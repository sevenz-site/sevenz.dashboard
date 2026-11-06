-- ENVIRONMENT: run in DEV first (vzqppwrwnmlbrxizskdh). Production comes later, with its own
-- green light, and BEFORE the code: the new `registrarVenta` writes this column, so without
-- it every sale would be refused. Today's code never names it and keeps working against it.
-- Re-runnable: `add column if not exists`.
--
-- ===========================================================================
-- 195: A SALE REMEMBERS WHO THE PRODUCT CAME FROM
--
-- Owner's request of 2026-11-06, the same class of error as migration 194. Reportes grouped
-- sales by the product's CURRENT supplier: move the flour from Makro to Éxito and everything
-- it ever sold moved with it, taking Makro's margin along, with no sale touched.
--
-- NULL MEANS «NOT KNOWN», not «no supplier»: a line sold before this migration, or a product
-- with no supplier written at the time. The report then uses the product's current supplier,
-- which is how every line behaved until today. So writing a supplier for a product that had
-- none gives its earlier sales to that supplier, and that is the gap being filled, not a
-- history being rewritten. No backfill: nobody knows who supplied those lines.
--
-- Free text, like `products.supplier`, and kept as the shopkeeper wrote it. The report groups
-- it with the same normalisation, so «Makro» and «MAKRO» stay one supplier across the years.

begin;

alter table public.sale_lines
  add column if not exists supplier text;

comment on column public.sale_lines.supplier is
  'Proveedor del producto el día de la venta, tal como estaba escrito. NULL = no se sabe y Reportes usa el proveedor actual.';

insert into public.schema_migrations (key, description)
values (
  '195_sale_line_supplier',
  'sale_lines.supplier: la venta guarda el proveedor del día, para que cambiar el proveedor de un producto no mude sus ventas pasadas.'
)
on conflict (key) do nothing;

commit;

-- ── verification, after running the above ─────────────────────────────────
--   select column_name, data_type, is_nullable from information_schema.columns
--    where table_schema = 'public' and table_name = 'sale_lines' and column_name = 'supplier';
--   -- supplier, text, YES
