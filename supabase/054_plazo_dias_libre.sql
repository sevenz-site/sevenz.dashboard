-- 054_plazo_dias_libre.sql
--
-- El plazo de pago deja de ser una lista de cuatro números y pasa a ser un
-- rango.
--
-- POR QUÉ, y esto es un fallo mío que conviene dejar escrito. El formulario
-- gana "Otro plazo…" para que el dueño escriba los días que acordó de verdad.
-- Amplié la validación del servidor a un rango de 1 a 365 y **no miré que la
-- base de datos tuviera su propia restricción**: seguía aceptando solo 7, 15,
-- 30 y 45. Un plazo de 5 días pasaba la comprobación del servidor, llegaba al
-- insert y moría ahí, devolviéndole al dueño el texto crudo de Postgres:
--
--   new row for relation "movements" violates check constraint
--   "movements_plazo_dias_check"
--
-- Dos guardas para la misma regla, escritas en sitios distintos y en momentos
-- distintos. La del servidor la cambié; esta se quedó atrás.
--
-- Los límites siguen existiendo, solo que ahora son los mismos en los dos
-- sitios: cero o negativo no es un plazo, y más de un año es casi siempre un
-- dedo de más al teclear. El plazo alimenta el puntaje del cliente, así que un
-- número absurdo no es inofensivo.

begin;

alter table public.movements
  drop constraint if exists movements_plazo_dias_check;

alter table public.movements
  add constraint movements_plazo_dias_check
  check (plazo_dias is null or (plazo_dias >= 1 and plazo_dias <= 365));

insert into public.schema_migrations (key, description)
values (
  '054_plazo_dias_libre',
  'plazo_dias goes from a fixed list (7, 15, 30, 45) to a 1-365 range, so the new "Otro plazo…" option can store what the owner actually agreed. The server-side check was already widened; this constraint had been missed and rejected the insert with a raw Postgres error.'
)
on conflict (key) do nothing;

commit;

-- ── verificación, después de correr lo de arriba ────────────────────────
--   select pg_get_constraintdef(oid)
--   from pg_constraint
--   where conname = 'movements_plazo_dias_check';
--
-- Debe decir el rango, no la lista de cuatro.
