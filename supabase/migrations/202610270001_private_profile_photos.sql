begin;

alter table public.job_seeker_profiles
  add column if not exists avatar_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('private-job-seeker-avatars', 'private-job-seeker-avatars', false, 5242880,
  array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Restrict private job-seeker avatars to their owner" on storage.objects;
create policy "Restrict private job-seeker avatars to their owner"
  on storage.objects as restrictive for all to public
  using (bucket_id <> 'private-job-seeker-avatars' or
    ((select auth.uid()) is not null and (storage.foldername(name))[1] = (select auth.uid())::text))
  with check (bucket_id <> 'private-job-seeker-avatars' or
    ((select auth.uid()) is not null and (storage.foldername(name))[1] = (select auth.uid())::text));

drop policy if exists "Job seekers can read their own private avatars" on storage.objects;
create policy "Job seekers can read their own private avatars"
  on storage.objects for select to authenticated
  using (bucket_id = 'private-job-seeker-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Job seekers can upload their own private avatars" on storage.objects;
create policy "Job seekers can upload their own private avatars"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'private-job-seeker-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Job seekers can delete their own private avatars" on storage.objects;
create policy "Job seekers can delete their own private avatars"
  on storage.objects for delete to authenticated
  using (bucket_id = 'private-job-seeker-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

commit;
