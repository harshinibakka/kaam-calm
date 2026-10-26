begin;

create table if not exists public.job_seeker_applications (
  user_id uuid not null references auth.users (id) on delete cascade,
  job_id text not null,
  title text not null,
  company text not null default '',
  location text not null default '',
  url text not null default '',
  source text not null default '',
  job_created text not null default '',
  status text not null default 'applied' check (status in ('applied')),
  applied_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (user_id, job_id)
);

create index if not exists job_seeker_applications_user_applied_at_idx
  on public.job_seeker_applications (user_id, applied_at desc);

alter table public.job_seeker_applications enable row level security;

drop policy if exists "Users can read their own job-seeker applications"
  on public.job_seeker_applications;
create policy "Users can read their own job-seeker applications"
  on public.job_seeker_applications for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can track their own job-seeker applications"
  on public.job_seeker_applications;
create policy "Users can track their own job-seeker applications"
  on public.job_seeker_applications for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own job-seeker applications"
  on public.job_seeker_applications;
drop policy if exists "Users can remove their own job-seeker applications"
  on public.job_seeker_applications;

revoke all on table public.job_seeker_applications from PUBLIC, anon, authenticated;
grant select, insert on table public.job_seeker_applications to authenticated;

commit;
