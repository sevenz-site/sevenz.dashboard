-- Lets an owner delete a movement they registered by mistake (soft-delete,
-- not a hard DELETE) and restore it later from a notification. A deleted
-- movement's row stays in place with deleted_at set; every balance-reading
-- query in the app must now exclude it, and running_balance for every
-- movement that came after it has to be recalculated since it was computed
-- once, at insert time, from whatever the previous balance was.

alter table public.movements
  add column if not exists deleted_at timestamptz;

create index if not exists movements_client_id_active_idx
  on public.movements (client_id, created_at) where deleted_at is null;

-- The insert-time trigger must skip deleted rows when finding "the current
-- balance to build on" — otherwise a deleted row that happens to still be
-- the latest by created_at would silently resurrect its balance into the
-- next real movement.
create or replace function public.set_movement_running_balance()
returns trigger
language plpgsql
as $$
declare
  v_prev numeric(12, 2);
begin
  select running_balance into v_prev
  from public.movements
  where client_id = new.client_id and deleted_at is null
  order by created_at desc, id desc
  limit 1;

  v_prev := coalesce(v_prev, 0);
  new.running_balance := v_prev + (case when new.type = 'charge' then new.amount else -new.amount end);

  return new;
end;
$$;

-- Walks a client's non-deleted movements oldest-to-newest and rewrites
-- running_balance on every one of them. Called after a delete or a restore,
-- since either one can shift every balance that came after it. Not
-- SECURITY DEFINER: it runs as the calling owner, so movements RLS quietly
-- limits it to that owner's own clients even if a bad client_id is passed.
create or replace function public.recalc_client_running_balance(p_client_id uuid)
returns void
language plpgsql
as $$
declare
  m record;
  running numeric(12, 2) := 0;
begin
  for m in
    select id, type, amount
    from public.movements
    where client_id = p_client_id and deleted_at is null
    order by created_at asc, id asc
  loop
    running := running + (case when m.type = 'charge' then m.amount else -m.amount end);
    update public.movements set running_balance = running where id = m.id;
  end loop;
end;
$$;

grant execute on function public.recalc_client_running_balance(uuid) to authenticated;

-- Same FIFO walk as before, just skipping deleted movements.
create or replace function public.get_oldest_unpaid_charge(p_client_id uuid)
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
    where mv.client_id = p_client_id and mv.deleted_at is null
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

-- Same shape as before, just excluding deleted movements from balance,
-- review-flag, and last-payment-date calculations.
create or replace view public.client_summary
with (security_invoker = on) as
select
  c.id as client_id,
  c.owner_id,
  c.name,
  c.whatsapp,
  c.created_at as client_created_at,
  coalesce(latest.running_balance, 0) as balance,
  coalesce(review.any_needs_review, false) as has_pending_review,
  last_payment.created_at as last_payment_at,
  coalesce(last_payment.created_at, c.created_at) as mora_reference_at,
  extract(day from now() - coalesce(last_payment.created_at, c.created_at))::int as days_since_payment,
  oldest_unpaid.charge_at as oldest_unpaid_charge_at,
  oldest_unpaid.plazo_dias as oldest_unpaid_charge_plazo_dias,
  c.document_id
from public.clients c
left join lateral (
  select m.running_balance
  from public.movements m
  where m.client_id = c.id and m.deleted_at is null
  order by m.created_at desc, m.id desc
  limit 1
) latest on true
left join lateral (
  select bool_or(m.needs_review) as any_needs_review
  from public.movements m
  where m.client_id = c.id and m.deleted_at is null
) review on true
left join lateral (
  select m.created_at
  from public.movements m
  where m.client_id = c.id and m.type = 'payment' and m.deleted_at is null
  order by m.created_at desc
  limit 1
) last_payment on true
left join lateral public.get_oldest_unpaid_charge(c.id) oldest_unpaid on true;

grant select on public.client_summary to authenticated;

-- Same shape as before, just excluding deleted movements from the public
-- client's history and balance.
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

  select business_name, whatsapp, logo_path, payment_info
    into v_business, v_owner_whatsapp, v_owner_logo_path, v_payment_info
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

  return json_build_object(
    'business_name', v_business,
    'owner_whatsapp', v_owner_whatsapp,
    'owner_logo_path', v_owner_logo_path,
    'payment_info', v_payment_info,
    'client_name', v_client.name,
    'document_id', v_client.document_id,
    'whatsapp_last4', right(coalesce(v_client.whatsapp, ''), 4),
    'balance', coalesce(v_balance, 0),
    'movements', coalesce(v_movements, '[]'::json)
  );
end;
$$;

grant execute on function public.get_shared_balance(text) to anon, authenticated;

-- ── movement deletions (drives the "movimiento eliminado" notification) ──
-- The movement row itself stays put (soft-deleted); this table is only the
-- notification/audit trail — same read_at pattern as import_notifications.
-- A movement can be deleted and restored more than once, so this is a log,
-- not a 1:1 flag: only rows with restored_at is null are still "pending".
create table if not exists public.movement_deletions (
  id uuid primary key default gen_random_uuid(),
  movement_id uuid not null references public.movements (id) on delete cascade,
  owner_id uuid not null references public.owners (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  deleted_at timestamptz not null default now(),
  restored_at timestamptz,
  read_at timestamptz
);

create index if not exists movement_deletions_owner_id_idx on public.movement_deletions (owner_id);

alter table public.movement_deletions enable row level security;

drop policy if exists "owners manage own movement deletions" on public.movement_deletions;
create policy "owners manage own movement deletions" on public.movement_deletions
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

grant select, insert, update on public.movement_deletions to authenticated;
