-- 092_revoke_carries_source.sql
--
-- ENVIRONMENT: run on the DEV branch (vzqppwrwnmlbrxizskdh), where 091 has
-- already run and has broken the thing this fixes. Do NOT run against
-- production (rabmiyqodnvnrwiartuj): 081, 082 and 091 are not there either, so
-- this is meaningless on its own. When production does get them, these four
-- go in order -- 081, 082, 091, 092.
--
-- ===========================================================================
-- 091 BROKE THE WITHDRAWAL PATH. THIS PUTS IT BACK.
--
-- 091 made `client_whatsapp_consents.source` NOT NULL with no default, and
-- recreated `record_client_whatsapp_consent` to pass it. It did not touch
-- `revoke_client_whatsapp_consent`, which lives in 082 and inserts its
-- 'revoked' row WITHOUT a source -- so every withdrawal now fails with 23502.
--
-- Measured, not reasoned: `npm run qa:consent` went from green to 24/30 the
-- moment 091 ran in dev, and all six failures are the group that switches the
-- notices off and reads the state back.
--
-- HOW IT GOT MISSED, because the next person deserves better than "an
-- oversight". The whole withdrawal path is in a SEPARATE FILE. 081 creates the
-- table and the three functions that read and grant; 082 adds the one that
-- revokes, a day later. Reading 081 end to end -- which was done -- shows a
-- table whose check constraint allows 'revoked' and no function that ever
-- writes one, and that reads exactly like a gap in the design rather than
-- like a file that has not been opened.
--
-- THE LESSON IS ABOUT THE METHOD, NOT THE FILE. The conclusion "nothing writes
-- a revoked row" was drawn from reading one migration, when the question was
-- about a BEHAVIOUR, and a behaviour is spread across however many migrations
-- it took to build it. The cheap check that would have caught it in seconds is
-- the suite: `qa:consent` tests withdrawal explicitly and would have named the
-- function out loud. It was run AFTER writing 091 instead of before, which is
-- the wrong order when the migration changes a constraint that existing
-- writers have to satisfy.
--
-- WHY `client_self` IS THE RIGHT VALUE HERE. `source` answers "where was this
-- event collected". This function's only credential is the share token, so its
-- only caller is the client's own screen -- the same reason 091 hardcodes
-- `client_self` in the granting twin. A shopkeeper switching a client's
-- notices off from the ficha (MS-35) is a DIFFERENT collection point and must
-- not reuse this value; it needs a fourth one, `owner_client_profile`, added
-- by the migration that creates its function. It is deliberately NOT added
-- here: an enum value that nothing writes is a trap, because the next person
-- sees it available and assumes something already produces it.
-- ===========================================================================

begin;

drop function if exists public.revoke_client_whatsapp_consent(text);

create function public.revoke_client_whatsapp_consent(p_token text)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_client_id uuid;
  v_phone text;
  v_latest public.client_whatsapp_consents%rowtype;
begin
  select c.id, public.normalize_whatsapp_phone(c.whatsapp)
    into v_client_id, v_phone
  from public.share_links sl
  join public.clients c on c.id = sl.client_id
  where sl.token = p_token
    and c.trashed_at is null;

  if not found or v_phone is null then
    return false;
  end if;

  select * into v_latest
  from public.client_whatsapp_consents
  where phone = v_phone
  order by occurred_at desc, id desc
  limit 1;

  -- Nothing to switch off: never granted, or already revoked. Returns true
  -- because the caller asked for a state, not for an action, and that state
  -- holds. A double tap, or a retry after a dropped connection, must not write
  -- a second row -- the ledger is read as a history and a duplicate would read
  -- as two separate decisions.
  if not found or v_latest.event = 'revoked' then
    return true;
  end if;

  -- consent_text stays null: there is no sentence to evidence here. The check
  -- constraint in 081 only requires one for 'granted', for this reason.
  --
  -- `source` is the only line that changed from 082. It is not evidence the
  -- way consent_text is -- nobody has to prove a withdrawal happened -- but it
  -- answers the question MS-36's panel exists to ask, and asks it of the half
  -- that matters most: if one collection point produces grants that get
  -- withdrawn minutes later, that is the point to switch off.
  insert into public.client_whatsapp_consents (phone, event, via_client_id, source)
  values (v_phone, 'revoked', v_client_id, 'client_self');

  return true;
end;
$fn$;

comment on function public.revoke_client_whatsapp_consent(text) is
  'Records that the number behind this share token withdrew permission. Appends a row, never deletes the grant: that grant is the evidence covering the messages already sent. Always source = client_self -- the token is the credential, so the caller is the client''s own screen. Idempotent. Revokes for every shop, because the key is the phone. service_role only.';

revoke execute on function public.revoke_client_whatsapp_consent(text) from public, anon, authenticated;
grant execute on function public.revoke_client_whatsapp_consent(text) to service_role;

insert into public.schema_migrations (key, description)
values (
  '092_revoke_carries_source',
  'Arregla lo que rompio la 091. Al hacer source NOT NULL sin default, la 091 recreo record_client_whatsapp_consent para que lo pasara, pero NO toco revoke_client_whatsapp_consent, que vive en la 082 -- otro archivo -- e inserta su fila revoked sin source: toda baja fallaba con 23502. Medido, no razonado: qa:consent paso de verde a 24/30 en cuanto la 091 corrio en dev, y los seis fallos son el grupo que apaga los avisos. Como se escapo: el camino de la baja esta en una migracion aparte, asi que leer la 081 entera ensena una tabla cuyo check admite revoked y ninguna funcion que lo escriba, y eso se lee como un hueco del diseno y no como un archivo sin abrir. La leccion es del metodo: la pregunta era sobre un COMPORTAMIENTO y un comportamiento esta repartido entre tantas migraciones como hicieran falta para construirlo; la comprobacion barata era correr la suite ANTES de escribir la migracion, no despues. source = client_self porque la unica credencial de esta funcion es el token, o sea la pantalla del propio cliente. La baja que haga el tendero desde la ficha (MS-35) es otro punto de recogida y necesita un cuarto valor, owner_client_profile, que se anade en la migracion que cree SU funcion: un valor de enum que nadie escribe es una trampa, porque el siguiente lo ve disponible y supone que algo ya lo produce.'
)
on conflict (key) do nothing;

commit;
