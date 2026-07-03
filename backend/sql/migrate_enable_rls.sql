-- Enable Row Level Security on all tables and add policies scoping every
-- row to its owning user. The backend uses the service-role key (bypasses
-- RLS entirely, by design), so this only affects direct client access via
-- the anon/publishable key — e.g. the frontend's Supabase Auth session
-- client. Run once in the Supabase SQL editor.

alter table public.users enable row level security;
alter table public.quiz_attempts enable row level security;
alter table public.question_attempts enable row level security;

-- users: a user can only see/update their own row (matched via Supabase
-- Auth's auth.uid(), compared against the external_id text column).
create policy "Users can view their own user row"
  on public.users for select
  using (external_id = auth.uid()::text);

create policy "Users can update their own user row"
  on public.users for update
  using (external_id = auth.uid()::text);

-- quiz_attempts: scoped via the owning user's external_id.
create policy "Users can view their own quiz attempts"
  on public.quiz_attempts for select
  using (
    user_id in (select id from public.users where external_id = auth.uid()::text)
  );

create policy "Users can insert their own quiz attempts"
  on public.quiz_attempts for insert
  with check (
    user_id in (select id from public.users where external_id = auth.uid()::text)
  );

-- question_attempts: scoped via the parent quiz_attempts row's owner.
create policy "Users can view their own question attempts"
  on public.question_attempts for select
  using (
    quiz_attempt_id in (
      select id from public.quiz_attempts
      where user_id in (select id from public.users where external_id = auth.uid()::text)
    )
  );

create policy "Users can insert their own question attempts"
  on public.question_attempts for insert
  with check (
    quiz_attempt_id in (
      select id from public.quiz_attempts
      where user_id in (select id from public.users where external_id = auth.uid()::text)
    )
  );
