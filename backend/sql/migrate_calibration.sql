-- Calibration feedback (ROADMAP_LEARNING 5): lifetime (confidence, correctness)
-- counters per concept. The per-answer confidence already scales the mastery
-- delta; these columns accumulate it so miscalibration (confidently wrong /
-- unsure but right) can be shown back to the student across sessions.
-- Medium ("fairly sure") answers aren't tracked — only the informative ends.
-- Run once in the Supabase SQL editor.

alter table concept_mastery add column if not exists conf_high_asked integer not null default 0;
alter table concept_mastery add column if not exists conf_high_correct integer not null default 0;
alter table concept_mastery add column if not exists conf_low_asked integer not null default 0;
alter table concept_mastery add column if not exists conf_low_correct integer not null default 0;

-- Recreate match_concept_mastery with the calibration counters in its return
-- set (changing a function's return type requires dropping it first).
drop function if exists match_concept_mastery(vector(384), uuid, float, int);

create function match_concept_mastery(
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
    conf_high_asked integer,
    conf_high_correct integer,
    conf_low_asked integer,
    conf_low_correct integer,
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
        cm.conf_high_asked,
        cm.conf_high_correct,
        cm.conf_low_asked,
        cm.conf_low_correct,
        1 - (cm.embedding <=> query_embedding) as similarity
    from concept_mastery cm
    where cm.user_id = target_user_id
      and 1 - (cm.embedding <=> query_embedding) >= match_threshold
    order by cm.embedding <=> query_embedding
    limit match_count;
$$;
