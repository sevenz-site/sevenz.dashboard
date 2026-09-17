-- 063_document_source.sql
--
-- ENVIRONMENT: run first on the DEV branch (vzqppwrwnmlbrxizskdh), then on
-- production (rabmiyqodnvnrwiartuj).
--
-- Who typed a client's document: the shopkeeper, or the client themselves.
--
-- ─────────────────────────────────────────────────────────────────────────
-- WHY THIS EXISTS
--
-- Some shopkeepers fill contact fields with junk to get past the form — the
-- owner has seen it with WhatsApp numbers. That disqualifies WhatsApp as
-- identity evidence, and it disqualifies the document too WHEN THE SHOPKEEPER
-- TYPED IT.
--
-- A document the client typed into the public modal at /s/[token] is a
-- different thing: they typed it to see their own debt, and lying there only
-- hurts them.
--
-- Today both live in the same column, indistinguishable. The day a person has
-- to be matched to a client record, that difference decides whether the number
-- can be believed. See CLIENTES-AUTENTICADOS-PLAN.md, section 5.
--
-- ─────────────────────────────────────────────────────────────────────────
-- WHY `null` AND NOT 'unknown'
--
-- Null means "we do not know". A filler value reads as data, and this is
-- exactly the field where confusing the two defeats the purpose.
--
-- ─────────────────────────────────────────────────────────────────────────
-- THIS FILE REPLACES 063_procedencia_del_documento.sql
--
-- That version shipped Spanish values ('dueno'/'cliente') and a Spanish
-- filename. It ran on the dev branch and NEVER reached production, so the
-- rename costs one re-run in dev and nothing anywhere else. Values stored in a
-- database outlive the code that writes them — see CLAUDE.md, "Code is written
-- in English".
--
-- The blocks below are written so a dev branch that already has the Spanish
-- version ends up identical to a production run that never saw it.

begin;

alter table public.clients
  add column if not exists document_source text;

-- Dropped rather than guarded: on the dev branch this constraint already
-- exists and still allows the Spanish values, so a do-block that skips when it
-- finds one would leave dev permanently wrong.
alter table public.clients
  drop constraint if exists clients_document_source_check;

-- No-op on a first run; on the dev branch this is the rename itself.
update public.clients set document_source = 'owner'  where document_source = 'dueno';
update public.clients set document_source = 'client' where document_source = 'cliente';

alter table public.clients
  add constraint clients_document_source_check
  check (document_source is null or document_source in ('owner', 'client'));

-- ── Backfill: only what is PROVABLE ─────────────────────────────────────
--
-- Three rules, none of them statistical. Each one is an impossibility:
--
--   1. Created on 2026-09-02 or later. The form requires a document when
--      registering a client, and submit_shared_document_id NEVER overwrites an
--      existing one. So the client cannot have supplied it.
--
--      THE CUTOFF IS THE 2nd, NOT 31 AUGUST, and the difference matters. The
--      commit that made the document mandatory (a7a867e) is from the 31st, but
--      it reached production with merge 3388071 on the 1st. Cutting at midnight
--      on the 1st left a window of hours: a record created that morning, before
--      the deploy, could have been born without a document and received one
--      from the client afterwards — and would have been marked 'owner' wrongly.
--      The 2nd clears the whole day.
--
--      It costs a few records, which stay null. If this field ever decides a
--      match, the error must always fall on the distrustful side: marking "we
--      do not know" over something that WAS the shopkeeper's is cheap; the
--      opposite is not.
--
--   2. Never had a share link. submit_shared_document_id requires a token, and
--      the token comes from share_links. No row there, no door.
--
--   3. Had a link that was never opened. The page has to load to submit.
--
-- Measured in production on 2026-09-17 with a 1 Sep cutoff: of 156 records
-- with a document, 74 fell under one of the three. With the 2 Sep cutoff it
-- will be the same or slightly fewer; the verification below gives the exact
-- number.
--
-- And the marked ones are mostly NEW records: the ones that stay null are the
-- old ones, which are precisely the established clients. This labels the
-- future; it does not rescue the past.
--
-- `document_source is null` in the where clause makes it re-runnable: a second
-- pass touches nothing the app has already marked.
--
-- Rule 3 relies on link_opens having always recorded every open. If it ever
-- failed silently, a record would be marked as the shopkeeper's without being
-- so — an error toward distrust, which is the correct side here.
update public.clients c
set document_source = 'owner'
where c.document_source is null
  and nullif(regexp_replace(coalesce(c.document_id, ''), '\D', '', 'g'), '') is not null
  and (
    c.created_at >= timestamptz '2026-09-02'
    or not exists (select 1 from public.share_links sl where sl.client_id = c.id)
    or not exists (select 1 from public.link_opens lo where lo.client_id = c.id)
  );

