-- 099_tope_de_recordatorios_por_negocio.sql
--
-- ENVIRONMENT: run on the DEV branch (vzqppwrwnmlbrxizskdh). Do NOT run against
-- production (rabmiyqodnvnrwiartuj) until the user says to launch.
--
-- ===========================================================================
-- LA AVALANCHA DE UNA LIBRETA, REPARTIDA EN VEZ DE EXCLUIDA
--
-- MS-27, y lo primero es lo que la ficha avisa: **MS-7 NO CUBRE ESTO**.
--
-- MS-7 apaga los mensajes que se disparan AL GUARDAR un movimiento. Los
-- recordatorios de plazo no se disparan ahi: se disparan despues, mirando que
-- fechas vencen. Dona Rosa sube el lunes cuarenta fiados a 7 dias; MS-7 evita
-- cuarenta mensajes el lunes, y el sabado LOS CUARENTA VENCEN EL MISMO DIA y
-- salen de golpe. El problema no se evita, se aplaza cinco dias.
--
-- Decision del dueno el 2026-10-08: **repartir, no excluir**. Un tope por dia
-- y por negocio, y lo que sobra sale al dia siguiente. Nadie pierde su aviso.
-- La alternativa --no recordar nunca lo importado-- se descarto porque casi
-- todo tendero arranca subiendo su libreta, asi que seria no recordar nada.
--
-- ===========================================================================
-- SOLO A LOS RECORDATORIOS, Y ESA DISTINCION IMPORTA
--
-- El tope NO se aplica a los recibos. Un recibo sale porque el cliente ACABA
-- de pagar, delante del tendero: frenarlo seria dejar sin confirmacion a quien
-- mas se la ha ganado, y en el peor momento. Ademas un recibo solo puede venir
-- de un movimiento manual --MS-7 bloquea los de foto-- asi que una libreta
-- jamas produce una avalancha de recibos.
--
-- Un recordatorio es lo contrario: nadie lo pidio hoy, lo decide un cron
-- mirando fechas, y aplazarlo un dia no le quita valor a nadie.
--
-- Se distingue con `p_reminder` y no mirando el nombre de la plantilla: atar
-- una regla de negocio a una cadena que vive fuera del repo --en Meta-- es
-- pedir que se rompa el dia que alguien renombre una.
--
-- ===========================================================================
-- EL NUMERO, Y LA CUENTA QUE HAY QUE SABER ANTES DE DISCUTIRLO
--
-- 20 recordatorios por negocio y por dia.
--
--   * Un negocio normal no lo roza: son 20 personas con plazo venciendo HOY.
--   * Los cuarenta de Dona Rosa salen en dos dias en vez de en un minuto.
--   * Pero 8 negocios a 20 son 160, y el tope de clientes de la plataforma es
--     150. O sea que los dos topes NO son independientes: el de arriba sigue
--     mandando, y por encima de el es el primero que llega quien pasa.
--
-- Este tope no reparte con justicia entre negocios -- eso seria 150/24, que es
-- 6, demasiado poco para un negocio con quince plazos reales. Lo que hace es
-- impedir que UNO solo se lo lleve todo. Si algun dia 24 negocios tienen
-- recordatorios el mismo dia, el numero a mirar es este, y la respuesta
-- probablemente sea NG-1 (verificar la sociedad y subir el techo de 250).
--
-- ===========================================================================
-- LO QUE ESTO NO RESUELVE, Y ES UNA DECISION PENDIENTE DEL DUENO
--
-- «Lo que sobra sale al dia siguiente» sale gratis mientras el remitente sea
-- un cron que vuelve a mirar manana. Pero `payment_due_today` habla de HOY:
-- un recordatorio que se aplaza un dia ya no es «vence hoy», es «vencio ayer».
-- O sea que el sobrante no se reenvia igual, CAMBIA DE PLANTILLA.
--
-- No se resuelve aqui porque el remitente de recordatorios todavia no existe y
-- adivinar su forma seria inventar. Queda escrito para que quien lo escriba lo
-- encuentre, en vez de descubrirlo con los mensajes ya saliendo.
-- ===========================================================================

begin;

-- Si esta fila es un recordatorio de plazo. Default false porque todo lo que
-- hay hoy son avisos al dueno y recibos, y ninguno lo es. No es un detalle de
-- contabilidad: es contra lo que cuenta el tope del negocio.
alter table public.whatsapp_sends
  add column if not exists reminder boolean not null default false;

comment on column public.whatsapp_sends.reminder is
  'True si esta fila es un recordatorio de plazo. Los recibos no lo son, y por eso no les aplica el tope por negocio de MS-27: un recibo sale cuando el cliente acaba de pagar.';

-- El tope del negocio consulta por (owner_id, audience, reminder) dentro de la
-- ventana. Sin esto es un scan de la tabla entera en cada envio.
create index if not exists whatsapp_sends_recordatorios_idx
  on public.whatsapp_sends (owner_id, sent_at desc)
  where audience = 'client' and reminder is true and ok is not false;

drop function if exists public.whatsapp_send_begin(uuid, text, text, text, text, uuid, uuid);
drop function if exists public.whatsapp_send_begin(uuid, text, text, text, text, uuid, uuid, boolean);

