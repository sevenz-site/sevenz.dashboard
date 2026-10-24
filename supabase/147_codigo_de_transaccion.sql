-- A SHORT, READABLE CODE FOR EVERY TRANSACTION.
--
-- Asked for by the owner on 2026-10-23, and it answers a problem measured
-- that same day: a single payment of Bs. 20.000 split across three fiados
-- shows up in the history as THREE separate rows, and nothing says they were
-- one payment. The receipt the client gets by WhatsApp says «Abonó Bs.
-- 20.000,00 · Repartido entre 3 fiados»; his history says three abonos. The
-- code is what ties them back together, on screen and in a search box.
--
-- ===========================================================================
-- WHAT A "TRANSACTION" IS HERE, because it is not one row
--
-- It is what the shopkeeper DID once, and that maps to three different
-- shapes in this schema:
--
--   · a sale (fiado or de contado) — one `sales` row, plus zero to N
--     `movements` rows, one per currency. A sale paid in full writes no
--     movement at all (migration 124), so the code has to live on `sales`
--     too, or a de contado transaction would have none.
--   · a split payment — N `movements` rows sharing `payment_group_id`.
--   · anything else — one `movements` row on its own: a manual charge, a
--     line from an imported libreta, a plain abono.
--
-- So the grouping key is `coalesce(sale_id, payment_group_id, id)`, and every
-- row sharing a key shares a code. A movement that belongs to a sale takes
-- the SALE's code: those are the same transaction seen from two tables, and
-- giving them different codes would be the original bug with extra steps.
--
-- ===========================================================================
-- THE SHAPE OF THE CODE, AND WHY IT IS NOT A UUID
--
-- Three letters and three digits, «ABC000», as the owner wrote it. It is read
-- out loud over a counter and typed into a search box by someone who may be
-- looking at a screenshot, so it has to survive being spoken and retyped.
--
-- I AND O ARE LEFT OUT of the alphabet on purpose: next to 1 and 0 they are
-- the two characters this code would lose most often. That leaves 24 letters
-- and 24³ × 10³ = 13.8 million codes, which is far more than this product
-- will write, and the registry below makes a collision impossible rather than
-- unlikely.
--
-- ===========================================================================
-- WHY A REGISTRY TABLE AND NOT A UNIQUE INDEX
--
-- `movements.transaction_code` CANNOT be unique — the three lines of a split
-- payment share one by design. So uniqueness cannot be enforced on the column
-- where the code is used. `public.transaction_codes` is the one place that
-- owns the code space: the generator claims a code there first, and the
-- primary key turns a collision into a retry instead of into two transactions
-- with the same name.

-- ── THE CODE SPACE ──────────────────────────────────────────────────────
create table if not exists public.transaction_codes (
  code text primary key,
  created_at timestamptz not null default now()
);

-- Nobody reads this table from the app: it exists to make the primary key do
-- its job. RLS on with zero policies is the pattern this repo already uses
-- for `movement_rejections` — both doors are SECURITY DEFINER functions.
alter table public.transaction_codes enable row level security;

-- ── THE GENERATOR ───────────────────────────────────────────────────────
--
-- Claims a free code and returns it. The loop is not defensive programming:
-- with a shared code space every caller races every other, and `on conflict
-- do nothing` turns that race into "try again" instead of an error surfacing
-- in the middle of someone registering a sale.
--
-- 50 attempts is a ceiling, not an expectation. At one million codes used the
-- chance of 50 consecutive collisions is around (1/13.8)^50 — it will not
-- happen, and if the space ever did fill up, failing loudly here is correct:
-- silently returning a duplicate would corrupt the search.
create or replace function public.generar_codigo_transaccion()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  -- No I and no O: see the header.
  v_letras constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_codigo text;
  v_intento int := 0;
begin
  loop
    v_intento := v_intento + 1;
    v_codigo :=
      substr(v_letras, 1 + floor(random() * length(v_letras))::int, 1) ||
      substr(v_letras, 1 + floor(random() * length(v_letras))::int, 1) ||
      substr(v_letras, 1 + floor(random() * length(v_letras))::int, 1) ||
      lpad(floor(random() * 1000)::int::text, 3, '0');

    insert into public.transaction_codes (code)
    values (v_codigo)
    on conflict (code) do nothing;

    if found then
      return v_codigo;
    end if;

    if v_intento >= 50 then
      raise exception 'No se pudo generar un código de transacción libre tras % intentos', v_intento;
    end if;
  end loop;
end;
$$;

-- ── THE COLUMNS ─────────────────────────────────────────────────────────
alter table public.sales
  add column if not exists transaction_code text;

alter table public.movements
  add column if not exists transaction_code text;

-- The search in the history filters by this, so it gets an index on both. Not
-- unique, for the reason in the header.
create index if not exists sales_transaction_code_idx
  on public.sales (transaction_code);

