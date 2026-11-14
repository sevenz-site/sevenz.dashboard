-- ENVIRONMENT: run in DEV first (vzqppwrwnmlbrxizskdh). Production comes later, with its
-- own green light, and BEFORE the code that calls it (CLAUDE.md, deploy step 1). Nothing in
-- production calls these functions today.
-- Re-runnable: `create table if not exists`, drop + create for every function, and
-- `on conflict` on the ledger row.
--
-- ===========================================================================
-- 205: THE BUSINESS FAMILY ON MONDAY AND THURSDAY
--
-- Owner's request of 2026-11-13: «sí constrúyelo», for v0.6.0. Approved by Meta and built
-- here: `negocio_resumen` (Monday), `atencion_cobros` and `atencion_negocio` (Thursday).
-- They replace `cartera_summary_v2` for an owner with something owed, and `cartera_attention`
-- entirely. The spec is `../docs/WHATSAPP-PLANTILLAS.md`, «La familia del negocio».
--
-- His four answers that day, which shape every figure below:
--   - «En las dos monedas»: a client who owes in dollars AND euros counts once in each book.
--     The counts can add up to more than the real clients, and that is correct: two books.
--   - «Todo lo que deben»: the amount next to «3 clientes» is the whole balance of that book
--     for those clients, not only the part that fell due.
--   - «Solo los de 7 días»: «Por vencer» is a book whose next deadline falls in the next 7
--     days, nothing further out.
--   - «Construye y te lo paso»: the variable names and order below are the spec's; he reads
--     the approved ones off Kapso before launch. That comparison is a hard stop.
--
-- WHAT THIS FILE ADDS
--   1. `whatsapp_attention_memory`: which clients were overdue in the last Thursday message
--      that went out, so this Thursday can say «(2 clientes nuevos esta semana)».
--   2. `whatsapp_ledger_states(owner)`: each client's book, with its balance and whether it
--      is overdue or due within 7 days. One definition, read by the two functions below.
--   3. `whatsapp_business_weekly_targets(period, prev_period)`: every owner who accepted the
--      notices, with every figure both days need, and whether this week's Monday or Thursday
--      slot is already taken, for this owner and for this phone.
--   4. `whatsapp_attention_remember(owner, period)`: writes 1 after a Thursday send succeeds.
--
-- THE SLOT CHECK IS NEW AND IS THE POINT. The send gate (067/101) dedupes by owner, template
-- and week. With several templates per day that stops being enough: if an owner's books
-- change between Monday and the Tuesday retry, Monday's `negocio_resumen` and Tuesday's
-- `cartera_summary_v2` are different templates and both go out. So a send now first asks
-- whether ANY template of that day already went out this week (`ok is not false`: a send
-- in flight counts, a failed one frees the slot, the same rule as the gate).
--
-- THE CAP COUNTS BY PHONE, NOT BY BUSINESS (CLAUDE.md, «Un tendero recibe dos mensajes a la
-- semana», point 4): two businesses can share a number, and that person would get four.
-- `owners.whatsapp` is compared as stored (digits with prefix); `whatsapp_sends` keeps no
-- phone for owner messages, so the current number is the one counted. An owner who changed
-- number this week is counted with the new one. Accepted: the error is one message, once.
--
-- «OVERDUE» AND «DUE SOON» ARE READ OFF `client_summary`, the same per-book worst charge the
-- client chips and Reportes judge with (146): a book is overdue when its worst open charge
-- has a plazo and that deadline (cuotas included) has passed; due soon when it has not passed
-- and falls within 7 days. A charge WITHOUT plazo is never «plazo vencido»: it has no plazo.
-- THE COST, said here so nobody rediscovers it: `146` ranks a no-plazo charge as overdue from
-- the day it was taken, so a book holding one shows that charge as its worst and hides a
-- termed charge due in three days. That book is in neither line. It is the same answer the
-- client's chip gives on the same book, which is why it was not worked around here.
--
-- Server only: everything is revoked from public, anon and authenticated.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. THE THURSDAY MEMORY

create table if not exists public.whatsapp_attention_memory (
  owner_id uuid not null references public.owners (id) on delete cascade,
  -- `claveSemanal()`, the same key as `whatsapp_sends.period_key`.
  period_key text not null,
  client_id uuid not null references public.clients (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, period_key, client_id)
);

alter table public.whatsapp_attention_memory enable row level security;
-- No policy on purpose: no owner reads this. Only the service role writes and reads it.
revoke all on table public.whatsapp_attention_memory from public, anon, authenticated;
grant select, insert, delete on table public.whatsapp_attention_memory to service_role;

-- ---------------------------------------------------------------------------
-- 2. EACH CLIENT'S BOOK, JUDGED ONCE

