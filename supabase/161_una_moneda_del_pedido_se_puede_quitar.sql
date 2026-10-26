-- ═══════════════════════════════════════════════════════════════════════
-- QUITAR UNA MONEDA DE UN PEDIDO, SIN PERDERLA
-- ═══════════════════════════════════════════════════════════════════════
--
-- Asked for by the owner on 2026-10-26, closing a question that had been open
-- since «Continuar» was removed: can a shopkeeper charge only part of a
-- mixed-currency order? His answer was no — *«ambos pedidos entran juntos en
-- la misma venta»* — and the way out is to DELETE the currency he is not
-- going to sell: *«agreguemos botón "Eliminar" en cada una de las cards de
-- los pedidos por moneda»*.
--
-- ───────────────────────────────────────────────────────────────────────
-- POR QUÉ UNA COLUMNA Y NO UN `delete`
--
-- También suyo, preguntado antes de escribir nada: *«que se pueda restaurar
-- (queda pequeña card donde estaba el pedido con el botón "Restaurar", mismo
-- patrón que cuando se elimina un registro en la verificación de la libreta
-- al importar libreta)»*.
--
-- Y la razón de fondo es que estas filas NO son del tendero: las escribió su
-- cliente al pedir. Borrarlas de verdad hace que el pedido afirme que nunca
-- pidió esos euros, y no deja rastro de que existieron. Con un toque por
-- error, lo que se pierde es la única prueba de lo que el cliente quiso.
--
-- ───────────────────────────────────────────────────────────────────────
-- LO QUE ESTA COLUMNA OBLIGA, Y ES LA PARTE PELIGROSA
--
-- NUEVE sitios leen `catalog_order_items`, y uno de ellos es el que escribe
-- la venta. Un lector que olvide `deleted_at is null` no enseña una fila de
-- más: COBRA lo que el tendero acaba de quitar, con el cliente delante.
--
-- Por eso la defensa no es acordarse: `npm run qa:lineas-borradas` recorre
-- `app/`, `lib/` y `components/` y falla si alguna consulta a esa tabla no
-- filtra. Misma forma que `qa:suscripciones`, y por el mismo motivo: una
-- regla que solo vive en un comentario se salta sola.
--
-- NO HAY QUE TOCAR GRANTS NI POLÍTICAS: los permisos de esta tabla son de
-- tabla entera, así que una columna nueva entra con ellos.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.catalog_order_items
  add column if not exists deleted_at timestamptz;

comment on column public.catalog_order_items.deleted_at is
  'Cuando el tendero quito esta linea del pedido desde el flujo de registrar. NULL = viva. Se guarda en vez de borrar porque la fila la escribio el CLIENTE al pedir: borrarla haria que el pedido afirmara que nunca pidio eso, y sin rastro. Toda lectura de esta tabla filtra por deleted_at is null -- lo vigila npm run qa:lineas-borradas.';

-- EL ÍNDICE ES PARCIAL, sobre las vivas. Todas las consultas del flujo piden
-- las líneas de UN pedido que no estén borradas, y las borradas son siempre
-- la minoría: un índice sobre las vivas es más pequeño y es el que se usa.
create index if not exists catalog_order_items_vivas_idx
  on public.catalog_order_items (order_id)
  where deleted_at is null;

insert into public.schema_migrations (key, description)
values (
  '161_una_moneda_del_pedido_se_puede_quitar',
  'catalog_order_items.deleted_at: el tendero puede quitar una moneda entera de un pedido antes de registrarlo, y restaurarla. Decision del dueno el 2026-10-26, con borrado suave y no `delete` porque esas filas las escribio su cliente al pedir. Incluye indice parcial sobre las lineas vivas.'
)
on conflict (key) do nothing;
