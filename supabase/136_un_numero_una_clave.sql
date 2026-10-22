-- 136. THE SAME PHONE STOPS PRODUCING TWO DIFFERENT KEYS.
--
-- `normalize_whatsapp_phone` strips non-digits and the trunk zero, then
-- accepts anything 10 to 15 digits long. It never ADDS a dial code. So the
-- same human phone, written the two ways people actually write it, becomes
-- two unrelated keys:
--
--   '04149900094'   -> 4149900094
--   '+584149900094' -> 584149900094
--
-- And `client_whatsapp_consents` is keyed by that value. Two keys mean the
-- consent recorded under one is invisible from the other: the client agreed,
-- the record carries his number, and Sevenz believes nobody ever asked.
--
-- ===========================================================================
-- MEASURED, NOT SUSPECTED
--
-- Found in dev on 2026-10-21 while walking the entry forms. A `granted`
-- consent sits under `3238130265` while NINE live client records carry
-- `573238130265` -- the same phone, written with the dial code. None of the
-- nine sees it.
--
-- PRODUCTION IS CLEAN: 116 consents, every one of them carrying a dial code.
-- Checked by the owner on 2026-10-21 with three read-only queries. So this
-- migration repairs dev and arms production against a trap that has not
-- sprung there.
--
-- TWO OF THOSE 116 ARE NOT VENEZUELAN OR COLOMBIAN, and they are worth
-- knowing about before anyone widens this rule. They are 11 digits opening
-- with `569` and `519` -- a Chilean and a Peruvian mobile, each with its own
-- dial code -- and they came in through the owner's own movement form on the
-- 19th and the 21st. `lib/countries.ts` offers 226 countries in that selector,
-- so this is the app working as built, not a stray.
--
-- They pass through this function untouched: 11 digits matches none of the
-- branches below and falls to the unjudged pass-through, which is exactly
-- where a number this file cannot place belongs. Nothing here merges them,
-- renames them, or gives them a country.
--
-- THE REASON THEY GET A PARAGRAPH is that a shape count written to look for
-- "missing dial code" reported them as missing one, because it asked for
-- `58` or `57` and called everything else bare. They were never bare. If the
-- rule below is ever widened past two countries, this is the row shape that
-- will be sitting there to be misread again.
--
-- The three dev rows without a dial code all came in as `client_order` from
-- test tooling that calls `create_catalog_order` with a bare number. The
-- cart's own screen composes the number with `WhatsappInput`, so the UI is
-- not the leak -- which is exactly why the fix belongs in the function and
-- not in a form: the function is the only place every caller passes through.
--
-- ===========================================================================
-- WHY TWO DIAL CODES MAKE THIS SAFE, AND WHY IT WOULD NOT BE WITH MORE
--
-- Decision of the owner, 2026-10-21: *«El producto de momento es solo para
-- venezuela (+58 ó 58) y colombia (+57 ó 57), trabajaría en la solución en
-- función de esos dos indicativos solamente»*.
--
-- That restriction is the whole safety argument, because a bare national
-- number is ambiguous on its face and guessing wrong is the worst failure
-- this product has: two people merged into one key means one of them receives
-- the other's balance. With exactly two countries the shapes do not overlap,
-- and the shapes are not invented here -- they are the ones `lib/phone.ts`
-- already warns owners about:
--
--   Venezuela  mobile 412 414 416 424 426 · landline 2xx   (10 digits)
--   Colombia   mobile 3xx                 · landline 60x   (10 digits)
--
-- A Venezuelan number never opens with 3 or 6; a Colombian one never opens
-- with 4 or 2. So a 10-digit bare number resolves to exactly one country, or
-- to none.
--
-- THE VENEZUELAN MOBILE PREFIXES ARE LISTED ONE BY ONE and not as "starts
-- with 4", which is what `lib/phone.ts` uses. Being stricter here is
-- deliberate: a bare 10-digit number can also be a US one, where 404 and 415
-- are real area codes, and `4045551234` under a "starts with 4" rule would be
-- filed as a Venezuelan phone. Listing 412/414/416/424/426 leaves it
-- untouched instead. Stricter means "no repair", which is today's behaviour --
-- the direction this whole area already fails in.
--
-- NINE-DIGIT NUMBERS ARE NOT TOUCHED and still return null, same as before.
-- `lib/phone.ts` notes that a real ledger holds Peruvian and Chilean mobiles,
-- which are 9 digits; they have no consent today and this migration does not
-- give them one. That is a separate decision and not this one's to take.
--
-- ===========================================================================
-- THE FUNCTION AND THE STORED ROWS CHANGE TOGETHER OR NOT AT ALL
--
-- This is the part that makes the file dangerous, and the reason it is one
-- transaction.
--
-- `client_whatsapp_consents.phone` holds the OUTPUT of this function, while
-- every lookup recomputes it from `clients.whatsapp`. Replace the function
-- without rewriting those rows and the two stop matching for every canonical
-- number too -- not three rows orphaned, but the entire ledger, every client
-- asked again, nothing sent to anyone. The bug this fixes, multiplied by all
-- of them.
--
-- So: `begin` ... `commit`, and the rewrite uses the new function itself, so
-- a second run finds nothing left to change.
--
-- WHAT A REPAIR CAN LEGITIMATELY FLIP: if a bare key and its canonical twin
-- both exist with opposite events, merging them makes the LATEST one win,
-- which may turn a granted into a revoked or the reverse. That is the correct
-- reading of a consent ledger -- the most recent word is the one that counts --
-- but it is a change of outcome, so the file reports it. In dev the three
-- repaired keys have no twin at all, so nothing flips.

