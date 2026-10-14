-- 091_client_consent_source.sql
--
-- ENVIRONMENT: run first on the DEV branch (vzqppwrwnmlbrxizskdh). Do NOT run
-- against production (rabmiyqodnvnrwiartuj) until the user says to launch.
-- Production does not have 081 either, so these two travel together: 081 first,
-- then this one. Running this alone against production fails on a table that
-- is not there.
--
-- ===========================================================================
-- WHERE EACH PERMISSION CAME FROM, AND THE SHOPKEEPER'S WAY OF WRITING ONE
--
-- Decision by the owner on 2026-10-10 (MS-4, MS-34). Until today the only way
-- a client could grant permission was to open their own share link and tap
-- Accept. That path is built (081) and it is the strongest evidence there is,
-- because the client did it themselves -- but on its own it can produce ZERO
-- recipients: 43 of 214 clients have never been sent a link at all (CT-1).
--
-- So permission also gets collected IN PERSON, by the shopkeeper, at the exact
-- moment they hand over the fiado and the client is standing there. Meta does
-- not require a particular channel; it requires consent that is the
-- recipient's, affirmative and demonstrable, and an in-person opt-in that is
-- recorded qualifies.
--
-- THE TWO ARE NOT EQUALLY STRONG, AND THAT IS WHY `source` EXISTS.
--
-- `client_self` is the client's own tap. `owner_movement_form` and
-- `owner_import` are a THIRD PARTY asserting that the client said yes. They
-- are legitimate and they will produce most of the rows, but they are a
-- different kind of proof, and the owner asked for three values rather than
-- two so each collection point can be measured on its own.
--
-- The reason is operational, not bureaucratic: if one origin turns out to be
-- blocked at 8% and another at 0.3%, that is a decision somebody can act on --
-- switch one off and keep the other. Stored as a single boolean, or not stored
-- at all, that question has no answer, ever, and the only way to get one back
-- is to start collecting from scratch.
--
-- WHAT IS DELIBERATELY NOT STORED: which owner declared it. `via_client_id`
-- already reaches the owner through `clients.owner_id`, and clients are soft
-- deleted (`trashed_at`), so that path does not evaporate in practice. A
-- second column would be the same fact twice, and two copies of a fact are an
-- invitation for them to disagree.
--
-- ===========================================================================

begin;

-- ===========================================================================
-- 1. THE COLUMN
-- ===========================================================================
--
-- NO DEFAULT, AND NOT NULL. A default would make a forgotten `source` quietly
-- become a wrong answer -- rows claiming the client accepted in person when
-- nobody knows who accepted. Without one, an insert that forgets it fails
-- loudly, which is what should happen to a row whose provenance is unknown.
--
-- English values in the database, per CLAUDE.md: a check-constrained string in
-- a production column costs far more to rename than a variable does.
--
-- THE ORDER OF THE NEXT FOUR STATEMENTS IS THE WHOLE POINT. `add constraint`
-- evaluates the rows that are already there, so a check added before the
-- backfill fails with 23514 on any pre-existing row. That is not theoretical:
-- it is exactly how 087 failed on 2026-10-10, in dev, which is where it was
-- supposed to fail.
alter table public.client_whatsapp_consents
  add column if not exists source text;

-- Every row that exists today was written by `record_client_whatsapp_consent`,
-- whose only caller is the modal on /s/[token]. So they are all the client's
-- own tap, and this is a statement of fact rather than a guess. In dev the
-- table holds zero rows and this is a no-op; it is written correctly anyway,
-- because the day it is not a no-op is the day it matters.
update public.client_whatsapp_consents
set source = 'client_self'
where source is null;

alter table public.client_whatsapp_consents
  drop constraint if exists client_whatsapp_consents_source_check;

alter table public.client_whatsapp_consents
  add constraint client_whatsapp_consents_source_check
  check (source in ('client_self', 'owner_movement_form', 'owner_import'));

alter table public.client_whatsapp_consents
  alter column source set not null;

comment on column public.client_whatsapp_consents.source is
  'Where this permission was collected: client_self (the client tapped Accept on their own share link), owner_movement_form (the shopkeeper declared it while registering a movement), owner_import (the shopkeeper declared it on a person detail while uploading a libreta). Kept apart so each collection point can be measured against its own block rate.';

-- Answering "how did the permissions break down" is a scan of the whole table
-- by source, which is MS-36's panel. Small table, admin-only, runs once a page
-- load: no index. Added when it is slow, not before.

