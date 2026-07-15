-- Persist adaptive tutor sessions (ROADMAP 1.1).
-- Sessions previously lived in an in-memory dict in tutor_agent.py and died
-- on every backend restart. This table is the source of truth; the dict
-- remains as a hot cache. Run once in the Supabase SQL editor.

create table if not exists tutor_sessions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references users(id),
    subject text not null,
    text_content text not null,
    max_questions integer not null,
    -- Per-concept knowledge state: {"<concept>": {"mastery": float,
    -- "questions_asked": int, "questions_correct": int}, ...}
    concepts jsonb not null,
    -- Question texts already asked, to avoid repeats within the session.
    asked_questions jsonb not null default '[]'::jsonb,
    -- The pending question (with its answer — never sent to the client) or null.
    current jsonb,
    -- Per-answer log, shaped like question_attempts rows, so a completed
    -- session can be recorded into quiz_attempts + question_attempts.
    history jsonb not null default '[]'::jsonb,
    questions_answered integer not null default 0,
    correct_answers integer not null default 0,
    status text not null default 'active',  -- 'active' | 'completed'
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_tutor_sessions_user_id on tutor_sessions(user_id);
create index if not exists idx_tutor_sessions_status on tutor_sessions(status);

-- Consistent with migrate_enable_rls.sql: the backend's service-role key
-- bypasses RLS; direct anon-key clients may only read their own sessions.
alter table public.tutor_sessions enable row level security;

create policy "Users can view their own tutor sessions"
  on public.tutor_sessions for select
  using (
    user_id in (select id from public.users where external_id = auth.uid()::text)
  );
