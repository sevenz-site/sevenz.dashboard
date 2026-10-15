-- WHICH NUMBER SENT EACH MESSAGE.
--
-- ===========================================================================
-- WHY THIS EXISTS, AND IT IS WORTH REMEMBERING
--
-- On 2026-10-15 the owner asked a question this database could not answer:
-- "are the client receipts going out from the client number, or from the
-- owners' one?" MS-24 split the two numbers on 2026-10-12 precisely so that a
-- client marking a debt reminder as spam could not wreck the reputation of the
-- number that already carries the 24 owners' alerts. That split only works if
-- it can be AUDITED, and `whatsapp_sends` recorded template, audience,
-- recipient and error -- everything except who sent it.
--
-- The answer had to be argued from source code instead of read from a row.
-- The code was right, and that is not the point: a safeguard nobody can check
-- after the fact is a safeguard you believe in rather than one you have.
--
-- WHAT WAS USED, NOT WHAT SHOULD HAVE BEEN. The value is returned by the
-- function that made the HTTP call, so it is the id that actually appeared in
-- the URL. Recomputing it from the audience here would re-derive the very
-- thing under suspicion, and would agree with itself even if routing broke.
--
-- THIS DOES NOT BACKFILL. The 12 rows already in production stay null
-- forever: nothing recorded it at the time, and inventing a value from today's
-- routing would be a guess written as if it were a record. Null means "we did
-- not know", which is the truth about those rows.

begin;

-- ===========================================================================
-- 1. THE COLUMN
-- ===========================================================================

-- Meta's `phone_number_id`, as a string. Not an enum and not a foreign key to
-- anything: it is an opaque identifier belonging to a third party, and the day
-- MS-17 replaces these US numbers with a local one, the old rows must keep the
-- id they were really sent from.
alter table public.whatsapp_sends
  add column if not exists phone_number_id text;

comment on column public.whatsapp_sends.phone_number_id is
  'Meta phone_number_id the message was actually sent from, as returned by the call that sent it. Null for rows written before 2026-10-15 and for reservations that never reached the provider.';

-- ===========================================================================
-- 2. THE FUNCTION THAT WRITES IT
-- ===========================================================================

-- BOTH SIGNATURES GET DROPPED, and that is the rule in CLAUDE.md rather than
-- tidiness. Postgres overloads on argument types, so `create or replace`
-- cannot add a parameter -- it would create a SECOND function and leave
-- PostgREST to pick. And dropping only the four-argument one makes this file
-- work exactly once: on a re-run the drop matches nothing and the create fails
-- with 42723. The moment you need to re-run a migration is right after
-- correcting it.
drop function if exists public.whatsapp_send_finish(uuid, boolean, text, text);
drop function if exists public.whatsapp_send_finish(uuid, boolean, text, text, text);

-- `p_phone_number_id` carries a default so the ALREADY DEPLOYED code, which
-- calls this with four arguments, keeps working after this migration lands and
-- before the new code ships. That is the deploy order of CLAUDE.md: migrations
-- into production first, code second, and the failure mode of that order is
-- "one column stays null for a few minutes" instead of "every receipt errors".
create function public.whatsapp_send_finish(
  p_id uuid,
  p_ok boolean,
  p_provider_message_id text default null,
  p_error text default null,
  p_phone_number_id text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.whatsapp_sends
  set ok = p_ok,
      provider_message_id = p_provider_message_id,
      -- The provider's raw text is stored HERE and only here. It never reaches
      -- an HTTP response: that is CLAUDE.md's rule on masking errors.
      error = p_error,
      -- COALESCE, so a four-argument call never ERASES a value a five-argument
      -- call already wrote. Nothing calls it twice today; retries are the
      -- obvious next thing someone adds.
      phone_number_id = coalesce(p_phone_number_id, phone_number_id)
  where id = p_id;
end;
$$;

-- REVOKING FROM `public` IS NOT ENOUGH, and migration 067 documents the hole
-- this closed: Supabase grants EXECUTE to anon, authenticated and service_role
-- on every new function in the public schema through `alter default
-- privileges`. That is an explicit grant to those roles, and taking the
-- permission away from `public` does not touch it. A new function means a new
-- grant, so this has to be repeated here.
revoke execute on function public.whatsapp_send_finish(uuid, boolean, text, text, text)
  from public, anon, authenticated;

grant execute on function public.whatsapp_send_finish(uuid, boolean, text, text, text)
  to service_role;

insert into public.schema_migrations (key, description)
values (
  '105_quien_mando_cada_mensaje',
  'whatsapp_sends gana phone_number_id: desde que numero salio de verdad cada mensaje. Nace de una pregunta del dueno el 2026-10-15 que la base no podia contestar -- MS-24 separo el numero de clientes del de duenos el 2026-10-12 para que un cliente marcando spam no se llevara por delante la reputacion del numero que ya atiende a los 24 duenos, y esa separacion solo sirve si se puede AUDITAR; la tabla guardaba plantilla, audiencia, destinatario y error, todo menos quien lo mando, asi que la respuesta hubo que argumentarla leyendo codigo en vez de leerla en una fila. El valor lo devuelve la funcion que hizo la llamada HTTP, o sea el id que de verdad fue en la URL: recalcularlo aqui desde la audiencia volveria a deducir justo lo que se esta poniendo en duda y coincidiria consigo mismo aunque el enrutado estuviera roto. whatsapp_send_finish cambia de firma, asi que se tiran las DOS -- la de cuatro argumentos y la de cinco -- porque create or replace no puede anadir un parametro (crearia una segunda funcion y PostgREST elegiria) y tirar solo la vieja hace que el archivo corra una sola vez. El quinto argumento lleva default null para que el codigo YA DESPLEGADO, que llama con cuatro, siga funcionando entre esta migracion y el despliegue del codigo nuevo. No rellena nada hacia atras: las 12 filas de produccion del 14 y 15 de octubre se quedan en null para siempre, porque inventarles un valor con el enrutado de hoy seria escribir una suposicion con forma de registro.'
)
on conflict (key) do nothing;

commit;

-- ── verification, after running the above ───────────────────────────────
--
-- 1. La columna existe y la funcion tiene CINCO argumentos y solo una version:
--
-- select p.proname, pg_get_function_identity_arguments(p.oid) as argumentos
-- from pg_proc p
-- join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname = 'whatsapp_send_finish';
--
-- EXPECTED: una sola fila, con cinco argumentos. Dos filas significa que
-- quedaron las dos sobrecargas y que PostgREST puede elegir la que no es.
--
-- 2. Que `anon` no pueda llamarla:
--
-- select has_function_privilege('anon', 'public.whatsapp_send_finish(uuid, boolean, text, text, text)', 'execute') as anon_puede;
--
-- EXPECTED: false.
