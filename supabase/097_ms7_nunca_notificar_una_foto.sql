-- 097_ms7_nunca_notificar_una_foto.sql
--
-- ENVIRONMENT: run on the DEV branch (vzqppwrwnmlbrxizskdh). Do NOT run against
-- production (rabmiyqodnvnrwiartuj) until the user says to launch.
--
-- ===========================================================================
-- UN MOVIMIENTO QUE VIENE DE UNA FOTO NO GENERA NUNCA UN MENSAJE
--
-- MS-7, y la ficha pide algo mas raro de lo que parece: **la regla tiene que
-- existir ANTES que el remitente**, no despues. Hoy no hay ni una linea de
-- codigo que escriba a un cliente, asi que esto no arregla nada que este roto
-- ahora mismo. Se escribe primero justo por eso: el dia que exista el
-- remitente, la unica puerta por la que puede pasar ya estara cerrada.
--
-- EN CRISTIANO, que es lo que justifica el trabajo: Dona Rosa estrena Sevenz
-- fotografiando su libreta del ultimo ano y confirma doscientos movimientos.
-- Pedro recibe CATORCE WhatsApps en un minuto por fiados de hace ocho meses
-- que ya pago. No es solo una molestia: son catorce razones para bloquear el
-- numero, y la calidad se mide por numero.
--
-- Y hay un segundo dano, menos obvio: esos doscientos movimientos son cuarenta
-- destinatarios unicos de golpe contra el techo de 250 del portafolio. Una sola
-- libreta podria dejar sin cupo a todos los demas negocios.
--
-- ===========================================================================
-- DOS CAPAS, Y LA SEGUNDA ES LA QUE IMPORTA
--
-- 1. `movement_notice_target()` es la fuente unica de verdad: dice si un
--    movimiento puede generar un aviso y, si puede, devuelve todo lo que el
--    remitente necesita. Una segunda consulta que respondiera «casi» lo mismo
--    acabaria discrepando, y la discrepancia seria mensajes que no debian
--    salir o silencio hacia quien si debia recibirlos.
--
-- 2. `whatsapp_send_begin` lo comprueba OTRA VEZ para los envios a cliente.
--    Es la misma filosofia que CLAUDE.md pide para la propiedad de una fila:
--    la comprobacion explicita en el codigo Y la de la base, porque la segunda
--    sigue en pie el dia que alguien se olvide de la primera.
--
-- Y UN ENVIO A CLIENTE SIN MOVIMIENTO SE RECHAZA. Las cinco plantillas de
-- cliente que existen hoy hablan todas de un movimiento concreto -- el recibo
-- de un abono, el aviso de un fiado, los tres recordatorios de plazo -- asi que
-- exigirlo no cierra ninguna puerta real y cierra la de olvidarse el guardia.
-- Si algun dia hay una plantilla de cliente que no habla de un movimiento, ESTE
-- es el comentario que hay que venir a cambiar, a conciencia.
-- ===========================================================================

begin;

-- ===========================================================================
-- 1. LA FUENTE UNICA DE VERDAD
-- ===========================================================================
--
-- Devuelve jsonb y no un booleano a proposito: cuando un mensaje no sale, lo
-- primero que hace falta es saber POR QUE, y un `false` obliga a reconstruirlo
-- a mano repitiendo las mismas consultas. Los motivos son estables y se pueden
-- contar en el panel de MS-36.
drop function if exists public.movement_notice_target(uuid);

