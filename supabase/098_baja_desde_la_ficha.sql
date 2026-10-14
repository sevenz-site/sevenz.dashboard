-- 098_baja_desde_la_ficha.sql
--
-- ENVIRONMENT: run on the DEV branch (vzqppwrwnmlbrxizskdh). Do NOT run against
-- production (rabmiyqodnvnrwiartuj) until the user says to launch.
--
-- ===========================================================================
-- EL TENDERO PUEDE QUITARLE LOS AVISOS A UN CLIENTE
--
-- MS-35. META EXIGE HONRAR LA BAJA, y hoy el tendero no tiene donde hacerla.
-- El cliente si: su propio enlace tiene el modal de la 082. Pero quien recibe
-- el «ya no me mandes mas eso» es el tendero, en el mostrador, de viva voz --
-- y no tiene ningun sitio donde apuntarlo.
--
-- EL CUARTO VALOR DE `source`, que la 092 se nego a anadir a proposito. Decia:
-- «un valor de enum que nadie escribe es una trampa, porque el siguiente lo ve
-- disponible y supone que algo ya lo produce». Ahora si hay quien lo escriba,
-- asi que entra con su funcion, no antes.
--
-- `owner_client_profile` es un punto de recogida distinto de los otros dos del
-- tendero, y se separa por la misma razon que ellos: si un dia las bajas desde
-- la ficha se disparan, eso es una senal sobre esa pantalla concreta, no sobre
-- «los permisos» en general.
--
-- ===========================================================================
-- LA BAJA NO BORRA EL ALTA, Y ESO NO ES UN DETALLE
--
-- Se escribe una fila nueva con `event = 'revoked'`. El alta se queda, porque
-- es la evidencia que amparaba los mensajes YA ENVIADOS a esa persona:
-- borrarla al apagar destruiria justo la prueba que haria falta si alguien
-- pregunta por uno de ellos. El par se lee como historia -- alta el 9, baja el
-- 20 -- que es exactamente lo que ocurrio.
--
-- Y COMO LA CLAVE ES EL TELEFONO, la baja vale para todas las bodegas. Es la
-- consecuencia de la decision de la 081 y es la correcta: el permiso se le da
-- a Sevenz, que es el remitente en todas, no a una bodega. Si Pedro dice que
-- no quiere mas mensajes, no quiere mas mensajes.
-- ===========================================================================

begin;

-- ===========================================================================
-- 1. EL CUARTO ORIGEN
-- ===========================================================================

alter table public.client_whatsapp_consents
  drop constraint if exists client_whatsapp_consents_source_check;

alter table public.client_whatsapp_consents
  add constraint client_whatsapp_consents_source_check
  check (source in ('client_self', 'owner_movement_form', 'owner_import', 'owner_client_profile'));

comment on column public.client_whatsapp_consents.source is
  'Donde se recogio: client_self (el cliente lo toco en su propio enlace), owner_movement_form (el tendero lo declaro al registrar un movimiento), owner_import (al subir una libreta), owner_client_profile (desde la ficha del cliente, MS-35). Separados para poder medir cada punto de recogida contra su propia tasa de bloqueo.';

-- ===========================================================================
-- 2. EL ALTA ADMITE EL ORIGEN NUEVO
-- ===========================================================================
--
-- La firma no cambia, pero se dropea igual y se recrea: `create or replace` no
-- puede cambiar el nombre ni el tipo de un parametro, asi que el habito de
-- usarlo es lo que produce una segunda sobrecarga el dia que alguien lo haga.
drop function if exists public.record_owner_declared_whatsapp_consent(uuid, uuid, text, text);

