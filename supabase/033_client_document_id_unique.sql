-- Run once in the SQL editor, BOTH the dev branch and production Supabase
-- project — same dual-environment discipline as every migration before it.
--
-- BEFORE running the create index statement below, run this check in both
-- environments — if it returns any rows, this index creation will fail
-- (Postgres won't create a unique index over data that already violates
-- it), and those existing duplicates need to be resolved by hand first
-- (merge the movements onto one client row, then delete the other) since
-- picking which row survives isn't something this migration can decide on
-- its own:
--
-- select owner_id, regexp_replace(lower(document_id), '[^a-z0-9]', '', 'g') as normalized_document_id,
--        count(*), array_agg(id) as client_ids, array_agg(name) as names
-- from public.clients
-- where document_id is not null
-- group by 1, 2
-- having count(*) > 1;
--
-- Nothing before this stopped an owner from registering the same person
-- twice under their own account (two separate clients rows sharing a
-- document_id). The app now checks for this before insert (see
-- createClientWithMovement in app/(app)/dashboard/actions.ts and
-- confirmImport in app/(app)/import/actions.ts), but this index is the
-- last-resort safety net against a race between two concurrent requests
-- slipping past that check. Expression-based (not a plain column index)
-- because document_id is stored exactly as typed, with no fixed format —
-- "555.111.222" and "555111222" must collide as duplicates. Partial
-- (where document_id is not null) so legacy clients without one yet are
-- unaffected.
create unique index if not exists clients_owner_document_id_normalized_idx
  on public.clients (owner_id, regexp_replace(lower(document_id), '[^a-z0-9]', '', 'g'))
  where document_id is not null;

insert into public.schema_migrations (key, description)
values ('033_client_document_id_unique', 'Adds a normalized unique index preventing duplicate document_id per owner')
on conflict (key) do nothing;
