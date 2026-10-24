-- 135. THE FORM CAN SAY THAT THIS NUMBER ALREADY HAS PERMISSION.
--
-- Reported from production on 2026-10-21 by an owner: a shopkeeper registered
-- him WITHOUT ticking the notifications box, he received the receipt for his
-- payment anyway, and the client's record showed the permission on.
--
-- ===========================================================================
-- NOTHING IS BROKEN. THE SCREEN IS SIMPLY NOT SAYING WHAT WILL HAPPEN.
--
-- The permission belongs to the NUMBER and not to the record -- the owner's
-- decision of 2026-10-10, from the «Pedro and Pedro's son share a phone» case,
-- and the sentence the client signs says it in the plural: «…en los negocios
-- donde tengo cuenta». So a number that ever accepted accepts for every record
-- carrying it, in any shop.
--
-- Measured in dev the same day: of 35 clients with a number, the app would
-- write to 2, and ONE of them was never asked on his own record -- he inherits
-- it from his phone. Six phones are shared by several records, one by NINE.
--
-- WHAT IS WRONG IS THAT THREE OF THE FOUR ENTRY FORMS SHOW AN UNTICKED BOX and
-- never look at the number. The shopkeeper leaves it alone, believes he turned
-- nothing on, and the client gets a message. The sale assistant already does
-- the right thing -- it shows «ya recibe notificaciones» instead of the box --
-- but `/clients/nuevo`, the search dialog and the step 4/4 form do not.
--
-- This function is what lets them. It answers the only question those screens
-- need while the number is still being typed: **may Sevenz write to this
-- number, and do I already know this person?**
--
-- ===========================================================================
-- THE NAME ONLY TRAVELS WHEN THE RECORD IS THE CALLER'S OWN
--
-- This is the part that decided the shape, and it is a privacy boundary, not a
-- convenience. The owner asked for the message to name the client -- «ya se
-- encuentra registrado a <nombre del cliente>». That is right when the record
-- is his: he is being reminded of someone he already has.
--
-- It would be wrong when the record belongs to ANOTHER shop. Returning the
-- name then would tell one shopkeeper that this phone is a customer of another
-- business, and under what name. Neither fact is his.
--
-- So the answer has two shapes and the screen writes a different sentence for
-- each:
--
--   granted + client_name  → «Ya lo tienes registrado como X, y ese número ya
--                            recibe notificaciones.»
--   granted, name null     → «Este número ya recibe notificaciones de Sevenz.»
--
-- The second says strictly less, and what it says is true and useful: the box
-- stays hidden and the shopkeeper is not promised silence that will not
-- happen.
--
-- ===========================================================================
-- IT ANSWERS FOR A RAW NUMBER, BECAUSE THAT IS WHAT THE SCREEN HAS
--
-- `client_accepts_whatsapp` takes a `client_id`, which the entry forms do not
-- have: the record does not exist yet. So this one takes what the shopkeeper
-- is typing and normalises it HERE, with the same function the ledger is keyed
-- by -- never in the browser, where a second normalisation would be a second
-- answer to «is this the same person».
--
-- A number that cannot be normalised answers `granted: false`, same as
-- everywhere else: a miss fails closed, and the box is shown. Being asked
-- twice is recoverable; a message nobody agreed to is not.
--
-- ===========================================================================
-- WHY IT IS NOT A SECOND COPY OF THE PREDICATE
--
-- `client_accepts_whatsapp` is still the only thing the SEND gate consults,
-- and nothing here changes it. This function answers a different question for
-- a different caller -- a phone with no record yet, instead of a record -- and
-- reads the same table with the same key, so the two cannot disagree about
-- whether a number consented.

begin;

create or replace function public.whatsapp_consent_for_phone(p_phone text)
returns json
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_phone text;
  v_granted boolean;
  v_name text;
