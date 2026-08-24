-- Run once in the SQL editor, DEV Supabase project only.
--
-- ARCHITECTURE CHANGE. A VE owner's ledger is no longer one USD-indexed
-- balance — it's one balance PER CURRENCY. A client can owe $50 and €20 at
-- the same time as two parallel accounts: a dollar payment only reduces the
-- dollar debt, and each balance converts to its own bolívar figure.
--
-- That means running_balance is now per (client, currency), and the FIFO
-- payment matching runs within a currency rather than across the whole
-- client. Status / mora / credit score stay a single combined judgement per
-- client (computed app-side, where the exchange rate is available).
--
-- country='CO' owners keep currency = null and behave exactly as before.

-- ── 1. denomination ─────────────────────────────────────────────────────
alter table public.movements
  add column if not exists currency text
    check (currency is null or currency in ('USD', 'EUR'));

-- Everything a VE owner has recorded so far is already stored in USD (see
-- migration 024), including the movements that were originally typed in
-- bolívares. They all belong to the dollar ledger.
update public.movements m
set currency = 'USD'
where m.currency is null
  and m.client_id in (
    select c.id from public.clients c
    join public.owners o on o.id = c.owner_id
    where o.country = 'VE'
  );

create index if not exists movements_client_currency_idx
  on public.movements (client_id, currency, created_at) where deleted_at is null;

-- ── 2. running balance is per (client, currency) ────────────────────────
create or replace function public.set_movement_running_balance()
returns trigger
language plpgsql
as $$
declare
  v_prev numeric(14, 4);
begin
  select running_balance into v_prev
  from public.movements
  where client_id = new.client_id
    and currency is not distinct from new.currency
    and deleted_at is null
  order by created_at desc, id desc
  limit 1;

  v_prev := coalesce(v_prev, 0);
  new.running_balance := v_prev + (case when new.type = 'charge' then new.amount else -new.amount end);

  return new;
end;
$$;

-- Rewrites every currency's chain independently after a delete or restore.
create or replace function public.recalc_client_running_balance(p_client_id uuid)
returns void
language plpgsql
as $$
declare
  cur record;
  m record;
  running numeric(14, 4);
begin
  for cur in
    select distinct currency
    from public.movements
    where client_id = p_client_id and deleted_at is null
  loop
    running := 0;
    for m in
      select id, type, amount
      from public.movements
      where client_id = p_client_id
        and currency is not distinct from cur.currency
        and deleted_at is null
      order by created_at asc, id asc
    loop
      running := running + (case when m.type = 'charge' then m.amount else -m.amount end);
      update public.movements set running_balance = running where id = m.id;
    end loop;
  end loop;
end;
$$;

grant execute on function public.recalc_client_running_balance(uuid) to authenticated;

-- ── 3. FIFO payment matching, scoped to one currency ────────────────────
-- Same queue algorithm as before, now filtered to a single currency: a
-- dollar payment can only pay off dollar charges.
create or replace function public.get_oldest_unpaid_charge_for_currency(
  p_client_id uuid,
  p_currency text
)
returns table (charge_at timestamptz, plazo_dias int)
language plpgsql
stable
as $$
declare
  m record;
  queue_amount numeric[] := '{}';
  queue_at timestamptz[] := '{}';
  queue_plazo int[] := '{}';
  remaining numeric;
  i int;
begin
  for m in
    select mv.type, mv.amount, mv.created_at, mv.plazo_dias
    from public.movements mv
    where mv.client_id = p_client_id
      and mv.currency is not distinct from p_currency
      and mv.deleted_at is null
    order by mv.created_at asc, mv.id asc
  loop
    if m.type = 'charge' then
      queue_amount := array_append(queue_amount, m.amount);
      queue_at := array_append(queue_at, m.created_at);
      queue_plazo := array_append(queue_plazo, m.plazo_dias);
    else
      remaining := m.amount;
      i := 1;
      while remaining > 0 and i <= coalesce(array_length(queue_amount, 1), 0) loop
        if queue_amount[i] > 0 then
          if queue_amount[i] <= remaining then
            remaining := remaining - queue_amount[i];
            queue_amount[i] := 0;
          else
            queue_amount[i] := queue_amount[i] - remaining;
            remaining := 0;
          end if;
        end if;
        i := i + 1;
      end loop;
    end if;
  end loop;

  for i in 1 .. coalesce(array_length(queue_amount, 1), 0) loop
    if queue_amount[i] > 0 then
      charge_at := queue_at[i];
      plazo_dias := queue_plazo[i];
      return next;
      return;
    end if;
  end loop;

  return;
end;
$$;

grant execute on function public.get_oldest_unpaid_charge_for_currency(uuid, text) to authenticated;

