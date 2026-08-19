-- Additive migration: run once in the SQL editor. Doesn't touch existing data.
-- Adds an optional "plazo de pago" (payment term, in days) to charge
-- movements, and extends client_summary with the oldest still-unpaid
-- charge's date/term so the dashboard can tell "owes money but still
-- within term" apart from "actually late".

alter table public.movements
  add column if not exists plazo_dias int;

alter table public.movements
  drop constraint if exists movements_plazo_dias_check;
alter table public.movements
  add constraint movements_plazo_dias_check check (plazo_dias is null or plazo_dias in (7, 15, 30, 45));

-- Walks a client's movements oldest-to-newest, applying payments to charges
-- FIFO (oldest charge first) the way a running balance implicitly does, and
-- returns the date + plazo_dias of whichever charge is still oldest-unpaid.
-- Returns no rows once every charge has been fully paid off.
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
    where mv.client_id = p_client_id
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

grant execute on function public.get_oldest_unpaid_charge(uuid) to authenticated;

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
  oldest_unpaid.plazo_dias as oldest_unpaid_charge_plazo_dias
from public.clients c
left join lateral (
  select m.running_balance
  from public.movements m
  where m.client_id = c.id
  order by m.created_at desc, m.id desc
  limit 1
) latest on true
left join lateral (
  select bool_or(m.needs_review) as any_needs_review
  from public.movements m
  where m.client_id = c.id
) review on true
left join lateral (
  select m.created_at
  from public.movements m
  where m.client_id = c.id and m.type = 'payment'
  order by m.created_at desc
  limit 1
) last_payment on true
left join lateral public.get_oldest_unpaid_charge(c.id) oldest_unpaid on true;

grant select on public.client_summary to authenticated;
