-- Run once in the SQL editor, BOTH the dev branch and production — same
-- dual-environment discipline as every migration before it.
--
-- Repeat visits to a shared link were invisible to the owner.
--
-- link_opens is unique (client_id, opened_date) so an owner gets at most one
-- notification per client per day, which is the right instinct: a shop with
-- 300 clients would otherwise drown. But the insert in get_shared_balance used
-- `on conflict do nothing`, which made that cap absolute — once the owner had
-- read the day's notification, that client could open the link all afternoon
-- and nothing would say so. The feature failed at exactly the moment it is
-- useful: "I chased Pedro this morning, has he looked at what he owes?"
--
-- It also left opened_at frozen at the first visit of the day, so the time
-- shown in the notification list was wrong for any returning client — quietly,
-- with nothing to indicate it.
--
-- `do update` fixes both: still one row per client per day, so the list never
-- floods, but a genuine revisit clears read_at (notifying again) and moves
-- opened_at forward (making it mean "last seen", which is what the list
-- already implies).
--
-- Unlike 036 this does not change the function's signature, so it is a plain
-- create or replace — no drop, no window where the function does not exist.
-- The transaction is kept anyway so a failure leaves nothing half-applied.
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
  '037_link_open_revisit',
  'A repeat visit to a shared link re-arms the owner notification and refreshes opened_at, instead of being discarded by on conflict do nothing'
)
on conflict (key) do nothing;

commit;