create function public.movement_notice_target(p_movement_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  m record;
begin
  select
    mv.id,
    mv.client_id,
    mv.source,
    mv.deleted_at,
    mv.type,
    mv.amount,
    mv.currency,
    c.owner_id,
    c.name as client_name,
    c.whatsapp,
    c.trashed_at as client_trashed_at
  into m
  from public.movements mv
  join public.clients c on c.id = mv.client_id
  where mv.id = p_movement_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- MS-7. Va ANTES que todo lo demas porque es la regla dura: da igual que el
  -- cliente haya aceptado y que el numero sea perfecto.
  if m.source <> 'manual' then
    return jsonb_build_object('ok', false, 'reason', 'photo_import');
  end if;

  if m.deleted_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'deleted');
  end if;

  if m.client_trashed_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'client_trashed');
  end if;

  if public.normalize_whatsapp_phone(m.whatsapp) is null then
    return jsonb_build_object('ok', false, 'reason', 'no_phone');
  end if;

  -- El permiso, por la misma funcion que usa todo lo demas (081). Dos formas
  -- de preguntar «¿acepta?» acabarian respondiendo distinto.
  if not public.client_accepts_whatsapp(m.client_id) then
    return jsonb_build_object('ok', false, 'reason', 'no_consent');
  end if;

  return jsonb_build_object(
    'ok', true,
    'movement_id', m.id,
    'client_id', m.client_id,
    'owner_id', m.owner_id,
    'client_name', m.client_name,
    'phone', public.normalize_whatsapp_phone(m.whatsapp),
    'type', m.type,
    'amount', m.amount,
    'currency', m.currency
  );
end;
$fn$;

comment on function public.movement_notice_target(uuid) is
  'Si este movimiento puede generar un aviso al cliente, y todo lo que el remitente necesita para mandarlo. La regla dura es MS-7: un movimiento con source distinto de manual NUNCA genera mensaje, da igual el permiso. Devuelve jsonb y no un booleano para que el motivo del no se pueda registrar y contar.';

revoke execute on function public.movement_notice_target(uuid) from public, anon, authenticated;
grant execute on function public.movement_notice_target(uuid) to service_role;

-- ===========================================================================
-- 2. LA PUERTA LO COMPRUEBA OTRA VEZ
-- ===========================================================================
--
-- Se dropean las DOS firmas, la de 6 que creo la 096 y la de 7 que crea esta.
-- Postgres sobrecarga por tipos: dejar viva la de 6 significa dos funciones y
-- PostgREST resolviendo a la que quiera.
--
-- `p_movement_id` lleva default null, por la regla de orden de despliegue: las
-- migraciones entran en produccion antes que el codigo, y durante ese rato la
-- produccion llama con 3 argumentos. Esas llamadas son de AUDIENCIA DUENO, que
-- no pasa por este guardia, asi que siguen funcionando exactamente igual.
drop function if exists public.whatsapp_send_begin(uuid, text, text, text, text, uuid);
drop function if exists public.whatsapp_send_begin(uuid, text, text, text, text, uuid, uuid);

