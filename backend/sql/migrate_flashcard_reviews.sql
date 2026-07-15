-- Spaced repetition for flashcards (ROADMAP 4.1): flashcards stop being
-- generate-and-forget. Every generated set is persisted per user, each card
-- carries SM-2-style scheduling state updated by self-graded reviews
-- ("again / hard / good / easy"), and a "due today" view brings the user
-- back at growing intervals.
-- Run once in the Supabase SQL editor (after migrate_memory_layer.sql).

create table if not exists flashcard_sets (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references users(id),
    subject text not null,
    card_type text not null,
    -- Optional link back to the stored upload the set was generated from
    -- (documents library, ROADMAP 3.1). The set outlives the document.
    document_id uuid references documents(id) on delete set null,
    created_at timestamptz not null default now()
);

create table if not exists flashcards (
    id uuid primary key default gen_random_uuid(),
    set_id uuid not null references flashcard_sets(id) on delete cascade,
    user_id uuid not null references users(id),
    front text not null,
    back text not null,
    category text,
    -- SM-2 scheduling state. interval_days 0 = "learning" (due again within
    -- minutes); ease is clamped to >= 1.3 like classic SM-2.
    interval_days double precision not null default 0,
    ease double precision not null default 2.5,
    repetitions integer not null default 0,
    due_at timestamptz not null default now(),
    last_reviewed_at timestamptz,
    created_at timestamptz not null default now()
);

create index if not exists idx_flashcard_sets_user_id on flashcard_sets(user_id);
create index if not exists idx_flashcards_set_id on flashcards(set_id);
create index if not exists idx_flashcards_user_due on flashcards(user_id, due_at);

-- RLS consistent with the other migrations: service-role backend bypasses,
-- anon-key clients may only read their own rows.
alter table public.flashcard_sets enable row level security;
alter table public.flashcards enable row level security;

create policy "Users can view their own flashcard sets"
  on public.flashcard_sets for select
  using (
    user_id in (select id from public.users where external_id = auth.uid()::text)
  );

create policy "Users can view their own flashcards"
  on public.flashcards for select
  using (
    user_id in (select id from public.users where external_id = auth.uid()::text)
  );
