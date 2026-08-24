-- Additive migration: run once in the SQL editor, DEV Supabase project only.
-- Doesn't touch existing data — both new columns are nullable, so every
-- existing movement (COP or Bs) is unaffected and simply renders without
-- the conversion rows.
--
-- Why: 020 stored the rate that was applied (exchange_rate_used) but not
-- which currency it applied to, so a movement detail could only show a bare
-- "Bs. 779,95" with no way to tell whether that was the USD or the EUR rate
-- — and no way for a client to redo the arithmetic. Storing what the owner
-- actually typed (entry_currency + entry_amount) is also the more defensible
-- audit record in a dispute than a figure derived after the fact.

alter table public.movements
  add column if not exists entry_currency text
    check (entry_currency is null or entry_currency in ('VES', 'USD', 'EUR')),
  add column if not exists entry_amount numeric;

-- ── get_shared_balance(): expose the conversion trail per movement ───────
-- Adds entry_currency, entry_amount and official_bcv_rate_at_time to each
-- movement so the public client screen can show the full, verifiable
-- conversion — including the official BCV rate at that moment as the
-- objective comparison point when the business used a custom rate.
create or replace function public.get_shared_balance(p_token text)
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
  v_balance numeric(12, 2);
  v_owner_country text;
  v_settings public.owner_exchange_settings%rowtype;
  v_current_bcv record;
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

  select json_agg(
    json_build_object(
      'id', m.id,
      'type', m.type,
      'amount', m.amount,
      'description', m.description,
      'running_balance', m.running_balance,
      'needs_review', m.needs_review,
      'plazo_dias', m.plazo_dias,
      'rate_mode_used', m.rate_mode_used,
      'exchange_rate_used', m.exchange_rate_used,
      'official_bcv_rate_at_time', m.official_bcv_rate_at_time,
      'entry_currency', m.entry_currency,
      'entry_amount', m.entry_amount,
      'created_at', m.created_at
    ) order by m.created_at asc
  )
  into v_movements
  from public.movements m
  where m.client_id = v_client.id and m.deleted_at is null;

  select running_balance into v_balance
  from public.movements
  where client_id = v_client.id and deleted_at is null
  order by created_at desc, id desc
  limit 1;

  if v_owner_country = 'VE' then
    select * into v_settings from public.owner_exchange_settings where owner_id = v_client.owner_id;
    select * into v_current_bcv from public.get_current_bcv_rate();
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
    'movements', coalesce(v_movements, '[]'::json),
    'owner_country', v_owner_country,
    'rate_mode', v_settings.rate_mode,
    'display_currency', coalesce(v_settings.display_currency, 'USD'),
    'current_bcv_usd', v_current_bcv.usd,
    'current_bcv_eur', v_current_bcv.eur,
    'custom_rate_usd', v_settings.custom_rate_usd,
    'custom_rate_eur', v_settings.custom_rate_eur
  );
end;
$$;

grant execute on function public.get_shared_balance(text) to anon, authenticated;
