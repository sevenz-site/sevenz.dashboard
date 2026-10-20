-- 130. `last_movement_at`: when something last happened with this client.
--
-- Asked for by the owner on 2026-10-20, as two new entries in the «Ordenar
-- por» filter of the client list: «Más reciente a más antiguo» and «Más
-- antiguo a más reciente».
--
-- ===========================================================================
-- WHY A NEW COLUMN AND NOT ONE OF THE FOUR DATES ALREADY THERE
--
-- `client_summary` already carries `client_created_at`, `last_payment_at`,
-- `mora_reference_at` and `oldest_unpaid_charge_at`, and none of them answers
-- «who did I last do business with»:
--
--   client_created_at         when the person was registered. A customer from
--                             two years ago who bought yesterday sorts last.
--   last_payment_at           payments only. A fiado taken today does not
--                             move it.
--   mora_reference_at         `coalesce(last_payment, client_created)` — the
--                             same blind spot, with a fallback.
--   oldest_unpaid_charge_at   the OLDEST debt, which is the opposite end.
--
-- The owner was shown all three free options and chose this one knowing it
-- was the only one that costs a migration.
--
-- ===========================================================================
-- IT HAS TO READ `sales` TOO, AND THAT IS THE WHOLE TRAP
--
-- A fully-paid sale writes NOTHING to `movements` — deliberately, so cash
-- never touches the balance, the score or the charts. So a column built from
-- `movements` alone would say "nothing ever happened" about a customer who
-- pays cash every week, and that customer would sit at the bottom of «Más
-- reciente» forever.
--
-- Measured in dev before writing this: 7 of 19 live sales leave no movement
-- at all. More than a third. This is not an edge case, it is the shopkeeper's
-- most ordinary transaction.
--
-- So the column is the greatest of the two, and `greatest` ignores NULLs in
-- Postgres, which is exactly what is wanted: a client with movements but no
-- sales, or sales but no movements, still gets a real date.
--
-- The final fallback is `c.created_at`: a client registered and never touched
-- has no activity, and NULL would make the sort decide for itself where to
-- put them. Registering someone IS the last thing that happened to them.
--
-- ===========================================================================
-- `create or replace`, NOT `drop` + `create`
--
-- Postgres allows replacing a view when the change only ADDS columns at the
-- end, which is this case. That matters for three reasons, and the `118`
-- migration learned the third one the hard way:
--
--   1. `client_summary_all` is read by `get_shared_balance`, which is the
--      client's public page. A drop would need every dependent rebuilt in the
--      right order.
--   2. Nothing is dropped, so nothing that depends on these views breaks.
--   3. A drop takes the grants with it. The `044` migration wrote that down
--      after every one of the shopkeeper's screens answered "permission
--      denied". The grants are re-stated at the end anyway, because a
--      migration that only works when the grant survives is a migration that
--      works until it doesn't.
--
-- The column goes LAST for the reason `118` gives: some screens read these
-- views with `select *`, and a different order would change what each one
-- receives with nothing to warn anybody.

begin;

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
  -- THE NEW COLUMN, AT THE END. See the header for why it reads both tables.
  coalesce(
    greatest(last_movement.created_at, last_sale.created_at),
    c.created_at
  ) as last_movement_at
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
-- The two halves of "last activity". Separate laterals rather than one
-- `union all` subquery: each one can use its own table's index on
-- (client_id, created_at), and a reader can see at a glance which table
-- contributes what.
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
left join lateral public.get_oldest_unpaid_charge(c.id) oldest_unpaid on true;

grant select on public.client_summary_all to authenticated;

-- RE-EXPANDING THE `*`. This view's body is `select *`, which Postgres
-- expands into a fixed column list when the view is created. Replacing
-- `client_summary_all` above does NOT add the new column here on its own —
-- this statement is what does it, by re-running the same text against the
-- widened view. Leaving it out is the silent failure mode: the migration
-- succeeds, the column exists in one view and not the other, and the screen
-- that reads `client_summary` gets `undefined` with no error anywhere.
create or replace view public.client_summary
with (security_invoker = on) as
select * from public.client_summary_all
where trashed_at is null and deleted_at is null;

grant select on public.client_summary to authenticated;

insert into public.schema_migrations (key, description)
values (
  '130_ultima_actividad_del_cliente',
  'client_summary.last_movement_at: cuando paso algo por ultima vez con este cliente, para las dos entradas nuevas de «Ordenar por» que pidio el dueno el 2026-10-20 (mas reciente / mas antiguo). Es el mayor entre su ultimo movimiento vivo y su ultima venta viva, con el alta del cliente de respaldo. MIRA sales Y movements a proposito: una venta pagada entera no escribe nada en movements, y medido en dev eran 7 de 19 ventas vivas, asi que una columna hecha solo con movements dejaria al cliente que paga de contado cada semana al final de «mas reciente» para siempre. Va con create or replace y no con drop+create porque solo anade una columna al final: asi no se cae get_shared_balance ni se pierden los grants. Las dos vistas, porque client_summary es un select * y hay que reexpandirlo.'
)
on conflict (key) do nothing;

commit;
