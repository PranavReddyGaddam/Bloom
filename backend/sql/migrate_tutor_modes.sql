-- Mode-based tutor sessions: replace the fixed question count with a mastery
-- bar per mode ("vibe_check" / "locked_in") and persist the verification and
-- recheck queues that drive the "same knowledge, different framing" loop.
-- max_questions is no longer chosen by the user; it keeps a default as the
-- session hard cap for old rows. Run once in the Supabase SQL editor.

alter table tutor_sessions
    add column if not exists mode text not null default 'vibe_check',
    add column if not exists verify_queue jsonb not null default '[]'::jsonb,
    add column if not exists recheck_queue jsonb not null default '[]'::jsonb,
    add column if not exists checkpoint_shown boolean not null default false;

alter table tutor_sessions alter column max_questions set default 35;
