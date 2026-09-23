-- 067_whatsapp_send_puerta.sql
--
-- ENVIRONMENT: run first on the DEV branch (vzqppwrwnmlbrxizskdh). Do NOT run
-- against production (rabmiyqodnvnrwiartuj) until the code that uses it is
-- ready to deploy and the user has said to launch.
--
-- La puerta por la que sale todo mensaje de WhatsApp. Dos funciones: una
-- reserva el turno antes de llamar a Kapso, la otra anota cómo fue.
--
-- ─────────────────────────────────────────────────────────────────────────
-- POR QUÉ FUNCIONES Y NO LEER LA TABLA CON LA CLAVE DE SERVICIO
--
-- `whatsapp_sends` tiene RLS encendida, cero políticas y ningún grant. Leerla
-- directamente con `createServiceClient()` funcionaría en dev y **no puede
-- funcionar en producción**, donde los privilegios sobre las tablas de
-- clientes están revocados a `service_role` a propósito. Es exactamente la
-- caída del 2026-09-05 en /admin, y por eso existe `npm run qa:service-role`.
--
-- Una función SECURITY DEFINER corre como su dueño y no necesita ningún grant
-- sobre la tabla. Mismo arreglo que `039_admin_reads_without_table_grants`.
--
-- ─────────────────────────────────────────────────────────────────────────
-- LOS TOPES VIVEN AQUÍ, NO EN TYPESCRIPT
--
-- Porque una comprobación en el servidor de Next es código, y el código se
-- puede esquivar escribiendo un segundo llamador que no la haga. Esta función
-- es la puerta: si el tope está dentro, no hay camino que lo rodee.
--
--   Kapso Free: 2.000 mensajes/mes  → se opera con 1.600 (80%)
--   Meta sin verificar: 250 destinatarios únicos/24 h → 200 (80%)
--
-- El 20% restante no es prudencia decorativa: es el margen para reintentos,
-- pruebas, y para lo que Kapso cuente distinto de lo que contamos nosotros.
--
-- ─────────────────────────────────────────────────────────────────────────
-- EL ÍNDICE PASA A SER PARCIAL, Y ESO CAMBIA ALGO IMPORTANTE
--
-- La 065 lo creó único a secas: una fila por (dueño, plantilla, periodo) pasara
-- lo que pasara. Eso frena al cron disparado en bucle —que es su trabajo— pero
-- tiene un efecto que no vi entonces: **si Kapso falla treinta segundos un
-- lunes a las 8, los dieciocho dueños pierden el resumen de esa semana para
-- siempre**, porque el turno quedó ocupado por un envío que nunca salió.
--
-- Ahora el índice ignora las filas marcadas como fallidas. Un fallo queda
-- registrado para poder diagnosticarlo, y a la vez libera el turno para el
-- siguiente intento. El freno sigue intacto: una fila recién insertada tiene
-- `ok` nulo, y eso sí bloquea duplicados.
--
-- Y una fila que se quedó en nulo para siempre —el servidor se cayó entre
-- reservar y llamar— caducaría el turno del dueño sin remedio. Por eso
-- `whatsapp_send_begin` limpia las reservas sin respuesta de más de 15 minutos
-- antes de intentar la suya.

begin;

drop index if exists public.whatsapp_sends_idempotency_idx;

create unique index if not exists whatsapp_sends_idempotency_idx
  on public.whatsapp_sends (owner_id, template, period_key)
  where ok is not false;

