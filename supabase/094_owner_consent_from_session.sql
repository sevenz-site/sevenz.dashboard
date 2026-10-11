-- 094_owner_consent_from_session.sql
--
-- ENVIRONMENT: run on the DEV branch (vzqppwrwnmlbrxizskdh). Do NOT run against
-- production (rabmiyqodnvnrwiartuj) until the user says to launch. Order there,
-- when it happens: 081, 082, 091, 092, 093, 094.
--
-- ===========================================================================
-- EL TENDERO LLAMA CON SU SESION, NO CON LA CLAVE DE SERVICIO
--
-- `record_owner_declared_whatsapp_consent` nacio en la 091 copiando la forma
-- de su hermana `record_client_whatsapp_consent`: cuatro parametros y permiso
-- solo para `service_role`. Y esa copia estaba mal, por una razon que no se ve
-- leyendo las dos funciones una al lado de la otra:
--
--   - La del CLIENTE se llama desde /s/[token], que no tiene sesion de nadie.
--     Por fuerza usa el cliente de servicio.
--   - La del TENDERO se llama desde `addMovement`, que SI tiene sesion -- y
--     usa el cliente de sesion, como todo el resto de esa accion.
--
-- Sintoma medido el 2026-10-10 guardando un fiado real en dev:
-- `permission denied for function record_owner_declared_whatsapp_consent`, en
-- el log del servidor y en ningun otro sitio. La pantalla guardo el fiado, no
-- enseno ningun error, y el permiso no se escribio. Exactamente el fallo
-- silencioso que esta funcion existe para evitar.
--
-- ===========================================================================
-- POR QUE NO BASTA CON DAR EL GRANT A `authenticated`
--
-- Ese era el arreglo de una linea, y abre un agujero. La funcion se CREE
-- `p_owner_id`: solo comprueba que el cliente pertenezca a ese uuid. Mientras
-- el unico que puede llamarla es nuestro servidor, el parametro sale de
-- `auth.getUser()` y es de fiar. En cuanto cualquier sesion puede llamarla, el
-- parametro lo elige quien llama, y un tendero podria pasar el id de un
-- cliente de OTRA bodega junto al uuid de SU dueno -- las dos cosas casan
-- entre si, la comprobacion pasa, y queda escrito un permiso a nombre del
-- telefono de un desconocido.
--
-- LA DEFENSA ES `auth.uid()`, que sale del JWT y no se puede inventar. Con la
-- sesion de un tendero, `p_owner_id` deja de ser una afirmacion y pasa a tener
-- que COINCIDIR con quien esta llamando.
--
-- Y SE QUEDA COMO PARAMETRO en vez de leerse solo de `auth.uid()`, que seria
-- lo mas corto, por una razon concreta: bajo la clave de servicio `auth.uid()`
-- es null, asi que una funcion que solo lo leyera de ahi seria IMPOSIBLE DE
-- PROBAR desde los scripts de qa/ -- es el problema que el checklist ya
-- documenta para `record_movement_rejection`, cuya telemetria nadie ha visto
-- funcionar nunca. Aqui el parametro se conserva y la comprobacion solo se
-- aplica cuando hay sesion, asi que `npm run qa:consent` sigue ejercitando la
-- funcion de verdad y la sesion de un tendero sigue sin poder mentir.
--
-- La frontera, dicha claro: quien tenga la clave de servicio puede escribir lo
-- que quiera, y eso ya era cierto de toda la base. Lo que esta migracion cierra
-- es lo que puede hacer una SESION, que es lo que esta expuesto al mundo.
--
-- SE CAMBIA LA FIRMA (4 parametros -> 3), asi que se dropean LAS DOS: la vieja
-- que existe antes de correr esto, y la nueva que crea. Dropear solo la vieja
-- hace que el archivo funcione exactamente una vez -- la segunda vez el drop
-- no encuentra nada y el create falla con 42723. Es la regla de CLAUDE.md y es
-- justo el caso que la motiva.
-- ===========================================================================

begin;

-- La firma NO cambia de forma (sigue siendo de 4), pero se dropea tambien la
-- de 3 por si alguna vez existio: un drop de mas no cuesta nada y un drop de
-- menos hace fallar el segundo pase con 42723.
drop function if exists public.record_owner_declared_whatsapp_consent(uuid, uuid, text, text);
drop function if exists public.record_owner_declared_whatsapp_consent(uuid, text, text);

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
  v_owner_id uuid := p_owner_id;
  v_phone text;
  v_latest public.client_whatsapp_consents%rowtype;
