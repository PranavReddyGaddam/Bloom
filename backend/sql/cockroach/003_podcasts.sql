-- Podcasts (ROADMAP_HONEN 3.3): a two-speaker audio episode generated from a
-- document, for reviewing material away from a screen.
--
-- The audio itself lives in S3, not here — a five-minute MP3 is several MB and
-- CockroachDB ranges are the wrong home for blobs. `audio_key` is the object
-- key within the configured bucket (storage_service.py owns the layout);
-- bytes are streamed back through an ownership-checked API route so the
-- bucket never needs to be public.
--
-- The script is kept alongside it deliberately. It is the transcript the
-- player follows along with, it makes an episode searchable as text, and it
-- means regenerating audio (a different voice, a failed synthesis) costs one
-- TTS call rather than a second LLM pass.
--
-- Apply after 001_schema.sql. Idempotent: safe to apply more than once.

CREATE TABLE IF NOT EXISTS podcasts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id),
    -- The episode outlives the document it came from, matching flashcard_sets.
    document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
    subject text NOT NULL,
    title text NOT NULL,
    -- [{"speaker": "host" | "explainer", "text": "..."}] in playback order.
    script jsonb NOT NULL,
    -- S3 object key. Null means the script was written and grounded but
    -- synthesis failed — the transcript is still worth keeping and showing.
    audio_key text,
    duration_seconds integer,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_podcasts_user_id ON podcasts(user_id, created_at DESC);
