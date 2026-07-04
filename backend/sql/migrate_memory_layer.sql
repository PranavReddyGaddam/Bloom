-- Memory layer: per-user vector store over uploaded documents so the app
-- can recognize overlapping material across uploads (architecture_future.md
-- stage 4). Uses pgvector on the existing Supabase project — no new infra.
-- Run once in the Supabase SQL editor.

create extension if not exists vector;

create table if not exists documents (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references users(id),
    filename text not null,
    created_at timestamptz not null default now()
);

-- 384 dimensions matches the backend's local embedding model
-- (fastembed / BAAI/bge-small-en-v1.5). Changing models means changing
-- this dimension and re-embedding existing rows.
create table if not exists document_chunks (
    id uuid primary key default gen_random_uuid(),
    document_id uuid not null references documents(id) on delete cascade,
    user_id uuid not null references users(id),
    chunk_index integer not null,
    content text not null,
    embedding vector(384) not null
);

create index if not exists idx_documents_user_id on documents(user_id);
create index if not exists idx_document_chunks_user_id on document_chunks(user_id);
create index if not exists idx_document_chunks_document_id on document_chunks(document_id);
create index if not exists idx_document_chunks_embedding
    on document_chunks using hnsw (embedding vector_cosine_ops);

-- Similarity search scoped to one user's chunks. Called by the backend via
-- RPC with a freshly-embedded chunk of a new upload; returns the closest
-- prior chunks above the threshold, with their owning document's metadata.
create or replace function match_document_chunks(
    query_embedding vector(384),
    target_user_id uuid,
    match_threshold float,
    match_count int
)
returns table (
    document_id uuid,
    filename text,
    chunk_index integer,
    similarity float,
    uploaded_at timestamptz
)
language sql stable
as $$
    select
        dc.document_id,
        d.filename,
        dc.chunk_index,
        1 - (dc.embedding <=> query_embedding) as similarity,
        d.created_at as uploaded_at
    from document_chunks dc
    join documents d on d.id = dc.document_id
    where dc.user_id = target_user_id
      and 1 - (dc.embedding <=> query_embedding) >= match_threshold
    order by dc.embedding <=> query_embedding
    limit match_count;
$$;

-- RLS: the backend uses the service-role key (bypasses RLS); these policies
-- only constrain direct client access via the anon key, matching
-- migrate_enable_rls.sql.
alter table public.documents enable row level security;
alter table public.document_chunks enable row level security;

create policy "Users can view their own documents"
  on public.documents for select
  using (
    user_id in (select id from public.users where external_id = auth.uid()::text)
  );

create policy "Users can view their own document chunks"
  on public.document_chunks for select
  using (
    user_id in (select id from public.users where external_id = auth.uid()::text)
  );