begin
  -- NO SESSION, NO ANSWER. This is reached from the owner's own screens; an
  -- anonymous caller asking «does this number accept» would be a way to probe
  -- the ledger phone by phone.
  if auth.uid() is null then
    return json_build_object('granted', false, 'client_name', null);
  end if;

  v_phone := public.normalize_whatsapp_phone(p_phone);
  if v_phone is null then
    return json_build_object('granted', false, 'client_name', null);
  end if;

  select cc.event = 'granted' into v_granted
  from public.client_whatsapp_consents cc
  where cc.phone = v_phone
  order by cc.occurred_at desc, cc.id desc
  limit 1;

  -- THE NAME, ONLY FROM THE CALLER'S OWN LIVE RECORDS. See the header: the
  -- same number in another shop must not travel with a name attached.
  --
  -- The oldest one when there are several -- the shopkeeper most likely means
  -- the account he has been using, and a stable answer beats an arbitrary one
  -- that changes between two keystrokes.
  select c.name into v_name
  from public.clients c
  where c.owner_id = auth.uid()
    and c.trashed_at is null
    and c.deleted_at is null
    and public.normalize_whatsapp_phone(c.whatsapp) = v_phone
  order by c.created_at asc
  limit 1;

  return json_build_object(
    'granted', coalesce(v_granted, false),
    'client_name', v_name
  );
end;
$fn$;

-- `authenticated` ONLY, never `anon`. Postgres grants EXECUTE to PUBLIC by
-- default, so the revoke is not decoration -- the same thing `126` had to fix
-- after `qa:abono-dirigido` caught it on its first run.
revoke execute on function public.whatsapp_consent_for_phone(text) from public, anon;
grant execute on function public.whatsapp_consent_for_phone(text) to authenticated;

comment on function public.whatsapp_consent_for_phone(text) is
  'Para los formularios de alta: dado un numero TAL COMO SE ESTA TECLEANDO, dice si Sevenz ya puede escribirle y, SOLO si hay una ficha viva del propio tendero con ese numero, el nombre de esa ficha. El nombre nunca sale de otra bodega: eso le diria a un tendero que ese telefono es cliente de otro negocio y con que nombre figura alli. Normaliza aqui, con la misma funcion por la que esta indexado el registro de consentimientos, asi que no puede discrepar de la puerta de envio sobre si un numero acepto.';

insert into public.schema_migrations (key, description)
values (
  '135_el_numero_ya_tiene_permiso',
  'whatsapp_consent_for_phone(numero): para que los formularios de alta puedan decir que ese numero YA tiene las notificaciones activadas, y de quien es si es una ficha del propio tendero. Nace de un reporte de produccion del 2026-10-21: un tendero registro a un cliente SIN marcar la casilla, el cliente recibio igual el recibo de su abono, y la ficha mostraba el permiso encendido. NO ESTABA ROTO NADA: el permiso es del NUMERO y no de la ficha --decision del dueno del 2026-10-10, por el caso de Pedro y el hijo de Pedro compartiendo telefono-- y la frase que firma el cliente dice en plural «en los negocios donde tengo cuenta». Medido en dev ese dia: de 35 clientes con numero la app escribiria a 2, y a UNO de ellos nunca se le pregunto en su ficha; hay 6 telefonos compartidos por varias fichas, uno por NUEVE. Lo que estaba mal era la pantalla: el asistente de venta ya ensena «ya recibe notificaciones» en vez de la casilla, pero /clients/nuevo, el buscador y el paso 4/4 ensenaban la casilla desmarcada sin mirar el numero, asi que el tendero creia que no activaba nada. EL NOMBRE SOLO VIAJA SI LA FICHA ES DEL QUE PREGUNTA, y eso es una frontera de privacidad y no una comodidad: devolverlo cuando la ficha es de otra bodega le diria a un tendero que ese telefono es cliente de otro negocio y con que nombre figura. Sin ficha propia la respuesta dice menos y sigue siendo util: el numero acepta, la casilla se esconde, y a nadie se le promete un silencio que no va a ocurrir. Recibe el numero EN BRUTO porque la ficha todavia no existe cuando el tendero lo teclea, y normaliza aqui con la misma funcion por la que esta indexado el registro, asi que no puede discrepar de la puerta de envio. Un numero ilegible responde que no acepta: fallar cerrado ensena la casilla, y que te pregunten dos veces se arregla, un mensaje que nadie acepto no.'
)
on conflict (key) do nothing;

commit;
