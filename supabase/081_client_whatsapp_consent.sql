-- 081_client_whatsapp_consent.sql
--
-- ENVIRONMENT: run first on the DEV branch (vzqppwrwnmlbrxizskdh). Do NOT run
-- against production (rabmiyqodnvnrwiartuj) until the modal on /s/[token] is
-- built and the user has said to launch.
--
-- WHERE THE FINAL CUSTOMER'S PERMISSION LIVES. Ticket MS-25, which blocks
-- MS-3 (phase 3: Sevenz writing to the client, not to the shopkeeper).
--
-- This is the twin of 065, which did the same job for the owner. Same reason
-- the text is stored next to the date, and the comment there explains it: Meta
-- requires collecting consent outside WhatsApp and being able to evidence it,
-- and a timestamp alone is not evidence, because the sentence on screen will
-- change and what has to be shown a year from now is what THAT person read.
--
-- ===========================================================================
-- WHY THIS IS A TABLE KEYED BY PHONE, AND NOT THREE COLUMNS ON `clients`
--
-- MS-25 was written asking for three columns on `clients`. Owner's decision,
-- 2026-10-09, after measuring that the case the ticket had not considered is
-- real: THE SAME PHONE NUMBER EXISTS UNDER TWO DIFFERENT OWNERS (1 of 14
-- distinct numbers in dev). One person can be a customer of two shops, which
-- is two `clients` rows, two tokens, two modals.
--
-- The permission is granted to SEVENZ, which is the sender in both cases --
-- not to the shop. So it is stored once per person and covers every shop they
-- owe money to, present and future.
--
-- WHAT THE OWNER ACCEPTED ALONG WITH IT, stated here because it is the cost of
-- the choice and not an oversight: the phone number is typed by the
-- shopkeeper. If a typo lands on a number that ALREADY granted permission
-- (because that other person is a Sevenz customer somewhere else), the wrong
-- number inherits a stranger's consent and a stranger receives this client's
-- balance. It needs the mistyped digits to match a consented number exactly,
-- so it is remote -- but it is not impossible, and it is the one scenario this
-- design makes worse than per-shop consent would. See PENDIENTES MS-30.
--
-- ===========================================================================
-- THE PROPERTY THAT COMES FOR FREE: AN EDITED NUMBER EXPIRES THE PERMISSION
--
-- Second decision of 2026-10-09: if the shopkeeper changes a client's phone
-- AFTER that client accepted, the permission must stop applying and the modal
-- must come back.
--
-- Keying by phone gives this with no extra column. Change the number and the
-- lookup key changes, finds nothing, and `client_accepts_whatsapp()` returns
-- false. The old consent row stays untouched, which is correct -- it is still
-- true that THAT number consented on that day.
--
-- It closes a real leak. If the edit was a typo correction, the number that
-- was there before may belong to someone else entirely, and that someone would
-- have received this client's debt. That is both a data leak and an almost
-- certain report to Meta, which costs every owner on the platform at once
-- because quality rating is measured per NUMBER and Sevenz has one.
--
-- ===========================================================================
-- APPEND-ONLY, AND WHY IT IS NOT ONE ROW PER PERSON
--
-- 065 overwrites: accepting again replaces `whatsapp_opt_in_at` and
-- `whatsapp_opt_in_text`. That is wrong for the only purpose these rows have.
-- Someone who accepts, revokes and accepts again under a newer wording would
-- lose the first text -- and the first text is precisely the one worth
-- questioning, because it is the one the messages already sent went out under.
--
-- So each accept and each revoke is its own row, and the current state is the
-- latest row for that phone. The cost is one index and a `limit 1`.
--
-- ===========================================================================
-- WHAT A CLIENT WITH NO STORED NUMBER CAN DO: NOTHING, ON PURPOSE
--
-- The key IS the number, so a client whose `whatsapp` is null cannot consent.
-- `client_whatsapp_consent_state()` reports that, and the modal must not be
-- shown to them -- a modal whose "Accept" stores nothing is worse than no
-- modal. In dev, 30 of 66 live clients have a number at all.
--
-- The shopkeeper adds the number, the client opens their link again, and then
-- the modal appears. Every failure in this design points the same way: no
-- permission found means nothing is sent.

begin;

