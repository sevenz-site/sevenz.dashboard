-- ENVIRONMENT: run in DEV first (vzqppwrwnmlbrxizskdh). Production comes later, with its own
-- green light, and BEFORE the code (CLAUDE.md, deploy step 1): the new `registrarVenta`
-- writes this column, so without it every sale would be refused. The other order is safe:
-- today's code never names the column and keeps working against it.
-- Re-runnable: `add column if not exists`, and the check is dropped before it is added.
--
-- ===========================================================================
-- 194: A SALE REMEMBERS WHAT THE PRODUCT COST THAT DAY
--
-- Owner's decision of 2026-11-06: *«guardemos el costo al día de la venta, ajústalo también
-- en reportes»*.
--
-- THE BUG THIS CLOSES. A sale line kept its price and not its cost, so Reportes computed
-- (price of the line - cost of the product TODAY). Marta buys flour at $1, sells 100 at $2
-- and earns $100. On the 30th new stock arrives at $1.50 and she updates the cost: October
-- now says $50, and so does every earlier month, with no sale touched. Nothing errors.
--
-- WHAT IS STORED: the cost of ONE unit, ALREADY IN THE LINE'S CURRENCY, converted with the
-- rates of the sale. Not the raw cost and its currency: over half the lines measured in dev
-- on 2026-10-28 were sold in a currency other than their cost, so a raw cost would still be
-- converted with today's rate and the past would keep moving.
--
-- NULL DOES NOT MEAN «COST ZERO». It means nothing could be frozen: a line sold before this
-- migration, a product with no cost written, a cost in a free-text currency, or no rate to
-- convert with. `cuentasPorProducto` then falls back to the product's current cost, which
-- is exactly how every line behaved until today. No backfill, on purpose: nobody knows what
-- those products cost on those days, and writing today's cost in would present a guess as
-- a record.
--
-- NOT PUBLIC. `get_shared_balance` builds its JSON field by field and names no cost. A
-- function that starts exposing sale lines has to keep this column out: what a shop paid
-- for a product is not something its client should read.

begin;

alter table public.sale_lines
  add column if not exists unit_cost numeric(14, 4);

alter table public.sale_lines
  drop constraint if exists sale_lines_unit_cost_check;
alter table public.sale_lines
  add constraint sale_lines_unit_cost_check
  check (unit_cost is null or (unit_cost > 0 and unit_cost <= 1e11));

comment on column public.sale_lines.unit_cost is
  'Costo de una unidad el día de la venta, ya en la moneda de la línea. NULL = no se pudo congelar y Reportes usa el costo actual; nunca significa cero.';

insert into public.schema_migrations (key, description)
values (
  '194_sale_line_cost',
  'sale_lines.unit_cost: la venta guarda el costo del día, en la moneda de la línea, para que cambiar un costo no reescriba la ganancia pasada.'
)
on conflict (key) do nothing;

commit;

-- ── verification, after running the above ─────────────────────────────────
--   select column_name, data_type, is_nullable from information_schema.columns
--    where table_schema = 'public' and table_name = 'sale_lines' and column_name = 'unit_cost';
--   -- unit_cost, numeric, YES
--   select key from public.schema_migrations where key = '194_sale_line_cost';   -- one row
