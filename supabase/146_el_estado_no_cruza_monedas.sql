-- 146 -- THE WORST CHARGE, LEDGER BY LEDGER
--
-- `CT-137`. Owner's instruction on 2026-10-23, looking at the Clientes list:
-- *«debería prelar el estado más crítico con su moneda respectiva, sin cruzar
-- estado con moneda que es el error que entiendo que está pasando
-- actualmente»*.
--
-- WHAT HE SAW. Her row read **«Mariangel Mendoza · A favor · €3.50»** -- a
-- green chip saying she is in credit, with the debt printed beside it. One
-- tap away, her own page said **«Crítico (2)»**.
--
-- The row was mixing two criteria. The figure came from «the bigger of the
-- two ledgers»; the chip came from «both balances converted to dollars and
-- added up», which for her is +158,50 $ of credit against 3,50 € of debt, so
-- it netted out green. Neither half was wrong on its own; together they
-- described two different things in one line.
--
-- The client's own page stopped summing ledgers on 2026-10-23 (`144`). Every
-- screen that judges a client from a `client_summary` row still did, because
-- that row carries ONE `worst_unpaid_charge_*` for the whole client.
--
-- ===========================================================================
-- ONE RANKING, NOT TWO
--
-- `get_worst_unpaid_charge` (migration `134`) already knows how to pick the
-- worst open charge. Writing a second copy of that rule, grouped by currency,
-- is how the two would eventually disagree -- the failure this repo has
-- written down three times. So it goes the other way round:
--
--   * `get_worst_unpaid_charge_by_ledger` becomes the ONLY implementation,
--     and returns one row per ledger.
--   * `get_worst_unpaid_charge` keeps its signature and its meaning, and is
--     now a one-line pick of the worst row among those.
--
-- Its three sort keys are `134`'s, unchanged and for its reasons: overdue
-- first; among the overdue, the ones that HAD a term before the ones that
-- never had one, because «Plazo vencido» says an agreed date was missed and
-- «Sin plazo» says none was ever set (owner's call, 2026-10-21); and then the
-- earliest effective due date. A fourth key -- the charge's own date -- was
-- added so a tie resolves the same way every time instead of depending on the
-- order rows happen to come back in.
--
-- WHAT IT IS NOT: this file does not decide any chip. The judging stays in
-- TypeScript, in `getClientStatus`, which also needs the balance and the days
-- without payment. SQL answers one question -- «which open charge is the
-- worst in each ledger» -- and answers it once.

begin;

-- ===========================================================================
-- 1. THE WORST OPEN CHARGE OF EACH LEDGER
--
-- `language sql` and not plpgsql: the loop `134` used existed to carry one
-- running best, and one per ledger is a `distinct on`, which is the same
-- ranking written as sorting instead of as comparing. Every internal alias is
-- renamed (`ledger`, `taken_at`, `term_days`...) so that no CTE column ever
-- shares a name with an OUT parameter -- the ambiguity that migration `126`
-- documents the hard way.
drop function if exists public.get_worst_unpaid_charge_by_ledger(uuid);

create function public.get_worst_unpaid_charge_by_ledger(p_client_id uuid)
returns table (
  currency text,
  charge_at timestamptz,
  plazo_dias int,
  due_at timestamptz,
  overdue_count int
)
language sql
stable
as $fn$
  with open_charges as (
    select
      oc.currency   as ledger,
      oc.charge_at  as taken_at,
      oc.plazo_dias as term_days,
      oc.amount     as total,
      oc.pending    as left_to_pay,
      greatest(coalesce(oc.cuotas, 1), 1) as parts
    from public.get_open_charges_for_client(p_client_id) oc
  ),
  with_due as (
    -- WHOLE CUOTAS ONLY, copied from `134`, which copied it from `126`: half a
    -- cuota does not move the deadline. If that rule ever changes, a grep for
    -- `cubiertas` finds the other two.
    select
      o.*,
      case
        when o.term_days is null then null
        else o.taken_at + (interval '1 day' * (o.term_days::numeric
             * (least(
                  o.parts - 1,
                  case when o.total > 0
                       then floor((o.total - o.left_to_pay) / (o.total / o.parts))
                       else 0 end
                ) + 1) / o.parts))
      end as due
    from open_charges o
  ),
  ranked as (
    select
      w.*,
      -- A charge with no term counts as overdue from the day it was taken.
      -- `134`'s `coalesce(vence, charge_at)`, unchanged.
      count(*) filter (where coalesce(w.due, w.taken_at) < now())
        over (partition by w.ledger) as overdue
    from with_due w
  )
  select distinct on (r.ledger)
    r.ledger,
    r.taken_at,
    r.term_days,
    r.due,
    r.overdue::int
  from ranked r
  order by
    r.ledger,
    (case when coalesce(r.due, r.taken_at) < now() then 0 else 1 end),
    (case when coalesce(r.due, r.taken_at) < now() and r.term_days is null then 1 else 0 end),
    coalesce(r.due, r.taken_at),
    r.taken_at;
$fn$;

revoke execute on function public.get_worst_unpaid_charge_by_ledger(uuid) from public;
grant execute on function public.get_worst_unpaid_charge_by_ledger(uuid) to authenticated;

-- ===========================================================================
-- 2. THE CLIENT-WIDE ONE NOW DELEGATES
--
-- Same name, same arguments, same `returns table`, so `create or replace`
-- really replaces and nothing that calls it has to change. The language goes
-- from plpgsql to sql, which `create or replace` allows.
--
-- `overdue_count` IS THE SUM OF THE LEDGERS' COUNTS, which is what the old
-- loop counted: every open charge of the client that is past its date,
-- whatever ledger it sits in. The badge's «(3)» means the same thing it meant
-- yesterday.
create or replace function public.get_worst_unpaid_charge(p_client_id uuid)
returns table (
  charge_at timestamptz,
  plazo_dias int,
  due_at timestamptz,
  overdue_count int
)
language sql
stable
as $fn$
  with per_ledger as (
    select * from public.get_worst_unpaid_charge_by_ledger(p_client_id)
  )
  select
    w.charge_at,
    w.plazo_dias,
    w.due_at,
    (select coalesce(sum(t.overdue_count), 0)::int from per_ledger t)
  from per_ledger w
  order by
    (case when coalesce(w.due_at, w.charge_at) < now() then 0 else 1 end),
    (case when coalesce(w.due_at, w.charge_at) < now() and w.plazo_dias is null then 1 else 0 end),
    coalesce(w.due_at, w.charge_at),
    w.charge_at
  limit 1;
$fn$;

grant execute on function public.get_worst_unpaid_charge(uuid) to authenticated;

-- ===========================================================================
-- 3. TWELVE COLUMNS ON THE SUMMARY, AT THE END
--
-- Same reason `118`, `130` and `134` all give for appending rather than
-- inserting: some screens read these views with `select *`, and a different
-- order would change what each one receives with nothing to warn anybody.
--
-- ONE LATERAL JOIN AND A PIVOT, not three joins: the function is one call per
-- client either way, and calling it three times would triple the work of the
-- heaviest query on the Clientes screen, which already reads every client of
-- the business in one go.
create or replace view public.client_summary_all
with (security_invoker = on) as
select
  c.id as client_id,
  c.owner_id,
  c.name,
  c.whatsapp,
  c.created_at as client_created_at,
  coalesce(latest_cop.running_balance, 0) as balance,
  coalesce(latest_usd.running_balance, 0) as balance_usd,
  coalesce(latest_eur.running_balance, 0) as balance_eur,
  coalesce(review.any_needs_review, false) as has_pending_review,
  last_payment.created_at as last_payment_at,
  coalesce(last_payment.created_at, c.created_at) as mora_reference_at,
  extract(day from now() - coalesce(last_payment.created_at, c.created_at))::int as days_since_payment,
  oldest_unpaid.charge_at as oldest_unpaid_charge_at,
  oldest_unpaid.plazo_dias as oldest_unpaid_charge_plazo_dias,
  c.document_id,
  c.is_flagged,
  c.trashed_at,
  c.deleted_at,
  c.trashed_balance,
  c.trashed_balance_usd,
  c.trashed_balance_eur,
  oldest_unpaid.due_at as oldest_unpaid_charge_due_at,
  coalesce(
    greatest(last_movement.created_at, last_sale.created_at),
    c.created_at
  ) as last_movement_at,
  worst_unpaid.charge_at as worst_unpaid_charge_at,
  worst_unpaid.plazo_dias as worst_unpaid_charge_plazo_dias,
  worst_unpaid.due_at as worst_unpaid_charge_due_at,
  -- NULL AND NOT ZERO when the client owes nothing: `get_worst_unpaid_charge`
  -- returns no row at all then, so the left join leaves every column null.
  -- The screen coalesces it; writing a zero here would need a second lateral
  -- for a number no badge draws.
  worst_unpaid.overdue_count as overdue_charge_count,
  -- THE SAME FOUR, ONCE PER LEDGER. Null throughout for a ledger with nothing
  -- open, exactly like the client-wide ones above and for the same reason.
  by_ledger.cop_at    as worst_unpaid_charge_at_cop,
  by_ledger.cop_plazo as worst_unpaid_charge_plazo_dias_cop,
  by_ledger.cop_due   as worst_unpaid_charge_due_at_cop,
  by_ledger.cop_count as overdue_charge_count_cop,
  by_ledger.usd_at    as worst_unpaid_charge_at_usd,
  by_ledger.usd_plazo as worst_unpaid_charge_plazo_dias_usd,
  by_ledger.usd_due   as worst_unpaid_charge_due_at_usd,
  by_ledger.usd_count as overdue_charge_count_usd,
  by_ledger.eur_at    as worst_unpaid_charge_at_eur,
  by_ledger.eur_plazo as worst_unpaid_charge_plazo_dias_eur,
  by_ledger.eur_due   as worst_unpaid_charge_due_at_eur,
  by_ledger.eur_count as overdue_charge_count_eur
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
left join lateral (
  select m.created_at from public.movements m
  where m.client_id = c.id and m.deleted_at is null
  order by m.created_at desc limit 1
) last_movement on true
left join lateral (
  select s.created_at from public.sales s
  where s.client_id = c.id and s.deleted_at is null
  order by s.created_at desc limit 1
) last_sale on true
left join lateral public.get_oldest_unpaid_charge(c.id) oldest_unpaid on true
left join lateral public.get_worst_unpaid_charge(c.id) worst_unpaid on true
left join lateral (
  -- `max` over at most one row per ledger IS that row's value. It is the
  -- shortest way to pivot three rows into one and needs no second scan.
  select
    max(l.charge_at)     filter (where l.currency is null)  as cop_at,
    max(l.plazo_dias)    filter (where l.currency is null)  as cop_plazo,
    max(l.due_at)        filter (where l.currency is null)  as cop_due,
    max(l.overdue_count) filter (where l.currency is null)  as cop_count,
    max(l.charge_at)     filter (where l.currency = 'USD')  as usd_at,
    max(l.plazo_dias)    filter (where l.currency = 'USD')  as usd_plazo,
    max(l.due_at)        filter (where l.currency = 'USD')  as usd_due,
    max(l.overdue_count) filter (where l.currency = 'USD')  as usd_count,
    max(l.charge_at)     filter (where l.currency = 'EUR')  as eur_at,
    max(l.plazo_dias)    filter (where l.currency = 'EUR')  as eur_plazo,
    max(l.due_at)        filter (where l.currency = 'EUR')  as eur_due,
    max(l.overdue_count) filter (where l.currency = 'EUR')  as eur_count
  from public.get_worst_unpaid_charge_by_ledger(c.id) l
) by_ledger on true;

grant select on public.client_summary_all to authenticated;

-- RE-EXPANDING THE `*`, same as `130` and `134`: this view's body is
-- `select *`, which Postgres froze into a fixed column list when it was
-- created. Replacing `client_summary_all` above does not widen this one on
-- its own, and leaving this statement out is the silent failure -- the
-- migration succeeds, the columns exist in one view and not the other, and
-- every chip reads undefined.
create or replace view public.client_summary
with (security_invoker = on) as
select * from public.client_summary_all
where trashed_at is null and deleted_at is null;

grant select on public.client_summary to authenticated;

insert into public.schema_migrations (key, description)
values (
  '146_el_estado_no_cruza_monedas',
  'CT-137. client_summary y client_summary_all traen el peor fiado abierto DE CADA MONEDA, en doce columnas nuevas al final, para que el chip de estado de cada pantalla deje de juzgar los dos libros sumados. Lo que se veia: la fila de la lista decia «A favor» con 3,50 EUR de deuda al lado, porque la cifra salia del libro mas grande y el chip de los dos saldos convertidos a dolares y sumados; su propia ficha, a un toque, decia «Critico (2)». No se escribio una segunda copia del ranking: get_worst_unpaid_charge_by_ledger pasa a ser la UNICA implementacion y get_worst_unpaid_charge -misma firma, mismo significado- ahora elige la peor fila entre las suyas. Las tres claves de orden son las de la 134 sin cambios, mas un cuarto desempate por la fecha del propio fiado para que un empate se resuelva igual siempre. Esta migracion no decide ningun chip: el juicio sigue en TypeScript, en getClientStatus, que ademas necesita el saldo y los dias sin pagar.'
)
on conflict (key) do nothing;

commit;
