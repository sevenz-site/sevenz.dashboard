-- THE CLIENT'S DOCUMENT TYPE REACHES THE SCREENS THAT LIST CLIENTS.
--
-- Asked for by the owner on 2026-10-24: *«En todos los lugares donde se
-- maquete el documento del cliente debe incluir el prefijo, ejemplo
-- V-32.256.369»*.
--
-- ===========================================================================
-- WHY A MIGRATION FOR WHAT LOOKS LIKE A LABEL
--
-- `clients.document_type` has existed since migration `125`, and the screens
-- that read the TABLE could already show it. But the client cards, the
-- clients table and the search results do not read the table: they read
-- `client_summary`, and that view never selected the column. A view only
-- hands over what it names -- the same shape as the four `get_shared_balance`
-- migrations of 2026-10-23 and 24, where a field added on the owner's side
-- stayed invisible on the client's until a migration named it.
--
-- There is no error to notice either. The column simply arrives `undefined`,
-- the card renders the number with no prefix, and that reads as a document
-- without a letter rather than as a bug.
--
-- ===========================================================================
-- WHAT IT DOES NOT DO: INVENT A LETTER
--
-- Rows with `document_type` null keep showing the bare number. There will
-- always be some -- written before `125`, imported from a photographed
-- libreta, or carrying a type that did not match the business's country and
-- was discarded on save. Defaulting to 'V' would be worse than nothing: in
-- Venezuela V and J tell a person apart from a company, so guessing it
-- asserts something nobody typed about someone's identity.
--
-- ===========================================================================
-- RE-RUNNABLE, and the second statement is not optional
--
-- Both views are `create or replace`, so a second run replaces them with the
-- same definition. `client_summary` is `select * from client_summary_all`,
-- which Postgres froze into a fixed column list when it was created:
-- replacing only the first view does NOT widen this one, and leaving the
-- second statement out is the silent failure -- the migration succeeds, the
-- column exists in one view and not the other, and every card reads
-- undefined. Same note migrations `130`, `134` and `146` carry.

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
  by_ledger.eur_count as overdue_charge_count_eur,
  -- LAST, NOT NEXT TO `document_id`: `create or replace view` only accepts
  -- NEW columns at the end. Putting it in the middle fails with «cannot
  -- change name of view column», and the obvious fix -- `drop view ...
  -- cascade` -- would take the grants and every dependent view with it.
  -- Nothing reads these columns by position.
  c.document_type
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

-- RE-EXPANDING THE `*`: see the header.
create or replace view public.client_summary
with (security_invoker = on) as
select * from public.client_summary_all
where trashed_at is null and deleted_at is null;

grant select on public.client_summary to authenticated;

insert into public.schema_migrations (key, description)
values (
  '154_el_documento_lleva_su_prefijo',
  'client_summary y client_summary_all exponen clients.document_type, para que las tarjetas y la tabla de clientes puedan enseñar «V-32.256.369» en vez del número suelto.'
)
on conflict (key) do nothing;
