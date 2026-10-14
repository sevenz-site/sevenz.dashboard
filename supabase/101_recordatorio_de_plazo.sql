-- 101_recordatorio_de_plazo.sql
--
-- ENVIRONMENT: run on the DEV branch (vzqppwrwnmlbrxizskdh). Do NOT run against
-- production (rabmiyqodnvnrwiartuj) until the user says to launch.
--
-- ===========================================================================
-- 1. MS-7 SE ESTRECHA: «ningun mensaje AL GUARDARLO», no «ningun mensaje»
--
-- La 097 rechazaba `photo_import` para TODOS los mensajes a cliente, y eso
-- contradecia una decision anterior del dueno. MS-27, del 2026-10-08:
--
--   «MS-7 apaga los mensajes que se disparan AL GUARDAR un movimiento, y los
--   recordatorios de plazo no se disparan ahi (...) Dona Rosa sube el lunes 40
--   fiados a 7 dias; el sabado los 40 vencen el mismo dia. REPARTIR, NO
--   EXCLUIR -- la alternativa, no recordar nunca lo importado, se descarto
--   porque casi todo tendero arranca subiendo su libreta.»
--
-- Con el guardia ancho, esos 40 fiados no recibian recordatorio NUNCA: justo
-- la alternativa descartada. Lo lei como «ningun mensaje por un movimiento de
-- foto» y lo correcto es «ningun mensaje AL GUARDARLO».
--
-- Confirmado por el dueno el 2026-10-14. El recordatorio llega dias despues,
-- cuando el plazo vence, y ahi el origen de la fila ya no dice nada sobre si
-- el mensaje molesta: lo que molestaba era recibir catorce de golpe por cosas
-- de hace ocho meses, y de eso se encarga el tope de MS-27.
--
-- El recibo de una foto SIGUE BLOQUEADO, porque ese si se dispara al guardar.
--
-- ===========================================================================
-- 2. QUIEN RECIBE `payment_due_date`
--
-- La ventana la fijo el dueno el 2026-10-14 y su tabla entera vive en
-- WHATSAPP-PLANTILLAS.md:
--
--   dias_antes = acotar( redondear(plazo x 0,25), minimo 1, maximo 7 )
--
-- Un porcentaje y no un numero fijo porque lo que hace util a un recordatorio
-- es la PROPORCION de plazo que deja por delante. Los dos topes salen de dos
-- casos reales: hay un plazo de 365 en los datos (sin techo avisaria con tres
-- meses de antelacion, que es ruido) y el 25% de un plazo de 2 dias es medio
-- dia (el aviso llegaria el mismo dia del fiado, pegado al «te fiaron»).
-- ===========================================================================

begin;

-- ===========================================================================
-- MS-7, ESTRECHADO EN LAS DOS CAPAS
-- ===========================================================================

drop function if exists public.movement_notice_target(uuid);
drop function if exists public.movement_notice_target(uuid, boolean);

