-- 116: THE OWNER COULD NOT READ A SINGLE ONE OF THEIR OWN ORDERS
--
-- Migration 108 created `catalog_orders` and `catalog_order_items`, turned RLS
-- on, and wrote the policy that scopes every row to `owner_id = auth.uid()`.
-- What it never wrote is the GRANT. A policy decides WHICH rows a role may
-- see; a grant decides whether that role may touch the table at all. Without
-- the second one the first one never gets consulted, and PostgREST answers
--
--     42501: permission denied for table catalog_orders
--
-- to every read the shopkeeper makes. 108 only `revoke`d from `anon` -- which
-- was right and is kept -- and nothing granted to `authenticated`.
--
-- HOW IT WAS FOUND, and it is the point: deliverable D's screens were opened
-- in a browser for the first time, against a dev owner holding three real
-- orders placed through the public `create_catalog_order`, and the Pedidos
-- screen said "todavía no te ha llegado ningún pedido". Nothing had errored
-- anywhere. `npm run qa:pedidos` was passing 14 of 14 at that exact moment,
-- because every one of its checks runs under the service-role key, which
-- bypasses RLS AND needs no grant -- so the one thing the suite could never
-- see is precisely the thing that was broken.
--
-- WHAT IT WOULD HAVE COST IN PLAIN WORDS: Doña Rosa shares her catalogue,
-- three customers order from it, each gets their "ya te lo mandamos" screen,
-- and the orders are sitting in the database with their names and phone
-- numbers. Her Pedidos screen tells her nobody has ordered anything. She has
-- no way to find out otherwise, and the customers are waiting.
--
-- The tables already exist in production (108 ran there on 2026-10-16), so
-- this file runs in BOTH environments. It is pure permissions: it creates
-- nothing, drops nothing and touches no row.

-- ===========================================================================
-- 1. THE GRANTS, AS NARROW AS THE SCREENS ACTUALLY NEED
-- ===========================================================================

-- `select` so the owner can list orders, count the unattended ones and open
-- one; `update` so "Marcar como atendido" can move `status` to 'seen'.
--
-- NO `insert`: an order is born only inside `create_catalog_order`, which is
-- `security definer` and therefore needs no grant of its own. A shopkeeper
-- writing an order straight into the table would be inventing a customer's
-- request, and nothing in the product asks for that.
--
-- NO `delete`: a received order is a record of something a real person asked
-- for. `status = 'discarded'` is how one is dismissed (108), and it keeps the
-- row -- which is what lets anyone ever answer "did that order arrive?".
grant select, update on public.catalog_orders to authenticated;

-- The lines are read-only for the owner. They are written once by the same
-- `security definer` function, and the detail screen only displays them.
grant select on public.catalog_order_items to authenticated;

-- ===========================================================================
-- 2. AND `anon` STAYS OUT, EXPLICITLY
-- ===========================================================================

-- 108 already revoked this. It is repeated here because this file is about
-- who may touch these two tables, and a reader checking that question should
-- find the whole answer in one place instead of concluding from silence.
-- Re-running a revoke that is already in effect does nothing.
revoke all on public.catalog_orders from anon;
revoke all on public.catalog_order_items from anon;

-- ===========================================================================
-- 3. THE LEDGER
-- ===========================================================================

insert into public.schema_migrations (key, description)
values (
  '116_el_dueno_puede_leer_sus_ordenes',
  'Permisos que a la 108 se le olvidaron: `grant select, update` de catalog_orders y `grant select` de catalog_order_items a authenticated. Sin ellos la politica de RLS no llegaba ni a consultarse y el dueno recibia 42501 en cada lectura: su pantalla de Pedidos decia que no habia llegado ninguno mientras las ordenes estaban guardadas con el nombre y el telefono de cada cliente. Se descubrio abriendo la pantalla en el navegador; la suite qa:pedidos pasaba 14 de 14 porque corre con la clave de servicio, que ni usa RLS ni necesita permisos. Corre en DEV y en PRODUCCION: no crea nada, no borra nada y no toca ninguna fila.'
)
on conflict (key) do nothing;
