-- ENVIRONMENT: run in DEV first (vzqppwrwnmlbrxizskdh). Production comes later, with its
-- own green light, and BEFORE the code that reads it (CLAUDE.md, deploy step 1).
-- Re-runnable: `if not exists` on the table, column and indexes, policies dropped and
-- recreated, grants set every time, `on conflict` on the ledger.
--
-- ===========================================================================
-- 219: BARCODES ON PRODUCTS, AND THE SWITCH THAT TURNS THEM ON (CT-182)
--
-- Owner's decisions of 2026-11-23, with the frames of «Propuesta · Escáner de códigos: el
-- flujo completo» approved that day («Aprobados»):
--   * scanning is OPTIONAL PER BUSINESS: a switch in Mi negocio, off by default. Off, the
--     app is exactly what it was before this file;
--   * a product can carry SEVERAL codes («Varios códigos»): the same product imported from
--     two countries, a special-edition can, a generic sold under two brands at one price,
--     the shopkeeper's own label and later the factory one;
--   * a code belongs to ONE product of a business: scanning it must answer one product.
--
-- WHAT THIS DISPLACES, on purpose. `083_products.sql` left codes out on 2026-10-09 («sin
-- SKU») because the two interviewed shopkeepers sell anything and keep no stock. That is
-- still true for whoever does not work with codes, which is why the switch exists and why
-- a code is never required.
--
-- A SEPARATE TABLE, NOT A COLUMN, because of «several». A single column turned into a
-- list later would mean rewriting every reader of it at once.
--
-- UNIQUE PER BUSINESS, TRASHED PRODUCTS INCLUDED. A code of a product in the bin still
-- answers that product, so the scanner can say «está en la papelera» and offer to restore
-- it instead of «código nuevo». Without that, the shopkeeper creates a duplicate, and
-- restoring the old one later would put the same code on two products.
--
-- CODES ARE STORED NORMALISED by the app (`lib/barcodes/normalize.ts`): digits and capital
-- letters only, and a 12-digit UPC-A stored as its 13-digit EAN form (a leading 0). A
-- phone camera may read the same package as either, and both must find one product. The
-- check below refuses anything else, so a code written by another door cannot slip past
-- the unique index in a different spelling.
--
-- THE OWNER READS AND WRITES THIS TABLE DIRECTLY, so it gets RLS AND the grants. Migration
-- 108 created a table with a correct policy and no grant, and every read died with 42501
-- while the service-role suite passed (CLAUDE.md, «A qa/ script runs as the service
-- role»). The customer never reads it: nothing public returns a code.
-- ===========================================================================

begin;

create table if not exists public.product_barcodes (
  id uuid primary key default gen_random_uuid(),
  -- Kept on the row, not only through the product, so the unique index below can be per
  -- business without a join, and every read can filter by owner explicitly.
  owner_id uuid not null references public.owners (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  code text not null check (code ~ '^[0-9A-Z]{4,48}$'),
  created_at timestamptz not null default now()
);

create unique index if not exists product_barcodes_owner_code_key
  on public.product_barcodes (owner_id, code);
create index if not exists product_barcodes_product_idx
  on public.product_barcodes (product_id);

alter table public.product_barcodes enable row level security;

-- THE PRODUCT MUST BE THE SAME OWNER'S, not only the row. Without the `exists`, an owner
-- could insert a row with his own owner_id pointing at another business's product id.
drop policy if exists "owners manage own product barcodes" on public.product_barcodes;
create policy "owners manage own product barcodes" on public.product_barcodes
  for all using (
    owner_id = auth.uid()
  ) with check (
    owner_id = auth.uid()
    and exists (select 1 from public.products p where p.id = product_id and p.owner_id = auth.uid())
  );

revoke all on public.product_barcodes from anon;
-- No `update`: the save rewrites a product's codes (delete, insert), like its photos.
grant select, insert, delete on public.product_barcodes to authenticated;
-- The qa/ suites use the service role. Production's service role has lacked grants
-- before (migration 213), so it is granted here explicitly rather than assumed.
grant select, insert, delete on public.product_barcodes to service_role;

comment on table public.product_barcodes is
  'Barcodes of a product (several per product, one product per code within a business; trashed products included). Normalised by lib/barcodes/normalize.ts. CT-182.';

-- ───────────────────────────────────────────────────────────────────────────
-- The switch in Mi negocio. Off by default: an existing business sees no change.
-- ───────────────────────────────────────────────────────────────────────────
alter table public.owners
  add column if not exists barcodes_enabled boolean not null default false;

comment on column public.owners.barcodes_enabled is
  'Mi negocio › «Trabajar con códigos de barras». Shows the scan button, the code field and the gun listener. The guard that keeps a gun burst out of money fields runs whatever this says. CT-182.';

insert into public.schema_migrations (key, description)
values (
  '219_product_barcodes',
  'Códigos de barras (CT-182): tabla product_barcodes (varios códigos por producto, cada código de un solo producto del negocio, también si está en la papelera; el dueño lee y escribe con RLS y permisos) y owners.barcodes_enabled, el interruptor de Mi negocio, apagado de entrada.'
)
on conflict (key) do nothing;

commit;