create function public.record_owner_declared_whatsapp_consent(
  p_client_id uuid,
  p_owner_id uuid,
  p_consent_text text,
  p_source text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_sesion uuid := auth.uid();
  v_phone text;
  v_latest public.client_whatsapp_consents%rowtype;
begin
  if v_sesion is not null and v_sesion <> p_owner_id then
    return false;
  end if;

  if p_owner_id is null or p_client_id is null then
    return false;
  end if;

  -- `client_self` se sigue rechazando: un tendero no puede declarar que el
  -- cliente acepto en su propio telefono. Si pudiera, el camino debil
  -- escribiria la etiqueta fuerte y `source` dejaria de medir nada.
  if p_source is null
     or p_source not in ('owner_movement_form', 'owner_import', 'owner_client_profile') then
    return false;
  end if;

  if p_consent_text is null or btrim(p_consent_text) = '' then
    return false;
  end if;

  select public.normalize_whatsapp_phone(c.whatsapp)
    into v_phone
  from public.clients c
  where c.id = p_client_id
    and c.owner_id = p_owner_id
    and c.trashed_at is null;

  if not found or v_phone is null then
    return false;
  end if;

  select * into v_latest
  from public.client_whatsapp_consents
  where phone = v_phone
  order by occurred_at desc, id desc
  limit 1;

  if found
     and v_latest.event = 'granted'
     and v_latest.consent_text = p_consent_text then
    return true;
  end if;

  insert into public.client_whatsapp_consents (phone, event, consent_text, via_client_id, source)
  values (v_phone, 'granted', p_consent_text, p_client_id, p_source);

  return true;
end;
$fn$;

comment on function public.record_owner_declared_whatsapp_consent(uuid, uuid, text, text) is
  'Registra que un tendero declaro, en persona, que este cliente acepto recibir avisos. Bajo sesion, p_owner_id tiene que ser auth.uid(); bajo la clave de servicio se confia en el parametro, que es lo que la mantiene probable desde qa/. Rechaza source = client_self: solo el cliente puede producirlo. No reescribe un alta identica, asi que la casilla repetida es un no-op y una fila client_self nunca se degrada.';

revoke execute on function public.record_owner_declared_whatsapp_consent(uuid, uuid, text, text) from public, anon;
grant execute on function public.record_owner_declared_whatsapp_consent(uuid, uuid, text, text) to authenticated, service_role;

-- ===========================================================================
-- 3. LA BAJA
-- ===========================================================================
--
-- Hermana de `revoke_client_whatsapp_consent` (082), que es la del cliente y
-- va por token. Esta va por sesion del tendero, igual que su alta.
--
-- NO LLEVA `consent_text`: no hay frase que evidenciar aqui. Nadie tiene que
-- demostrar una baja -- el riesgo es no honrarla, no haberla inventado. El
-- check de la 081 solo exige texto para `granted`, por esta razon.
drop function if exists public.revoke_owner_declared_whatsapp_consent(uuid, uuid);

create function public.revoke_owner_declared_whatsapp_consent(
  p_client_id uuid,
  p_owner_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_sesion uuid := auth.uid();
  v_phone text;
  v_latest public.client_whatsapp_consents%rowtype;
begin
  if v_sesion is not null and v_sesion <> p_owner_id then
    return false;
  end if;

  if p_owner_id is null or p_client_id is null then
    return false;
  end if;

  select public.normalize_whatsapp_phone(c.whatsapp)
    into v_phone
  from public.clients c
  where c.id = p_client_id
    and c.owner_id = p_owner_id
    and c.trashed_at is null;

  if not found or v_phone is null then
    return false;
  end if;

  select * into v_latest
  from public.client_whatsapp_consents
  where phone = v_phone
  order by occurred_at desc, id desc
  limit 1;

  -- Nada que apagar: nunca acepto, o ya estaba de baja. Devuelve true porque
  -- el que llama pidio un ESTADO, no una accion, y ese estado se cumple. Un
  -- doble toque, o un reintento tras una conexion caida, no puede escribir una
  -- segunda fila: el ledger se lee como historia y un duplicado se leeria como
  -- dos decisiones distintas.
  if not found or v_latest.event = 'revoked' then
    return true;
  end if;

  insert into public.client_whatsapp_consents (phone, event, via_client_id, source)
  values (v_phone, 'revoked', p_client_id, 'owner_client_profile');

  return true;
end;
$fn$;

comment on function public.revoke_owner_declared_whatsapp_consent(uuid, uuid) is
  'El tendero le quita los avisos a un cliente desde su ficha (MS-35). Anade una fila, nunca borra el alta: esa alta es la evidencia que amparaba los mensajes ya enviados. Idempotente. Como la clave es el telefono, la baja vale para todas las bodegas -- el permiso se le da a Sevenz, que es el remitente en todas.';

revoke execute on function public.revoke_owner_declared_whatsapp_consent(uuid, uuid) from public, anon;
grant execute on function public.revoke_owner_declared_whatsapp_consent(uuid, uuid) to authenticated, service_role;

insert into public.schema_migrations (key, description)
values (
  '098_baja_desde_la_ficha',
  'MS-35: el tendero puede quitarle los avisos a un cliente desde su ficha. Meta exige honrar la baja y hasta hoy solo podia darsela el cliente, desde su propio enlace (082) -- pero quien recibe el "ya no me mandes mas eso" es el tendero, en el mostrador, de viva voz, y no tenia donde apuntarlo. Entra el cuarto valor de source, owner_client_profile, que la 092 se nego a anadir a proposito porque un valor de enum que nadie escribe es una trampa: ahora si hay quien lo escriba, asi que entra con su funcion. Se separa de los otros dos origenes del tendero por la misma razon que ellos: si un dia las bajas desde la ficha se disparan, eso es una senal sobre esa pantalla concreta. record_owner_declared_whatsapp_consent se recrea admitiendo el origen nuevo y sigue rechazando client_self. Y nace revoke_owner_declared_whatsapp_consent(client_id, owner_id), hermana de la del cliente pero por sesion: anade una fila revoked y NO borra el alta, porque esa alta es la evidencia que amparaba los mensajes ya enviados -- borrarla destruiria justo la prueba que haria falta si alguien pregunta por uno de ellos. No lleva consent_text porque no hay frase que evidenciar: nadie tiene que demostrar una baja, el riesgo es no honrarla. Idempotente. Como la clave es el telefono, la baja vale para todas las bodegas.'
)
on conflict (key) do nothing;

commit;