begin;

-- ---------------------------------------------------------------------------
-- 1. The function
-- ---------------------------------------------------------------------------
--
-- `create or replace` and not drop+create: the signature is unchanged, so
-- there is no second overload to worry about and the file re-runs cleanly.
-- Nothing indexes on this function -- `client_whatsapp_consents_phone_idx` is
-- on the stored column -- so replacing it invalidates nothing.
create or replace function public.normalize_whatsapp_phone(p_raw text)
returns text
language sql
immutable
strict
as $fn$
  select case
    -- Already canonical: one of the two dial codes plus a 10-digit national
    -- number. Checked first so a repaired value passes through untouched,
    -- which is what makes the rewrite below idempotent.
    when length(d) = 12 and (left(d, 2) = '58' or left(d, 2) = '57') then d

    -- Bare Venezuelan: the five mobile prefixes, or a landline opening with 2.
    when length(d) = 10
     and (left(d, 3) in ('412', '414', '416', '424', '426') or left(d, 1) = '2')
      then '58' || d

    -- Bare Colombian: any 3xx mobile, or a 60x landline.
    when length(d) = 10 and (left(d, 1) = '3' or left(d, 2) = '60')
      then '57' || d

    -- Everything else keeps the OLD contract exactly: 10-15 digits pass
    -- through unjudged, anything else is null. A number this file cannot
    -- place with certainty is left exactly as it was, so the worst case of
    -- being wrong here is the behaviour of yesterday, never a merge.
    when length(d) between 10 and 15 then d
    else null
  end
  from (select ltrim(regexp_replace(p_raw, '[^0-9]', '', 'g'), '0') as d) s;
$fn$;

comment on function public.normalize_whatsapp_phone(text) is
  'Digits only, no trunk zero, and -- since 136 -- a CANONICAL key: a bare 10-digit number whose shape can only be Venezuelan (412/414/416/424/426, or a 2xx landline) or Colombian (3xx, or a 60x landline) gets its dial code prepended, so the same phone written two ways is one key. Anything it cannot place with certainty passes through unjudged, exactly as before, because a wrong guess merges two people and a missing guess only repeats yesterday. Null when it cannot be a country-coded number (10-15 digits). The key of client_whatsapp_consents. Null means "no permission" to every caller, so a normalization miss fails closed.';

-- ---------------------------------------------------------------------------
-- 2. The stored keys, in the same transaction
-- ---------------------------------------------------------------------------
--
-- `where phone is distinct from normalize(phone)` means a re-run touches
-- nothing: the first run leaves every row canonical, and a canonical value
-- is returned unchanged by the first branch above.
update public.client_whatsapp_consents
   set phone = public.normalize_whatsapp_phone(phone)
 where public.normalize_whatsapp_phone(phone) is not null
   and phone is distinct from public.normalize_whatsapp_phone(phone);

-- The catalogue order keeps the same normalized value for the owner's own
-- "contact this customer" link. It is not a consent key, but a bare number
-- there builds a wa.me link that does not reach anyone, so it is repaired for
-- the same reason and with the same condition.
update public.catalog_orders
   set customer_whatsapp = public.normalize_whatsapp_phone(customer_whatsapp)
 where public.normalize_whatsapp_phone(customer_whatsapp) is not null
   and customer_whatsapp is distinct from public.normalize_whatsapp_phone(customer_whatsapp);

