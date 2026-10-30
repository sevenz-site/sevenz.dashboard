-- ENVIRONMENT: run in DEV first (vzqppwrwnmlbrxizskdh). Production comes later,
-- with its own green light. Re-runnable: every object is dropped first.
--
-- ===========================================================================
-- 166: EL ASISTENTE DEJA DE LEER Y ESCRIBIR SU TABLA DE FRENTE
--
-- La migración `165` le concedió a `service_role` `select, insert, update`
-- sobre `report_assistant_notes`, porque la ruta escribe la nota con ese
-- cliente y la tarjeta de /admin la lee con él.
--
-- `npm run qa:service-role` lo rechazó, y tiene razón. Lo que dice su mensaje
-- es exactamente lo que hay que hacer:
--
--     «Esto funciona en dev y NO puede funcionar en producción, que le revoca
--      SELECT a service_role sobre las tablas de clientes. Muévelo detrás de
--      una función SECURITY DEFINER.»
--
-- ---------------------------------------------------------------------------
-- POR QUÉ SE SIGUE ESE CONSEJO EN VEZ DE DEFENDER EL GRANT
--
-- El grant de la `165` habría funcionado: es explícito y se ejecuta en los dos
-- entornos. Pero ata el código a que esa migración haya corrido ALLÍ, y ese
-- orden es precisamente el que ya se rompió una vez -- el 2026-09-05 `/admin`
-- devolvió un 500 en producción por leer tablas con el cliente de servicio,
-- que funciona en dev y no allí. La migración `039` es la respuesta de
-- entonces y este archivo repite su forma.
--
-- UNA FUNCIÓN `security definer` NO NECESITA NINGÚN PERMISO DE TABLA. Corre
-- con los del dueño de la función, así que da igual lo que producción le
-- revoque a `service_role`: no hay nada que comparar entre entornos, que es
-- una clase entera de fallo que deja de existir.
--
-- Y POR ESO SE REVOCA EL GRANT DE LA `165`: dejar un permiso que ya no usa
-- nadie es dejarle al siguiente la duda de para qué estaba.
--
-- ---------------------------------------------------------------------------
-- LO QUE NO CAMBIA, Y ES LA MITAD DEL DISEÑO
--
-- El tendero sigue leyendo SU nota con SU sesión, por RLS, con el `grant
-- select, update` que la `165` le dio a `authenticated`. Eso no pasa por aquí
-- y no debe: la política `owner_id = auth.uid()` es lo que impide que una
-- sesión vea la nota de otro negocio, y moverla detrás de una función la
-- dejaría sin ese filtro.
-- ===========================================================================

-- ===========================================================================
-- 1. ESCRIBIR LA NOTA DEL DÍA
--
-- La escribe el SERVIDOR y no el tendero, y esa es la razón de que exista:
-- si la sesión del dueño pudiera escribir aquí, cualquiera podría inventarse
-- el resumen de su propio negocio. Por eso `authenticated` solo tiene `update`
-- --para el pulgar-- y nunca `insert`.
--
-- `upsert` Y NO `insert`: una nota degradada se reemplaza cuando un reintento
-- del mismo día sale bien, que es lo que los tres intentos permiten. Y
-- `rating` vuelve a nulo en cada regeneración, porque el pulgar valía para el
-- texto anterior -- decisión del dueño el 2026-10-30.
-- ===========================================================================
drop function if exists public.upsert_report_assistant_note(uuid, date, text, text[], boolean, text, text);

