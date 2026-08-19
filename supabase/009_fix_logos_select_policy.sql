-- Additive/corrective migration: run once in the SQL editor.
-- Public buckets already serve files via the public URL without needing a
-- SELECT policy — that policy only let anon *list/query* every file in the
-- bucket through the API, which Supabase's dashboard correctly flagged.
drop policy if exists "anyone reads logos" on storage.objects;
revoke select on storage.objects from anon;
