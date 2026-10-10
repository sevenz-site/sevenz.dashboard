-- 087_product_cost_currency_and_currencies.sql
--
-- ENVIRONMENT: run first on the DEV branch (vzqppwrwnmlbrxizskdh). Do NOT run
-- against production (rabmiyqodnvnrwiartuj) until the user says to launch.
-- 083 a 087 viajan juntas: produccion no tiene ninguna.
--
-- ===========================================================================
-- 1. EL COSTO TIENE MONEDA PROPIA
--
-- Decision del dueno el 2026-10-10: el tendero ELIGE en que moneda escribio el
-- costo, con chips, incluido un chip «Otra».
--
-- Hace falta desde que puede quitar el dolar de un producto y dejar solo el
-- euro. Hasta ahora el costo estaba implicitamente en `base_currency`, y eso
-- deja de tener sentido en cuanto la moneda del producto puede ser cualquiera
-- o varias.
--
-- CONSECUENCIA DE «OTRA», dicha al dueno antes de construirlo: de una moneda
-- que no sea bolivar, dolar, euro o USDT no tenemos tasa. Sin tasa no hay
-- conversion, asi que con «Otra» el margen solo puede calcular el precio en
-- esa misma moneda y las demas se quedan sin numero. La pantalla lo dice.
--
-- ===========================================================================
-- 2. LAS MONEDAS ACTIVAS SON UNA LISTA QUE EL TENDERO MONTA
--
-- Decision del mismo dia: cada moneda del producto se agrega y se quita. USD
-- viene activa por defecto y NO es obligatoria — un producto puede tener solo
-- precio en euros.
--
-- VES NO ENTRA EN ESTA TABLA, Y ES A PROPOSITO. El bolivar es la moneda en la
-- que el cliente PAGA, no una en la que se fija precio: se ensena siempre al
-- final, calculado, y no se agrega ni se quita. Es coherente con haberle
-- quitado el candado esa misma manana (migracion 085) y con la razon de
-- fondo — un precio en bolivares es el unico que se vuelve falso solo cuando
-- se mueve la tasa.

begin;

alter table public.products
  add column if not exists cost_currency text,
  add column if not exists cost_currency_other text;

alter table public.products drop constraint if exists products_cost_currency_check;
alter table public.products add constraint products_cost_currency_check
  check (cost_currency is null or cost_currency in ('COP','USD','EUR','USDT','VES','OTHER'));

-- Si es OTHER hay que decir cual, y si no lo es no sobra una etiqueta suelta.
alter table public.products drop constraint if exists products_cost_currency_other_check;
alter table public.products add constraint products_cost_currency_other_check
  check (
    (cost_currency = 'OTHER' and btrim(coalesce(cost_currency_other, '')) <> '')
    or (cost_currency is distinct from 'OTHER' and cost_currency_other is null)
  );

-- EL RELLENO VA ANTES QUE SU RESTRICCION, y el primer intento de esta
-- migracion lo tenia al reves: `add constraint` evalua TODAS las filas que ya
-- existen, asi que exigir la moneda antes de rellenarla reventaba con 23514.
-- La transaccion lo dejo todo sin aplicar, que es para lo que esta.
update public.products
set cost_currency = base_currency
where cost is not null and cost_currency is null;

-- Y ahora si: un costo sin moneda no se puede interpretar.
alter table public.products drop constraint if exists products_cost_needs_currency;
alter table public.products add constraint products_cost_needs_currency
  check (cost is null or cost_currency is not null);

create table if not exists public.product_currencies (
  product_id uuid not null references public.products (id) on delete cascade,
  currency text not null check (currency in ('COP','USD','EUR','USDT')),
  primary key (product_id, currency)
);

alter table public.product_currencies enable row level security;

-- Via el producto, porque esta tabla no lleva `owner_id`. Mismo patron que
-- `product_price_overrides`.
drop policy if exists "owners manage own product currencies" on public.product_currencies;
create policy "owners manage own product currencies" on public.product_currencies
  for all using (
    exists (select 1 from public.products p where p.id = product_id and p.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.products p where p.id = product_id and p.owner_id = auth.uid())
  );

grant select, insert, delete on public.product_currencies to authenticated;

-- Sin `update`: una moneda se agrega o se quita, no se edita.

-- Lo que ya hay: su moneda base es la unica activa.
insert into public.product_currencies (product_id, currency)
select id, base_currency from public.products
where base_currency in ('COP','USD','EUR','USDT')
on conflict do nothing;

insert into public.schema_migrations (key, description)
values (
  '087_product_cost_currency_and_currencies',
  'Dos decisiones del dueno el 2026-10-10. (1) cost_currency: el tendero elige en que moneda esta el costo, con chips e incluyendo OTHER mas cost_currency_other para su nombre. Hace falta desde que puede quitar el dolar y dejar solo el euro -- antes el costo estaba implicitamente en base_currency. Consecuencia dicha: de una moneda OTHER no tenemos tasa, asi que el margen solo puede calcular el precio en esa misma moneda. Se exige el par cost/cost_currency, y ESA restriccion va DESPUES del relleno: ponerla antes rompio el primer intento con 23514, porque add constraint evalua las filas que ya existen y las que tenian costo aun no tenian moneda. (2) product_currencies: las monedas que el producto maneja, que el tendero agrega y quita. USD por defecto pero no obligatoria. VES NO entra en esta tabla a proposito: es la moneda en que el cliente paga, se ensena siempre calculada al final y no se agrega ni se quita -- decision del dueno del mismo dia, coherente con haberle quitado el candado por la manana. El traspaso deja activa la base_currency de cada producto existente.'
)
on conflict (key) do nothing;

commit;
