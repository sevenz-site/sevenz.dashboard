-- ENVIRONMENT: run in DEV first (vzqppwrwnmlbrxizskdh). Production comes later, with its own
-- green light, and BEFORE the code (CLAUDE.md, deploy step 1): the new action calls this
-- function, so without it every correction would fail. The other order is safe: today's code
-- never calls it and writes no `unit_cost` by update.
-- Re-runnable: `if not exists` on the table and its index, `create or replace` with the same
-- signature, triggers dropped before they are created, the ledger row `on conflict do nothing`.
--
-- ===========================================================================
-- 196: THE COST OF ONE LINE ALREADY SOLD CAN BE CORRECTED, BY HAND, ONE LINE AT A TIME
--
-- `CT-168`. Owner's decision of 2026-11-06, between three ways out: *«Vamos con A, acotada
-- como propones»*. Migration 194 froze the cost of the day on each line, and the price of that
-- was said at the time: a cost typed wrong and sold stays wrong on that line after it is fixed
-- on the product. Marta types $10 for a $1 flour, sells 100 at $2, and fixes the product the
-- next day: that sale goes on saying she lost $800.
--
-- WHAT THIS IS NOT. Not a range rewrite from the product (option B, discarded), and not a
-- backfill: nothing here writes a cost nobody typed. It touches `unit_cost` and no other
-- column, so no balance, no price, no stock and nothing the client reads can move. Only
-- Reportes does: Ganancia, Margen, Proveedores, the CSV and the assistant.
--
-- A LINE WITH NO COST CAN GET ITS FIRST ONE. Owner's words of 2026-11-06, asked by name:
-- *«3 sí (agreguemoslo como excepcion a la regla "«no se rellena el pasado con datos de hoy»"»*.
-- Every line sold before 194 is such a line: all 266 of dev's when this was written. The
-- rule it is an exception to is about the app guessing; a figure the shopkeeper types for that
-- one line is a record, and `previous_cost` null says it was the first.
--
-- WHY A FUNCTION, AND WHY NO TRIGGER OF 180 OR 188 IS TOUCHED. Rule 6 of 180
-- (`sale_children_guard_update`) refuses every direct update of a sale line, and
-- `sale_rows_guard_returns` (188) refuses it on a sale with a live return. Both ask
-- `ledger_direct_write()`, which is false inside a SECURITY DEFINER function, the same door
-- `registrar_devolucion` and `import_libreta` use. So this opens one column by being the only
-- writer of it, and loosens nothing.
--
-- AN OPEN DOOR 180 LEAVES, CLOSED HERE. Production has 180's rules observing (`PL-21`), so a
-- direct `update sale_lines set unit_cost` from the console would pass there and skip the
-- trail below. `sale_lines_guard_cost` does not ask the switch: no screen updates this column,
-- so nothing legitimate can be refused, which is the reasoning of 188. It fires only when
-- `unit_cost` changes, and only for a direct session write.
--
-- A LINE WITH A LIVE RETURN CAN BE CORRECTED. What 188 protects there is the value and the
-- ceiling of the return, and those come from quantity, price and payments, never from the cost.
-- A return already registered DOES MOVE with the correction: `cargarDevoluciones` reads the
-- cost of the same line, on purpose, so the unit that came back takes out the profit the sale
-- put in. A month already closed therefore changes, in the month of the sale and in the month
-- of the return. That is what a correction is, and the owner chose it knowing it.
--
-- `unit_cost` KEEPS ITS CHECK. Only a figure above zero: 0 would read as a free product and
-- show the whole price as profit, and going back to null would hand the line to today's cost,
-- which is the thing 194 ended. A wrong correction is corrected again.
--
-- FOUR DECIMALS OR REFUSED, NEVER ROUNDED. The column keeps four. Rounding here would store a
-- figure the shopkeeper did not type, without telling him.
--
-- NO RATE ANYWHERE. The figure is typed in the line's own currency, so nothing is converted:
-- neither with today's rate, which CLAUDE.md forbids for a past figure, nor with the sale's.
-- The Colombian 'COP' needs nothing different.
--
-- A LINE WITH NO PRODUCT IS REFUSED. Reportes never counts it (`if (!l.product_id) continue`),
-- so a correction there would be a trail of something that moves no figure.
--
-- WHY A TABLE OF ITS OWN AND NOT `owner_security_audit`. That one is the trail of the account:
-- sign-ins, codes, a changed number, read from /admin. It has no column for a line and its
-- `detail` is free json. Mixing them would make the page that answers «who got into this
-- account» list cost fixes, and would leave «what happened to this line» unqueryable.
--
-- NOTHING IS GRANTED TO A SESSION: the owner writes it only through the function and reads
-- nothing of it. A trail its subject can edit is not a trail. No foreign key to the line or
-- the sale either: `sale_lines` can be hard-deleted inside 180's ten minutes, and the trail
-- has to outlive that. It goes only with the account.
-- ===========================================================================

begin;

-- ── 1. The trail ────────────────────────────────────────────────────────────

create table if not exists public.sale_line_cost_changes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owners (id) on delete cascade,
  sale_id uuid not null,
  sale_line_id uuid not null,
  -- Null: the line had no cost and this is the first one.
  previous_cost numeric(14, 4),
  new_cost numeric(14, 4) not null check (new_cost > 0 and new_cost <= 1e11),
  -- The session that wrote it. Separate from `owner_id` because the rest of the book keeps the
  -- two apart (`created_by`), so a second user on an account would not need a new column.
  changed_by uuid not null,
  changed_at timestamptz not null default now()
);

create index if not exists sale_line_cost_changes_line_idx
  on public.sale_line_cost_changes (sale_line_id, changed_at desc);
create index if not exists sale_line_cost_changes_owner_idx
  on public.sale_line_cost_changes (owner_id, changed_at desc);

