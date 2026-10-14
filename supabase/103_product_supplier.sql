-- ENVIRONMENT: run in DEV ONLY for now — dev branch (vzqppwrwnmlbrxizskdh).
-- Production (rabmiyqodnvnrwiartuj) does not have the catalogue yet: it is
-- missing 083 to 090, so this file has nothing to attach to there. It goes to
-- production with the rest of the catalogue, in its order, the day that ships.
--
-- EL PROVEEDOR DE UN PRODUCTO. Frame 1192:4185, pedido por el dueno el
-- 2026-10-14: «Proveedor (opcional) — ¿Donde compraste en producto?».
--
-- ===========================================================================
-- TEXTO LIBRE, Y NO UNA ENTIDAD: DECISION DEL DUENO, EL MISMO DIA
--
-- La etapa 2 de INVENTARIO-PLAN.md contempla proveedores como tabla propia,
-- con encargos y reposicion -- es la herramienta central del Tendero 1, que ya
-- la mantiene a mano en su celular. Aun asi esto entra como una columna de
-- texto, por una razon concreta: una entidad hoy obliga a decidir la forma de
-- esa etapa ANTES de haberla investigado, y lo que se sabe de ella cabe en dos
-- entrevistas.
--
-- Lo que hace barata la conversion despues: los valores repetidos. Cuando la
-- etapa 2 llegue, los proveedores reales de cada negocio estaran escritos aqui
-- y agrupar por nombre da la lista inicial sin preguntarle nada a nadie.
--
-- ===========================================================================
-- SE GUARDA TAL COMO LO TECLEA, Y SE BUSCA SIN DISTINGUIR MAYUSCULAS
--
-- El dueno pidio que al teclear se vayan mostrando coincidencias, como el
-- buscador de clientes del formulario de movimiento. Eso obliga a separar dos
-- cosas que es tentador juntar:
--
--   - Lo que se GUARDA es literal. «Makro» y «makro» son lo que el tendero
--     escribio, y normalizarlo seria corregirle un dato suyo que a nadie le
--     hace dano.
--   - Lo que se BUSCA ignora la caja, porque si no, la sugerencia no aparece
--     justo cuando mas falta hace: al teclear la segunda vez el mismo nombre
--     con otra mayuscula.
--
-- Sin esa separacion el autocompletado no cumple su unico proposito, que es
-- que el segundo producto del mismo proveedor NO cree una variante nueva.
--
-- ===========================================================================
-- ESTE ARCHIVO ES SOLO UNA COLUMNA, Y LA PRIMERA VERSION NO LO ERA
--
-- Llevaba ademas una funcion `product_suppliers_for_owner()` que devolvia los
-- proveedores distintos del dueno para alimentar el autocompletado. Se quito
-- antes de correrla, al mirar como carga la pantalla: `/productos` ya trae
-- TODOS los productos de ese dueno, sin paginar y sin filtrar en el servidor
-- --el buscador filtra en el navegador-- asi que la lista de proveedores se
-- deriva de datos que la pagina ya tiene en memoria. La funcion habria sido
-- una consulta de mas y, peor, una funcion SECURITY DEFINER que nadie llama.
--
-- Se deja escrito porque es la misma trampa que la 092 documento para los
-- valores de enum: lo que existe y nadie usa, el siguiente lo encuentra
-- disponible y supone que algo lo produce. El `drop` de abajo no es defensivo
-- por costumbre -- cubre el caso real de que esta migracion se hubiera corrido
-- en su primera version.

begin;

drop function if exists public.product_suppliers_for_owner();

alter table public.products
  add column if not exists supplier text;

comment on column public.products.supplier is
  'Donde compro el tendero este producto. Texto libre a proposito (decision del dueno, 2026-10-14): la etapa 2 del plan contempla proveedores como entidad con encargos, y adelantarla aqui obligaria a disenarla sin haberla investigado. Los valores repetidos son lo que hara barata esa conversion. Se guarda literal; la busqueda del autocompletado es la que ignora la caja.';

-- SIN INDICE, Y ES UNA DECISION. Nadie consulta esta columna: el
-- autocompletado la deriva de los productos que la pantalla ya cargo. Un
-- indice costaria escritura en cada alta de producto a cambio de nada.

insert into public.schema_migrations (key, description)
values (
  '103_product_supplier',
  'Frame 1192:4185: el formulario de producto gana «Proveedor (opcional)». Texto libre y no entidad, por decision del dueno el 2026-10-14: la etapa 2 del plan contempla proveedores con encargos --es la herramienta central del Tendero 1-- pero adelantarla aqui obligaria a disenarla sin haberla investigado, y los valores repetidos de esta columna son justo lo que hara barata la conversion cuando llegue. Se guarda literal y la BUSQUEDA ignora la caja: sin esa separacion el autocompletado falla justo cuando sirve, que es al teclear el mismo proveedor por segunda vez con otra mayuscula, y entonces crea una variante en vez de evitarla. La primera version de este archivo traia ademas product_suppliers_for_owner(); se quito antes de correrla al ver que /productos ya carga todos los productos del dueno sin paginar, asi que las sugerencias salen de memoria y la funcion habria sido una SECURITY DEFINER que nadie llama -- la misma trampa que la 092 documento para los valores de enum. El drop sigue en el archivo por si llego a correrse esa primera version.'
)
on conflict (key) do nothing;

commit;
