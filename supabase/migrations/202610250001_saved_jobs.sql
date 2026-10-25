create table if not exists public.saved_jobs (
  user_id uuid not null references auth.users (id) on delete cascade,
  job_id text not null,
  title text not null,
  company text not null default '',
  location text not null default '',
  description text not null default '',
  url text not null default '',
  source text not null default '',
  job_created text not null default '',
  type text not null default '',
  experience text not null default '',
  skills text[] not null default '{}',
  salary text not null default '',
  saved_at timestamptz not null default now(),
  primary key (user_id, job_id)
);

create index if not exists saved_jobs_user_saved_at_idx
  on public.saved_jobs (user_id, saved_at desc);

alter table public.saved_jobs enable row level security;

drop policy if exists "Users can read their saved jobs" on public.saved_jobs;
create policy "Users can read their saved jobs"
  on public.saved_jobs for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can save their own jobs" on public.saved_jobs;
create policy "Users can save their own jobs"
  on public.saved_jobs for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can remove their own saved jobs" on public.saved_jobs;
create policy "Users can remove their own saved jobs"
  on public.saved_jobs for delete
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.saved_jobs from PUBLIC, anon, authenticated;
grant select, insert, delete on table public.saved_jobs to authenticated;