create index if not exists movements_transaction_code_idx
  on public.movements (transaction_code);

-- ── WHO ASSIGNS IT ──────────────────────────────────────────────────────
--
-- A trigger and not the application code, and that is deliberate: movements
-- are written from at least four places —the sale wizard, the directed abono,
-- the split abono (`registrar_abono_repartido`, a function), and the libreta
-- import— and CLAUDE.md has a whole section on what happens when a new field
-- is added to one entry point and not the others. A row written by any of
-- them, today or in two years, comes out with a code.
create or replace function public.asignar_codigo_de_venta()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.transaction_code is null then
    new.transaction_code := public.generar_codigo_transaccion();
  end if;
  return new;
end;
$$;

create or replace function public.asignar_codigo_de_movimiento()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_codigo text;
begin
  if new.transaction_code is not null then
    return new;
  end if;

  -- 1. BELONGS TO A SALE → the sale's code. Same transaction, two tables.
  if new.sale_id is not null then
    select s.transaction_code into v_codigo
    from public.sales s
    where s.id = new.sale_id;
    if v_codigo is not null then
      new.transaction_code := v_codigo;
      return new;
    end if;
  end if;

  -- 2. PART OF A SPLIT PAYMENT → whatever its siblings already got.
  --
  -- Inside one transaction the lines are inserted in sequence, so the second
  -- and third see the first. That is the whole mechanism that gives a split
  -- payment ONE code, which is the point of this migration.
  if new.payment_group_id is not null then
    select m.transaction_code into v_codigo
    from public.movements m
    where m.payment_group_id = new.payment_group_id
      and m.transaction_code is not null
    limit 1;
    if v_codigo is not null then
      new.transaction_code := v_codigo;
      return new;
    end if;
  end if;

  -- 3. ON ITS OWN.
  new.transaction_code := public.generar_codigo_transaccion();
  return new;
end;
$$;

drop trigger if exists sales_transaction_code on public.sales;
create trigger sales_transaction_code
  before insert on public.sales
  for each row execute function public.asignar_codigo_de_venta();

drop trigger if exists movements_transaction_code on public.movements;
create trigger movements_transaction_code
  before insert on public.movements
  for each row execute function public.asignar_codigo_de_movimiento();

-- ── WHAT IS ALREADY THERE ───────────────────────────────────────────────
--
-- Decision of the owner on 2026-10-23: the history gets codes too, not just
-- what comes next. A search box that finds nothing older than today teaches
-- people it does not work.
--
-- IT RUNS IN THREE PASSES AND THE ORDER MATTERS: sales first, because the
-- movements of a sale copy its code; then the split payments, one code per
-- group; then everything left over, one each. Running it the other way round
-- would give a sale's movements their own codes and the sale a different one.
--
-- RE-RUNNABLE: every pass only touches rows where the code is still null, so
-- a second run is a no-op. The `where transaction_code is null` is not an
-- optimisation, it is what makes this file safe to run twice — which, per
-- CLAUDE.md, is the run that actually happens after a correction.
do $$
declare
  v_fila record;
  v_codigo text;
begin
  -- 1. SALES.
  for v_fila in select id from public.sales where transaction_code is null loop
    update public.sales
    set transaction_code = public.generar_codigo_transaccion()
    where id = v_fila.id;
  end loop;

  -- 2. MOVEMENTS THAT BELONG TO A SALE.
  update public.movements m
  set transaction_code = s.transaction_code
  from public.sales s
  where m.sale_id = s.id
    and m.transaction_code is null
    and s.transaction_code is not null;

  -- 3. SPLIT PAYMENTS, one code per group.
  for v_fila in
    select distinct payment_group_id
    from public.movements
    where payment_group_id is not null
      and transaction_code is null
  loop
    v_codigo := public.generar_codigo_transaccion();
    update public.movements
    set transaction_code = v_codigo
    where payment_group_id = v_fila.payment_group_id
      and transaction_code is null;
  end loop;

  -- 4. EVERYTHING ELSE, one each.
  for v_fila in select id from public.movements where transaction_code is null loop
    update public.movements
    set transaction_code = public.generar_codigo_transaccion()
    where id = v_fila.id;
  end loop;
end;
$$;

-- ── GRANTS ──────────────────────────────────────────────────────────────
--
-- The generator is called by the triggers, which run as the table's writer.
-- `authenticated` needs execute for the shopkeeper's own inserts to work; it
-- is SECURITY DEFINER so it can write the registry, which nobody can read.
grant execute on function public.generar_codigo_transaccion() to authenticated, service_role;

insert into public.schema_migrations (key, description)
values (
  '147_codigo_de_transaccion',
  'Código corto por transacción (ABC000) en sales y movements, con registro de unicidad, triggers de asignación y relleno del histórico. Un reparto comparte un solo código.'
)
on conflict (key) do nothing;
