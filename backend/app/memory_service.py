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
    for doc_id, entry in matches.items():
        overlap = entry["matched"] / len(checked)
        if overlap >= OVERLAP_RATIO_THRESHOLD:
            similar.append({
                "document_id": doc_id,
                "filename": entry["filename"],
                "uploaded_at": entry["uploaded_at"],
                "similarity": round(entry["best_similarity"], 3),
                "overlap": round(overlap, 3),
            })

    similar.sort(key=lambda d: (d["overlap"], d["similarity"]), reverse=True)
    return similar[:MAX_SIMILAR_DOCUMENTS]


def _store_document(user_id: str, filename: str, chunks: List[str], embeddings: List[List[float]]) -> str:
    """Persist a document and its chunk embeddings, replacing any earlier
    upload with the same filename so re-uploads don't accumulate stale
    copies (delete cascades to its chunks). Returns the new document id.
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

    return document_id


def _remember_upload_sync(external_user_id: str, filename: str, text: str):
    user_id = get_or_create_user(external_user_id)

    chunks = _chunk_text(text)
    if not chunks:
        return [], None
    embeddings = _embed(chunks)

    # Match before storing, so a re-upload of the same file is reported as
    # overlapping its earlier copy instead of silently replacing it.
    similar = _find_similar_documents(user_id, embeddings)
    document_id = _store_document(user_id, filename, chunks, embeddings)
    return similar, document_id


async def remember_upload(external_user_id: str, filename: str, text: str):
    """Embed + store an upload in the user's memory. Returns a
    (similar_documents, document_id) tuple: prior documents with substantial
    overlap, and the stored document's id (so the frontend can link
    generated artifacts back to it). Embedding is CPU-bound, so the whole
    pipeline runs in a worker thread. Callers should treat this as
    best-effort — an exception here must never fail the upload itself.
    """
    return await asyncio.to_thread(_remember_upload_sync, external_user_id, filename, text)


# --- Weak-concept retrieval for overlapping uploads (ROADMAP 3.2) ------------

# Concept names are short phrases matched against ~1000-char passages, which
# scores much lower than name-vs-name matching — hence a looser threshold
# than CONCEPT_MATCH_THRESHOLD (0.85) or chunk overlap (0.80).
WEAK_CONCEPT_SIMILARITY_THRESHOLD = 0.60

# Only concepts the student actually struggles with are worth emphasizing.
WEAK_CONCEPT_MASTERY_BELOW = 0.6

MAX_WEAK_CONCEPTS = 3


def _weak_concepts_for_text_sync(external_user_id: str, text: str) -> List[str]:
    client = _get_client()
    user = client.table("users").select("id").eq("external_id", external_user_id).execute()
    if not user.data:
        return []
    user_id = user.data[0]["id"]

    # A few chunks are enough to characterize the material's topics.
    chunks = _chunk_text(text)[:3]
    if not chunks:
        return []

    found: Dict[str, float] = {}  # concept -> mastery
    for embedding in _embed(chunks):
        rows = client.rpc("match_weak_concepts", {
            "query_embedding": embedding,
            "target_user_id": user_id,
            "mastery_below": WEAK_CONCEPT_MASTERY_BELOW,
            "match_threshold": WEAK_CONCEPT_SIMILARITY_THRESHOLD,
            "match_count": MAX_WEAK_CONCEPTS,
        }).execute().data or []
        for row in rows:
            found.setdefault(row["concept"], row["mastery"])

    weakest = sorted(found.items(), key=lambda item: item[1])[:MAX_WEAK_CONCEPTS]
    return [concept for concept, _ in weakest]


async def weak_concepts_for_text(external_user_id: str, text: str) -> List[str]:
    """The user's weakest stored concepts (from the tutor's cross-session
    knowledge state) that match this text, weakest first — used as emphasis
    hints in summary/quiz prompts when an upload overlaps prior material.
    Best-effort, like the rest of the memory layer."""
    return await asyncio.to_thread(_weak_concepts_for_text_sync, external_user_id, text)
