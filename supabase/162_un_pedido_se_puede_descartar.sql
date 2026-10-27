-- ═══════════════════════════════════════════════════════════════════════
-- DESCARTAR UN PEDIDO, Y DEVOLVERLO
-- ═══════════════════════════════════════════════════════════════════════
--
-- Asked for by the owner on 2026-10-26: *«dentro de la pantalla "Nuevo
-- pedido" en el header, agrega botón "More" con opción "Descartar"; al
-- seleccionarla elimina el pedido (debe mandar la notificación y ofrecer
-- restaurarlo)»*.
--
-- `status` ALREADY HAD `'discarded'` in its check, from `108`. Nothing in the
-- app ever wrote it, so this migration adds no constraint — only the two
-- dates the feature actually needs.
--
-- ───────────────────────────────────────────────────────────────────────
-- WHY TWO DATES AND NOT JUST THE STATUS
--
-- Because the NOTIFICATION hangs off them. Order notices are not stored in
-- any table: `getNotifications()` DERIVES them from `catalog_orders`, so a
-- notice needs a timestamp to be built from and sorted by. A boolean would
-- say the order is discarded and leave the red notice with no date, no place
-- in the list, and no way to tell "discarded a minute ago" from "discarded
-- last week".
--
-- And this repeats: discard, restore, discard again. Two columns keep the
-- last of each, which is exactly what the single notice per order shows.
--
-- `status` stays the one that decides whether the order counts as pending —
-- these two only record WHEN it happened.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.catalog_orders
  add column if not exists discarded_at timestamptz,
  add column if not exists restored_at timestamptz;

-- THE OWNER'S BELL READS THIS, and it reads only the discarded ones: a
-- partial index is the whole table today and a handful of rows tomorrow.
create index if not exists catalog_orders_descartados_idx
  on public.catalog_orders (owner_id, discarded_at desc)
  where discarded_at is not null;

-- NO GRANTS NEEDED, and that was CHECKED, not assumed: `116` granted
-- `select, update` on `catalog_orders` -- whole-table, so the two new columns
-- come in with it, and `update` is exactly what discard and restore do. What
-- `116` gave `catalog_order_items` was `select` ALONE, which is why `161` had
-- to add its own `grant update (deleted_at)` after dying with 42501 in the
-- browser. Same migration, two tables, two different answers: the reason this
-- comment exists is so the next one is looked up rather than guessed.
--
-- The policy `catalog_orders_owner_all` already scopes the rows.

insert into public.schema_migrations (key, description)
values (
  '162_un_pedido_se_puede_descartar',
  'catalog_orders.discarded_at y restored_at: el tendero puede descartar un pedido desde el menu de su pantalla y devolverlo. Decision del dueno el 2026-10-26. Dos fechas y no un estado porque puede repetirse, y porque las notificaciones de eliminado (roja) y restaurado (azul) cuelgan de ellas: sin fecha no hay de que colgarlas. El status sigue siendo quien dice si cuenta como pendiente.'
)
on conflict (key) do nothing;