create function public.whatsapp_send_begin(
  p_owner_id uuid,
  p_template text,
  p_period_key text,
  p_audience text default 'owner',
  p_recipient text default null,
  p_client_id uuid default null,
  p_movement_id uuid default null,
  p_reminder boolean default false
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
  v_recordatorios_negocio int;
  v_origen text;
  v_tope_mensual constant int := 1600;
  v_tope_diario_destinatarios constant int := 200;
  v_tope_diario_clientes constant int := 150;
  -- MS-27. Solo para recordatorios: ver la cabecera.
  v_tope_recordatorios_negocio constant int := 20;
  v_audience text := coalesce(p_audience, 'owner');
  v_clave text := coalesce(p_recipient, p_owner_id::text);
begin
  if v_audience not in ('owner', 'client') then
    return jsonb_build_object('skip', 'audiencia_invalida');
  end if;

  -- MS-7, segunda capa. Un aviso a cliente SIEMPRE habla de un movimiento, y
  -- ese movimiento nunca puede venir de una foto.
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
      return jsonb_build_object('skip', 'tope_diario', 'destinatarios_hoy', v_destinatarios_hoy);
    end if;

    if v_audience = 'client' and v_clientes_hoy >= v_tope_diario_clientes then
      return jsonb_build_object('skip', 'tope_diario_clientes', 'clientes_hoy', v_clientes_hoy);
    end if;
  end if;

  -- ── MS-27: EL TOPE DEL NEGOCIO ────────────────────────────────────────
  --
  -- Va FUERA del `if not exists` de arriba, y es deliberado. Alli la pregunta
  -- es «¿este destinatario gasta cupo nuevo de la plataforma?», y a quien ya
  -- se le escribio hoy no se le frena. Aqui la pregunta es otra: «¿cuantos
  -- recordatorios lleva ya ESTE negocio hoy?». Un cliente al que ya le llego
  -- un recibo esta manana sigue contando contra la tanda de recordatorios de
  -- su bodega, porque lo que se reparte es la avalancha de la bodega.
  if v_audience = 'client' and coalesce(p_reminder, false) then
    select count(distinct coalesce(recipient, owner_id::text))
    into v_recordatorios_negocio
    from public.whatsapp_sends
    where owner_id = p_owner_id
      and audience = 'client'
      and reminder is true
      and sent_at >= now() - interval '24 hours'
      and ok is not false;

    if v_recordatorios_negocio >= v_tope_recordatorios_negocio then
      return jsonb_build_object(
        'skip', 'tope_recordatorios_negocio',
        'recordatorios_hoy', v_recordatorios_negocio
      );
    end if;
  end if;

  insert into public.whatsapp_sends (
    owner_id, template, period_key, audience, recipient, client_id, reminder
  )
  values (
    p_owner_id, p_template, p_period_key, v_audience, p_recipient, p_client_id,
    coalesce(p_reminder, false)
  )
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

comment on function public.whatsapp_send_begin(uuid, text, text, text, text, uuid, uuid, boolean) is
  'Reserva el turno de un envio de WhatsApp antes de llamar a Kapso. Tres topes: 200 destinatarios unicos en 24h en total, 150 de ellos de clientes (los otros 50 son la reserva de los duenos), y 20 RECORDATORIOS por negocio y por dia (MS-27), que no se aplica a los recibos porque un recibo sale cuando el cliente acaba de pagar. Un envio a cliente exige p_movement_id y rechaza el que venga de una foto (MS-7). Los parametros nuevos llevan default para que la llamada de 3 argumentos de la produccion desplegada siga funcionando.';

revoke execute on function public.whatsapp_send_begin(uuid, text, text, text, text, uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.whatsapp_send_begin(uuid, text, text, text, text, uuid, uuid, boolean) to service_role;

insert into public.schema_migrations (key, description)
values (
  '099_tope_de_recordatorios_por_negocio',
  'MS-27: la avalancha de una libreta se reparte en vez de excluirse. MS-7 NO cubre esto y la ficha lo avisa: MS-7 apaga los mensajes que se disparan AL GUARDAR, y los recordatorios de plazo se disparan despues, mirando que fechas vencen -- Dona Rosa sube el lunes cuarenta fiados a 7 dias, MS-7 evita cuarenta mensajes el lunes, y el sabado los cuarenta vencen el mismo dia. El problema no se evita, se aplaza cinco dias. Decision del dueno el 2026-10-08: repartir, no excluir. whatsapp_sends gana reminder boolean y la puerta un tercer tope: 20 recordatorios por negocio y por dia. NO se aplica a los recibos, porque un recibo sale cuando el cliente acaba de pagar delante del tendero y frenarlo seria dejar sin confirmacion a quien mas se la ha ganado; ademas un recibo solo puede venir de un movimiento manual, asi que una libreta jamas produce una avalancha de recibos. Se distingue con p_reminder y no por el nombre de la plantilla, porque atar una regla de negocio a una cadena que vive en Meta es pedir que se rompa cuando alguien renombre una. El tope del negocio va FUERA del guardia de "ya se le escribio hoy": alli la pregunta es si el destinatario gasta cupo nuevo de la plataforma, aqui es cuantos lleva ya este negocio. PENDIENTE DEL DUENO, escrito en la cabecera: "lo que sobra sale al dia siguiente" sale gratis mientras el remitente sea un cron que vuelve a mirar manana, pero payment_due_today habla de HOY, asi que el sobrante no se reenvia igual sino que CAMBIA DE PLANTILLA. No se resuelve aqui porque el remitente de recordatorios todavia no existe.'
)
on conflict (key) do nothing;

commit;
