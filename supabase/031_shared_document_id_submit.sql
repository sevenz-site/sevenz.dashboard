-- Run once in the SQL editor, BOTH the dev branch and production Supabase
-- project — same dual-environment discipline as every migration before it.
--
-- Lets a client self-report their cédula/documento through the public
-- balance-share link (/s/[token]) when their record doesn't have one yet —
-- the goal is backfilling document IDs for clients created before this was
-- required, or ones added without one. Mirrors get_shared_balance()'s own
-- trusted token -> client resolution (security definer, tightly scoped),
-- since this is the first WRITE-capable action reachable from that
-- unauthenticated page. Never overwrites an existing value — once any
-- document_id is on file, this becomes a harmless no-op forever.

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
    -- Already has one — e.g. a duplicate/stale submit. Not an error, just
    -- confirms the value already on file rather than touching it again.
    return json_build_object('error', null, 'document_id', v_existing_document_id);
  end if;

  if p_document_id is null or trim(p_document_id) = '' then
    return json_build_object('error', 'Escribe tu número de documento.');
  end if;

  update public.clients set document_id = trim(p_document_id) where id = v_client_id;

  return json_build_object('error', null, 'document_id', trim(p_document_id));
end;
$$;

grant execute on function public.submit_shared_document_id(text, text) to anon, authenticated;

insert into public.schema_migrations (key, description)
values ('031_shared_document_id_submit', 'Adds submit_shared_document_id() RPC so a client can self-report their document ID via the public share link when missing')
on conflict (key) do nothing;