-- ===========================================================================
-- 2. THE EXISTING WRITER HAS TO LEARN THE COLUMN -- OR IT BREAKS
-- ===========================================================================
--
-- THIS IS NOT OPTIONAL AND IT IS EASY TO MISS. A not-null column with no
-- default makes the INSERT inside `record_client_whatsapp_consent` fail with
-- 23502, which would take down the ONE path that already works today -- the
-- client's own Accept button, shipped and verified in dev on 2026-10-09.
--
-- So the column and this function ship in the same file. Splitting them into
-- two migrations leaves a window, however short, where /s/[token] silently
-- refuses every acceptance.
--
-- The signature does not change, so `create or replace` would be enough. It is
-- dropped and recreated anyway, for the reason CLAUDE.md gives: `create or
-- replace` cannot change a parameter's type or name, so the habit of reaching
-- for it is what produces a second overload the day someone does. One drop
-- line and not two because this signature is the only one that has ever
-- existed -- there is no older shape to clean up.
--
-- Dropping a function drops its grants with it, which is why the revoke/grant
-- pair below is repeated rather than assumed.
drop function if exists public.record_client_whatsapp_consent(text, text);

create function public.record_client_whatsapp_consent(
  p_token text,
  p_consent_text text
)
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
  if p_consent_text is null or btrim(p_consent_text) = '' then
    return false;
  end if;

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

  -- Already granted under this exact wording. Tapping Accept twice, or a
  -- double submit, must not write a second row -- the ledger is evidence and
  -- a duplicate makes it look like two separate decisions.
  if found
     and v_latest.event = 'granted'
     and v_latest.consent_text = p_consent_text then
    return true;
  end if;

  insert into public.client_whatsapp_consents (phone, event, consent_text, via_client_id, source)
  values (v_phone, 'granted', p_consent_text, v_client_id, 'client_self');

  return true;
end;
$fn$;

comment on function public.record_client_whatsapp_consent(text, text) is
  'Records that the number behind this share token granted permission, storing the sentence the caller displayed. Always source = client_self: the only caller is the modal the client taps themselves. service_role only: the text must come from the server constant, never from the browser. False for an unknown token or a client with no usable number.';

revoke execute on function public.record_client_whatsapp_consent(text, text) from public, anon, authenticated;
grant execute on function public.record_client_whatsapp_consent(text, text) to service_role;

-- ===========================================================================
-- 3. THE SHOPKEEPER'S WAY OF WRITING ONE
-- ===========================================================================
--
-- A SEPARATE FUNCTION, NOT A FOURTH PARAMETER ON THE ONE ABOVE. The two paths
-- authenticate through completely different things and neither credential can
-- stand in for the other:
--
--   - The client's path proves nothing about who is calling. Its credential is
--     the share token, which is also the credential for the page itself.
--   - This path has no token at all. Its credential is the authenticated
--     owner, and `p_client_id` arrives FROM THE BROWSER.
--
-- WHICH IS WHY `p_owner_id` IS CHECKED HERE AND NOT ONLY IN THE SERVER ACTION.
-- CLAUDE.md requires the explicit ownership check in code; this is the second
-- layer, not a replacement for it. RLS cannot be that layer: this function is
-- SECURITY DEFINER and the table has zero policies by design, so RLS is not
-- watching anything here. Without the `owner_id` predicate below, any signed-in
-- shopkeeper could pass another shop's client id and write a permission for a
-- stranger's phone number.
--
-- `p_owner_id` comes from `auth.getUser()` in the server action, never from the
-- request body. It is not read from `auth.uid()` because the caller holds the
-- service key, under which `auth.uid()` is null -- the same reason
-- `record_movement_rejection` cannot be exercised by the qa/ scripts.
--
-- Returns false rather than raising, matching its sibling: the caller turns a
-- false into one sentence for the shopkeeper. There is no information in
-- WHICH check failed that the shopkeeper can act on, and telling them "that
-- client is not yours" would confirm the id exists.
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
  v_phone text;
  v_latest public.client_whatsapp_consents%rowtype;
