-- DEV-ONLY fix, run only in the dev branch's SQL editor — production
-- already has these buckets and policies from before this ledger existed;
-- running this there too is harmless (on conflict do update / drop-then-
-- create), but there's nothing for it to fix there.
--
-- Discovered 2026-08-28: a Supabase branch clones the SQL schema (tables,
-- policies) but NOT Storage buckets — same class of gap as the
-- auth.users trigger not being cloned (see CLAUDE.md's "Gotcha if another
-- branch is ever created"). The dev branch had zero Storage buckets at
-- all, meaning every logo/attachment upload would fail outright. This
-- recreates both buckets and every policy to exactly match production.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('logos', 'logos', true, 5242880, array['image/jpeg', 'image/jpg', 'image/png']),
  ('attachments', 'attachments', false, 5242880, array['image/jpeg', 'image/jpg', 'image/png'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "owners upload own logo" on storage.objects;
create policy "owners upload own logo" on storage.objects for insert to public
  with check (bucket_id = 'logos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "owners read own logo" on storage.objects;
create policy "owners read own logo" on storage.objects for select to authenticated
  using (bucket_id = 'logos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "owners update own logo" on storage.objects;
create policy "owners update own logo" on storage.objects for update to public
  using (bucket_id = 'logos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "owners delete own logo" on storage.objects;
create policy "owners delete own logo" on storage.objects for delete to public
  using (bucket_id = 'logos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "owners upload own attachments" on storage.objects;
create policy "owners upload own attachments" on storage.objects for insert to public
  with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "owners read own attachments" on storage.objects;
create policy "owners read own attachments" on storage.objects for select to public
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "owners delete own attachments" on storage.objects;
create policy "owners delete own attachments" on storage.objects for delete to public
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);

insert into public.schema_migrations (key, description)
values ('030_dev_storage_buckets', 'Recreates logos/attachments Storage buckets + policies in dev, missing since branch creation')
on conflict (key) do nothing;