-- Kept at the same signature the view and app already call: returns the
-- earliest still-unpaid charge across every currency, since status and mora
-- remain a single combined judgement per client.
create or replace function public.get_oldest_unpaid_charge(p_client_id uuid)
returns table (charge_at timestamptz, plazo_dias int)
language plpgsql
stable
as $$
declare
  cur record;
  r record;
  best_at timestamptz;
  best_plazo int;
begin
  for cur in
    select distinct currency
    from public.movements
    where client_id = p_client_id and deleted_at is null
  loop
    select * into r
    from public.get_oldest_unpaid_charge_for_currency(p_client_id, cur.currency);

    if r.charge_at is not null and (best_at is null or r.charge_at < best_at) then
      best_at := r.charge_at;
      best_plazo := r.plazo_dias;
    end if;
  end loop;

  if best_at is not null then
    charge_at := best_at;
    plazo_dias := best_plazo;
    return next;
  end if;

  return;
end;
$$;

grant execute on function public.get_oldest_unpaid_charge(uuid) to authenticated;

-- ── 4. rebuild every VE client's balances under the new per-currency rule ─
do $$
declare
  r record;
begin
  for r in
    select distinct c.id
    from public.clients c
    join public.owners o on o.id = c.owner_id
    where o.country = 'VE'
  loop
    perform public.recalc_client_running_balance(r.id);
  end loop;
end
$$;

-- ── 5. client_summary exposes one balance per currency ──────────────────
drop view if exists public.client_summary;

create view public.client_summary
with (security_invoker = on) as
select
  c.id as client_id,
  c.owner_id,
  c.name,
  c.whatsapp,
  c.created_at as client_created_at,
  -- COP ledger (country='CO'): the currency-less chain, unchanged.
  coalesce(latest_cop.running_balance, 0) as balance,
  -- VE ledger: one independent balance per currency.
  coalesce(latest_usd.running_balance, 0) as balance_usd,
  coalesce(latest_eur.running_balance, 0) as balance_eur,
  coalesce(review.any_needs_review, false) as has_pending_review,
  last_payment.created_at as last_payment_at,
  coalesce(last_payment.created_at, c.created_at) as mora_reference_at,
  extract(day from now() - coalesce(last_payment.created_at, c.created_at))::int as days_since_payment,
  oldest_unpaid.charge_at as oldest_unpaid_charge_at,
  oldest_unpaid.plazo_dias as oldest_unpaid_charge_plazo_dias,
  c.document_id,
  c.is_flagged
from public.clients c
left join lateral (
  select m.running_balance from public.movements m
  where m.client_id = c.id and m.currency is null and m.deleted_at is null
  order by m.created_at desc, m.id desc limit 1
) latest_cop on true
left join lateral (
  select m.running_balance from public.movements m
  where m.client_id = c.id and m.currency = 'USD' and m.deleted_at is null
  order by m.created_at desc, m.id desc limit 1
) latest_usd on true
left join lateral (
  select m.running_balance from public.movements m
  where m.client_id = c.id and m.currency = 'EUR' and m.deleted_at is null
  order by m.created_at desc, m.id desc limit 1
) latest_eur on true
left join lateral (
  select bool_or(m.needs_review) as any_needs_review from public.movements m
  where m.client_id = c.id and m.deleted_at is null
) review on true
left join lateral (
  select m.created_at from public.movements m
  where m.client_id = c.id and m.type = 'payment' and m.deleted_at is null
  order by m.created_at desc limit 1
) last_payment on true
left join lateral public.get_oldest_unpaid_charge(c.id) oldest_unpaid on true;

grant select on public.client_summary to authenticated;

-- ── 6. get_shared_balance: both balances + each movement's currency ─────
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
  v_balance numeric(14, 4);
  v_balance_usd numeric(14, 4);
  v_balance_eur numeric(14, 4);
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
  from public.movements m
  where m.client_id = v_client.id and m.deleted_at is null;

  select coalesce(balance, 0), coalesce(balance_usd, 0), coalesce(balance_eur, 0)
    into v_balance, v_balance_usd, v_balance_eur
  from public.client_summary where client_id = v_client.id;

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
    'balance_usd', coalesce(v_balance_usd, 0),
    'balance_eur', coalesce(v_balance_eur, 0),
    'movements', coalesce(v_movements, '[]'::json),
    'owner_country', v_owner_country,
    'rate_mode', v_settings.rate_mode,
    'current_bcv_usd', v_current_bcv.usd,
    'current_bcv_eur', v_current_bcv.eur,
    'custom_rate_usd', v_settings.custom_rate_usd,
    'custom_rate_eur', v_settings.custom_rate_eur
  );
end;
$$;

grant execute on function public.get_shared_balance(text) to anon, authenticated;
