-- ENVIRONMENT: run in DEV first (vzqppwrwnmlbrxizskdh). Production comes later, with its
-- own green light, after 205 and BEFORE the code that calls it (CLAUDE.md, deploy step 1).
-- Re-runnable: `create table if not exists`, drop + create for every function, and
-- `on conflict` on the ledger row.
--
-- ===========================================================================
-- 206: ON THURSDAY, PRODUCTS AND ORDERS ONLY COME BACK WHEN SOMETHING IS NEW
--
-- Owner's decision of 2026-11-14 («Solo lo que cambió», then, between two readings, «Bloque
-- solo si hay algo nuevo»): `atencion_negocio` carries its three lines (agotados, por
-- agotarse, pedidos sin atender) only if, since last Thursday's message, a product ran out,
-- a product started running low, or an order arrived. When it does, the three figures are
-- TODAY'S TOTALS, the same Reportes shows. With nothing new, the owner with debtors gets
-- `atencion_cobros`, without those lines. Version 4 of the family document promised this;
-- 205 counted whatever was there, and the family document v5 said so.
--
-- WHAT THIS FILE ADDS
--   1. `whatsapp_attention_item_memory`: which products and orders were on last Thursday's list.
--   2. `whatsapp_attention_items(owner)`: today's list, one definition for both uses.
--   3. `whatsapp_business_weekly_targets` again, with `new_attention_items`.
--   4. `whatsapp_attention_remember` again, keeping the items too.
--
-- THE COST, said so nobody rediscovers it: an order that sits unregistered for weeks counts as
-- new only on its first Thursday; a product that stays out of stock comes back only when
-- something else is new. That is the point of the decision, not a slip.
--
-- Server only: everything is revoked from public, anon and authenticated.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. THE THURSDAY MEMORY OF PRODUCTS AND ORDERS

create table if not exists public.whatsapp_attention_item_memory (
  owner_id uuid not null references public.owners (id) on delete cascade,
  period_key text not null,
  -- 'out' and 'low' are products (`stockState`); 'order' is a catalogue order.
  kind text not null check (kind in ('out', 'low', 'order')),
  -- No foreign key: it points at two tables. A deleted product or order simply never
  -- matches again, which is what «not on last week's list» should mean for it.
  item_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, period_key, kind, item_id)
);

alter table public.whatsapp_attention_item_memory enable row level security;
-- No policy on purpose: no owner reads this. Only the server writes and reads it.
revoke all on table public.whatsapp_attention_item_memory from public, anon, authenticated;
grant select, insert, delete on table public.whatsapp_attention_item_memory to service_role;

-- ---------------------------------------------------------------------------
-- 2. TODAY'S LIST, ONE DEFINITION
--
-- The same rules as the three counts of 205: `stockState` for products (out at zero or
-- below; low above zero and at or under the threshold, only when the threshold is above
-- zero), and `isUnregistered` for orders.

drop function if exists public.whatsapp_attention_items(uuid);
create function public.whatsapp_attention_items(p_owner_id uuid)
returns table (kind text, item_id uuid)
language sql
stable
security definer
set search_path = public
as $fn$
  select case when p.stock_opening <= 0 then 'out' else 'low' end, p.id
    from public.products p
    join public.owners o on o.id = p.owner_id
   where p.owner_id = p_owner_id
     and p.trashed_at is null
     and p.stock_opening is not null
     and (p.stock_opening <= 0
          or (coalesce(o.low_stock_threshold, 5) > 0 and p.stock_opening <= coalesce(o.low_stock_threshold, 5)))
  union all
  select 'order', co.id
    from public.catalog_orders co
   where co.owner_id = p_owner_id
     and co.status not in ('registered', 'discarded');
$fn$;

revoke execute on function public.whatsapp_attention_items(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. THE TARGETS, NOW SAYING HOW MANY ATTENTION ITEMS ARE NEW
--
-- Unchanged from 205 except the last field, `new_attention_items`.

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
    -- HOW MANY OF TODAY'S ITEMS ARE NEW SINCE LAST THURSDAY. Only last week's memory counts,
    -- the same «jueves anterior» as `new_overdue_clients`; with no Thursday sent last week,
    -- every item counts as new. A product that went from low to out IS new (it got worse);
    -- one that went from out to low is NOT (it was restocked, and was already on last week's
    -- list as out).
    'new_attention_items', (
      select count(*)
        from public.whatsapp_attention_items(r.id) it
       where not exists (
         select 1 from public.whatsapp_sends w
          where w.owner_id = r.id and w.period_key = p_prev_period and w.ok is true
            and w.template in ('atencion_cobros', 'atencion_negocio'))
          or not exists (
         select 1 from public.whatsapp_attention_item_memory m
          where m.owner_id = r.id and m.period_key = p_prev_period and m.item_id = it.item_id
            and (m.kind = it.kind or (it.kind = 'low' and m.kind = 'out')))),
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
-- 4. REMEMBER WHO WAS OVERDUE AND WHAT NEEDED ATTENTION, AFTER A THURSDAY SEND WENT OUT
--
-- Same as 205, plus the items. Written after EITHER Thursday template, so a week whose
-- message was `atencion_cobros` still leaves its items for the next one to compare with.

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

  delete from public.whatsapp_attention_item_memory
   where owner_id = p_owner_id and period_key = p_period;
  insert into public.whatsapp_attention_item_memory (owner_id, period_key, kind, item_id)
  select p_owner_id, p_period, it.kind, it.item_id
    from public.whatsapp_attention_items(p_owner_id) it;
  delete from public.whatsapp_attention_item_memory
   where owner_id = p_owner_id and created_at < now() - interval '60 days';

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
  '206_attention_items_only_when_new',
  'El jueves, atencion_negocio lleva sus líneas de productos y pedidos solo si desde el jueves anterior se agotó o empezó a agotarse un producto o llegó un pedido; entonces con los totales de hoy. Sin nada nuevo sale atencion_cobros. Decisión del dueño del 2026-11-14. Guarda qué productos y pedidos salieron en cada jueves enviado. Solo del servidor.'
)
on conflict (key) do nothing;

commit;
