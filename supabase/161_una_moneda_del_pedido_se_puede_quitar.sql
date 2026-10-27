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
-- LA POLÍTICA NO HAY QUE TOCARLA; EL GRANT SÍ, Y ESA ES LA SORPRESA.
-- `catalog_order_items_owner_all` es `for all`, así que cubre el `update`.
-- Los permisos, en cambio, NO son de tabla entera aquí: la `116` dio `select`
-- a secas sobre esta tabla, y quitar una moneda es un `update`. El porqué
-- entero, y lo que costó descubrirlo, está al final de este fichero.
--
-- (Esta línea decía lo contrario --«no hay que tocar grants»-- hasta el
-- 2026-10-27. Era lo que yo creía al empezar a escribir la migración, y el
-- navegador lo desmintió media hora después con un `42501`. Se corrige ahora
-- porque esto todavía no ha corrido en producción; una vez allí, la prosa de
-- una migración se queda como está.)
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

-- ═══════════════════════════════════════════════════════════════════════
-- Y EL PERMISO, QUE ES LA MITAD QUE SE OLVIDA
-- ═══════════════════════════════════════════════════════════════════════
--
-- La migración `116` existe por esto mismo: la `108` creó estas tablas, les
-- puso RLS y escribió la política correcta, y nunca otorgó nada a
-- `authenticated`. Lo que `116` dio sobre `catalog_order_items` fue `select`
-- a secas -- porque hasta hoy el tendero solo las LEÍA.
--
-- QUITAR UNA MONEDA ES UN `update`, así que sin esta línea la acción muere
-- con `42501: permission denied for table catalog_order_items`. Medido en dev
-- el 2026-10-26: el botón se dibujaba, el diálogo preguntaba, se confirmaba
-- y no pasaba nada. Ningún guion de `qa/` lo vio, porque todos corren con la
-- clave de servicio, que ni usa RLS ni necesita permisos. Lo cazó abrir la
-- pantalla en el navegador. Es la misma historia que la `116`, letra por
-- letra, y por eso está escrita aquí otra vez.
--
-- ───────────────────────────────────────────────────────────────────────
-- SOLO ESA COLUMNA, Y NO LA TABLA ENTERA
--
-- `grant update (deleted_at)` y no `grant update`. Las demás columnas son lo
-- que el CLIENTE acordó --cantidad, precio unitario, escalón-- y siguen sin
-- poder tocarse desde la sesión del tendero: esa es justo la razón por la que
-- `registrarVenta` las trata como selladas. Un permiso de tabla entera
-- abriría la puerta a cambiar el precio de lo que alguien ya pidió, que no es
-- lo que esta migración viene a permitir.
--
-- LA POLÍTICA YA ACOTA LAS FILAS: `catalog_order_items_owner_all` es `for
-- all` sobre las líneas de un pedido cuyo `owner_id` es el de la sesión. Sin
-- `with check` explícito, Postgres usa su `using` también para escribir, así
-- que un tendero no puede marcar la línea de otro negocio.
grant update (deleted_at) on public.catalog_order_items to authenticated;

insert into public.schema_migrations (key, description)
values (
  '161_una_moneda_del_pedido_se_puede_quitar',
  'catalog_order_items.deleted_at: el tendero puede quitar una moneda entera de un pedido antes de registrarlo, y restaurarla. Decision del dueno el 2026-10-26, con borrado suave y no `delete` porque esas filas las escribio su cliente al pedir. Incluye indice parcial sobre las lineas vivas Y el grant update(deleted_at) a authenticated, sin el cual la accion muere con 42501: la 116 solo habia dado select sobre esta tabla. Es la misma historia que la 116 y la cazo el navegador, no las suites, porque corren con la clave de servicio.'
)
on conflict (key) do nothing;