-- ---------------------------------------------------------------------------
-- 3. What is left, said out loud
-- ---------------------------------------------------------------------------
--
-- Raised as a NOTICE and not a failure: a number this function still cannot
-- place is the old behaviour, not a regression, and blocking the migration on
-- it would block the repair that fixes the rest.
do $$
declare
  v_sueltos int;
begin
  -- SOLO LOS DE 10 DIGITOS, que son los unicos genuinamente ambiguos: un
  -- numero nacional suelto, sin pais. Cualquier otra longitud YA lleva su
  -- indicativo y esta bien aunque no sea de los dos paises -- en produccion
  -- hay un movil chileno y uno peruano, de 11 digitos, perfectamente
  -- canonicos. Contarlos como «sueltos» fue justo el error que escribio este
  -- comentario.
  select count(*) into v_sueltos
  from public.client_whatsapp_consents
  where length(phone) = 10;

  if v_sueltos > 0 then
    raise notice 'ATENCION: quedan % permisos con un numero nacional SUELTO, sin pais. No es un fallo de esta migracion --su forma no es ni venezolana ni colombiana, asi que situarlo seria adivinar-- pero conviene mirarlos uno a uno.', v_sueltos;
  end if;
end $$;

insert into public.schema_migrations (key, description)
values (
  '136_un_numero_una_clave',
  'normalize_whatsapp_phone ahora canoniza: un numero de 10 digitos cuya FORMA solo puede ser venezolana (412/414/416/424/426, o un fijo 2xx) o colombiana (3xx, o un fijo 60x) sale con su indicativo delante. Antes la misma persona producia DOS claves distintas --«04149900094» daba 4149900094 y «+584149900094» daba 584149900094-- y como client_whatsapp_consents esta indexada por ese valor, el permiso dado bajo una era invisible desde la otra: el cliente acepto, su ficha lleva su numero, y Sevenz creia que nadie le habia preguntado. MEDIDO EN DEV el 2026-10-21: un permiso concedido bajo 3238130265 mientras NUEVE fichas vivas llevan 573238130265; ninguna de las nueve lo veia. PRODUCCION ESTA LIMPIA: 116 permisos y todos con indicativo, comprobado por el dueno el 2026-10-21 con tres consultas de solo lectura, asi que alli esto desarma una trampa en vez de reparar un dano. DOS DE ESOS 116 NO SON NI VENEZOLANOS NI COLOMBIANOS y conviene saberlo antes de que alguien ensanche esta regla: son de 11 digitos y abren por 569 y 519 --un movil chileno y uno peruano, cada uno con SU indicativo-- y entraron por el formulario de movimiento del propio tendero el 19 y el 21. lib/countries.ts ofrece 226 paises en ese selector, o sea que es la app funcionando como esta hecha y no un numero perdido. Pasan por esta funcion sin tocarse: 11 digitos no casa con ninguna rama y cae al paso directo, que es donde debe quedar un numero que este archivo no puede situar. Y merecen parrafo porque un recuento de formas escrito para buscar «sin indicativo» los conto como si les faltara, por pedir 58 o 57 y llamar sueltos a todos los demas; nunca estuvieron sueltos. DOS INDICATIVOS ES LO QUE LO HACE SEGURO, decision del dueno del 2026-10-21: con solo Venezuela y Colombia las formas no se solapan --un numero venezolano nunca abre por 3 ni por 6, uno colombiano nunca por 4 ni por 2-- asi que un numero suelto se resuelve a un solo pais o a ninguno. Los prefijos moviles venezolanos van listados uno a uno y no como «empieza por 4», que es lo que usa lib/phone.ts: un numero suelto de 10 digitos tambien puede ser de EE. UU., donde 404 y 415 son indicativos reales, y bajo la regla ancha 4045551234 se archivaria como venezolano. Lo estricto deja el numero como estaba, que es el comportamiento de ayer; lo ancho fusionaria a dos personas en una clave, que es el peor fallo que tiene este producto. LA FUNCION Y LAS FILAS CAMBIAN JUNTAS O NO CAMBIA NADA, y por eso el archivo es UNA transaccion: las filas guardadas son la salida de esta funcion y las busquedas la recalculan, asi que cambiar una sin la otra dejaria huerfano el registro ENTERO --no tres filas, todas-- y nadie recibiria nada. Se reescriben tambien los telefonos de catalog_orders, que no son clave de permiso pero construyen el enlace de wa.me del tendero. Re-ejecutable: la primera rama devuelve intacto lo ya canonico, asi que una segunda pasada no toca nada. Los numeros de 9 digitos (Peru, Chile) siguen dando null como siempre: darles permiso es otra decision y no la toma esta migracion.'
)
on conflict (key) do nothing;

commit;
