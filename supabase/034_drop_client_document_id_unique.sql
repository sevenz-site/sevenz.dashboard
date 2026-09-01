-- Run once in the SQL editor, BOTH the dev branch and production Supabase
-- project — same dual-environment discipline as every migration before it.
--
-- Reverses 033_client_document_id_unique.sql. Turns out the same document_id
-- twice under one owner isn't always a mistake — an informal client with no
-- legal business registration of their own sometimes deliberately tracks two
-- separate ledgers under the same owner (e.g. a personal account and a
-- business-use account, both under the same cédula). The app now allows
-- this with an explicit confirmation step (see confirm_duplicate in
-- createClientWithMovement, app/(app)/dashboard/actions.ts) instead of
-- blocking it outright, so the hard database constraint has to go — it
-- would reject exactly the case that's now meant to work.
--
-- Safe to run whether or not 033's index was ever actually created here.
drop index if exists public.clients_owner_document_id_normalized_idx;

insert into public.schema_migrations (key, description)
values ('034_drop_client_document_id_unique', 'Removes the unique index from 033 — same document_id can be deliberate under one owner')
on conflict (key) do nothing;
