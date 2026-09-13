-- 053_tasa_prevista.sql
--
-- Guarda la próxima tasa del BCV —la que ya está publicada pero todavía no
-- rige— para que el servidor pueda sellarla en un movimiento.
--
-- POR QUÉ. El BCV no publica sábados ni domingos, pero los negocios abren. El
-- cliente llega con bolívares y el dueño decide qué cifra en dólares anota; con
-- la tasa del viernes pierde:
--
--   Bs. 45.000 a la del viernes (832,49)  ->  le abona $54,05
--   Bs. 45.000 a la del lunes   (842,21)  ->  le abona $53,43
--
-- Las calculadoras ya ofrecen esa tasa, y ahí basta con leerla en el navegador.
-- El formulario de fiado y abono no: quien decide qué tasa se sella es el
-- servidor, y **el servidor no puede fiarse de un número que le mande el
-- navegador**. Si el formulario enviara "usa 842,21", una petición hecha a mano
-- podría sellar cualquier cosa en el respaldo de un movimiento. Por eso la tasa
-- prevista tiene que estar guardada aquí: el formulario manda una casilla, no
-- una cifra.
--
-- Las tres columnas van en la misma fila que la tasa vigente, no en una tabla
-- aparte, porque son la misma lectura: cada vez que se consulta al proveedor se
-- anota lo que rige hoy y lo que regirá después. Nullable porque puede no haber
-- ninguna futura publicada —que es lo normal entre semana— y porque el
-- proveedor de respaldo no publica histórico.

begin;

alter table public.bcv_exchange_rate_fetches
  add column if not exists prevista_usd numeric,
  add column if not exists prevista_eur numeric,
  add column if not exists prevista_date date;

comment on column public.bcv_exchange_rate_fetches.prevista_date is
  'La fecha en que entra en vigor la próxima tasa publicada, cuando el proveedor ya la trae. Null es lo normal entre semana. Nunca es anterior a rate_date.';

-- 'BCV_PREVISTA' como tercer modo. No es BCV_AUTO —no es la tasa que regía al
-- registrar— ni es CUSTOM —no se la inventó el dueño, la publicó el BCV—. Es su
-- propio caso y merece su propio nombre: dentro de un mes, mirando el respaldo
-- de un movimiento, la diferencia entre "usó una tasa que aún no regía" y "se
-- inventó un número" es toda la diferencia.
alter table public.movements
  drop constraint if exists movements_rate_mode_used_check;

alter table public.movements
  add constraint movements_rate_mode_used_check
  check (rate_mode_used is null or rate_mode_used in ('BCV_AUTO', 'CUSTOM', 'BCV_PREVISTA'));

-- drop + create, no create or replace: la funcion gana columnas y Postgres no
-- deja cambiar la forma de un returns table sobre la marcha. Mismo motivo y
-- misma maniobra que en la 046.
drop function if exists public.get_current_bcv_rate();

create function public.get_current_bcv_rate()
returns table (
  usd numeric,
  eur numeric,
  source text,
  fetched_at timestamptz,
  rate_date date,
  prevista_usd numeric,
  prevista_eur numeric,
  prevista_date date
)
language sql
stable
as $$
  select f.usd, f.eur, f.source, f.fetched_at, f.rate_date,
         f.prevista_usd, f.prevista_eur, f.prevista_date
  from public.bcv_exchange_rate_fetches f
  where f.needs_review = false
  order by f.fetched_at desc
  limit 1;
$$;

-- El drop se lleva los permisos por delante, igual que en la 046. Volver a
-- concederlos explicitamente es lo unico que garantiza que siguen ahi.
grant execute on function public.get_current_bcv_rate() to authenticated, service_role;

insert into public.schema_migrations (key, description)
values (
  '053_tasa_prevista',
  'Stores the BCV rate that is published but not yet in force (prevista_usd/eur/date on bcv_exchange_rate_fetches, returned by get_current_bcv_rate) so the SERVER can stamp it on a movement without trusting a rate sent by the browser. Adds BCV_PREVISTA as a third rate_mode_used.'
)
on conflict (key) do nothing;

commit;

-- ── verificación, después de correr lo de arriba ────────────────────────
--   select * from public.get_current_bcv_rate();   -- ahora con tres columnas más
--
--   select pg_get_constraintdef(oid)
--   from pg_constraint
--   where conname = 'movements_rate_mode_used_check';   -- debe incluir BCV_PREVISTA
