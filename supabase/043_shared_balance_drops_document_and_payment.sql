-- ENVIRONMENT: run in BOTH — dev branch (vzqppwrwnmlbrxizskdh) first, then
-- production (rabmiyqodnvnrwiartuj).
--
-- Stops get_shared_balance() returning the client's document and the owner's
-- payment details to anyone holding a share link.
--
-- The 2026-09-06 change removed both from the rendered page, and that part
-- worked — grepping the raw server response for a CO and a VE client found zero
-- occurrences. But the page is only half the story: this function still put both
-- values in the response the browser receives, and it is granted to anon, so one
-- call with the project's public key returns them. Measured on dev:
--
--     document_id  -> "CC-SECRETO-99887766"
--     payment_info -> "Nequi: 3238130265"
--
-- 109 of 168 clients in production have a document on file. Removing something
-- from a rendered page is not removing it from the API, and until now the link
-- looked private while not being private — which is worse than a known hole,
-- because it stops anyone looking.
--
-- BASE: 037_link_open_revisit.sql, verified with pg_get_functiondef against BOTH
-- environments before writing this. Do NOT base it on schema.sql — line 580
-- there still holds a one-argument, pre-036 body. Copying that would create a
-- second overload rather than replacing anything, and would reintroduce the bug
-- where every country='CO' share link returned 404.
--
-- The ONLY changes from 037 are three lines in the final json_build_object:
-- payment_info and document_id come out, has_document_id goes in. Everything
-- else — the link_opens upsert, the p_limit paging, the movement_total count,
-- the VE rate branch — is byte-identical, deliberately. On a function every
-- client of every owner depends on, a three-line diff is worth more than tidy
-- housekeeping, which is also why v_payment_info stays declared and populated
-- despite now going unused.
--
-- has_document_id replaces the raw value because the page needs to know whether
-- to show the "confirma tu cédula" dialog — 59 of 168 clients have no document
-- and that dialog is how they eventually get one. app/s/[token]/page.tsx already
-- reads this field and falls back safely when it is absent (shipped in 1d217f3),
-- so this migration is safe in either order and needs no code deploy at all.
begin;

create or replace function public.get_shared_balance(p_token text, p_limit int default 50)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client public.clients%rowtype;
  v_business text;
  v_owner_whatsapp text;
  v_owner_logo_path text;
  v_payment_info text;
  v_movements json;
  v_movement_total int;
  v_balance numeric(14, 4);
  v_balance_usd numeric(14, 4);
  v_balance_eur numeric(14, 4);
  v_owner_country text;
  v_settings public.owner_exchange_settings%rowtype;
  -- Scalars, not a record: these are read below whether or not the VE branch
  -- ran, and a scalar that was never assigned is simply NULL. See 036.
  v_bcv_usd numeric;
  v_bcv_eur numeric;
begin
  select c.* into v_client
  from public.share_links sl
  join public.clients c on c.id = sl.client_id
  where sl.token = p_token;

  if not found then
    return null;
  end if;

  -- The only change from 036: a revisit now re-arms the notification and
  -- refreshes the timestamp, instead of being discarded.
  insert into public.link_opens (client_id, opened_date)
  values (v_client.id, current_date)
  on conflict (client_id, opened_date) do update
    set read_at = null,
        opened_at = now();

  select business_name, whatsapp, logo_path, payment_info, country
    into v_business, v_owner_whatsapp, v_owner_logo_path, v_payment_info, v_owner_country
  from public.owners where id = v_client.owner_id;

  -- Total is counted before the limit is applied, so the page can say how many
  -- are being withheld and whether to offer "ver todo" at all.
  select count(*) into v_movement_total
  from public.movements
  where client_id = v_client.id and deleted_at is null;

  -- Newest p_limit rows, then aggregated oldest-first — the order the page has
  -- always received them in. p_limit null means "all of them".
  select json_agg(
    json_build_object(
      'id', m.id,
      'type', m.type,
      'amount', m.amount,
      'currency', m.currency,
      'description', m.description,
      'running_balance', m.running_balance,
      'needs_review', m.needs_review,
      'plazo_dias', m.plazo_dias,
      'rate_mode_used', m.rate_mode_used,
      'exchange_rate_used', m.exchange_rate_used,
      'official_bcv_rate_at_time', m.official_bcv_rate_at_time,
      'entry_currency', m.entry_currency,
      'entry_amount', m.entry_amount,
      'rate_usd_at_time', m.rate_usd_at_time,
      'rate_eur_at_time', m.rate_eur_at_time,
      'created_at', m.created_at
    ) order by m.created_at asc
  )
  into v_movements
  from (
    select *
    from public.movements
    where client_id = v_client.id and deleted_at is null
    order by created_at desc
    limit p_limit
  ) m;

  select coalesce(balance, 0), coalesce(balance_usd, 0), coalesce(balance_eur, 0)
    into v_balance, v_balance_usd, v_balance_eur
  from public.client_summary where client_id = v_client.id;

  if v_owner_country = 'VE' then
    select * into v_settings from public.owner_exchange_settings where owner_id = v_client.owner_id;
    select r.usd, r.eur into v_bcv_usd, v_bcv_eur from public.get_current_bcv_rate() r;
  end if;

  return json_build_object(
    'business_name', v_business,
    'owner_whatsapp', v_owner_whatsapp,
    'owner_logo_path', v_owner_logo_path,
    -- 'payment_info' removed: the owner's Nequi or bank details are the raw
    -- material for impersonating the shop to its own client.
    'client_name', v_client.name,
    -- 'document_id' removed. What the page needs is whether one exists, not
    -- what it is — and under the identity plan in 035 the (country, document)
    -- pair is what future client accounts match on, so publishing it to anyone
    -- with a forwarded link is exactly backwards.
    'has_document_id', (v_client.document_id is not null and trim(v_client.document_id) <> ''),
    'whatsapp_last4', right(coalesce(v_client.whatsapp, ''), 4),
    'balance', coalesce(v_balance, 0),
    'balance_usd', coalesce(v_balance_usd, 0),
    'balance_eur', coalesce(v_balance_eur, 0),
    'movements', coalesce(v_movements, '[]'::json),
    'movement_total', coalesce(v_movement_total, 0),
    'owner_country', v_owner_country,
    'rate_mode', v_settings.rate_mode,
    'current_bcv_usd', v_bcv_usd,
    'current_bcv_eur', v_bcv_eur,
    'custom_rate_usd', v_settings.custom_rate_usd,
    'custom_rate_eur', v_settings.custom_rate_eur
  );
end;
$$;

-- create or replace preserves the existing ACL, but re-granting is idempotent
-- and removes the question rather than trusting it. If this grant were ever
-- lost, every share link in the business would 404 at once.
grant execute on function public.get_shared_balance(text, int) to anon, authenticated;

insert into public.schema_migrations (key, description)
values (
  '043_shared_balance_drops_document_and_payment',
  'get_shared_balance() no longer returns document_id or payment_info — both were readable by any anon caller holding a share link. Adds has_document_id so the page can still decide whether to ask for a missing document.'
)
on conflict (key) do nothing;

commit;