create function public.movement_notice_target(
  p_movement_id uuid,
  -- Si la pregunta es por un RECORDATORIO. Por defecto false, que es el recibo:
  -- el camino que ya existia sigue comportandose igual sin tocar su llamada.
  p_reminder boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  m record;
  v_display text;
begin
  select
    mv.id, mv.client_id, mv.source, mv.deleted_at, mv.type, mv.amount,
    mv.currency, mv.running_balance, mv.plazo_dias, mv.created_at,
    c.owner_id, c.name as client_name, c.whatsapp, c.trashed_at as client_trashed_at,
    o.business_name, o.first_name,
    (
      select sl.token from public.share_links sl
      where sl.client_id = c.id
      order by sl.created_at desc, sl.id desc limit 1
    ) as share_token
  into m
  from public.movements mv
  join public.clients c on c.id = mv.client_id
  join public.owners o on o.id = c.owner_id
  where mv.id = p_movement_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- MS-7, ESTRECHADO. Solo frena lo que se dispara AL GUARDAR. Un recordatorio
  -- sobre un fiado importado SI sale: lo pide MS-27 y lo reparte su tope.
  if m.source <> 'manual' and not coalesce(p_reminder, false) then
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

  if not public.client_accepts_whatsapp(m.client_id) then
    return jsonb_build_object('ok', false, 'reason', 'no_consent');
  end if;

  v_display := case
    when coalesce(btrim(m.first_name), '') = '' then m.business_name
    else btrim(m.first_name) || ' (' || m.business_name || ')'
  end;

  return jsonb_build_object(
    'ok', true,
    'movement_id', m.id,
    'client_id', m.client_id,
    'owner_id', m.owner_id,
    'client_name', m.client_name,
    'phone', public.normalize_whatsapp_phone(m.whatsapp),
    'type', m.type,
    'amount', m.amount,
    'currency', m.currency,
    'new_balance', m.running_balance,
    'business_display', v_display,
    'share_token', m.share_token
  );
end;
$fn$;

comment on function public.movement_notice_target(uuid, boolean) is
  'Si este movimiento puede generar un aviso al cliente, y todo lo que la plantilla necesita. MS-7 estrechado el 2026-10-14: el origen photo_import solo frena lo que se dispara AL GUARDAR (el recibo), no los recordatorios de plazo, que llegan dias despues y que MS-27 pide explicitamente que salgan repartidos.';

revoke execute on function public.movement_notice_target(uuid, boolean) from public, anon, authenticated;
grant execute on function public.movement_notice_target(uuid, boolean) to service_role;

-- ===========================================================================
-- LA PUERTA, CON EL MISMO ESTRECHAMIENTO
-- ===========================================================================

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
  v_tope_recordatorios_negocio constant int := 20;
  v_audience text := coalesce(p_audience, 'owner');
  v_clave text := coalesce(p_recipient, p_owner_id::text);
begin
  if v_audience not in ('owner', 'client') then
    return jsonb_build_object('skip', 'audiencia_invalida');
  end if;

  if v_audience = 'client' then
    if p_movement_id is null then
      return jsonb_build_object('skip', 'sin_movimiento');
    end if;

    select source into v_origen from public.movements where id = p_movement_id;

    if v_origen is null then
      return jsonb_build_object('skip', 'movimiento_no_existe');
    end if;

    -- MS-7 estrechado: ver la cabecera. Solo frena el mensaje que se dispara
    -- al guardar, nunca el recordatorio de plazo.
    if v_origen <> 'manual' and not coalesce(p_reminder, false) then
      return jsonb_build_object('skip', 'photo_import');
    end if;
  end if;

  update public.whatsapp_sends
  set ok = false, error = 'sin respuesta'
  where ok is null and sent_at < now() - interval '15 minutes';

  select count(*) into v_mes
  from public.whatsapp_sends
  where sent_at >= date_trunc('month', now()) and ok is not false;

  if v_mes >= v_tope_mensual then
    return jsonb_build_object('skip', 'tope_mensual', 'enviados_mes', v_mes);
  end if;

  select
    count(distinct coalesce(recipient, owner_id::text)),
    count(distinct coalesce(recipient, owner_id::text)) filter (where audience = 'client')
  into v_destinatarios_hoy, v_clientes_hoy
  from public.whatsapp_sends
  where sent_at >= now() - interval '24 hours' and ok is not false;

  if not exists (
    select 1 from public.whatsapp_sends
    where coalesce(recipient, owner_id::text) = v_clave
      and sent_at >= now() - interval '24 hours' and ok is not false
  ) then
    if v_destinatarios_hoy >= v_tope_diario_destinatarios then
      return jsonb_build_object('skip', 'tope_diario', 'destinatarios_hoy', v_destinatarios_hoy);
    end if;

    if v_audience = 'client' and v_clientes_hoy >= v_tope_diario_clientes then
      return jsonb_build_object('skip', 'tope_diario_clientes', 'clientes_hoy', v_clientes_hoy);
    end if;
  end if;

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
  'Reserva el turno de un envio antes de llamar a Kapso. Tres topes: 200 destinatarios unicos/24h, 150 de clientes, y 20 recordatorios por negocio y por dia (MS-27). Un envio a cliente exige p_movement_id. MS-7 estrechado el 2026-10-14: photo_import solo frena lo que se dispara al guardar, no los recordatorios.';

revoke execute on function public.whatsapp_send_begin(uuid, text, text, text, text, uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.whatsapp_send_begin(uuid, text, text, text, text, uuid, uuid, boolean) to service_role;

-- ===========================================================================
-- QUIEN RECIBE EL RECORDATORIO HOY
-- ===========================================================================
--
-- UNA FUNCION Y NO UNA CONSULTA EN EL REMITENTE, por lo mismo que
-- `client_accepts_whatsapp`: la regla de «lo que vence» vive una sola vez. Dos
-- copias acabarian discrepando, y la discrepancia serian recordatorios de mas
-- o silencio hacia quien si lo esperaba.
--
-- EL CARGO QUE SE MIRA ES EL DE VENCIMIENTO MAS CERCANO EN EL FUTURO, no «el
-- cargo mas viejo sin pagar». Son cosas distintas y la primera es la que pide
-- la plantilla: habla de «tu plazo vence el X». Y ademas evita duplicar la
-- logica de «sin pagar» que ya vive en `client_summary_all` -- aqui el filtro
-- real es el SALDO, que es lo unico que de verdad dice si todavia debe.
--
-- LAS FECHAS VAN EN HORA DE COLOMBIA, como el resto del cron (ver
-- `diaIsoEnColombia` en lib/whatsapp/send.ts). Un negocio venezolano esta una
-- hora por delante, asi que en la franja de medianoche su recordatorio puede
-- salir el dia que aqui todavia es ayer. Es un desfase conocido de una hora en
-- un aviso que se manda con dias de antelacion.
drop function if exists public.whatsapp_destinatarios_plazo();

create function public.whatsapp_destinatarios_plazo()
returns table (
  movement_id uuid,
  client_id uuid,
  owner_id uuid,
  client_name text,
  phone text,
  business_display text,
  due_date date,
  amount_due numeric,
  currency text
)
language sql
stable
security definer
set search_path = public
as $fn$
  with hoy as (select (now() at time zone 'America/Bogota')::date as d),
  cargos as (
    select
      mv.id,
      mv.client_id,
      mv.currency,
      ((mv.created_at at time zone 'America/Bogota')::date + mv.plazo_dias) as vence,
      -- La ventana del dueno, 2026-10-14. La tabla de los seis casos esta en
      -- WHATSAPP-PLANTILLAS.md.
      greatest(1, least(7, round(mv.plazo_dias * 0.25)::int)) as dias_antes
    from public.movements mv
    where mv.type = 'charge'
      and mv.deleted_at is null
      and mv.plazo_dias is not null
      and mv.plazo_dias > 0
  ),
  -- El vencimiento mas cercano de cada cliente, de los que aun no han llegado.
  proximo as (
    select distinct on (c.client_id) c.*
    from cargos c, hoy
    where c.vence >= hoy.d
    order by c.client_id, c.vence asc, c.id asc
  )
  select
    p.id as movement_id,
    cl.client_id,
    cl.owner_id,
    cl.name as client_name,
    public.normalize_whatsapp_phone(cl.whatsapp) as phone,
    case
      when coalesce(btrim(o.first_name), '') = '' then o.business_name
      else btrim(o.first_name) || ' (' || o.business_name || ')'
    end as business_display,
    p.vence as due_date,
    case p.currency
      when 'USD' then cl.balance_usd
      when 'EUR' then cl.balance_eur
      else cl.balance
    end as amount_due,
    p.currency
  from proximo p
  join public.client_summary_all cl on cl.client_id = p.client_id
  join public.owners o on o.id = cl.owner_id
  cross join hoy
  where cl.trashed_at is null
    and cl.deleted_at is null
    -- Hoy es el dia: ni antes ni despues.
    and (p.vence - p.dias_antes) = hoy.d
    -- Sin deuda en ESE libro no hay nada que recordar.
    and (case p.currency
           when 'USD' then cl.balance_usd
           when 'EUR' then cl.balance_eur
           else cl.balance
         end) > 0
    and public.normalize_whatsapp_phone(cl.whatsapp) is not null
    and public.client_accepts_whatsapp(cl.client_id);
$fn$;

comment on function public.whatsapp_destinatarios_plazo() is
  'Quien recibe hoy el recordatorio payment_due_date. Mira el vencimiento mas cercano AUN NO LLEGADO de cada cliente y lo compara con la ventana del dueno: acotar(redondear(plazo*0,25), 1, 7). Filtra por saldo en el libro de ese cargo, telefono utilizable y permiso. Fechas en hora de Colombia, como el resto del cron.';

revoke execute on function public.whatsapp_destinatarios_plazo() from public, anon, authenticated;
grant execute on function public.whatsapp_destinatarios_plazo() to service_role;

insert into public.schema_migrations (key, description)
values (
  '101_recordatorio_de_plazo',
  'Dos cosas. (1) MS-7 SE ESTRECHA, confirmado por el dueno el 2026-10-14: photo_import solo frena los mensajes que se disparan AL GUARDAR, no los recordatorios de plazo. La 097 los frenaba todos y eso contradecia a MS-27, que decidio el 2026-10-08 "repartir, no excluir" con el caso explicito de Dona Rosa subiendo 40 fiados que vencen el mismo sabado -- con el guardia ancho esos 40 no recibian recordatorio NUNCA, justo la alternativa descartada. El recibo de una foto sigue bloqueado porque ese si se dispara al guardar. (2) Nace whatsapp_destinatarios_plazo(), que dice quien recibe hoy payment_due_date. Mira el vencimiento mas cercano AUN NO LLEGADO de cada cliente -- no "el cargo mas viejo sin pagar", que es otra cosa y ademas duplicaria la logica de client_summary_all; aqui el filtro real es el SALDO. La ventana es acotar(redondear(plazo*0,25),1,7), fijada por el dueno con su tabla de seis casos en WHATSAPP-PLANTILLAS.md: un porcentaje y no un numero fijo porque lo util es la proporcion de plazo que deja por delante, y los dos topes salen de dos casos reales (hay un plazo de 365 en los datos, y el 25% de un plazo de 2 dias es medio dia). Fechas en hora de Colombia como el resto del cron, con un desfase conocido de una hora para los negocios venezolanos en la franja de medianoche.'
)
on conflict (key) do nothing;

commit;
