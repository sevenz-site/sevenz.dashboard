-- 064_client_feedback.sql
--
-- ENVIRONMENT: run first on the DEV branch (vzqppwrwnmlbrxizskdh). Do NOT run
-- against production (rabmiyqodnvnrwiartuj) until the code that uses it is
-- ready to deploy and the user has said to launch.
--
-- What a client of a bodega would like to do in Sevenz, in their own words.
--
-- ─────────────────────────────────────────────────────────────────────────
-- WHY THIS EXISTS
--
-- Every idea on the roadmap for clients — paying through the app, sending
-- receipts, seeing what they owe across shops, asking for credit — is an
-- assumption. Nobody has asked them. `/s/[token]` is the only surface where a
-- client of a bodega meets Sevenz, so it is the only place the question can be
-- asked at all.
--
-- ─────────────────────────────────────────────────────────────────────────
-- THE TRUST MODEL IS THE SAME AS submit_shared_document_id
--
-- Anyone holding a share link can call this. No login exists for these people.
-- So the defences are the ones that already guard that page:
--
--   1. The token resolves to a client INSIDE the function, never from a
--      parameter the caller controls.
--   2. RLS on, ZERO policies, no grants on the table. The only door is this
--      SECURITY DEFINER function — same shape as movement_rejections.
--   3. A length ceiling here, not only in the server action. The action is one
--      caller; this function is the door.
--   4. Rate limiting lives in the action, via claim_rate_limit_quota.

begin;

create table if not exists public.client_feedback (
  id uuid primary key default gen_random_uuid(),

  -- ON DELETE SET NULL, deliberately, and not CASCADE: this is product
  -- research, and it has to outlive the client record it came from. A
  -- shopkeeper deleting a client months from now should not silently erase
  -- what that person told us they needed.
  client_id uuid references public.clients (id) on delete set null,

  -- Snapshot, not a join: it is the one piece of context that survives the
  -- client row disappearing. "What do Venezuelan clients ask for that
  -- Colombian ones don't" stays answerable either way.
  owner_country text,

  message text not null,
  created_at timestamptz not null default now()
);

create index if not exists client_feedback_created_at_idx
  on public.client_feedback (created_at desc);

-- RLS on with NO policies: unreachable to anon and to authenticated alike.
-- Reading it is a job for the service role through /admin, not for anyone
-- holding a share link.
alter table public.client_feedback enable row level security;

-- ── The only door ───────────────────────────────────────────────────────
create or replace function public.submit_shared_feedback(p_token text, p_message text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
  v_country text;
  v_message text;
begin
  -- The token decides the client. A caller cannot name one.
  select c.id, o.country into v_client_id, v_country
  from public.share_links sl
  join public.clients c on c.id = sl.client_id
  join public.owners o on o.id = c.owner_id
  where sl.token = p_token;

  if v_client_id is null then
    return json_build_object('error', 'Link inválido.');
  end if;

  v_message := btrim(coalesce(p_message, ''));

  if v_message = '' then
    return json_build_object('error', 'Escribe tu respuesta.');
  end if;

  -- Truncate rather than reject: someone who wrote four pages should not lose
  -- all of it to an error message they cannot act on. The first thousand
  -- characters carry the point.
  insert into public.client_feedback (client_id, owner_country, message)
  values (v_client_id, v_country, left(v_message, 1000));

  return json_build_object('error', null);
end;
$$;

-- EXECUTE goes to PUBLIC by default, so the revoke has to come first or the
-- grant below is decoration. See CLAUDE.md.
revoke all on function public.submit_shared_feedback(text, text) from public;
grant execute on function public.submit_shared_feedback(text, text) to anon, authenticated;

insert into public.schema_migrations (key, description)
values (
  '064_client_feedback',
  'client_feedback stores, in their own words, what a client of a bodega would like to do in Sevenz. Every client-facing idea on the roadmap is an assumption and nobody has asked them; /s/[token] is the only surface where these people meet Sevenz. Same trust model as submit_shared_document_id: the token resolves the client inside the function, RLS is on with zero policies and no table grants, and the only door is submit_shared_feedback. client_id is ON DELETE SET NULL because product research has to outlive the client record, and owner_country is snapshotted so the feedback stays segmentable when that row is gone.'
)
on conflict (key) do nothing;

commit;

-- ── verification, after running the above ───────────────────────────────
--
-- 1. The table is unreachable without the function:
--
--   select count(*) from pg_policies
--   where schemaname = 'public' and tablename = 'client_feedback';
--   -- EXPECTED: 0. RLS on, no policies, no doors but the function.
--
-- 2. The function is callable by anon:
--
--   select has_function_privilege('anon', 'public.submit_shared_feedback(text, text)', 'execute');
--   -- EXPECTED: true. The page calls it with the anon key.
--
-- 3. A bad token says nothing useful:
--
--   select public.submit_shared_feedback('not-a-real-token', 'hola');
--   -- EXPECTED: {"error": "Link inválido."} and no row written.
