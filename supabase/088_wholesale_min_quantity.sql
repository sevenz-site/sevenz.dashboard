-- 088_wholesale_min_quantity.sql
--
-- ENVIRONMENT: run first on the DEV branch (vzqppwrwnmlbrxizskdh). Do NOT run
-- against production (rabmiyqodnvnrwiartuj) until the user says to launch.
-- 083 a 088 viajan juntas: produccion no tiene ninguna.
--
-- ===========================================================================
-- «PRECIO AL MAYOR A PARTIR DE CANTIDAD»
--
-- Del frame 1192:4185. Es la cantidad minima a partir de la cual aplica el
-- precio de mayor, y no es un invento de pantalla: el Tendero 1 lo describio
-- en campo el 2026-10-09 comprando «por docena o media docena». Hasta ahora el
-- precio de mayor existia sin decir desde cuantas unidades empieza, que es la
-- mitad que falta para poder usarlo en una venta.
--
-- Nullable a proposito: un producto puede tener precio de mayor sin minimo
-- declarado, que es como estan todos los que existen hoy.
--
-- El check exige `> 0` y no `>= 0` porque un minimo de cero significa «no hay
-- minimo», y eso ya lo dice el null. Dos formas de decir lo mismo es como se
-- acaban leyendo distinto en dos sitios.

begin;

alter table public.products
  add column if not exists wholesale_min_quantity numeric(14, 3);

alter table public.products drop constraint if exists products_wholesale_min_qty_positive;
alter table public.products add constraint products_wholesale_min_qty_positive
  check (wholesale_min_quantity is null or wholesale_min_quantity > 0);

insert into public.schema_migrations (key, description)
values (
  '088_wholesale_min_quantity',
  'Frame 1192:4185: la seccion de mayor gana el campo "Precio al mayor a partir de cantidad". Es la cantidad minima a partir de la cual aplica el precio de mayor -- lo que el Tendero 1 describio en campo como comprar por docena o media docena. Nullable: un producto puede tener precio de mayor sin minimo declarado, que es como estan todos los que existen hoy. El check exige > 0 y no >= 0 porque un minimo de cero significa que no hay minimo, y eso ya lo dice el null; dos formas de decir lo mismo es como se acaban leyendo distinto en dos sitios.'
)
on conflict (key) do nothing;

commit;
