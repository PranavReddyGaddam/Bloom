-- ROADMAP 3.2: when a new upload overlaps previously studied material, the
-- backend looks up the user's weakest concepts (from the tutor's
-- cross-session concept_mastery state) that match the upload's content and
-- passes them to summary/quiz generation as emphasis hints.
--
-- This RPC is match_concept_mastery with a mastery ceiling: only concepts
-- the student is still weak on are worth emphasizing.
-- Run once in the Supabase SQL editor (after migrate_concept_mastery.sql).

create or replace function match_weak_concepts(
    query_embedding vector(384),
    target_user_id uuid,
    mastery_below float,
    match_threshold float,
    match_count int
)
returns table (
    id uuid,
    concept text,
    mastery double precision,
    similarity float
)
language sql stable
as $$
    select
        cm.id,
        cm.concept,
        cm.mastery,
        1 - (cm.embedding <=> query_embedding) as similarity
    from concept_mastery cm
    where cm.user_id = target_user_id
      and cm.mastery < mastery_below
      and 1 - (cm.embedding <=> query_embedding) >= match_threshold
    order by cm.embedding <=> query_embedding
    limit match_count;
$$;
