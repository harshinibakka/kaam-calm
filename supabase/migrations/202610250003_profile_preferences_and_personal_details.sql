alter table public.job_seeker_profiles
  add column if not exists salary_period text not null default ''
    check (salary_period in ('', 'Per year', 'Per month', 'Per hour')),
  add column if not exists preferred_shift text not null default ''
    check (preferred_shift in ('', 'Morning', 'Afternoon', 'Night')),
  add column if not exists job_type text not null default ''
    check (job_type in ('', 'Permanent', 'Contract')),
  add column if not exists gender text not null default ''
    check (char_length(gender) <= 80),
  add column if not exists date_of_birth date,
  add column if not exists address text not null default ''
    check (char_length(address) <= 500),
  add column if not exists city text not null default ''
    check (char_length(city) <= 160),
  add column if not exists state text not null default ''
    check (char_length(state) <= 160),
  add column if not exists pincode text not null default ''
    check (char_length(pincode) <= 20),
  add column if not exists accomplishments jsonb not null default '[]'::jsonb
    check (jsonb_typeof(accomplishments) = 'array');
