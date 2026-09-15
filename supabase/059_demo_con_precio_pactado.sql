-- 059_demo_con_precio_pactado.sql
--
-- ENTORNO: correr en LOS DOS — primero la rama dev (vzqppwrwnmlbrxizskdh) y
-- después producción (rabmiyqodnvnrwiartuj).
--
-- POR QUÉ. Al dar una demo se acuerda todo en la misma conversación: cuántos
-- días de prueba, cuánto va a pagar después y cada cuánto. La primera versión
-- solo guardaba los días, así que el precio negociado se perdía hasta que
-- alguien se acordara de abrir "Cambiar plan" semanas más tarde — justo cuando
-- ya nadie recuerda qué se acordó.
--
-- CUÁNDO EMPIEZA EL COBRO NO ES UNA COLUMNA NUEVA. Es el día siguiente al fin
-- de la demo, que ya está en demo_termina_el. Añadir una segunda fecha
-- permitiría que las dos se contradigan —una demo que termina el 15 con un
-- cobro que empieza el 3— y eso es una pregunta que nadie ha hecho todavía.
-- Si algún día hace falta un periodo de gracia entre una cosa y otra, esa
-- columna se añade entonces y con su motivo escrito.
--
-- HAY QUE BORRAR LA FIRMA VIEJA. Postgres sobrecarga por tipos de argumento,
-- así que un `create or replace` con parámetros nuevos deja las DOS versiones
-- instaladas, y PostgREST llamaría a la que resolviera primero. Es la misma
-- maniobra de la 046 y la 053: drop y create, no replace.

begin;

drop function if exists public.admin_dar_demo(uuid, int, text, text);

create or replace function public.admin_dar_demo(
  p_owner uuid,
  p_dias int,
  p_actor_email text,
  p_notas text default null,
  -- Lo que pagará cuando termine la prueba. Null = todavía no se habló de
  -- precio, que es un caso legítimo y distinto de "gratis".
  p_precio_usd numeric default null,
  p_periodicidad text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_antes public.subscriptions;
  v_fin timestamptz;
begin
  if p_dias is null or p_dias < 1 or p_dias > 365 then
    raise exception 'La demo tiene que durar entre 1 y 365 días' using errcode = '22023';
  end if;

  if p_periodicidad is not null
     and p_periodicidad not in ('mensual', 'trimestral', 'anual') then
    raise exception 'Periodicidad no válida: %', p_periodicidad using errcode = '22023';
  end if;

  if p_precio_usd is not null and p_precio_usd < 0 then
    raise exception 'El precio no puede ser negativo' using errcode = '22023';
  end if;

  v_antes := public.admin_asegura_suscripcion(p_owner);

  -- Al FINAL del día en Caracas. Una demo dada a las 11 de la noche no puede
  -- durar 29 días y una hora.
  v_fin := (((now() at time zone 'America/Caracas')::date + p_dias)::timestamp
            + interval '23 hours 59 minutes 59 seconds')
           at time zone 'America/Caracas';

  update public.subscriptions set
    estado = 'demo',
    demo_termina_el = v_fin,
    periodo_termina_el = null,
    -- coalesce y no asignación directa: pasar null aquí significa "no lo
    -- hablamos", no "bórrale el precio que ya tenía acordado".
    periodicidad = coalesce(p_periodicidad, periodicidad),
    precio_pactado_usd = coalesce(p_precio_usd, precio_pactado_usd),
    notas = coalesce(p_notas, notas),
    updated_at = now()
  where owner_id = p_owner;

  insert into public.subscription_events
    (owner_id, actor_email, desde_estado, hasta_estado, desde_plan, hasta_plan, motivo, monto_usd)
  values
    (p_owner, p_actor_email, v_antes.estado, 'demo', v_antes.plan_code, v_antes.plan_code,
     coalesce(p_notas, 'Demo de ' || p_dias || ' días'),
     p_precio_usd);

  return jsonb_build_object(
    'ok', true,
    'demo_termina_el', v_fin,
    -- El día siguiente al fin de la demo. Se devuelve calculado para que la
    -- pantalla no lo recalcule por su cuenta y las dos puedan discrepar.
    'cobro_empieza_el', (v_fin + interval '1 second')
  );
end;
$$;

revoke execute on function public.admin_dar_demo(uuid, int, text, text, numeric, text)
  from public, anon, authenticated;
grant execute on function public.admin_dar_demo(uuid, int, text, text, numeric, text)
  to service_role;

insert into public.schema_migrations (key, description)
values (
  '059_demo_con_precio_pactado',
  'admin_dar_demo also records the agreed price and billing period, because both are settled in the same conversation as the trial length and were otherwise lost until someone remembered to open "Cambiar plan" weeks later. Billing start is NOT a new column: it is the day after demo_termina_el, and a second date could contradict the first. Old signature dropped rather than replaced — Postgres overloads on argument types and both versions would have stayed installed.'
)
on conflict (key) do nothing;

commit;

-- ── verificación ────────────────────────────────────────────────────────
--
-- 1. Solo queda UNA versión de la función:
--
--   select count(*) from pg_proc where proname = 'admin_dar_demo';
--   -- ESPERADO: 1
--
-- 2. Guarda el precio y devuelve cuándo empieza el cobro:
--
--   begin;
--   select public.admin_dar_demo(
--     (select id from public.owners order by created_at limit 1),
--     30, 'prueba@sevenz', 'con precio', 25, 'mensual');
--   select estado, precio_pactado_usd, periodicidad, demo_termina_el
--   from public.subscriptions
--   where owner_id = (select id from public.owners order by created_at limit 1);
--   rollback;
--   -- ESPERADO: demo, 25, mensual, y la fecha a 30 días a las 23:59 de Caracas.