create function public.whatsapp_send_begin(
  p_owner_id uuid,
  p_template text,
  p_period_key text,
  p_audience text default 'owner',
  p_recipient text default null,
  p_client_id uuid default null,
  p_movement_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id uuid;
  v_mes int;
  v_destinatarios_hoy int;
  v_clientes_hoy int;
  v_origen text;
  v_tope_mensual constant int := 1600;
  v_tope_diario_destinatarios constant int := 200;
  v_tope_diario_clientes constant int := 150;
  v_audience text := coalesce(p_audience, 'owner');
  v_clave text := coalesce(p_recipient, p_owner_id::text);
begin
  if v_audience not in ('owner', 'client') then
    return jsonb_build_object('skip', 'audiencia_invalida');
  end if;

  -- ── MS-7, SEGUNDA CAPA ────────────────────────────────────────────────
  --
  -- Un aviso a cliente SIEMPRE habla de un movimiento, y ese movimiento nunca
  -- puede venir de una foto. Si alguien escribe un remitente que se salta
  -- `movement_notice_target`, aqui se para igual.
  if v_audience = 'client' then
    if p_movement_id is null then
      return jsonb_build_object('skip', 'sin_movimiento');
    end if;

    select source into v_origen from public.movements where id = p_movement_id;

    if v_origen is null then
      return jsonb_build_object('skip', 'movimiento_no_existe');
    end if;

    if v_origen <> 'manual' then
      return jsonb_build_object('skip', 'photo_import');
    end if;
  end if;

  update public.whatsapp_sends
  set ok = false, error = 'sin respuesta'
  where ok is null and sent_at < now() - interval '15 minutes';

  select count(*) into v_mes
  from public.whatsapp_sends
  where sent_at >= date_trunc('month', now())
    and ok is not false;

  if v_mes >= v_tope_mensual then
    return jsonb_build_object('skip', 'tope_mensual', 'enviados_mes', v_mes);
  end if;

  select
    count(distinct coalesce(recipient, owner_id::text)),
    count(distinct coalesce(recipient, owner_id::text)) filter (where audience = 'client')
  into v_destinatarios_hoy, v_clientes_hoy
  from public.whatsapp_sends
  where sent_at >= now() - interval '24 hours'
    and ok is not false;

  if not exists (
    select 1 from public.whatsapp_sends
    where coalesce(recipient, owner_id::text) = v_clave
      and sent_at >= now() - interval '24 hours'
      and ok is not false
  ) then
    if v_destinatarios_hoy >= v_tope_diario_destinatarios then
      return jsonb_build_object(
        'skip', 'tope_diario',
        'destinatarios_hoy', v_destinatarios_hoy
      );
    end if;

    if v_audience = 'client' and v_clientes_hoy >= v_tope_diario_clientes then
      return jsonb_build_object(
        'skip', 'tope_diario_clientes',
        'clientes_hoy', v_clientes_hoy
      );
    end if;
  end if;

  insert into public.whatsapp_sends (owner_id, template, period_key, audience, recipient, client_id)
  values (p_owner_id, p_template, p_period_key, v_audience, p_recipient, p_client_id)
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('skip', 'ya_enviado');
  end if;

  return jsonb_build_object(
    'id', v_id,
    'alarma', v_mes >= (v_tope_mensual * 0.7)::int,
    'enviados_mes', v_mes
  );
end;
$fn$;

comment on function public.whatsapp_send_begin(uuid, text, text, text, text, uuid, uuid) is
  'Reserva el turno de un envio de WhatsApp antes de llamar a Kapso. Cuenta DESTINATARIOS distintos en 24h: 200 en total y como mucho 150 de clientes, para que el resumen semanal de los duenos nunca se quede sin cupo. Un envio a cliente exige p_movement_id y rechaza el movimiento que venga de una foto (MS-7), segunda capa sobre movement_notice_target. Los parametros nuevos llevan default para que la llamada de 3 argumentos de la produccion desplegada siga funcionando.';

revoke execute on function public.whatsapp_send_begin(uuid, text, text, text, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.whatsapp_send_begin(uuid, text, text, text, text, uuid, uuid) to service_role;

insert into public.schema_migrations (key, description)
values (
  '097_ms7_nunca_notificar_una_foto',
  'MS-7: un movimiento que viene de una foto no genera NUNCA un aviso al cliente. La ficha pedia que la regla existiera ANTES que el remitente, y hoy no hay ni una linea que escriba a un cliente -- se escribe primero justo por eso: el dia que exista el remitente, la unica puerta por la que puede pasar ya estara cerrada. El dano que evita: Dona Rosa sube un ano de libreta, confirma 200 movimientos, y Pedro recibe catorce WhatsApps en un minuto por fiados de hace ocho meses que ya pago -- catorce razones para bloquear el numero, y la calidad se mide por numero. Y un segundo dano menos obvio: esos 200 movimientos son 40 destinatarios unicos de golpe contra el techo de 250 del portafolio, asi que una sola libreta podria dejar sin cupo a los demas negocios. Dos capas: movement_notice_target(uuid) es la fuente unica de verdad y devuelve jsonb con el motivo del no (not_found, photo_import, deleted, client_trashed, no_phone, no_consent) para poder contarlos en MS-36; y whatsapp_send_begin lo comprueba otra vez para audiencia cliente, misma filosofia que la comprobacion de propiedad de CLAUDE.md. Un envio a cliente sin p_movement_id se rechaza: las cinco plantillas de cliente hablan todas de un movimiento, asi que exigirlo no cierra ninguna puerta real y cierra la de olvidarse el guardia.'
)
on conflict (key) do nothing;

commit;
