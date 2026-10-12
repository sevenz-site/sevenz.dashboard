-- 096_whatsapp_gate_por_destinatario.sql
--
-- ENVIRONMENT: run on the DEV branch (vzqppwrwnmlbrxizskdh). Do NOT run against
-- production (rabmiyqodnvnrwiartuj) until the user says to launch.
--
-- ===========================================================================
-- LA PUERTA DE ENVIO DEJA DE CONTAR DUENOS Y EMPIEZA A CONTAR DESTINATARIOS
--
-- MS-21 y MS-37. La 067 lo dejo escrito en su propio comentario: «OJO PARA LA
-- FASE 3: aqui el destinatario es el dueno. Cuando se escriba a clientes, el
-- destinatario sera otro y esta cuenta se quedara corta -- hara falta
-- registrar a quien se le escribio, no solo de quien es la cuenta.» Esto es
-- esa deuda, cobrada.
--
-- Hoy `count(distinct owner_id)` es correcto porque un dueno recibe UN mensaje
-- y es UN destinatario. Con clientes deja de serlo de dos formas a la vez: una
-- bodega con cuarenta clientes son cuarenta destinatarios y la cuenta dice
-- uno, y dos bodegas que comparten un cliente son un destinatario y la cuenta
-- dice dos. Meta cuenta personas, no cuentas.
--
-- ===========================================================================
-- EL CUPO ES DEL PORTAFOLIO, Y ESO OBLIGA A RESERVAR
--
-- Confirmado por Kapso el 2026-10-10: el techo de 250 conversaciones iniciadas
-- por la empresa en 24 h es del **business portfolio**, no del numero. Separar
-- los numeros por audiencia (MS-24) aisla la CALIDAD y no la CAPACIDAD: dos
-- numeros no son 500, y los avisos al dueno compiten por el mismo cupo que los
-- del cliente.
--
-- El riesgo concreto, que no existia antes de esa respuesta: los recibos de
-- cliente salen toda la semana; el resumen de los duenos sale un dia. Un lunes
-- cargado puede dejar sin cupo ese resumen, y el sintoma seria SILENCIO -- 24
-- duenos que simplemente dejan de recibirlo, sin error en ninguna parte.
--
-- LA REGLA: dos topes, no uno.
--
--   * 200 destinatarios unicos / 24 h en total (el 80 % de 250, como ya hacia
--     la 067). Por encima, no sale nada, sea de quien sea.
--   * 150 de esos 200, como mucho, para CLIENTES.
--
-- Los 50 que quedan son la reserva de los duenos. Hoy son 24, asi que la
-- reserva es el doble de lo que hace falta -- y ese es el numero a volver a
-- mirar cuando los duenos pasen de 50, no antes. Un cliente que ya recibio algo
-- en la ventana no vuelve a contar, igual que un dueno.
--
-- ===========================================================================
-- POR QUE LOS PARAMETROS NUEVOS LLEVAN VALOR POR DEFECTO
--
-- No es comodidad: es la regla de orden de despliegue de CLAUDE.md. Las
-- migraciones entran en produccion ANTES que el codigo, asi que durante un rato
-- la produccion desplegada llamara a esta funcion con los tres argumentos de
-- siempre. Con parametros obligatorios, ese rato son los avisos semanales de
-- los 24 duenos cayendo con «function does not exist».
--
-- Con `default`, una llamada de tres argumentos resuelve aqui y se comporta
-- exactamente como antes: audiencia «owner», sin destinatario, y la cuenta
-- diaria cae del lado de contar duenos. Es el fallo degradado -- «ligeramente
-- reducido» en vez de «todo el mundo caido».
--
-- Y SE DROPEAN LAS DOS FIRMAS, la vieja de 3 y la nueva de 6. Postgres sobrecarga
-- por tipos: dejar la vieja viva crearia dos funciones y PostgREST resolveria a
-- la que quisiera. Dropear solo la vieja haria que el archivo funcionara
-- exactamente una vez.
-- ===========================================================================

begin;

-- ===========================================================================
-- 1. LA FILA SABE A QUIEN SE LE ESCRIBIO
-- ===========================================================================

alter table public.whatsapp_sends
  add column if not exists audience text not null default 'owner';

alter table public.whatsapp_sends
  drop constraint if exists whatsapp_sends_audience_check;

alter table public.whatsapp_sends
  add constraint whatsapp_sends_audience_check
  check (audience in ('owner', 'client'));

-- EL DEFAULT 'owner' ES CORRECTO PARA LO QUE YA HAY, no una suposicion: hasta
-- hoy esta tabla solo registra avisos al dueno, porque MS-3 nunca ha enviado
-- nada. Se queda como default ademas para que la llamada de tres argumentos
-- descrita arriba siga siendo coherente.

-- El telefono normalizado al que se escribio. Null en lo historico y en las
-- llamadas viejas, y la cuenta de abajo lo trata como «este dueno» -- que es
-- exactamente lo que esas filas significan.
alter table public.whatsapp_sends
  add column if not exists recipient text;

-- De quien es el saldo del que habla el mensaje. Solo para audiencia 'client'.
-- `on delete set null` y no cascade: si el cliente se borra se pierde el
-- vinculo, pero NO el registro de que se mando un mensaje -- esa fila es
-- contabilidad frente a Meta y frente al cupo.
alter table public.whatsapp_sends
  add column if not exists client_id uuid references public.clients (id) on delete set null;