-- ── From now on, the public modal records its own origin ────────────────
--
-- Same body as 031 except for document_source. It still never overwrites an
-- existing document: that property is what makes backfill rule 1 true, so
-- changing it would invalidate the backfill.
--
-- The user-facing strings stay in Spanish on purpose: they are read by a
-- shopkeeper's client. CLAUDE.md's English rule covers identifiers and
-- comments, never copy.
create or replace function public.submit_shared_document_id(p_token text, p_document_id text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
  v_existing_document_id text;
begin
  select c.id, c.document_id into v_client_id, v_existing_document_id
  from public.share_links sl
  join public.clients c on c.id = sl.client_id
  where sl.token = p_token;

  if v_client_id is null then
    return json_build_object('error', 'Link inválido.');
  end if;

  if v_existing_document_id is not null and trim(v_existing_document_id) <> '' then
    return json_build_object('error', null, 'document_id', v_existing_document_id);
  end if;

  if p_document_id is null or trim(p_document_id) = '' then
    return json_build_object('error', 'Escribe tu número de documento.');
  end if;

  update public.clients
  set document_id = trim(p_document_id),
      document_source = 'client'
  where id = v_client_id;

  return json_build_object('error', null, 'document_id', trim(p_document_id));
end;
$$;

-- The superseded key is removed so the two ledgers can never disagree about a
-- migration that only ever existed on the dev branch.
delete from public.schema_migrations where key = '063_procedencia_del_documento';

insert into public.schema_migrations (key, description)
values (
  '063_document_source',
  'clients.document_source records WHO typed the document: the shopkeeper or the client. Some shopkeepers fill contact fields with junk to get past the form, which disqualifies an owner-typed document as identity evidence; one the client typed into the public modal to see their own debt is different. Backfilled to ''owner'' only where PROVABLE - created after the mandatory-document rule, or never had a share link, or had one that was never opened. The rest stay null, because null means "we do not know" and a filler value would read as data. submit_shared_document_id still never overwrites an existing document: that property is what makes the first backfill rule true. Supersedes 063_procedencia_del_documento, which shipped Spanish values, ran only on the dev branch and never reached production.'
)
on conflict (key) do nothing;

commit;

-- ── verification, after running the above ───────────────────────────────
--
-- 1. The split:
--
--   select document_source, count(*)
--   from public.clients
--   where trashed_at is null and deleted_at is null
--   group by document_source order by 1 nulls last;
--   -- EXPECTED on dev: owner 23, client 1, null 12. No 'dueno', no 'cliente'.
--
-- 2. The old ledger key is gone and the new one is there:
--
--   select key from public.schema_migrations where key like '063%';
--   -- EXPECTED: exactly one row, 063_document_source.
--
-- 3. No record WITHOUT a document got marked:
--
--   select count(*) from public.clients
--   where document_source is not null
--     and nullif(regexp_replace(coalesce(document_id, ''), '\D', '', 'g'), '') is null;
--   -- EXPECTED: 0. Recording the origin of a document that does not exist means nothing.
