-- Multi-document tutor sessions (ROADMAP_LEARNING 3, stage 1): material
-- arrives in sets — a week of a course is three decks plus a reading — so a
-- session's source is a list of documents, not one blob. `sources` holds
-- [{document_id, filename, text_content}] per session; concepts are extracted
-- per file and interleaved across them, and each concept remembers which file
-- it came from so the summary can name the material to go re-read.
--
-- text_content stays: it's still the whole-corpus blob (and keeps sessions
-- started before this migration readable — a null `sources` rehydrates from
-- it as a single source).
-- Run once in the Supabase SQL editor.

alter table tutor_sessions
    add column if not exists sources jsonb;
