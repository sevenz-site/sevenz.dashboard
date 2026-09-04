-- Two changes to get_shared_balance, both found by the load/performance audit.
--
-- 1. THE BUG (live in production): the function crashed outright for every
--    country='CO' owner, so their clients opened the shared link and got a 404
--    instead of their balance.
--
--    v_current_bcv was declared `record`, and a `record` has no field structure
--    until a row is actually assigned to it — reading .usd from an unassigned
--    one raises "record is not assigned yet". It was only ever assigned inside
--    `if v_owner_country = 'VE'`, but read unconditionally in the json below.
--    v_settings escaped this only because it is declared %rowtype, which does
--    have a structure and reads as NULL.
--
--    The same crash also waited for any VE owner whose rate had never been
--    fetched successfully (get_current_bcv_rate() returning no row leaves the
--    record unassigned too) — so a bad day at the rate provider would have
--    taken every VE owner's links down as well.
--
--    Fixed by reading into plain scalars, which are NULL when unset and never
--    raise. Both cases now degrade to "no rate available" instead of a 404.
--
-- 2. A ceiling on history: the function returned every movement a client ever
--    had. At 408 movements that was 203 KB of HTML on a phone, with no upper
--    bound. It now returns the most recent p_limit (default 50), and the page
--    offers "ver todo" to request the rest by passing null.
--
-- Dropped rather than replaced because the signature changes; adding a second
-- argument with a default alongside the old one-argument version would make
-- every existing call ambiguous.
--
-- Wrapped in a transaction — the only migration here that is, because it is the
-- only one that drops anything. Every other migration is a bare `create or
-- replace`, which is atomic on its own. This one has a window between the drop
-- and the create where the function does not exist, and a failure inside that
-- window would take down *every* share link, VE included, not just the CO ones
-- this is meant to fix. begin/commit closes the window: both statements land or
-- neither does. DDL is transactional in Postgres, so this costs nothing.
begin;

drop function if exists public.get_shared_balance(text);

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
  -- ran, and a scalar that was never assigned is simply NULL.
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

  insert into public.link_opens (client_id, opened_date)
  values (v_client.id, current_date)
  on conflict (client_id, opened_date) do nothing;

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
    'payment_info', v_payment_info,
    'client_name', v_client.name,
    'document_id', v_client.document_id,
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

grant execute on function public.get_shared_balance(text, int) to anon, authenticated;

insert into public.schema_migrations (key, description)
values (
  '036_shared_balance_fix_and_limit',
  'Fixes get_shared_balance crashing (404) for country=CO owners and for VE owners with no fetched rate, and caps returned movements at 50 by default'
)
on conflict (key) do nothing;

commit;
