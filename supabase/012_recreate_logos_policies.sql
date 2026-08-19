-- Run once in the SQL editor.
--
-- Deleting a bucket from the Supabase dashboard also removes the storage
-- policies scoped to it. The `logos` bucket was deleted and recreated, so its
-- INSERT/UPDATE/DELETE policies were gone — which is why uploads were denied
-- even though the policy condition itself evaluated to true when tested by
-- hand: with no applicable policy, RLS denies by default.
--
-- This recreates the full set. Safe to re-run.

drop policy if exists "owners upload own logo" on storage.objects;
create policy "owners upload own logo"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'logos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "owners read own logo" on storage.objects;
create policy "owners read own logo"
on storage.objects for select
to authenticated
using (
  bucket_id = 'logos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "owners update own logo" on storage.objects;
create policy "owners update own logo"
on storage.objects for update
to authenticated
using (
  bucket_id = 'logos'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'logos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "owners delete own logo" on storage.objects;
create policy "owners delete own logo"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'logos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Shows what ended up in place, so the result is visible after running.
select policyname, cmd
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
order by policyname;
