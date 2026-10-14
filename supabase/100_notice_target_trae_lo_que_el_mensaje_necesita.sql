-- 100_notice_target_trae_lo_que_el_mensaje_necesita.sql
--
-- ENVIRONMENT: run on the DEV branch (vzqppwrwnmlbrxizskdh). Do NOT run against
-- production (rabmiyqodnvnrwiartuj) until the user says to launch.
--
-- ===========================================================================
-- LA FUENTE DE VERDAD DEVUELVE TODO LO QUE LA PLANTILLA PIDE
--
-- `movement_notice_target` (097) ya decia en su comentario que devuelve «todo
-- lo que el remitente necesita para mandarlo». No era verdad del todo: le
-- faltaban tres de las cinco variables de `abono_confirmation_v2`.
--
-- La plantilla pide: client_name, payment_amount, business_display,
-- new_balance y share_token. La funcion traia las dos primeras y el telefono.
--
-- SE ANADEN AQUI Y NO EN EL REMITENTE porque cada una de las tres sale de una
-- tabla distinta -- `owners`, el propio movimiento y `share_links` -- y
-- resolverlas fuera serian tres viajes mas por cada recibo, cada uno con su
-- propio modo de fallar en silencio. Una consulta que ya hace el join es el
-- sitio barato.
--
-- ===========================================================================
-- LAS TRES, Y LO QUE TIENE CADA UNA
--
-- `business_display` es «Rosa (Bodega La Esquina)», precompuesto. Es UNA
-- variable y no dos a proposito (ver WHATSAPP-PLANTILLAS.md): el cliente no
-- conoce Sevenz, conoce a Rosa, y el nombre del negocio solo sirve si va
-- pegado al de la persona. Si el dueno no tiene nombre puesto, queda solo el
-- negocio -- nunca un parentesis vacio.
--
-- `new_balance` sale de `movements.running_balance`, que es el saldo DESPUES
-- de ese movimiento. No se recalcula: recalcularlo aqui seria una segunda
-- forma de contar el saldo, y dos formas acaban discrepando. Va en crudo; el
-- formato con su moneda lo pone el remitente, que es quien sabe en que pais
-- esta el negocio.
--
-- `share_token` PUEDE VENIR NULL, y eso no es un fallo: 43 de 214 clientes
-- nunca recibieron enlace (CT-1). El boton de la plantilla lo exige, asi que
-- el remitente tiene que crearlo antes de mandar -- y esta funcion no puede,
-- porque es `stable` y crear un token es escribir. Devolver null es decirle al
-- remitente «hazlo tu», que es mas honesto que inventar aqui una escritura
-- escondida dentro de una consulta.
-- ===========================================================================

begin;

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
  v_display text;
begin
  select
    mv.id,
    mv.client_id,
    mv.source,
    mv.deleted_at,
    mv.type,
    mv.amount,
    mv.currency,
    mv.running_balance,
    c.owner_id,
    c.name as client_name,
    c.whatsapp,
    c.trashed_at as client_trashed_at,
    o.business_name,
    o.first_name,
    -- SUBCONSULTA Y NO UN JOIN, con orden explicito. Hoy un cliente tiene un
    -- enlace como mucho, pero MS-9 existe para poder ROTARLO -- y el dia que
    -- se rote habra dos filas. Con un left join, `select into` se queda con
    -- una cualquiera sin avisar, y el mensaje saldria con el token viejo: el
    -- que MS-9 acaba de invalidar a proposito. El mas reciente es el vigente.
    (
      select sl.token
      from public.share_links sl
      where sl.client_id = c.id
      order by sl.created_at desc, sl.id desc
      limit 1
    ) as share_token
  into m
  from public.movements mv
  join public.clients c on c.id = mv.client_id
  join public.owners o on o.id = c.owner_id
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

  if not public.client_accepts_whatsapp(m.client_id) then
    return jsonb_build_object('ok', false, 'reason', 'no_consent');
  end if;

  -- «Rosa (Bodega La Esquina)», o solo el negocio si no hay nombre. Nunca un
  -- parentesis vacio ni un nombre suelto sin negocio.
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
    -- Null cuando el cliente nunca tuvo enlace (CT-1). El remitente lo crea.
    'share_token', m.share_token
  );
end;
$fn$;

comment on function public.movement_notice_target(uuid) is
  'Si este movimiento puede generar un aviso al cliente, y TODO lo que la plantilla necesita: client_name, amount, new_balance (el running_balance, sin recalcular), business_display precompuesto y share_token. La regla dura es MS-7: un movimiento con source distinto de manual NUNCA genera mensaje, da igual el permiso. share_token puede venir null -- 43 de 214 clientes nunca recibieron enlace -- y el remitente lo crea, porque esta funcion es stable y no puede escribir.';

revoke execute on function public.movement_notice_target(uuid) from public, anon, authenticated;
grant execute on function public.movement_notice_target(uuid) to service_role;

insert into public.schema_migrations (key, description)
values (
  '100_notice_target_trae_lo_que_el_mensaje_necesita',
  'movement_notice_target ya decia en su comentario que devuelve todo lo que el remitente necesita, y no era verdad del todo: le faltaban tres de las cinco variables de abono_confirmation_v2. Ahora trae business_display (Rosa (Bodega La Esquina), precompuesto, UNA variable y no dos porque el cliente no conoce Sevenz sino a Rosa; solo el negocio si el dueno no tiene nombre, nunca un parentesis vacio), new_balance (movements.running_balance, el saldo DESPUES del movimiento, sin recalcular porque dos formas de contar un saldo acaban discrepando; en crudo, el formato lo pone el remitente que sabe en que pais esta el negocio) y share_token. Se anaden aqui y no en el remitente porque cada una sale de una tabla distinta -- owners, el movimiento y share_links -- y resolverlas fuera serian tres viajes mas por recibo, cada uno con su propio modo de fallar en silencio. share_token PUEDE VENIR NULL y no es un fallo: 43 de 214 clientes nunca recibieron enlace (CT-1). El boton de la plantilla lo exige, asi que lo crea el remitente; esta funcion no puede porque es stable.'
)
on conflict (key) do nothing;

commit;
