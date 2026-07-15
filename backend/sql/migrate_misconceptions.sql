-- Misconception memory: persist the tutor's per-wrong-answer diagnoses so
-- later sessions can probe a student's known misconceptions instead of
-- rediscovering them. Each row links to the user's concept_mastery row
-- (which already merges differently-phrased concept names by embedding
-- similarity), so retrieval is "misconceptions for this matched concept".
-- Run once in the Supabase SQL editor.

create table if not exists misconceptions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references users(id),
    concept_mastery_id uuid not null references concept_mastery(id) on delete cascade,
    concept text not null,
    misconception text not null,
    created_at timestamptz not null default now()
);

create index if not exists idx_misconceptions_user_id on misconceptions(user_id);
create index if not exists idx_misconceptions_concept_mastery_id
    on misconceptions(concept_mastery_id);

-- RLS consistent with the other migrations: service-role backend bypasses,
-- anon-key clients may only read their own rows.
alter table public.misconceptions enable row level security;

create policy "Users can view their own misconceptions"
  on public.misconceptions for select
  using (
    user_id in (select id from public.users where external_id = auth.uid()::text)
  );