alter table public.sale_line_cost_changes enable row level security;
revoke all on table public.sale_line_cost_changes from public, anon, authenticated;
grant select, delete on table public.sale_line_cost_changes to service_role;

comment on table public.sale_line_cost_changes is
  'Cada corrección del costo de una línea ya vendida: quién, cuándo, de qué valor a qué valor. Solo la escribe correct_sale_line_cost.';

-- ── 2. The only writer ──────────────────────────────────────────────────────

create or replace function public.correct_sale_line_cost(p_line_id uuid, p_unit_cost numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_owner uuid := auth.uid();
  v_sale uuid;
  v_currency text;
  v_product uuid;
  v_previous numeric;
  v_sale_deleted timestamptz;
  v_client_gone boolean;
begin
  if v_owner is null then
    return jsonb_build_object('ok', false, 'code', 'sin_sesion');
  end if;
  if not public.owner_puede_escribir(v_owner) then
    return jsonb_build_object('ok', false, 'code', 'cuenta_pausada');
  end if;

  if p_unit_cost is null or p_unit_cost <= 0 or p_unit_cost > 1e11
     or p_unit_cost <> round(p_unit_cost, 4) then
    return jsonb_build_object('ok', false, 'code', 'costo_invalido');
  end if;

  -- THE LINE AND ITS OWNER, EXPLICITLY. The id comes from the browser and this function reads
  -- with its own rights, so this is the lock, not the backstop. `for update of l` so two
  -- corrections at once cannot both record the same previous value.
  select l.sale_id, l.currency, l.product_id, l.unit_cost, s.deleted_at,
         (c.trashed_at is not null or c.deleted_at is not null)
    into v_sale, v_currency, v_product, v_previous, v_sale_deleted, v_client_gone
  from public.sale_lines l
  join public.sales s on s.id = l.sale_id
  join public.clients c on c.id = s.client_id
  where l.id = p_line_id
    and s.owner_id = v_owner
  for update of l;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'linea_ajena');
  end if;
  if v_sale_deleted is not null or v_client_gone then
    return jsonb_build_object('ok', false, 'code', 'venta_eliminada');
  end if;
  if v_product is null then
    return jsonb_build_object('ok', false, 'code', 'sin_producto');
  end if;

  -- Saving what is already there writes nothing: a trail of non-changes hides the real ones.
  if v_previous is not distinct from p_unit_cost then
    return jsonb_build_object(
      'ok', true, 'changed', false, 'sale_id', v_sale,
      'currency', v_currency, 'previous_cost', v_previous, 'unit_cost', p_unit_cost
    );
  end if;

  update public.sale_lines set unit_cost = p_unit_cost where id = p_line_id;

  insert into public.sale_line_cost_changes (
    owner_id, sale_id, sale_line_id, previous_cost, new_cost, changed_by
  )
  values (v_owner, v_sale, p_line_id, v_previous, p_unit_cost, v_owner);

  return jsonb_build_object(
    'ok', true, 'changed', true, 'sale_id', v_sale,
    'currency', v_currency, 'previous_cost', v_previous, 'unit_cost', p_unit_cost
  );
end;
$fn$;

revoke execute on function public.correct_sale_line_cost(uuid, numeric) from public, anon;
grant execute on function public.correct_sale_line_cost(uuid, numeric) to authenticated, service_role;

-- ── 3. The column has one door ──────────────────────────────────────────────

create or replace function public.sale_lines_guard_cost()
returns trigger
language plpgsql
as $$
begin
  if public.ledger_direct_write() and new.unit_cost is distinct from old.unit_cost then
    raise exception using
      message = 'El costo de una venta se corrige desde su detalle.', errcode = 'SZ014';
  end if;
  return new;
end;
$$;

drop trigger if exists sale_lines_guard_cost on public.sale_lines;
create trigger sale_lines_guard_cost
  before update on public.sale_lines
  for each row execute function public.sale_lines_guard_cost();

-- ── 4. Ledger ───────────────────────────────────────────────────────────────

insert into public.schema_migrations (key, description)
values (
  '196_correct_sale_line_cost',
  'CT-168: correct_sale_line_cost deja corregir, o escribir por primera vez, el costo de una línea ya vendida, una a la vez y tecleado a mano, con su rastro en sale_line_cost_changes. Solo toca unit_cost: ni saldos, ni precios, ni lo que ve el cliente. Las reglas de la 180 y la 188 no se aflojan, y sale_lines_guard_cost cierra esa columna a la escritura directa aunque la 180 esté observando.'
)
on conflict (key) do nothing;

commit;

-- ── verification, after running the above ─────────────────────────────────
--   select
--     (select count(*) from pg_proc where proname = 'correct_sale_line_cost') as funciones,
--     (select prosecdef from pg_proc where proname = 'correct_sale_line_cost') as definer,
--     has_function_privilege('anon', 'public.correct_sale_line_cost(uuid, numeric)', 'execute') as anon_ejecuta,
--     has_function_privilege('authenticated', 'public.correct_sale_line_cost(uuid, numeric)', 'execute') as dueno_ejecuta,
--     has_table_privilege('authenticated', 'public.sale_line_cost_changes', 'select') as dueno_lee_rastro,
--     (select relrowsecurity from pg_class where oid = 'public.sale_line_cost_changes'::regclass) as rls,
--     (select count(*) from pg_trigger where tgname = 'sale_lines_guard_cost' and not tgisinternal) as candado,
--     exists (select 1 from public.schema_migrations where key = '196_correct_sale_line_cost') as apuntada;
--   -- funciones 1, definer t, anon_ejecuta f, dueno_ejecuta t, dueno_lee_rastro f, rls t,
--   -- candado 1, apuntada t
