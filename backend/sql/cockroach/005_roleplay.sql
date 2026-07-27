-- Voice roleplay sessions (ROADMAP_HONEN Phase 4).
--
-- Roleplay reuses tutor_sessions rather than adding a parallel table. A new
-- table would duplicate user_id / subject / text_content / sources / status
-- verbatim, and then force a second code path everywhere a study session is
-- read back: the recent-attempts sidebar, analytics, and the session-resume
-- lookup would each need to union two tables that differ only in their state
-- columns. `mode` already discriminates ('tutor' vs 'roleplay'), which is what
-- that column is for.
--
-- The split is enforced in code, not schema: these four columns are written
-- only by db._ROLEPLAY_STATE_FIELDS, and the tutor's own state fields are
-- untouched by the roleplay path. Extending _TUTOR_STATE_FIELDS instead would
-- have been the tempting move and is a trap — create_tutor_session subscripts
-- `session[field]` bare, so every added field raises KeyError on every
-- existing tutor start unless tutor_agent's dict changes in lockstep.
--
-- `concepts` and `checkpoint_shown` are deliberately NOT added here: both
-- already exist for the tutor and carry the same meaning for roleplay, so both
-- tuples name them identically and share the columns.
--
-- `turns_taken` is new rather than reusing the tutor's `questions_answered`,
-- which counts graded question attempts — a different thing from conversational
-- turns, and conflating them would corrupt tutor analytics.
--
-- One ALTER per statement so a partial failure names the column that failed.
-- Apply after 004_document_originals.sql. Idempotent: safe to apply twice.

ALTER TABLE tutor_sessions ADD COLUMN IF NOT EXISTS scenario jsonb;
ALTER TABLE tutor_sessions ADD COLUMN IF NOT EXISTS transcript jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE tutor_sessions ADD COLUMN IF NOT EXISTS rubric_result jsonb;
ALTER TABLE tutor_sessions ADD COLUMN IF NOT EXISTS turns_taken int NOT NULL DEFAULT 0;