begin
  -- `client_self` is rejected on purpose. A shopkeeper cannot declare that the
  -- client accepted on their own device, and allowing it here would let the
  -- strongest label be written by the weakest path -- which would quietly
  -- destroy the only reason the column exists.
  if p_source is null or p_source not in ('owner_movement_form', 'owner_import') then
    return false;
  end if;

  if p_consent_text is null or btrim(p_consent_text) = '' then
    return false;
  end if;

  if p_client_id is null or p_owner_id is null then
    return false;
  end if;

  select public.normalize_whatsapp_phone(c.whatsapp)
    into v_phone
  from public.clients c
  where c.id = p_client_id
    and c.owner_id = p_owner_id
    and c.trashed_at is null;

  -- Not found covers both "no such client" and "not yours", and they are
  -- deliberately indistinguishable from the outside.
  if not found or v_phone is null then
    return false;
  end if;

  select * into v_latest
  from public.client_whatsapp_consents
  where phone = v_phone
  order by occurred_at desc, id desc
  limit 1;

  -- Same idempotence rule as the client's path, and it carries more weight
  -- here: this checkbox sits in a screen the shopkeeper uses many times a day,
  -- so the same permission WILL be declared again and again for the same
  -- person. Each repeat must be a no-op, or the ledger fills with duplicates
  -- that read as a person who kept being asked and kept agreeing.
  --
  -- NOTE THAT IT COMPARES AGAINST THE LATEST ROW WHATEVER ITS SOURCE. If the
  -- client already accepted on their own link, the shopkeeper ticking the box
  -- writes nothing and the stronger `client_self` row stands. That is the
  -- right way round: this must never be able to downgrade existing evidence.
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
  'Records that a shopkeeper declared, in person, that this client agreed to receive WhatsApp notices. Verifies the client belongs to p_owner_id -- p_client_id comes from the browser. Rejects source = client_self: only the client can produce that. Never overwrites an existing identical grant, so a repeated checkbox is a no-op and a stronger client_self row is never downgraded. False for a client that is not theirs, has no usable number, or an empty sentence.';

revoke execute on function public.record_owner_declared_whatsapp_consent(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_owner_declared_whatsapp_consent(uuid, uuid, text, text) to service_role;

insert into public.schema_migrations (key, description)
values (
  '091_client_consent_source',
  'MS-34: de donde salio cada permiso de WhatsApp, y la via para que lo escriba el tendero. client_whatsapp_consents gana source not null con tres valores -- client_self, owner_movement_form, owner_import -- porque el permiso que se da uno mismo y el que declara un tercero no son la misma prueba, y a peticion del dueno cada punto de recogida tiene que poder medirse contra su propia tasa de bloqueo; con un booleano esa pregunta no tiene respuesta nunca. Sin default y not null: un default convertiria un source olvidado en una respuesta falsa en vez de un error. La columna OBLIGA a recrear record_client_whatsapp_consent en el mismo archivo -- su insert fallaria con 23502 y tumbaria el unico camino que hoy funciona, el boton Aceptar del cliente. Y nace record_owner_declared_whatsapp_consent(client_id, owner_id, texto, source), que comprueba owner_id explicitamente porque client_id llega del navegador y RLS no vigila nada aqui (security definer, cero politicas): sin ese predicado cualquier tendero escribiria un permiso para el telefono de un desconocido. Rechaza client_self, para que el camino debil no pueda escribir la etiqueta fuerte, y no reescribe un grant identico, asi que la casilla repetida es un no-op y una fila client_self nunca se degrada. NO incluye la baja: no existe funcion que escriba un evento revoked por ningun camino, ni para el cliente ni para el tendero, y Meta exige honrarla -- es MS-35.'
)
on conflict (key) do nothing;

commit;

-- ===========================================================================
-- VERIFICATION (run separately, after the commit above, in DEV)
-- ===========================================================================
--
--   -- The column exists, is not null, and the check holds the three values.
--   select column_name, is_nullable, data_type
--   from information_schema.columns
--   where table_schema = 'public'
--     and table_name = 'client_whatsapp_consents'
--     and column_name = 'source';
--
--   -- EXPECTED: one row, is_nullable = NO.
--
--   -- Nobody but the server can call either writer.
--   select p.proname,
--          has_function_privilege('anon', p.oid, 'execute')          as anon,
--          has_function_privilege('authenticated', p.oid, 'execute') as sesion,
--          has_function_privilege('service_role', p.oid, 'execute')  as servidor
--   from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public'
--     and p.proname in ('record_client_whatsapp_consent',
--                       'record_owner_declared_whatsapp_consent');
--
--   -- EXPECTED: two rows, false / false / true on both.