drop function if exists public.whatsapp_ledger_states(uuid);
create function public.whatsapp_ledger_states(p_owner_id uuid)
returns table (client_id uuid, ledger text, balance numeric, state text)
language sql
stable
security definer
set search_path = public
as $fn$
  select cs.client_id,
         b.ledger,
         b.balance::numeric,
         case
           when b.plazo is not null and b.due is not null and b.due < now() then 'overdue'
           when b.plazo is not null and b.due is not null and b.due <= now() + interval '7 days' then 'due_soon'
         end
    from public.client_summary cs
    join public.owners o on o.id = cs.owner_id
   cross join lateral (values
     ('COP', cs.balance,     cs.worst_unpaid_charge_plazo_dias_cop, cs.worst_unpaid_charge_due_at_cop),
     ('USD', cs.balance_usd, cs.worst_unpaid_charge_plazo_dias_usd, cs.worst_unpaid_charge_due_at_usd),
     ('EUR', cs.balance_eur, cs.worst_unpaid_charge_plazo_dias_eur, cs.worst_unpaid_charge_due_at_eur)
   ) as b (ledger, balance, plazo, due)
   where cs.owner_id = p_owner_id
     -- Half a cent is not a debt: the same 0.005 as `HOLGURA` in lib/estado-del-plazo.ts.
     and b.balance > 0.005
     -- A Venezuelan business keeps dollars and euros; a Colombian one, pesos. The same split
     -- `porCobrar` in lib/whatsapp/cartera-summary.ts has always made.
     and case when o.country = 'VE' then b.ledger in ('USD', 'EUR') else b.ledger = 'COP' end;
$fn$;

