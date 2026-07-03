-- Bloom quiz-attempt tracking schema
-- Run this once in the Supabase SQL editor for your project.
-- See PLAN_SUPABASE_ANALYTICS.md for the full design rationale.

create extension if not exists "pgcrypto";

create table if not exists users (
    id uuid primary key default gen_random_uuid(),
    external_id text unique,  -- nullable until auth lands; null = placeholder user
    created_at timestamptz not null default now()
);

-- Placeholder user row so every attempt has a valid user_id before auth exists.
-- Once real auth lands, new real users get their own rows; this one row can
-- stay indefinitely as a fallback/dev identity, or be retired later.
insert into users (id, external_id)
values ('00000000-0000-0000-0000-000000000001', 'placeholder')
on conflict (id) do nothing;

create table if not exists subjects (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references users(id),
    name text not null,
    created_at timestamptz not null default now(),
    unique (user_id, name)
);

create table if not exists quiz_attempts (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references users(id),
    subject_id uuid references subjects(id) on delete set null,
    subject text not null,  -- kept in sync with subjects.name for display/back-compat; see PLAN_USER_SUBJECTS.md
    difficulty text not null,
    total_questions integer not null,
    score double precision not null,
    created_at timestamptz not null default now()
);

create table if not exists question_attempts (
    id uuid primary key default gen_random_uuid(),
    quiz_attempt_id uuid not null references quiz_attempts(id) on delete cascade,
    question_text text not null,
    category text,
    difficulty text,
    user_answer text not null,
    correct_answer text not null,
    is_correct boolean not null,
    question_index integer not null
);

create index if not exists idx_quiz_attempts_user_id on quiz_attempts(user_id);
create index if not exists idx_quiz_attempts_subject_id on quiz_attempts(subject_id);
create index if not exists idx_subjects_user_id on subjects(user_id);
create index if not exists idx_question_attempts_quiz_attempt_id on question_attempts(quiz_attempt_id);
create index if not exists idx_question_attempts_category on question_attempts(category);
create index if not exists idx_question_attempts_difficulty on question_attempts(difficulty);