begin
  -- EL CANDADO. Con sesion, `p_owner_id` deja de ser una afirmacion: tiene que
  -- ser quien esta llamando. Sin sesion (clave de servicio) se confia en el
  -- parametro, que es lo que mantiene la funcion ejercitable desde qa/.
  if v_sesion is not null and v_sesion <> p_owner_id then
    return false;
  end if;

  if v_owner_id is null then
    return false;
  end if;

  -- `client_self` se rechaza a proposito: un tendero no puede declarar que el
  -- cliente acepto en su propio telefono. Si pudiera, el camino debil
  -- escribiria la etiqueta fuerte y la columna `source` dejaria de medir nada.
  if p_source is null or p_source not in ('owner_movement_form', 'owner_import') then
    return false;
  end if;

  if p_consent_text is null or btrim(p_consent_text) = '' then
    return false;
  end if;

  if p_client_id is null then
    return false;
  end if;

  -- LA COMPROBACION DE PROPIEDAD. `p_client_id` llega del navegador y aqui RLS
  -- no vigila nada: security definer sobre una tabla con cero politicas. La
  -- accion de servidor hace ademas su comprobacion explicita, como pide
  -- CLAUDE.md; esta es la segunda capa, y es la que sigue en pie si alguien se
  -- olvida de la primera.
  select public.normalize_whatsapp_phone(c.whatsapp)
    into v_phone
  from public.clients c
  where c.id = p_client_id
    and c.owner_id = v_owner_id
    and c.trashed_at is null;

  -- "No existe" y "no es tuyo" son indistinguibles desde fuera, a proposito:
  -- distinguirlos confirmaria que ese id existe.
  if not found or v_phone is null then
    return false;
  end if;

  select * into v_latest
  from public.client_whatsapp_consents
  where phone = v_phone
  order by occurred_at desc, id desc
  limit 1;

  -- La casilla vive en una pantalla que el tendero usa muchas veces al dia, y
  -- el mismo permiso se va a declarar una y otra vez por la misma persona.
  -- Cada repeticion tiene que ser un no-op, o el ledger se llena de duplicados
  -- que se leen como alguien a quien preguntaron muchas veces.
  --
  -- Compara contra la ultima fila SEA CUAL SEA SU ORIGEN: si el cliente ya
  -- acepto por su propio enlace, esto no escribe nada y la fila `client_self`
  -- se queda. Es el sentido correcto -- esto nunca puede degradar una
  -- evidencia mas fuerte.
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
  'Records that the signed-in shopkeeper declared, in person, that this client agreed to receive WhatsApp notices. Under a session, p_owner_id must equal auth.uid(), so a session cannot write for another shop; under the service key the parameter is trusted, which is what keeps it testable; p_client_id arrives from the browser and is checked against it. Rejects source = client_self: only the client can produce that. Never overwrites an existing identical grant, so a repeated checkbox is a no-op and a stronger client_self row is never downgraded.';

-- `authenticated` SI, porque la llama la sesion del tendero. `anon` NO: el
-- mundo entero es anon, y aunque la funcion falle cerrada sin `auth.uid()`, no
-- hay ninguna razon para que pueda siquiera intentarlo.
revoke execute on function public.record_owner_declared_whatsapp_consent(uuid, uuid, text, text) from public, anon;
grant execute on function public.record_owner_declared_whatsapp_consent(uuid, uuid, text, text) to authenticated, service_role;

insert into public.schema_migrations (key, description)
values (
  '094_owner_consent_from_session',
  'Arregla lo que la 091 dejo inservible. record_owner_declared_whatsapp_consent nacio copiando la forma de su hermana del cliente: cuatro parametros y grant solo a service_role. Pero la del cliente se llama desde /s/[token], que no tiene sesion y por fuerza usa la clave de servicio, mientras que esta la llama addMovement, que SI tiene sesion y usa el cliente de sesion. Medido el 2026-10-10 guardando un fiado real en dev: permission denied en el log del servidor y en ningun otro sitio -- el fiado se guardo, la pantalla no enseno ningun error y el permiso no se escribio. No basta con dar el grant a authenticated: la funcion se CREE p_owner_id, asi que cualquier sesion podria pasar el id de un cliente de otra bodega junto al uuid de SU dueno, las dos cosas casan, y quedaria escrito un permiso para el telefono de un desconocido. Ahora el dueno sale de auth.uid(), que viene del JWT y no se puede inventar. Se conserva como parametro -- y no se lee solo de auth.uid() -- porque bajo la clave de servicio auth.uid() es null y la funcion seria imposible de probar desde qa/, que es el problema que el checklist ya documenta para record_movement_rejection; la comprobacion solo aplica cuando hay sesion. Se dropean las dos firmas posibles por la regla de CLAUDE.md: un drop de mas no cuesta nada y uno de menos hace que el archivo funcione exactamente una vez.'
)
on conflict (key) do nothing;

commit;
