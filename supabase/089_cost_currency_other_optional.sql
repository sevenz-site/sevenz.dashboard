-- 089_cost_currency_other_optional.sql
--
-- ENVIRONMENT: run first on the DEV branch (vzqppwrwnmlbrxizskdh). Do NOT run
-- against production (rabmiyqodnvnrwiartuj) until the user says to launch.
-- 083 a 089 viajan juntas: produccion no tiene ninguna.
--
-- ===========================================================================
-- «OTRO» YA NO PREGUNTA CUAL
--
-- Decision del dueno el 2026-10-10: cuando elige «Otro» como moneda del costo,
-- se queda en «Otro» y la ficha no le pide el nombre.
--
-- La 087 lo exigia con un check, y esa exigencia pasa a ser IMPOSIBLE DE
-- CUMPLIR desde la pantalla: el formulario ya no tiene donde escribirlo, asi
-- que cualquier guardado con «Otro» reventaria con 23514.
--
-- Lo unico que sigue sin tener sentido es una etiqueta colgando de una moneda
-- que SI conocemos, y eso es lo que el check nuevo impide.
--
-- La columna se queda. No porque «quiza algun dia»: se queda porque borrarla
-- es destruir lo que algun tendero ya escribio, y lo que cuesta mantenerla es
-- cero mientras nada la escriba. Lo que se limpia es lo que quedo de
-- preguntarlo — en dev, un «Gjrj» tecleado al probar la pantalla.

begin;

alter table public.products drop constraint if exists products_cost_currency_other_check;

alter table public.products add constraint products_cost_currency_other_check
  check (cost_currency_other is null or cost_currency = 'OTHER');

update public.products
set cost_currency_other = null
where cost_currency_other is not null;

insert into public.schema_migrations (key, description)
values (
  '089_cost_currency_other_optional',
  'Decision del dueno el 2026-10-10: cuando elige "Otro" como moneda del costo, la ficha ya no le pregunta cual es. La 087 exigia el nombre con un check y esa exigencia pasaria a ser imposible de cumplir desde la pantalla -- el formulario ya no tiene donde escribirlo, asi que cualquier guardado con Otro reventaria con 23514. El check nuevo solo impide lo que sigue sin tener sentido: una etiqueta colgando de una moneda que SI conocemos. Se limpia lo que quedo de preguntarlo, en dev un "Gjrj" tecleado al probar. La columna se queda porque borrarla destruiria lo que algun tendero ya escribio y mantenerla no cuesta nada mientras nada la escriba.'
)
on conflict (key) do nothing;

commit;
