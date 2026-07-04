"""Memory layer: per-user vector store over uploaded documents.

On every upload the extracted text is chunked, embedded locally (no API
call), compared against the user's previously stored chunks in Supabase
pgvector, and then stored. The comparison result is surfaced to the user as
"you've already studied similar material in <file>".

Embeddings run locally via fastembed (ONNX, BAAI/bge-small-en-v1.5,
384-dim) because OpenRouter — the app's only LLM provider — does not serve
an embeddings endpoint, and a local model keeps this layer free and
key-less.
"""
import asyncio
from typing import Dict, List

from fastembed import TextEmbedding

from .db import _get_client, get_or_create_user

EMBEDDING_MODEL = "BAAI/bge-small-en-v1.5"  # 384-dim; must match vector(384) in the schema
CHUNK_CHARS = 1000

# A chunk pair below this cosine similarity isn't treated as overlap.
# bge-small scores unrelated academic text around 0.6-0.7, near-duplicate
# text 0.9+, so 0.8 separates "same topic" from "same material".
SIMILARITY_THRESHOLD = 0.80

# Fraction of a new upload's chunks that must match an existing document
# before it's worth telling the user about.
OVERLAP_RATIO_THRESHOLD = 0.30

# Cap on chunks used for the overlap check (one RPC each). Storage still
# embeds and keeps every chunk.
MAX_CHUNKS_CHECKED = 12

MAX_SIMILAR_DOCUMENTS = 3

_model: TextEmbedding = None


def _get_model() -> TextEmbedding:
    global _model
    if _model is None:
        # First instantiation downloads the model (~100 MB) to the local
        # cache; subsequent startups load from disk.
        _model = TextEmbedding(model_name=EMBEDDING_MODEL)
    return _model


def _chunk_text(text: str) -> List[str]:
    """Split text into ~CHUNK_CHARS chunks on paragraph boundaries, so a
    chunk stays a coherent unit of meaning rather than an arbitrary slice.
    """
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    chunks: List[str] = []
    current = ""

    for paragraph in paragraphs:
        # A single paragraph longer than the budget gets hard-split.
        while len(paragraph) > CHUNK_CHARS:
            if current:
                chunks.append(current)
                current = ""
            chunks.append(paragraph[:CHUNK_CHARS])
            paragraph = paragraph[CHUNK_CHARS:]

        if len(current) + len(paragraph) + 2 > CHUNK_CHARS and current:
            chunks.append(current)
            current = paragraph
        else:
            current = f"{current}\n\n{paragraph}" if current else paragraph

    if current:
        chunks.append(current)
    return chunks


def _embed(texts: List[str]) -> List[List[float]]:
    return [vector.tolist() for vector in _get_model().embed(texts)]


def _find_similar_documents(user_id: str, embeddings: List[List[float]]) -> List[Dict]:
    """Match a new upload's chunk embeddings against the user's stored
    chunks and aggregate matches per prior document.
    """
    client = _get_client()
    checked = embeddings[:MAX_CHUNKS_CHECKED]

    # document_id -> {"filename", "uploaded_at", "matched", "best_similarity"}
    matches: Dict[str, Dict] = {}
    for embedding in checked:
        rows = client.rpc("match_document_chunks", {
            "query_embedding": embedding,
            "target_user_id": user_id,
            "match_threshold": SIMILARITY_THRESHOLD,
            "match_count": 3,
        }).execute().data or []

        # Count each prior document at most once per new chunk.
        seen_this_chunk = set()
        for row in rows:
            doc_id = row["document_id"]
            entry = matches.setdefault(doc_id, {
                "filename": row["filename"],
                "uploaded_at": row["uploaded_at"],
                "matched": 0,
                "best_similarity": 0.0,
            })
            if doc_id not in seen_this_chunk:
                entry["matched"] += 1
                seen_this_chunk.add(doc_id)
            entry["best_similarity"] = max(entry["best_similarity"], row["similarity"])

    similar = []
    for entry in matches.values():
        overlap = entry["matched"] / len(checked)
        if overlap >= OVERLAP_RATIO_THRESHOLD:
            similar.append({
                "filename": entry["filename"],
                "uploaded_at": entry["uploaded_at"],
                "similarity": round(entry["best_similarity"], 3),
                "overlap": round(overlap, 3),
            })

    similar.sort(key=lambda d: (d["overlap"], d["similarity"]), reverse=True)
    return similar[:MAX_SIMILAR_DOCUMENTS]


def _store_document(user_id: str, filename: str, chunks: List[str], embeddings: List[List[float]]) -> None:
    """Persist a document and its chunk embeddings, replacing any earlier
    upload with the same filename so re-uploads don't accumulate stale
    copies (delete cascades to its chunks).
    """
    client = _get_client()

    client.table("documents").delete().eq("user_id", user_id).eq("filename", filename).execute()

    document = client.table("documents").insert({
        "user_id": user_id,
        "filename": filename,
    }).execute()
    document_id = document.data[0]["id"]

    client.table("document_chunks").insert([
        {
            "document_id": document_id,
            "user_id": user_id,
            "chunk_index": index,
            "content": chunk,
            "embedding": embedding,
        }
        for index, (chunk, embedding) in enumerate(zip(chunks, embeddings))
    ]).execute()


def _remember_upload_sync(external_user_id: str, filename: str, text: str) -> List[Dict]:
    user_id = get_or_create_user(external_user_id)

    chunks = _chunk_text(text)
    if not chunks:
        return []
    embeddings = _embed(chunks)

    # Match before storing, so a re-upload of the same file is reported as
    # overlapping its earlier copy instead of silently replacing it.
    similar = _find_similar_documents(user_id, embeddings)
    _store_document(user_id, filename, chunks, embeddings)
    return similar


async def remember_upload(external_user_id: str, filename: str, text: str) -> List[Dict]:
    """Embed + store an upload in the user's memory and return prior
    documents with substantial overlap. Embedding is CPU-bound, so the
    whole pipeline runs in a worker thread. Callers should treat this as
    best-effort — an exception here must never fail the upload itself.
    """
    return await asyncio.to_thread(_remember_upload_sync, external_user_id, filename, text)
