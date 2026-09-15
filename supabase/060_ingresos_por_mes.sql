-- 060_ingresos_por_mes.sql
--
-- ENTORNO: correr en LOS DOS — primero la rama dev (vzqppwrwnmlbrxizskdh) y
-- después producción (rabmiyqodnvnrwiartuj).
--
-- Lo que se ha cobrado cada mes, para la gráfica de /admin → Cuentas.
--
-- SALE DE subscription_events Y NO DE subscriptions, y la diferencia importa:
-- `subscriptions` dice lo que un negocio paga HOY, así que subir un precio
-- reescribiría el pasado. Los asientos son inmutables — cada uno guarda lo que
-- se cobró el día que se cobró — y por eso son la única fuente honesta para
-- una serie histórica.
--
-- ⚠ ESTA GRÁFICA VA A EMPEZAR CASI VACÍA, y conviene saberlo antes de mirarla.
-- El historial nació el 2026-09-15 con la 057, y sus 24 primeros asientos son
-- la propia migración, sin monto. Solo cuentan los pagos que se registren de
-- aquí en adelante. Los meses sin cobros salen en cero en vez de faltar, para
-- que la línea no invente una subida donde solo hubo un hueco.
--
-- SE AGRUPA EN HORA DE CARACAS. Un pago registrado a las 9 de la noche del 30
-- pertenece a ese mes, no al siguiente: en UTC ya sería día 1.

begin;

create or replace function public.admin_ingresos_por_mes(p_meses int default 12)
returns setof jsonb
language sql
security definer
set search_path = public
as $$
  with meses as (
    select generate_series(
      date_trunc('month', (now() at time zone 'America/Caracas')::date - make_interval(months => greatest(p_meses, 1) - 1)),
      date_trunc('month', (now() at time zone 'America/Caracas')::date),
      interval '1 month'
    )::date as mes
  ),
  cobros as (
    select
      date_trunc('month', (e.ocurrido_el at time zone 'America/Caracas'))::date as mes,
      sum(e.monto_usd) as total,
      count(*) as pagos
    from public.subscription_events e
    where e.monto_usd is not null
      and e.metodo_pago is not null   -- un cambio de plan anota el precio, no un cobro
    group by 1
  )
  select jsonb_build_object(
    'mes', to_char(m.mes, 'YYYY-MM'),
    'total_usd', coalesce(c.total, 0),
    'pagos', coalesce(c.pagos, 0)
  )
  from meses m
  left join cobros c on c.mes = m.mes
  order by m.mes;
$$;

revoke execute on function public.admin_ingresos_por_mes(int) from public, anon, authenticated;
grant execute on function public.admin_ingresos_por_mes(int) to service_role;

insert into public.schema_migrations (key, description)
values (
  '060_ingresos_por_mes',
  'Monthly revenue for the Cuentas chart, read from subscription_events rather than subscriptions: the events are immutable, so raising a price never rewrites the past. Only rows with both monto_usd and metodo_pago count — a plan change records the agreed price but is not a payment. Months with no payments come back as zero rather than missing, so the line cannot invent a rise where there was only a gap. Grouped in America/Caracas.'
)
on conflict (key) do nothing;

commit;

-- ── verificación ────────────────────────────────────────────────────────
--
--   select * from public.admin_ingresos_por_mes(6);
--
-- ESPERADO: seis filas, una por mes, la más antigua primero. Casi todas en
-- cero hoy — el historial acaba de nacer. La del mes actual debería llevar lo
-- que hayas registrado probando.