-- ===========================================================================
-- 1. NORMALIZING A PHONE NUMBER, IN ONE PLACE
-- ===========================================================================
--
-- This function is the key of the whole design, so it is deliberately dull.
--
-- Verified against dev on 2026-10-09 before writing it: all 34 client numbers
-- are stored as exactly 12 digits, no plus sign, no separators, country code
-- included (57 or 58) -- which is what `components/whatsapp-input.tsx` writes,
-- dial code concatenated with the local part. So stripping non-digits is
-- enough and no country has to be inferred. That matters, because the country
-- of the NUMBER is not the country of the owner: 16 clients of Venezuelan
-- owners carry Colombian prefixes.
--
-- Leading zeros are dropped as well. `owners.whatsapp` proves the stored shape
-- is not guaranteed -- 2 of 13 owner numbers in dev start with a plus sign,
-- which the comment in lib/whatsapp/kapso.ts asserts cannot happen -- and a
-- valid number with a country code never begins with 0. In Venezuela,
-- Colombia, Peru and Chile the 0 is a trunk prefix you dial inside the
-- country, the same reason lib/phone.ts strips it.
--
-- IMMUTABLE so it can be used in an index later, and STRICT so null in gives
-- null out instead of a key of the empty string.
--
-- A number this function cannot make sense of returns null, and every caller
-- treats null as "no permission". Getting normalization wrong therefore fails
-- CLOSED: the modal reappears and nothing is sent. The opposite default would
-- send a stranger someone else's balance.
create or replace function public.normalize_whatsapp_phone(p_raw text)
returns text
language sql
immutable
strict
as $fn$
  select case when length(d) between 10 and 15 then d else null end
  from (select ltrim(regexp_replace(p_raw, '[^0-9]', '', 'g'), '0') as d) s;
$fn$;

comment on function public.normalize_whatsapp_phone(text) is
  'Digits only, no leading zeros, null when it cannot be a country-coded number (10-15 digits). The key of client_whatsapp_consents. Null means "no permission" to every caller, so a normalization miss fails closed.';

-- ===========================================================================
-- 2. THE LEDGER
-- ===========================================================================

create table if not exists public.client_whatsapp_consents (
  id uuid primary key default gen_random_uuid(),

  -- Normalized by the function above, never by the caller. Not a foreign key
  -- to anything: the permission belongs to the person, and the `clients` rows
  -- that person appears in come and go.
  phone text not null,

  -- English values in the database, per CLAUDE.md: a check-constrained string
  -- in a production column is far more expensive to rename than a variable.
  event text not null check (event in ('granted', 'revoked')),

  occurred_at timestamptz not null default now(),

  -- The literal sentence that was on screen. THE evidence, which is why it is
  -- mandatory when granting and meaningless when revoking.
  consent_text text,

  -- Which share link it was granted through, for answering "where did this
  -- come from". `on delete set null` and not cascade: if the client row is
  -- deleted the provenance is lost but THE CONSENT IS NOT -- deleting a client
  -- must never delete the proof that a number agreed to be messaged.
  via_client_id uuid references public.clients (id) on delete set null,

  constraint client_whatsapp_consents_text_required
    check (event <> 'granted' or consent_text is not null)
);

-- The only hot query: the latest row for one phone.
create index if not exists client_whatsapp_consents_phone_idx
  on public.client_whatsapp_consents (phone, occurred_at desc);

alter table public.client_whatsapp_consents enable row level security;

-- RLS on, ZERO policies, no grants to anon or authenticated. Same shape as
-- whatsapp_sends and movement_rejections: only the server writes and reads
-- this, through the SECURITY DEFINER functions below.
--
-- It matters more here than there. The rows are a list of phone numbers of
-- people who are not Sevenz users and never agreed to be listed anywhere, so
-- a policy letting a session read it would hand one shopkeeper the phone
-- numbers of another shop's customers.
--
-- And no direct read with the service key either: production revokes SELECT
-- from service_role on the customer tables and the dev branch does not, so a
-- direct read passes in dev and 500s in production. That is the 2026-09-05
-- outage, and `npm run qa:service-role` fails on it.

-- ===========================================================================
-- 3. THE SEND GATE'S SINGLE SOURCE OF TRUTH
-- ===========================================================================
--
-- One function, so the staleness rule lives once. When MS-21 generalizes the
-- send gate it calls this instead of re-deriving it -- two copies of this
-- predicate would eventually disagree, and the disagreement would be either
-- messages to someone who never accepted, or silence towards someone who did.
drop function if exists public.client_accepts_whatsapp(uuid);

