-- Bloom schema for CockroachDB — collapsed final state.
--
-- This is NOT a replay of ../*.sql. Those 13 files are the Supabase history and
-- cannot be applied in filename order: match_concept_mastery is created in
-- migrate_concept_mastery.sql then dropped and recreated with calibration
-- columns in migrate_calibration.sql. Here every table carries its final column
-- set and each function is defined once. Leave ../ untouched as history.
--
-- Differences from the Supabase originals, all deliberate:
--   * No `create extension` — gen_random_uuid() and VECTOR are built into
--     CockroachDB.
--   * No RLS policies. The backend holds the only credential and reaches the
--     database directly; authorization is enforced in application code as
--     user-scoped predicates on every query (see db.py delete_subject,
--     review_flashcard, get_tutor_session, delete_document). After this
--     migration there is no direct client -> database path at all.
--   * Vector indexes live in 002_vector_indexes.sql so a bulk IMPORT INTO can
--     run before they exist (IMPORT INTO is unsupported on tables that already
--     have a vector index).
--
-- Verified against CockroachDB CCL v26.2.1 on 2026-07-25.
-- Idempotent: safe to apply more than once.

-- ---------------------------------------------------------------- users

CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    external_id text UNIQUE,  -- null = placeholder/dev identity
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Placeholder user so every attempt has a valid user_id outside a real session.
INSERT INTO users (id, external_id)
VALUES ('00000000-0000-0000-0000-000000000001', 'placeholder')
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------- subjects

CREATE TABLE IF NOT EXISTS subjects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id),
    name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_subjects_user_id ON subjects(user_id);

-- ------------------------------------------------------------ documents

CREATE TABLE IF NOT EXISTS documents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id),
    filename text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documents_user_id ON documents(user_id);

-- 384 dimensions matches the backend's local embedding model
-- (fastembed / BAAI/bge-small-en-v1.5). Changing models means changing this
-- dimension and re-embedding every existing row.
CREATE TABLE IF NOT EXISTS document_chunks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id),
    chunk_index integer NOT NULL,
    content text NOT NULL,
    embedding VECTOR(384) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_document_chunks_user_id ON document_chunks(user_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_document_id ON document_chunks(document_id);

-- -------------------------------------------------------- quiz attempts

CREATE TABLE IF NOT EXISTS quiz_attempts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id),
    subject_id uuid REFERENCES subjects(id) ON DELETE SET NULL,
    subject text NOT NULL,  -- kept in sync with subjects.name for display
    difficulty text NOT NULL,
    total_questions integer NOT NULL,
    score double precision NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS question_attempts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    quiz_attempt_id uuid NOT NULL REFERENCES quiz_attempts(id) ON DELETE CASCADE,
    question_text text NOT NULL,
    category text,
    difficulty text,
    user_answer text NOT NULL,
    correct_answer text NOT NULL,
    is_correct boolean NOT NULL,
    question_index integer NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user_id ON quiz_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_subject_id ON quiz_attempts(subject_id);
CREATE INDEX IF NOT EXISTS idx_question_attempts_quiz_attempt_id
    ON question_attempts(quiz_attempt_id);
CREATE INDEX IF NOT EXISTS idx_question_attempts_category ON question_attempts(category);
CREATE INDEX IF NOT EXISTS idx_question_attempts_difficulty ON question_attempts(difficulty);

-- ------------------------------------------------------ concept mastery

-- Final shape: base columns + calibration counters (migrate_calibration.sql)
-- + review scheduling (migrate_concept_reviews.sql).
CREATE TABLE IF NOT EXISTS concept_mastery (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id),
    concept text NOT NULL,
    embedding VECTOR(384) NOT NULL,
    mastery double precision NOT NULL,
    questions_asked integer NOT NULL DEFAULT 0,
    questions_correct integer NOT NULL DEFAULT 0,
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    -- Calibration: lifetime (confidence, correctness) counters. Medium
    -- confidence is not tracked — only the informative ends.
    conf_high_asked integer NOT NULL DEFAULT 0,
    conf_high_correct integer NOT NULL DEFAULT 0,
    conf_low_asked integer NOT NULL DEFAULT 0,
    conf_low_correct integer NOT NULL DEFAULT 0,
    -- Spaced repetition over concepts (SM-2 shape, like flashcards).
    document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
    subject text,
    review_interval_days double precision NOT NULL DEFAULT 0,
    review_count integer NOT NULL DEFAULT 0,
    review_due_at timestamptz  -- null = never scheduled
);

CREATE INDEX IF NOT EXISTS idx_concept_mastery_user_id ON concept_mastery(user_id);
CREATE INDEX IF NOT EXISTS idx_concept_mastery_review_due
    ON concept_mastery(user_id, review_due_at);

-- ------------------------------------------------------- misconceptions

CREATE TABLE IF NOT EXISTS misconceptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id),
    concept_mastery_id uuid NOT NULL REFERENCES concept_mastery(id) ON DELETE CASCADE,
    concept text NOT NULL,
    misconception text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_misconceptions_user_id ON misconceptions(user_id);
CREATE INDEX IF NOT EXISTS idx_misconceptions_concept_mastery_id
    ON misconceptions(concept_mastery_id);

-- ------------------------------------------------------ tutor sessions

-- Source of truth for adaptive tutor sessions; tutor_agent.py keeps an
-- in-memory dict as a hot cache on top of this.
CREATE TABLE IF NOT EXISTS tutor_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id),
    subject text NOT NULL,
    text_content text NOT NULL,
    max_questions integer NOT NULL DEFAULT 35,  -- session hard cap
    -- {"<concept>": {"mastery": float, "questions_asked": int,
    --                "questions_correct": int}, ...}
    concepts jsonb NOT NULL,
    -- Question texts already asked, to avoid repeats within the session.
    asked_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- Pending question (with its answer — never sent to the client) or null.
    current jsonb,
    -- Per-answer log shaped like question_attempts rows, so a completed
    -- session can be recorded into quiz_attempts + question_attempts.
    history jsonb NOT NULL DEFAULT '[]'::jsonb,
    questions_answered integer NOT NULL DEFAULT 0,
    correct_answers integer NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'active',  -- 'active' | 'completed'
    -- Mode-based sessions: mastery bar per mode replaces a fixed count.
    mode text NOT NULL DEFAULT 'vibe_check',  -- 'vibe_check' | 'locked_in'
    verify_queue jsonb NOT NULL DEFAULT '[]'::jsonb,
    recheck_queue jsonb NOT NULL DEFAULT '[]'::jsonb,
    checkpoint_shown boolean NOT NULL DEFAULT false,
    -- Multi-document sessions: [{document_id, filename, text_content}].
    -- Null rehydrates from text_content as a single source.
    sources jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tutor_sessions_user_id ON tutor_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_tutor_sessions_status ON tutor_sessions(status);

-- ----------------------------------------------------------- flashcards

CREATE TABLE IF NOT EXISTS flashcard_sets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id),
    subject text NOT NULL,
    card_type text NOT NULL,
    -- The set outlives the document it was generated from.
    document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS flashcards (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    set_id uuid NOT NULL REFERENCES flashcard_sets(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id),
    front text NOT NULL,
    back text NOT NULL,
    category text,
    -- SM-2 state. interval_days 0 = "learning" (due again within minutes);
    -- ease is clamped to >= 1.3 like classic SM-2.
    interval_days double precision NOT NULL DEFAULT 0,
    ease double precision NOT NULL DEFAULT 2.5,
    repetitions integer NOT NULL DEFAULT 0,
    due_at timestamptz NOT NULL DEFAULT now(),
    last_reviewed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_flashcard_sets_user_id ON flashcard_sets(user_id);
CREATE INDEX IF NOT EXISTS idx_flashcards_set_id ON flashcards(set_id);
CREATE INDEX IF NOT EXISTS idx_flashcards_user_due ON flashcards(user_id, due_at);

-- ------------------------------------------------------------ functions

-- Similarity search scoped to one user's chunks. Called with a freshly
-- embedded chunk of a new upload; returns the closest prior chunks above the
-- threshold with their owning document's metadata.
CREATE OR REPLACE FUNCTION match_document_chunks(
    query_embedding VECTOR(384),
    target_user_id uuid,
    match_threshold float,
    match_count int
)
RETURNS TABLE (
    document_id uuid,
    filename text,
    chunk_index integer,
    similarity float,
    uploaded_at timestamptz
)
LANGUAGE SQL STABLE
AS $$
    SELECT
        dc.document_id,
        d.filename,
        dc.chunk_index,
        1 - (dc.embedding <=> query_embedding) AS similarity,
        d.created_at AS uploaded_at
    FROM document_chunks dc
    JOIN documents d ON d.id = dc.document_id
    WHERE dc.user_id = target_user_id
      AND 1 - (dc.embedding <=> query_embedding) >= match_threshold
    ORDER BY dc.embedding <=> query_embedding
    LIMIT match_count;
$$;

-- Nearest stored concepts for one user above a similarity threshold.
-- Defined ONCE here in its final 10-column calibration form (Supabase built
-- this in two steps: migrate_concept_mastery.sql then migrate_calibration.sql).
CREATE OR REPLACE FUNCTION match_concept_mastery(
    query_embedding VECTOR(384),
    target_user_id uuid,
    match_threshold float,
    match_count int
)
RETURNS TABLE (
    id uuid,
    concept text,
    mastery double precision,
    questions_asked integer,
    questions_correct integer,
    conf_high_asked integer,
    conf_high_correct integer,
    conf_low_asked integer,
    conf_low_correct integer,
    similarity float
)
LANGUAGE SQL STABLE
AS $$
    SELECT
        cm.id,
        cm.concept,
        cm.mastery,
        cm.questions_asked,
        cm.questions_correct,
        cm.conf_high_asked,
        cm.conf_high_correct,
        cm.conf_low_asked,
        cm.conf_low_correct,
        1 - (cm.embedding <=> query_embedding) AS similarity
    FROM concept_mastery cm
    WHERE cm.user_id = target_user_id
      AND 1 - (cm.embedding <=> query_embedding) >= match_threshold
    ORDER BY cm.embedding <=> query_embedding
    LIMIT match_count;
$$;

-- match_concept_mastery with a mastery ceiling: only concepts the student is
-- still weak on are worth emphasizing in summary/quiz generation.
CREATE OR REPLACE FUNCTION match_weak_concepts(
    query_embedding VECTOR(384),
    target_user_id uuid,
    mastery_below float,
    match_threshold float,
    match_count int
)
RETURNS TABLE (
    id uuid,
    concept text,
    mastery double precision,
    similarity float
)
LANGUAGE SQL STABLE
AS $$
    SELECT
        cm.id,
        cm.concept,
        cm.mastery,
        1 - (cm.embedding <=> query_embedding) AS similarity
    FROM concept_mastery cm
    WHERE cm.user_id = target_user_id
      AND cm.mastery < mastery_below
      AND 1 - (cm.embedding <=> query_embedding) >= match_threshold
    ORDER BY cm.embedding <=> query_embedding
    LIMIT match_count;
$$;
