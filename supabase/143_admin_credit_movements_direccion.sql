-- 143 -- THE ADMIN AVERAGE NEEDS THE PAYMENT'S DIRECTION TOO
--
-- Part of `CT-124`, which is mostly a TypeScript fix: `buildChargeLedger` was
-- spreading each payment over the oldest charge first, while the database has
-- honoured the fiado the shopkeeper picked since migration `126`. The score on
-- the client's card and the one in Cartera read their movements straight from
-- the table, so adding two columns to those queries was enough.
--
-- `/admin`'s average credit score does not. It reads through
-- `admin_credit_movements`, a `security definer` function that exists so the
-- admin screens need no table grant (migration `039`, then `047`), and that
-- function never selected `applies_to_movement_id`.
--
-- WHY THIS COULD NOT BE CAUGHT BY THE TYPE CHECKER, which is the part worth
-- remembering: `lib/admin/metrics.ts` casts each row to `Movement`, a type
-- that HAS the field. So the code compiles, `m.applies_to_movement_id` is
-- simply `undefined` at run time, every payment falls through to the oldest-
-- first branch, and the average quietly keeps the old answer. Nothing errors.
-- A cast is a promise, and this one had stopped being true.
--
-- ===========================================================================
-- TWO CHANGES, AND THE SECOND IS NOT COSMETIC
--
--   1. `applies_to_movement_id` joins the payload.
--   2. `order by m.created_at` becomes `order by m.created_at, m.id`.
--
-- Without the tiebreak, the rows of one split payment -- which all share a
-- `created_at`, because inside a transaction `now()` is the TRANSACTION's
-- timestamp -- come back in whatever order Postgres picks, and the walk in
-- TypeScript spreads them differently from one call to the next. `m.id` is the
-- same tiebreak `get_open_charges_for_client` already uses, so the three
-- places that spread a payment now agree on the order as well as the rule.
--
-- No signature change: same parameters, same `returns setof jsonb`, so
-- `create or replace` really replaces and the file survives being re-run.

begin;

create or replace function public.admin_credit_movements(
  p_country text default null,
  p_owners  uuid[] default null,
  p_from    timestamptz default null,
  p_to      timestamptz default null
)
returns setof jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'id', m.id,
           'client_id', m.client_id,
           'type', m.type,
           'amount', m.amount,
           'currency', m.currency,
           'plazo_dias', m.plazo_dias,
           'created_at', m.created_at,
           'applies_to_movement_id', m.applies_to_movement_id
         )
  from public.movements m
  join public.clients c on c.id = m.client_id
  join public.owners  o on o.id = c.owner_id
  where m.deleted_at is null
    -- Exactly client_summary's own filter, so function 5 and function 6 return
    -- the same set of clients.
    and c.trashed_at is null
    and c.deleted_at is null
    and (p_country is null or o.country = p_country)
    and (p_owners  is null or cardinality(p_owners) = 0 or o.id = any(p_owners))
    and (p_from    is null or c.created_at >= p_from)
    and (p_to      is null or c.created_at <  p_to)
  order by m.created_at, m.id;
$$;

-- `create or replace` keeps the existing grants, so nothing is re-granted
-- here. Stated rather than left to be noticed: this function reads every
-- owner's data and only `service_role` may execute it (migration `047`); if
-- that ever has to be rebuilt, the revoke-from-public line goes with it.

insert into public.schema_migrations (key, description)
values (
  '143_admin_credit_movements_direccion',
  'admin_credit_movements devuelve applies_to_movement_id y ordena por created_at, id. Parte de CT-124: desde la migracion 126 la base respeta el fiado al que el tendero dirige un abono, y el calculo del puntaje en TypeScript lo ignoraba. La ficha del cliente y Cartera leen la tabla directamente y ya se arreglaron en el codigo, pero el promedio de /admin lee por esta funcion, que nunca devolvio ese campo: el cast a Movement en lib/admin/metrics.ts hacia que compilara igual y en ejecucion llegaba undefined, asi que todos los abonos caian en el reparto por antiguedad y el promedio se quedaba con la respuesta vieja, sin error ninguno. El desempate por id no es cosmetico: las lineas de un reparto comparten created_at, porque dentro de una transaccion now() es el instante de la TRANSACCION, y sin el las filas vuelven en cualquier orden y el reparto sale distinto en cada llamada. Es el mismo desempate que ya usa get_open_charges_for_client.'
)
on conflict (key) do nothing;

commit;
