-- One-time backfill: create subjects rows from existing quiz_attempts'
-- free-text subject values, then link those attempts to the new subject_id.
-- Run once, after schema.sql, before shipping the user-subjects feature.
-- Safe to re-run (idempotent): uses the (user_id, name) unique constraint
-- and only updates rows where subject_id is still null.
-- See PLAN_USER_SUBJECTS.md for design rationale.

insert into subjects (user_id, name)
select distinct user_id, subject
from quiz_attempts
where subject_id is null
on conflict (user_id, name) do nothing;

update quiz_attempts qa
set subject_id = s.id
from subjects s
where qa.subject_id is null
  and qa.user_id = s.user_id
  and qa.subject = s.name;