-- La unica consulta caliente nueva: destinatarios distintos en 24 h, por
-- audiencia. Sin esto es un scan de la tabla entera en cada envio.
create index if not exists whatsapp_sends_ventana_idx
  on public.whatsapp_sends (sent_at desc, audience)
  where ok is not false;

comment on column public.whatsapp_sends.audience is
  'owner = aviso al tendero (fase 2, en produccion). client = aviso al cliente final (MS-3). Decide contra que tope cuenta la fila y por que numero sale (MS-24).';
comment on column public.whatsapp_sends.recipient is
  'Telefono normalizado al que se escribio. Null en filas anteriores a la 096 y en llamadas de 3 argumentos; la cuenta diaria las trata como un destinatario por dueno, que es lo que eran.';

-- ===========================================================================
-- 2. LA PUERTA
-- ===========================================================================

drop function if exists public.whatsapp_send_begin(uuid, text, text);
drop function if exists public.whatsapp_send_begin(uuid, text, text, text, text, uuid);

create function public.whatsapp_send_begin(
  p_owner_id uuid,
  p_template text,
  p_period_key text,
  p_audience text default 'owner',
  p_recipient text default null,
  p_client_id uuid default null
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
  v_tope_mensual constant int := 1600;
  -- 80 % de los 250 del portafolio. Mismo numero que la 067, misma razon:
  -- operar al limite significa descubrirlo cortando.
  v_tope_diario_destinatarios constant int := 200;
  -- De esos 200, cuantos pueden ser clientes. Los 50 restantes son la reserva
  -- de los duenos, que hoy son 24.
  v_tope_diario_clientes constant int := 150;
  v_audience text := coalesce(p_audience, 'owner');
  -- La identidad del destinatario para contar: su telefono si lo sabemos, y si
  -- no el dueno, que es lo que significaban las filas de antes de la 096.
  --
  -- EL CAMINO DEL DUENO NO MANDA p_recipient, a proposito: su clave sigue
  -- siendo el owner_id, igual que todo lo historico. Si empezara a mandarlo,
  -- el mismo dueno tendria dos formas de clave dentro de la misma ventana de
  -- 24 h y se contaria dos veces.
  v_clave text := coalesce(p_recipient, p_owner_id::text);
begin
  if v_audience not in ('owner', 'client') then
    return jsonb_build_object('skip', 'audiencia_invalida');
  end if;

  -- Reservas sin respuesta de mas de 15 minutos: el servidor se cayo entre
  -- reservar y llamar a Kapso. Se liberan antes de intentar la nuestra.
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

  -- ── Los dos topes ─────────────────────────────────────────────────────
  --
  -- Se cuentan DESTINATARIOS DISTINTOS, no mensajes: es lo que cuenta Meta.
  -- Tres recibos a Pedro en un dia son un destinatario.
  select
    count(distinct coalesce(recipient, owner_id::text)),
    count(distinct coalesce(recipient, owner_id::text)) filter (where audience = 'client')
  into v_destinatarios_hoy, v_clientes_hoy
  from public.whatsapp_sends
  where sent_at >= now() - interval '24 hours'
    and ok is not false;

  -- Alguien a quien ya se le escribio en la ventana NO vuelve a gastar cupo,
  -- asi que no se le frena. Sin esto, el segundo recibo del dia a Pedro se
  -- quedaria fuera por un tope que el no esta gastando.
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

    -- LA RESERVA DE LOS DUENOS. Este tope solo frena a los clientes: por
    -- encima de 150 destinatarios de cliente en la ventana, los recibos
    -- esperan y el resumen semanal de los duenos sigue teniendo sitio.
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

comment on function public.whatsapp_send_begin(uuid, text, text, text, text, uuid) is
  'Reserva el turno de un envio de WhatsApp antes de llamar a Kapso. Cuenta DESTINATARIOS distintos en 24h, no cuentas: 200 en total (80% de los 250 del portafolio) y como mucho 150 de clientes, para que el resumen semanal de los duenos nunca se quede sin cupo. Los parametros nuevos llevan default para que una llamada de 3 argumentos -- la produccion desplegada antes de que entre el codigo -- siga funcionando como antes.';

revoke execute on function public.whatsapp_send_begin(uuid, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.whatsapp_send_begin(uuid, text, text, text, text, uuid) to service_role;

insert into public.schema_migrations (key, description)
values (
  '096_whatsapp_gate_por_destinatario',
  'MS-21 y MS-37: la puerta de envio deja de contar duenos y cuenta DESTINATARIOS distintos, que es lo que cuenta Meta. La 067 ya lo habia avisado en su propio comentario. whatsapp_sends gana audience (owner/client, default owner porque es lo que son todas las filas de hoy), recipient (el telefono normalizado) y client_id. Dos topes en vez de uno: 200 destinatarios unicos en 24h en total, y como mucho 150 de clientes -- los otros 50 son la reserva de los duenos, que hoy son 24. Hace falta reservar porque Kapso confirmo que los 250 son del business portfolio y no del numero: separar los numeros por audiencia aisla la calidad, no la capacidad, asi que un lunes cargado de recibos podria dejar sin cupo el resumen semanal y el sintoma seria silencio. Un destinatario al que ya se le escribio en la ventana no vuelve a gastar cupo y por tanto no se le frena. Los parametros nuevos llevan DEFAULT a proposito, por la regla de orden de despliegue: la migracion entra antes que el codigo, asi que durante un rato la produccion desplegada llama con 3 argumentos, y con parametros obligatorios ese rato son los avisos de los 24 duenos cayendo con function does not exist. Se dropean las dos firmas porque Postgres sobrecarga por tipos.'
)
on conflict (key) do nothing;

commit;
