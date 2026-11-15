-- 207 · THE THREE MONDAY TEMPLATES META APPROVED ON 2026-11-15: `ventas_resumen`,
-- `negocio_estado` and `primera_semana` (MS-51). Owner: «ya meta aprobó ventas_resumen;
-- primera_semana; y negocio_estado. Revisa si falta el código de algunas de ellas, de ser
-- así constrúyelo para que salgan en el próximo release».
--
-- Nothing here sends anything: `lib/whatsapp/business-weekly-text.ts` chooses the template.
-- This only gives the weekly targets the six figures that choice needs. The function is the
-- one in 206, unchanged except for `o.created_at` in `recipients` and the six new fields.
--
-- RE-RUNNABLE: `drop function if exists` with the one signature this function has ever had
-- (text, text), then `create`. Same grants as 205 and 206: only the service role.
--
-- DEV FIRST (`vzqppwrwnmlbrxizskdh`), then production (`rabmiyqodnvnrwiartuj`) in the
-- release window, before the code. The code reads every new field with a default, so it
-- still works against 206 (it then falls back to the old Monday template).

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
           o.created_at,
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
    -- 207: WHAT THE THREE MONDAY TEMPLATES APPROVED ON 2026-11-15 NEED TO CHOOSE.
    -- Whole days since the account was created, to find its first Monday with 5 or more.
    'account_age_days', floor(extract(epoch from (now() - r.created_at)) / 86400)::int,
    -- «Clientes registrados»: the client list the shopkeeper sees, so neither the bin nor
    -- the counter client the app creates for walk-in sales.
    'clients_count', (
      select count(*) from public.clients c
       where c.owner_id = r.id and c.trashed_at is null and c.deleted_at is null
         and not coalesce(c.is_walk_in, false)),
    'products_count', (
      select count(*) from public.products p
       where p.owner_id = r.id and p.trashed_at is null),
    -- «Si registró algo»: a client, a product or a sale. An account that only signed up
    -- gets no first-week summary, which would be all zeros.
    'has_records', (
      exists (select 1 from public.clients c
               where c.owner_id = r.id and not coalesce(c.is_walk_in, false))
      or exists (select 1 from public.products p where p.owner_id = r.id)
      or exists (select 1 from public.sales sa where sa.owner_id = r.id and sa.deleted_at is null)),
    -- `primera_semana` goes once in the life of an account. A failed send (ok false) does
    -- not count, so the next Monday inside the window can still deliver it.
    'first_week_sent', exists (
      select 1 from public.whatsapp_sends w
       where w.owner_id = r.id and w.template = 'primera_semana' and w.ok is not false),
    -- «Máximo tres lunes seguidos, y se detiene». Three Mondays fit in 22 days and no more,
    -- so three delivered `negocio_estado` in that window are three in a row. Any other
    -- Monday template in between leaves fewer than three there and the count starts over.
    'status_streak', (
      select count(*) from public.whatsapp_sends w
       where w.owner_id = r.id and w.template = 'negocio_estado' and w.ok is true
         and w.sent_at > now() - interval '22 days'),
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

insert into public.schema_migrations (key, description)
values ('207_monday_family_targets', 'Lunes de la familia del negocio: la función de destinatarios suma antigüedad de la cuenta, clientes, productos, si ya registró algo, si ya recibió primera_semana y cuántos negocio_estado seguidos lleva, para elegir entre ventas_resumen, negocio_estado y primera_semana (aprobadas por Meta el 2026-11-15).')
on conflict (key) do nothing;
