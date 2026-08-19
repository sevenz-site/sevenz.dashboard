-- Run once in the SQL editor.
--
-- Regression fix: migration 009 dropped the broad "anyone reads logos" SELECT
-- policy (correctly — a public bucket serves files by URL without RLS, and that
-- policy also let anon LIST the whole bucket). But it left `logos` with no
-- SELECT policy at all, while `attachments` still had "owners read own
-- attachments". The authenticated upload path reads storage.objects before
-- inserting, so with no SELECT policy the upload fails with
-- "new row violates row-level security policy".
--
-- This adds the owner-scoped SELECT policy that `attachments` already has,
-- WITHOUT reopening public listing of the bucket.

drop policy if exists "owners read own logo" on storage.objects;
create policy "owners read own logo"
on storage.objects for select
to authenticated
using (
  bucket_id = 'logos'
  and (storage.foldername(name))[1] = auth.uid()::text
);
