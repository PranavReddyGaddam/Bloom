-- Vector indexes, kept out of 001_schema.sql on purpose.
--
-- IMPORT INTO is unsupported on tables that already have a vector index, so a
-- bulk load must happen between 001 and 002. On a fresh cluster with no bulk
-- load, just apply both in order.
--
-- CockroachDB's vector index is k-means partitioned (C-SPANN), not HNSW —
-- a different implementation behind the same interface, and APPROXIMATE where
-- the Supabase original did an exhaustive scan. Recall must be measured, not
-- assumed; see the spike in MIGRATION_COCKROACHDB.md.
--
-- feature.vector_index.enabled was already true on CockroachDB Basic when
-- checked (v26.2.1, 2026-07-25) — no cluster setting needed here.
--
-- PREFIX COLUMNS: every similarity query filters `WHERE user_id = ...`, and
-- CockroachDB accelerates filtered vector search only when the filters match
-- the index's prefix columns. Hence (user_id, embedding). This is a hypothesis
-- to confirm with EXPLAIN, not settled fact — if EXPLAIN shows a full scan,
-- revisit before trusting it.

CREATE VECTOR INDEX IF NOT EXISTS idx_document_chunks_embedding
    ON document_chunks (user_id, embedding vector_cosine_ops);

CREATE VECTOR INDEX IF NOT EXISTS idx_concept_mastery_embedding
    ON concept_mastery (user_id, embedding vector_cosine_ops);
