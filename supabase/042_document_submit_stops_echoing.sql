-- ENVIRONMENT: run in BOTH — dev branch (vzqppwrwnmlbrxizskdh) first, then
-- production (rabmiyqodnvnrwiartuj).
--
-- Stops submit_shared_document_id() handing the client's real document back to
-- whoever called it.
--
-- The function is granted to anon, so anyone holding a share link can call it
-- with any junk value. When a document is already on file it takes the "already
-- has one" branch and returns that value:
--
--     return json_build_object('error', null, 'document_id', v_existing_document_id);
--
-- Measured on dev: passing "basura" returned
-- {"error":null,"document_id":"CC-SECRETO-99887766"}. In production 109 of 168
-- clients have a document on file, so 109 real cédulas are retrievable today by
-- anyone with the corresponding link — one call each, and it bypasses the rate
-- limiter in app/s/[token]/actions.ts entirely, because that guard lives in the
-- server action and this is the database function underneath it.
--
-- This is the same exposure the 2026-09-06 share-link change set out to close.
-- That change removed both values from the rendered page, which is why they no
-- longer appear in the HTML — and left this door open.
--
-- WHAT DOES NOT CHANGE: the modal that collects a missing document. 59 of 168
-- clients have none, so that flow is live and needed. Both branches still work;
-- they simply confirm success instead of echoing a value back. The dialog only
-- ever needed `error === null` — it stopped reading the returned value in
-- 20d93e4 — so this is safe against the currently deployed code, and safe in
-- either deploy order.
begin;

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
    -- Already has one — e.g. a duplicate or stale submit. Still not an error,
    -- and still does not touch the stored value. It just no longer reports what
    -- that value is: the caller is anonymous, and confirming "yes, one exists"
    -- tells them everything they legitimately need.
    return json_build_object('error', null, 'saved', true);
  end if;

  if p_document_id is null or trim(p_document_id) = '' then
    return json_build_object('error', 'Escribe tu número de documento.');
  end if;

  update public.clients set document_id = trim(p_document_id) where id = v_client_id;

  -- Not echoed either. The submitter already knows what they typed, and a
  -- response that repeats it is a response worth intercepting.
  return json_build_object('error', null, 'saved', true);
end;
$$;

-- create or replace preserves the existing ACL, but re-granting is idempotent
-- and removes the question rather than trusting it — the 59 clients without a
-- document reach this through the anon key and the flow must keep working.
grant execute on function public.submit_shared_document_id(text, text) to anon, authenticated;

insert into public.schema_migrations (key, description)
values (
  '042_document_submit_stops_echoing',
  'submit_shared_document_id() no longer returns the stored document to its caller — it was retrievable by anyone with a share link. Collection flow unchanged.'
)
on conflict (key) do nothing;

commit;