create function public.upsert_report_assistant_note(
  p_owner_id uuid,
  p_day date,
  p_summary text,
  p_recommendations text[],
  p_degraded boolean,
  p_model text,
  p_failure_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.report_assistant_notes
    (owner_id, day, summary, recommendations, degraded, model, failure_reason, rating)
  values
    (p_owner_id, p_day, p_summary, coalesce(p_recommendations, '{}'), p_degraded, p_model, p_failure_reason, null)
  on conflict (owner_id, day) do update set
    summary = excluded.summary,
    recommendations = excluded.recommendations,
    degraded = excluded.degraded,
    model = excluded.model,
    failure_reason = excluded.failure_reason,
    rating = null,
    created_at = now();
end;
$$;

revoke execute on function public.upsert_report_assistant_note(uuid, date, text, text[], boolean, text, text) from public, anon, authenticated;
grant execute on function public.upsert_report_assistant_note(uuid, date, text, text[], boolean, text, text) to service_role;

comment on function public.upsert_report_assistant_note(uuid, date, text, text[], boolean, text, text) is
  'Escribe la nota diaria del asistente de Reportes. SECURITY DEFINER y solo para service_role: la escribe el servidor, no la sesión del tendero, porque si no cualquiera podría inventarse el resumen de su propio negocio. Existe para que el código no dependa de un grant de tabla que producción revoca --el fallo de /admin del 2026-09-05--. Borra la calificación en cada regeneración: el pulgar valía para el texto anterior.';

-- ===========================================================================
-- 2. LAS CAÍDAS, PARA LA TARJETA DE /admin
--
-- Agrega en SQL en vez de devolver filas, por dos razones y la segunda es la
-- que importa: son menos datos por el cable, y **ninguna fila de ningún
-- negocio sale de la base**. Esta función cruza todos los dueños por
-- definición, así que devolver filas sería sacar el resumen de cada negocio
-- para contarlos fuera.
--
-- SIETE DÍAS POR DEFECTO, pero el parámetro existe para que la pantalla pueda
-- cambiarlo sin una migración.
-- ===========================================================================
drop function if exists public.admin_report_assistant_health(int);

create function public.admin_report_assistant_health(p_days int default 7)
returns json
language sql
security definer
set search_path = public
as $$
  with ventana as (
    select degraded, failure_reason
    from public.report_assistant_notes
    where day >= (current_date - (greatest(p_days, 1) - 1))
  ),
  motivos as (
    select coalesce(failure_reason, 'sin motivo') as reason, count(*) as times
    from ventana where degraded
    group by 1
    order by count(*) desc
  )
  select json_build_object(
    'total', (select count(*) from ventana),
    'failures', (select count(*) from ventana where degraded),
    'by_reason', coalesce((select json_agg(json_build_object('reason', reason, 'times', times)) from motivos), '[]'::json)
  );
$$;

revoke execute on function public.admin_report_assistant_health(int) from public, anon, authenticated;
grant execute on function public.admin_report_assistant_health(int) to service_role;

comment on function public.admin_report_assistant_health(int) is
  'Cuántos resúmenes del asistente se degradaron en los últimos N días y por qué motivo, para la tarjeta de caídas de /admin. SECURITY DEFINER y solo service_role, detrás del guardia de /admin. Agrega en SQL a propósito: cruza a TODOS los negocios, así que devolver filas sería sacar el resumen de cada uno para contarlos fuera.';

-- ===========================================================================
-- 3. Y SE RETIRA EL GRANT QUE LA 165 LE DIO A service_role
--
-- Ya no lee ni escribe esa tabla de frente. Un permiso que no usa nadie no es
-- inofensivo: es una pregunta sin respuesta para quien lo encuentre, y la
-- única superficie que `qa:service-role` no puede vigilar.
--
-- `authenticated` CONSERVA EL SUYO --select y update-- y es deliberado: es por
-- donde el tendero lee su nota y le pone el pulgar, con la política de RLS
-- filtrando por `owner_id = auth.uid()`.
-- ===========================================================================
revoke select, insert, update on public.report_assistant_notes from service_role;

insert into public.schema_migrations (key, description)
values (
  '166_el_asistente_no_toca_la_tabla_de_frente',
  'El asistente deja de leer y escribir report_assistant_notes con el cliente de servicio: ahora pasa por dos funciones SECURITY DEFINER --upsert_report_assistant_note y admin_report_assistant_health-- que no necesitan ningún permiso de tabla. Lo pidió qa:service-role, y evita atar el código a un grant que producción revoca, que es el fallo que tumbó /admin el 2026-09-05. Se retira el grant que la 165 le había dado a service_role; el de authenticated se queda, que es por donde el tendero lee su nota y la califica.'
)
on conflict (key) do nothing;
