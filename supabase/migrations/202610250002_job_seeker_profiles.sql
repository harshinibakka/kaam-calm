create table if not exists public.job_seeker_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '' check (char_length(full_name) <= 160),
  phone text not null default '' check (char_length(phone) <= 40),
  location text not null default '' check (char_length(location) <= 160),
  headline text not null default '' check (char_length(headline) <= 240),
  summary text not null default '' check (char_length(summary) <= 5000),
  skills text[] not null default '{}',
  education jsonb not null default '[]'::jsonb check (jsonb_typeof(education) = 'array'),
  employment jsonb not null default '[]'::jsonb check (jsonb_typeof(employment) = 'array'),
  projects jsonb not null default '[]'::jsonb check (jsonb_typeof(projects) = 'array'),
  preferred_role text not null default '' check (char_length(preferred_role) <= 200),
  preferred_locations text[] not null default '{}',
  expected_salary text not null default '' check (char_length(expected_salary) <= 100),
  employment_type text not null default '' check (employment_type in ('', 'Full-time', 'Part-time', 'Contract', 'Internship', 'Freelance')),
  work_mode text not null default '' check (work_mode in ('', 'On-site', 'Hybrid', 'Remote')),
  certifications jsonb not null default '[]'::jsonb check (jsonb_typeof(certifications) = 'array'),
  portfolio_links jsonb not null default '[]'::jsonb check (jsonb_typeof(portfolio_links) = 'array'),
  languages text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.job_seeker_profiles enable row level security;

revoke all on table public.job_seeker_profiles from PUBLIC, anon, authenticated;
grant select, insert, update on table public.job_seeker_profiles to authenticated;

drop policy if exists "Users can read their own profile" on public.job_seeker_profiles;
create policy "Users can read their own profile"
  on public.job_seeker_profiles for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own profile" on public.job_seeker_profiles;
create policy "Users can create their own profile"
  on public.job_seeker_profiles for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own profile" on public.job_seeker_profiles;
create policy "Users can update their own profile"
  on public.job_seeker_profiles for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
