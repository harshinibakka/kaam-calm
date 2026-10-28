begin;

alter table public.job_seeker_profiles
  add column if not exists first_name text not null default '' check (char_length(first_name) <= 80),
  add column if not exists middle_name text not null default '' check (char_length(middle_name) <= 80),
  add column if not exists last_name text not null default '' check (char_length(last_name) <= 80),
  add column if not exists resume_path text not null default '',
  add column if not exists resume_file_name text not null default '',
  add column if not exists resume_file_size bigint,
  add column if not exists resume_content_type text not null default '',
  add column if not exists cv_path text not null default '',
  add column if not exists cv_file_name text not null default '',
  add column if not exists cv_file_size bigint,
  add column if not exists cv_content_type text not null default '';

update public.job_seeker_profiles
set first_name = split_part(trim(full_name), ' ', 1),
    middle_name = case when cardinality(regexp_split_to_array(trim(full_name), '\s+')) > 2
      then (regexp_split_to_array(trim(full_name), '\s+'))[2] else '' end,
    last_name = case when cardinality(regexp_split_to_array(trim(full_name), '\s+')) > 2
      then array_to_string((regexp_split_to_array(trim(full_name), '\s+'))[3:], ' ')
      when cardinality(regexp_split_to_array(trim(full_name), '\s+')) > 1
      then (regexp_split_to_array(trim(full_name), '\s+'))[2] else '' end
where first_name = '' and trim(full_name) <> '';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('private-job-seeker-documents', 'private-job-seeker-documents', false, 10485760,
  array['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain'])
on conflict (id) do update set public = false, file_size_limit = 10485760,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Restrict private job-seeker documents to their owner" on storage.objects;
create policy "Restrict private job-seeker documents to their owner"
  on storage.objects as restrictive for all to public
  using (bucket_id <> 'private-job-seeker-documents' or
    ((select auth.uid()) is not null and (storage.foldername(name))[1] = (select auth.uid())::text))
  with check (bucket_id <> 'private-job-seeker-documents' or
    ((select auth.uid()) is not null and (storage.foldername(name))[1] = (select auth.uid())::text));

drop policy if exists "Job seekers can read their own private documents" on storage.objects;
create policy "Job seekers can read their own private documents"
  on storage.objects for select to authenticated
  using (bucket_id = 'private-job-seeker-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Job seekers can upload their own private documents" on storage.objects;
create policy "Job seekers can upload their own private documents"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'private-job-seeker-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Job seekers can delete their own private documents" on storage.objects;
create policy "Job seekers can delete their own private documents"
  on storage.objects for delete to authenticated
  using (bucket_id = 'private-job-seeker-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);

commit;
