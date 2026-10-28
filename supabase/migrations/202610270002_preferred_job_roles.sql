begin;

alter table public.job_seeker_profiles
  add column if not exists preferred_roles text[] not null default '{}';

update public.job_seeker_profiles
set preferred_roles = array[preferred_role]
where cardinality(preferred_roles) = 0 and trim(preferred_role) <> '';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.job_seeker_profiles'::regclass
      and conname = 'job_seeker_profiles_preferred_roles_max_three'
  ) then
    alter table public.job_seeker_profiles
      add constraint job_seeker_profiles_preferred_roles_max_three
      check (cardinality(preferred_roles) <= 3);
  end if;
end
$$;

commit;