create function public.client_accepts_whatsapp(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select coalesce(
    (
      select cc.event = 'granted'
      from public.clients c
      join public.client_whatsapp_consents cc
        on cc.phone = public.normalize_whatsapp_phone(c.whatsapp)
      where c.id = p_client_id
        and c.trashed_at is null
      order by cc.occurred_at desc, cc.id desc
      limit 1
    ),
    false
  );
$fn$;

comment on function public.client_accepts_whatsapp(uuid) is
  'Whether Sevenz may write to this client today. False when the number is missing, unreadable, edited since consent, never consented, revoked, or the client is in the bin. Never throws, never returns null.';

revoke execute on function public.client_accepts_whatsapp(uuid) from public, anon, authenticated;
grant execute on function public.client_accepts_whatsapp(uuid) to service_role;

-- ===========================================================================
-- 4. WHAT /s/[token] NEEDS IN ORDER TO DECIDE WHETHER TO SHOW THE MODAL
-- ===========================================================================
--
-- A separate function rather than another field on `get_shared_balance()`.
-- That one is called by an unauthenticated page on every visit and changing
-- its signature means drop + create plus the deploy-order rule in CLAUDE.md --
-- on 2026-09-04 adding an argument to it would have 404ed every share link if
-- the code had shipped before the migration. A new function cannot break the
-- page that already works.
--
-- `can_consent` false means the modal must not be shown: there is no number to
-- key the permission to, so "Accept" would store nothing and promise messages
-- that can never arrive.
drop function if exists public.client_whatsapp_consent_state(text);

create function public.client_whatsapp_consent_state(p_token text)
returns json
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_phone text;
  v_granted boolean;
begin
  -- Only the phone is needed, but `found` below still answers "did the token
  -- resolve to a client", which is a different question from "is that client's
  -- number usable" and has a different answer for the page.
  select public.normalize_whatsapp_phone(c.whatsapp)
    into v_phone
  from public.share_links sl
  join public.clients c on c.id = sl.client_id
  where sl.token = p_token
    and c.trashed_at is null;

  -- Same contract as get_shared_balance: an unknown token is null, not an
  -- error. The page already renders its own not-found state for that.
  if not found then
    return null;
  end if;

  if v_phone is null then
    return json_build_object('can_consent', false, 'granted', false);
  end if;

  select cc.event = 'granted' into v_granted
  from public.client_whatsapp_consents cc
  where cc.phone = v_phone
  order by cc.occurred_at desc, cc.id desc
  limit 1;

  return json_build_object(
    'can_consent', true,
    'granted', coalesce(v_granted, false)
  );
end;
$fn$;

comment on function public.client_whatsapp_consent_state(text) is
  'For the modal on /s/[token]: null for an unknown token, can_consent=false when the client has no usable number (do not show the modal), granted=true when the CURRENT number already has permission.';

revoke execute on function public.client_whatsapp_consent_state(text) from public, anon, authenticated;
grant execute on function public.client_whatsapp_consent_state(text) to service_role;

-- ===========================================================================
-- 5. WRITING THE PERMISSION
-- ===========================================================================
--
-- NOT GRANTED TO anon, AND THAT IS THE POINT. The caller is a Next server
-- action on /s/[token], which passes the constant from lib/ -- the same
-- constant that renders the modal, so what is shown is literally what is
-- stored, which is the rule 065 exists to keep.
--
-- Granting this to anon would let anyone holding a token call it directly with
-- any text they liked and write their own sentence into the evidence. The
-- evidence would then be a sentence nobody was ever shown, which is worse than
-- having none: it reads as proof and is not.
--
-- The token remains the only credential, as it already is for the page itself.
-- A forwarded link therefore lets a third party accept on the client's behalf
-- -- that is MS-9 (the token neither expires nor rotates) and is not made
-- worse here.
--
-- Returns false instead of raising, for the two cases the browser can produce:
-- an unknown token and a client with no usable number. /s/[token] is
-- unauthenticated, and CLAUDE.md's rule about masking errors applies -- the
-- caller turns false into one generic sentence.
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

  insert into public.client_whatsapp_consents (phone, event, consent_text, via_client_id)
  values (v_phone, 'granted', p_consent_text, v_client_id);

  return true;
end;
$fn$;

comment on function public.record_client_whatsapp_consent(text, text) is
  'Records that the number behind this share token granted permission, storing the sentence the caller displayed. service_role only: the text must come from the server constant, never from the browser. False for an unknown token or a client with no usable number.';

revoke execute on function public.record_client_whatsapp_consent(text, text) from public, anon, authenticated;
grant execute on function public.record_client_whatsapp_consent(text, text) to service_role;

insert into public.schema_migrations (key, description)
values (
  '081_client_whatsapp_consent',
  'MS-25: donde se guarda el permiso del cliente final, que bloquea MS-3. Gemela de la 065 (el permiso del dueno) y por el mismo motivo guarda el TEXTO junto a la fecha: Meta exige poder evidenciar el consentimiento y una marca de tiempo sola no lo es, porque la frase de la pantalla cambia. Decision del dueno el 2026-10-09, contra lo que pedia la ficha: NO son tres columnas en clients sino una tabla con el TELEFONO como clave, porque el mismo numero existe bajo dos duenos distintos (1 de 14 numeros en dev) y el permiso se le da a Sevenz, que es el remitente en los dos casos, no a la bodega. Dos consecuencias buscadas: un numero editado por el tendero cambia la clave, no encuentra permiso y el modal vuelve a salir -- sin columna extra, y cerrando la fuga de mandarle el saldo de un cliente a quien tenia antes ese numero; y un cliente sin numero guardado no puede aceptar, asi que el modal no se le ensena. Append-only, una fila por aceptacion o baja, porque sobrescribir como hace la 065 borraria el texto anterior, que es justo el que importa: es el que amparaba los mensajes ya enviados. normalize_whatsapp_phone() es la clave y falla CERRADO: lo que no entiende devuelve null y null es "no hay permiso". RLS encendida, cero politicas, sin grants: las filas son telefonos de gente que no es usuaria de Sevenz. Las tres funciones son SECURITY DEFINER y solo para service_role -- en particular la de escritura, porque si anon pudiera llamarla cualquiera con un token escribiria su propia frase en la evidencia.'
)
on conflict (key) do nothing;

commit;

-- ===========================================================================
-- VERIFICACION, despues de correr lo de arriba
-- ===========================================================================
--
-- Correr TODO esto en la rama DEV (vzqppwrwnmlbrxizskdh).
--
-- 1. La normalizacion, que es la clave de todo:
--
--   select public.normalize_whatsapp_phone('584121234567') as ve,
--          public.normalize_whatsapp_phone('+58 412-1234567') as con_mas,
--          public.normalize_whatsapp_phone('0584121234567') as con_cero,
--          public.normalize_whatsapp_phone('123') as corto,
--          public.normalize_whatsapp_phone(null) as nulo;
--   -- EXPECTED: los tres primeros dan '584121234567' IDENTICO. corto y nulo
--   -- dan null. Si los tres primeros no coinciden, la misma persona tendria
--   -- dos permisos distintos segun como el tendero teclee su numero.
--
-- 2. Nadie queda con permiso por la migracion:
--
--   select count(*) from public.client_whatsapp_consents;
--   -- EXPECTED: 0.
--
-- 3. La tabla es inalcanzable desde una sesion:
--
--   select count(*) as politicas from pg_policies
--   where schemaname = 'public' and tablename = 'client_whatsapp_consents';
--   -- EXPECTED: 0.
--
--   select has_table_privilege('anon', 'public.client_whatsapp_consents', 'select') as anon_lee,
--          has_table_privilege('authenticated', 'public.client_whatsapp_consents', 'select') as sesion_lee;
--   -- EXPECTED: false, false.
--
-- 4. Y las funciones tambien, sobre todo la de escritura:
--
--   select has_function_privilege('anon', 'public.record_client_whatsapp_consent(text,text)', 'execute') as anon_escribe,
--          has_function_privilege('authenticated', 'public.record_client_whatsapp_consent(text,text)', 'execute') as sesion_escribe,
--          has_function_privilege('service_role', 'public.record_client_whatsapp_consent(text,text)', 'execute') as servidor_escribe;
--   -- EXPECTED: false, false, true. Si anon_escribe sale true, cualquiera con
--   -- un token puede escribir su propia frase en la evidencia.
