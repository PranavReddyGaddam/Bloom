-- Cross-session knowledge state (ROADMAP 1.2): per-user mastery per concept,
-- persisted across tutor sessions so a new session on the same material
-- starts from what the tutor already knows about the student.
--
-- Concepts are free-text topic names extracted per session; each row stores
-- an embedding of the name (same local model as the memory layer,
-- fastembed / BAAI/bge-small-en-v1.5, 384-dim) so new sessions' topics can
-- be matched against existing rows by similarity — "Cell Respiration" and
-- "Cellular respiration" merge instead of duplicating.
-- Run once in the Supabase SQL editor.

create extension if not exists vector;

create table if not exists concept_mastery (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references users(id),
    concept text not null,
    embedding vector(384) not null,
    mastery double precision not null,
    questions_asked integer not null default 0,
    questions_correct integer not null default 0,
    last_seen_at timestamptz not null default now(),
    created_at timestamptz not null default now()
);

create index if not exists idx_concept_mastery_user_id on concept_mastery(user_id);
create index if not exists idx_concept_mastery_embedding
    on concept_mastery using hnsw (embedding vector_cosine_ops);

-- Nearest stored concept for one user above a similarity threshold.
-- Mirrors match_document_chunks in migrate_memory_layer.sql.
create or replace function match_concept_mastery(
    query_embedding vector(384),
    target_user_id uuid,
    match_threshold float,
    match_count int
)
returns table (
    id uuid,
    concept text,
    mastery double precision,
    questions_asked integer,
    questions_correct integer,
    similarity float
)
language sql stable
as $$
    select
        cm.id,
        cm.concept,
        cm.mastery,
        cm.questions_asked,
        cm.questions_correct,
        1 - (cm.embedding <=> query_embedding) as similarity
    from concept_mastery cm
    where cm.user_id = target_user_id
      and 1 - (cm.embedding <=> query_embedding) >= match_threshold
    order by cm.embedding <=> query_embedding
    limit match_count;
$$;

-- RLS consistent with the other migrations: service-role backend bypasses,
-- anon-key clients may only read their own rows.
alter table public.concept_mastery enable row level security;

create policy "Users can view their own concept mastery"
  on public.concept_mastery for select
  using (
    user_id in (select id from public.users where external_id = auth.uid()::text)
  );
