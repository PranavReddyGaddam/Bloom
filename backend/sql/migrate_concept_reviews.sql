-- Spaced repetition for concepts (ROADMAP_LEARNING 6): concepts decay like
-- flashcards do. Each concept_mastery row carries a review schedule that
-- grows with every session that confirms the concept (SM-2 shape, like
-- flashcards) and resets when a refresher finds it slipping. document_id
-- and subject remember where the concept was learned, so a due concept can
-- one-click into a tutor refresher on the source document's stored content.
-- Run once in the Supabase SQL editor.

alter table concept_mastery
    add column if not exists document_id uuid references documents(id) on delete set null,
    add column if not exists subject text,
    add column if not exists review_interval_days double precision not null default 0,
    add column if not exists review_count integer not null default 0,
    -- Null = never scheduled (concept has not yet cleared a session's bar).
    add column if not exists review_due_at timestamptz;

create index if not exists idx_concept_mastery_review_due
    on concept_mastery(user_id, review_due_at);