revoke execute on function public.whatsapp_ledger_states(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. WHO GETS WHAT, WITH EVERY FIGURE

drop function if exists public.whatsapp_business_weekly_targets(text, text);
create function public.whatsapp_business_weekly_targets(p_period text, p_prev_period text)
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  with recipients as (
    select o.id,
           o.whatsapp,
           o.first_name,
           o.business_name,
           o.country,
           coalesce(o.low_stock_threshold, 5) as threshold,
           -- `owner_puede_escribir` is STABLE: evaluated once per owner.
           not public.owner_puede_escribir(o.id) as paused,
           coalesce(s.is_test_account, false) as is_test
      from public.owners o
      left join public.subscriptions s on s.owner_id = o.id
     -- The consent rule of every owner message (119), written once more on purpose: this is
     -- the one that decides who is actually written to.
     where o.whatsapp is not null
       and btrim(o.whatsapp) <> ''
       and o.whatsapp_opt_in_at is not null
       and (o.whatsapp_opt_out_at is null or o.whatsapp_opt_in_at > o.whatsapp_opt_out_at)
  ),
  slots as (
    select array['cartera_summary', 'cartera_summary_v2', 'cartera_pausada', 'cartera_pausada_v2',
                 'negocio_resumen', 'ventas_resumen', 'primera_semana', 'negocio_estado'] as monday,
           array['cartera_attention', 'atencion_cobros', 'atencion_negocio', 'atencion_productos',
                 'cierre_mensual'] as thursday
  )
  select jsonb_build_object(
    'owner_id', r.id,
    'whatsapp', r.whatsapp,
    'first_name', r.first_name,
    'business_name', r.business_name,
    'country', r.country,
    'paused', r.paused,
    'is_test', r.is_test,
    'ledgers', coalesce((
      select jsonb_object_agg(x.ledger, jsonb_build_object(
               'due', x.due,
               'overdue_count', x.overdue_count,
               'overdue_amount', x.overdue_amount,
               'soon_count', x.soon_count,
               'soon_amount', x.soon_amount))
        from (
          select ls.ledger,
                 round(sum(ls.balance), 2) as due,
                 count(*) filter (where ls.state = 'overdue') as overdue_count,
                 round(coalesce(sum(ls.balance) filter (where ls.state = 'overdue'), 0), 2) as overdue_amount,
                 count(*) filter (where ls.state = 'due_soon') as soon_count,
                 round(coalesce(sum(ls.balance) filter (where ls.state = 'due_soon'), 0), 2) as soon_amount
            from public.whatsapp_ledger_states(r.id) ls
           group by ls.ledger
        ) x
    ), '{}'::jsonb),
    -- Distinct CLIENTS with an overdue book, for the two templates that predate the family
    -- (`cartera_summary_v2`, `cartera_pausada`) and say «Clientes con plazo vencido: N». A
    -- client late in both books is one client there.
    'overdue_clients', (
      select count(distinct ls.client_id)
        from public.whatsapp_ledger_states(r.id) ls
       where ls.state = 'overdue'),
    -- What was SOLD, line by line, in the last 7 days: Σ quantity × unit price per book. Not
    -- what came in at the till (that is Reportes' «Ventas», which nets returns and counts
    -- payments). The message says «Ventas registradas», and that is what this counts.
    'sales', coalesce((
      select jsonb_object_agg(y.ledger, jsonb_build_object('count', y.n, 'amount', y.amount))
        from (
          select sl.currency as ledger,
                 count(distinct sa.id) as n,
                 round(sum(sl.quantity * sl.unit_price), 2) as amount
            from public.sales sa
            join public.sale_lines sl on sl.sale_id = sa.id
           where sa.owner_id = r.id
             and sa.deleted_at is null
             and sa.created_at > now() - interval '7 days'
             and case when r.country = 'VE' then sl.currency in ('USD', 'EUR') else sl.currency = 'COP' end
           group by sl.currency
        ) y
    ), '{}'::jsonb),
    -- `stockState` in lib/products/availability.ts, the rule both faces of the app share:
    -- out at zero or below; low above zero and at or under the threshold, only when the
    -- threshold is above zero («0» is «no me avises»). Uncounted products are neither.
    'out_of_stock', (
      select count(*) from public.products p
       where p.owner_id = r.id and p.trashed_at is null
         and p.stock_opening is not null and p.stock_opening <= 0),
    'low_stock', (
      select count(*) from public.products p
       where p.owner_id = r.id and p.trashed_at is null
         and r.threshold > 0
         and p.stock_opening is not null and p.stock_opening > 0 and p.stock_opening <= r.threshold),
    -- Not registered and not discarded: `isUnregistered` in lib/orders/catalog-orders.ts.
    'open_orders', (
      select count(*) from public.catalog_orders co
       where co.owner_id = r.id and co.status not in ('registered', 'discarded')),
    -- NULL, not zero, when there is nothing to compare against: no Thursday message went out
    -- last week. «0 nuevos» would claim a comparison that never happened.
    'new_overdue_clients', case
      when exists (
        select 1 from public.whatsapp_sends w
         where w.owner_id = r.id and w.period_key = p_prev_period and w.ok is true
           and w.template in ('atencion_cobros', 'atencion_negocio'))
      then (
        select count(distinct ls.client_id)
          from public.whatsapp_ledger_states(r.id) ls
         where ls.state = 'overdue'
           and not exists (
             select 1 from public.whatsapp_attention_memory m
              where m.owner_id = r.id and m.period_key = p_prev_period and m.client_id = ls.client_id))
    end,
    'monday_used', exists (
      select 1 from public.whatsapp_sends w, slots
       where w.owner_id = r.id and w.period_key = p_period and w.ok is not false
         and w.template = any (slots.monday)),
    'thursday_used', exists (
      select 1 from public.whatsapp_sends w, slots
       where w.owner_id = r.id and w.period_key = p_period and w.ok is not false
         and w.template = any (slots.thursday)),
    'phone_slots_used', (
      select count(*) from public.whatsapp_sends w
        join public.owners o2 on o2.id = w.owner_id, slots
       where o2.whatsapp = r.whatsapp and w.period_key = p_period and w.ok is not false
         and (w.template = any (slots.monday) or w.template = any (slots.thursday)))
  )
  from recipients r;
$fn$;

revoke execute on function public.whatsapp_business_weekly_targets(text, text) from public, anon, authenticated;
grant execute on function public.whatsapp_business_weekly_targets(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. REMEMBER WHO WAS OVERDUE, AFTER A THURSDAY SEND WENT OUT

drop function if exists public.whatsapp_attention_remember(uuid, text);
create function public.whatsapp_attention_remember(p_owner_id uuid, p_period text)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_rows integer;
begin
  -- Rewritten whole, so a retry the same week leaves one copy, not two.
  delete from public.whatsapp_attention_memory
   where owner_id = p_owner_id and period_key = p_period;

  insert into public.whatsapp_attention_memory (owner_id, period_key, client_id)
  select distinct p_owner_id, p_period, ls.client_id
    from public.whatsapp_ledger_states(p_owner_id) ls
   where ls.state = 'overdue';
  get diagnostics v_rows = row_count;

  -- Only last week is ever read. Eight weeks is plenty of slack for a missed Thursday.
  delete from public.whatsapp_attention_memory
   where owner_id = p_owner_id and created_at < now() - interval '60 days';

  return v_rows;
end;
$fn$;

revoke execute on function public.whatsapp_attention_remember(uuid, text) from public, anon, authenticated;
grant execute on function public.whatsapp_attention_remember(uuid, text) to service_role;

insert into public.schema_migrations (key, description)
values (
  '205_business_weekly_whatsapp',
  'La familia del negocio por WhatsApp: negocio_resumen el lunes, atencion_cobros y atencion_negocio el jueves (pedido del dueño del 2026-11-13, v0.6.0). Cifras por moneda («En las dos monedas»), el saldo entero del libro («Todo lo que deben»), por vencer solo en 7 días. Una plantilla por cita y dos por teléfono a la semana. Guarda qué clientes estaban vencidos en el último jueves enviado, para decir cuántos son nuevos. Solo del servidor.'
)
on conflict (key) do nothing;

commit;
