-- Run once in the SQL editor.
--
-- Newer Supabase Storage versions keep a `storage.prefixes` table (a folder
-- index) alongside `storage.objects`. Uploading into a folder writes rows to
-- BOTH tables, and `storage.prefixes` has its own RLS. Without a matching
-- policy there, an upload fails with the exact same
-- "new row violates row-level security policy" message as an objects-policy
-- failure — which is why the policies on storage.objects all looked correct.
--
-- The DO block makes this a no-op on older projects that have no prefixes table.

do $outer$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'storage' and table_name = 'prefixes'
  ) then
    execute 'grant select, insert, update, delete on storage.prefixes to authenticated';

    execute 'drop policy if exists "owners manage own prefixes" on storage.prefixes';

    -- storage.foldername() is not used here: a top-level prefix row is just
    -- "<uid>" with no slash, so split_part is the reliable way to read the
    -- first path segment for both "<uid>" and "<uid>/sub".
    execute 'create policy "owners manage own prefixes" on storage.prefixes '
         || 'for all to authenticated '
         || 'using (bucket_id in (''logos'', ''attachments'') '
         || '  and split_part(name, ''/'', 1) = auth.uid()::text) '
         || 'with check (bucket_id in (''logos'', ''attachments'') '
         || '  and split_part(name, ''/'', 1) = auth.uid()::text)';
  end if;
end
$outer$;
