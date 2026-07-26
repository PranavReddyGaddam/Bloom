"""Memory layer: per-user vector store over uploaded documents.

On every upload the extracted text is chunked, embedded locally (no API
call), compared against the user's previously stored chunks in CockroachDB's
vector index, and then stored. The comparison result is surfaced to the user
as "you've already studied similar material in <file>".

Embeddings run locally via fastembed (ONNX, BAAI/bge-small-en-v1.5,
384-dim) because OpenRouter — the app's only LLM provider — does not serve
an embeddings endpoint, and a local model keeps this layer free and
key-less.
"""
import asyncio
from typing import Dict, List

from fastembed import TextEmbedding

from .database import cursor, retry_on_serialization_failure, to_vector, transaction
from .db import _lookup_user_id, get_or_create_user

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

# Chunk rows per INSERT batch when storing a document. CockroachDB warns that
# large batched VECTOR inserts degrade performance, and chunk count is
# unbounded (MAX_CHUNKS_CHECKED caps the overlap check, not storage).
CHUNKS_PER_INSERT_BATCH = 64

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
    checked = embeddings[:MAX_CHUNKS_CHECKED]

    # document_id -> {"filename", "uploaded_at", "matched", "best_similarity"}
    matches: Dict[str, Dict] = {}
    # One query per chunk (up to MAX_CHUNKS_CHECKED). Kept as a loop to match
    # the previous behavior exactly; collapsing it into a single query is a
    # worthwhile follow-up but changes result semantics, so not in this port.
    with cursor() as cur:
        for embedding in checked:
            cur.execute(
                "SELECT * FROM match_document_chunks(%s, %s, %s, %s)",
                (to_vector(embedding), user_id, SIMILARITY_THRESHOLD, 3),
            )
            rows = cur.fetchall()

            # Count each prior document at most once per new chunk.
            seen_this_chunk = set()
            for row in rows:
                # psycopg returns uuid columns as UUID objects; the key is
                # compared against document ids elsewhere and surfaced to the
                # frontend, both of which expect strings.
                doc_id = str(row["document_id"])
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
            uploaded_at = entry["uploaded_at"]
            similar.append({
                "document_id": doc_id,
                "filename": entry["filename"],
                # datetime from psycopg where supabase-py returned a string;
                # SimilarDocument declares uploaded_at: str.
                "uploaded_at": uploaded_at.isoformat().replace("+00:00", "Z")
                if hasattr(uploaded_at, "isoformat") else uploaded_at,
                "similarity": round(entry["best_similarity"], 3),
                "overlap": round(overlap, 3),
            })

    similar.sort(key=lambda d: (d["overlap"], d["similarity"]), reverse=True)
    return similar[:MAX_SIMILAR_DOCUMENTS]


@retry_on_serialization_failure
def _store_document(user_id: str, filename: str, chunks: List[str], embeddings: List[List[float]]) -> str:
    """Persist a document and its chunk embeddings, replacing the content of
    any earlier upload with the same filename so re-uploads don't accumulate
    stale copies. Returns the document id.

    The whole operation is one transaction. Previously the DELETE and the
    INSERT were independent calls, so a failure between them left a document
    row with zero chunks — the library would list the file while opening it
    returned empty text.

    Re-uploading reuses the existing row and swaps only its chunks, so the
    document id is stable across re-uploads. That matters because the id is
    referenced from outside this table — concept_mastery.document_id (a
    concept's source material for spaced-repetition refreshers) and the
    client's stored pointer to the material being studied. Deleting and
    re-inserting would mint a new id and silently orphan all of them.
    """
    with transaction() as cur:
        cur.execute(
            "SELECT id FROM documents WHERE user_id = %s AND filename = %s",
            (user_id, filename),
        )
        existing = cur.fetchone()

        if existing:
            document_id = str(existing["id"])
            # Same document, new content: drop the old chunks (they're replaced
            # wholesale below — a shorter re-upload must not leave a tail of
            # stale chunks behind) and keep the row itself.
            cur.execute("DELETE FROM document_chunks WHERE document_id = %s", (document_id,))
        else:
            cur.execute(
                "INSERT INTO documents (user_id, filename) VALUES (%s, %s) RETURNING id",
                (user_id, filename),
            )
            document_id = str(cur.fetchone()["id"])

        # Batched rather than one statement for the whole document. CockroachDB
        # documents that large batched VECTOR inserts degrade performance, and
        # nothing caps the chunk count — MAX_CHUNKS_CHECKED bounds the overlap
        # check only, so a long upload can produce hundreds of chunks.
        rows = [
            (document_id, user_id, index, chunk, to_vector(embedding))
            for index, (chunk, embedding) in enumerate(zip(chunks, embeddings))
        ]
        for start in range(0, len(rows), CHUNKS_PER_INSERT_BATCH):
            cur.executemany(
                "INSERT INTO document_chunks"
                " (document_id, user_id, chunk_index, content, embedding)"
                " VALUES (%s,%s,%s,%s,%s)",
                rows[start:start + CHUNKS_PER_INSERT_BATCH],
            )

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
    user_id = _lookup_user_id(external_user_id)
    if not user_id:
        return []

    # A few chunks are enough to characterize the material's topics.
    chunks = _chunk_text(text)[:3]
    if not chunks:
        return []

    found: Dict[str, float] = {}  # concept -> mastery
    with cursor() as cur:
        for embedding in _embed(chunks):
            cur.execute(
                "SELECT * FROM match_weak_concepts(%s, %s, %s, %s, %s)",
                (to_vector(embedding), user_id, WEAK_CONCEPT_MASTERY_BELOW,
                 WEAK_CONCEPT_SIMILARITY_THRESHOLD, MAX_WEAK_CONCEPTS),
            )
            for row in cur.fetchall():
                found.setdefault(row["concept"], row["mastery"])

    weakest = sorted(found.items(), key=lambda item: item[1])[:MAX_WEAK_CONCEPTS]
    return [concept for concept, _ in weakest]


async def weak_concepts_for_text(external_user_id: str, text: str) -> List[str]:
    """The user's weakest stored concepts (from the tutor's cross-session
    knowledge state) that match this text, weakest first — used as emphasis
    hints in summary/quiz prompts when an upload overlaps prior material.
    Best-effort, like the rest of the memory layer."""
    return await asyncio.to_thread(_weak_concepts_for_text_sync, external_user_id, text)