-- ── reservar el turno ────────────────────────────────────────────────────
--
-- Se llama ANTES de Kapso, nunca después. Si esto devuelve un id, el mensaje
-- se manda; si devuelve un motivo, no se manda y no se reintenta solo.
create or replace function public.whatsapp_send_begin(
  p_owner_id uuid,
  p_template text,
  p_period_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tope_mensual constant int := 1600;
  v_alarma_mensual constant int := 1400;
  v_tope_diario_destinatarios constant int := 200;
  v_mes int;
  v_destinatarios_hoy int;
  v_id uuid;
begin
  -- Reservas que nunca reportaron. Sin esto, un servidor caído a mitad de
  -- envío deja al dueño sin su mensaje de esa semana y sin forma de saberlo.
  delete from public.whatsapp_sends
  where owner_id = p_owner_id
    and template = p_template
    and period_key = p_period_key
    and ok is null
    and sent_at < now() - interval '15 minutes';

  -- El mes natural, que es como cuenta Kapso.
  select count(*) into v_mes
  from public.whatsapp_sends
  where sent_at >= date_trunc('month', now())
    and ok is not false;

  if v_mes >= v_tope_mensual then
    return jsonb_build_object('skip', 'tope_mensual', 'enviados_mes', v_mes);
  end if;

  -- Destinatarios ÚNICOS en 24 h, que es como lo mide Meta: dos mensajes a la
  -- misma persona cuentan uno.
  --
  -- OJO PARA LA FASE 3: aquí el destinatario es el dueño. Cuando se escriba a
  -- clientes, el destinatario será otro y esta cuenta se quedará corta — hará
  -- falta registrar a quién se le escribió, no solo de quién es la cuenta.
  select count(distinct owner_id) into v_destinatarios_hoy
  from public.whatsapp_sends
  where sent_at >= now() - interval '24 hours'
    and ok is not false;

  if v_destinatarios_hoy >= v_tope_diario_destinatarios
     and not exists (
       select 1 from public.whatsapp_sends
       where owner_id = p_owner_id and sent_at >= now() - interval '24 hours' and ok is not false
     )
  then
    return jsonb_build_object('skip', 'tope_diario', 'destinatarios_hoy', v_destinatarios_hoy);
  end if;

  insert into public.whatsapp_sends (owner_id, template, period_key)
  values (p_owner_id, p_template, p_period_key)
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('skip', 'ya_enviado');
  end if;

  return jsonb_build_object(
    'id', v_id,
    -- Para que el llamador avise cuando el mes se está agotando. Una parada
    -- silenciosa es peor que pasarse: los mensajes dejan de salir y nadie se
    -- entera durante tres semanas.
    'alarma', v_mes + 1 >= v_alarma_mensual,
    'enviados_mes', v_mes + 1
  );
end;
$$;

-- ── anotar cómo fue ──────────────────────────────────────────────────────
create or replace function public.whatsapp_send_finish(
  p_id uuid,
  p_ok boolean,
  p_provider_message_id text default null,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.whatsapp_sends
  set ok = p_ok,
      provider_message_id = p_provider_message_id,
      -- El texto crudo del proveedor se guarda AQUÍ y solo aquí. Nunca sale a
      -- una respuesta HTTP: es la regla de enmascarar errores de CLAUDE.md.
      error = p_error
  where id = p_id;
end;
$$;

-- EXECUTE va a PUBLIC por defecto, así que el revoke tiene que ir antes o el
-- grant de abajo es decoración. Ver CLAUDE.md.
revoke all on function public.whatsapp_send_begin(uuid, text, text) from public;
revoke all on function public.whatsapp_send_finish(uuid, boolean, text, text) from public;

-- Solo `service_role`. Ni `anon` ni `authenticated`: un dueño no manda
-- mensajes, los manda el cron. Que la función exista no es una puerta si
-- nadie con sesión puede llamarla.
grant execute on function public.whatsapp_send_begin(uuid, text, text) to service_role;
grant execute on function public.whatsapp_send_finish(uuid, boolean, text, text) to service_role;

insert into public.schema_migrations (key, description)
values (
  '067_whatsapp_send_puerta',
  'whatsapp_send_begin y whatsapp_send_finish, la unica puerta por la que sale un mensaje de WhatsApp. SECURITY DEFINER y granted solo a service_role, porque whatsapp_sends tiene RLS con cero politicas y ningun grant: leerla directo con la clave de servicio funciona en dev y no puede funcionar en produccion, que es la caida de /admin del 2026-09-05. Los topes (1.600/mes, el 80% del plan Free de Kapso, y 200 destinatarios unicos en 24h, el 80% del techo de Meta sin verificar) viven dentro de la funcion y no en TypeScript, porque una comprobacion en codigo se esquiva escribiendo un segundo llamador. Y el indice unico de la 065 pasa a ser PARCIAL, ignorando las filas fallidas: tal como estaba, un fallo de Kapso de treinta segundos un lunes dejaba a los dieciocho duenos sin resumen esa semana para siempre, porque el turno quedaba ocupado por un envio que nunca salio. Una reserva sin respuesta de mas de 15 minutos se limpia sola.'
)
on conflict (key) do nothing;

commit;

-- ── verification, after running the above ───────────────────────────────
--
-- 1. El índice ignora los fallos pero sigue frenando los duplicados. Esta es
--    la razón de ser de la migración, así que se prueba en vez de suponerse —
--    con cualquier uuid de dueño real:
--
--   begin;
--   select public.whatsapp_send_begin('<owner-uuid>', 'qa', 'X');  -- da un id
--   select public.whatsapp_send_begin('<owner-uuid>', 'qa', 'X');  -- ya_enviado
--   -- marcar el primero como fallido libera el turno:
--   update public.whatsapp_sends set ok = false
--     where owner_id = '<owner-uuid>' and template = 'qa' and period_key = 'X';
--   select public.whatsapp_send_begin('<owner-uuid>', 'qa', 'X');  -- da un id nuevo
--   rollback;
--
-- 2. Nadie con sesión puede llamarlas:
--
--   select has_function_privilege('authenticated', 'public.whatsapp_send_begin(uuid, text, text)', 'execute'),
--          has_function_privilege('anon', 'public.whatsapp_send_begin(uuid, text, text)', 'execute');
--   -- EXPECTED: false, false.
