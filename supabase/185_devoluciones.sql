-- ENVIRONMENT: run in DEV first (vzqppwrwnmlbrxizskdh). Production comes later,
-- with its own green light, and BEFORE the code (CLAUDE.md, deploy step 1).
-- The old code keeps working against this file: no return exists until the new
-- code writes one. Re-runnable: every function is `create or replace`, every
-- trigger is dropped first, tables and columns are `if not exists`.
--
-- ===========================================================================
-- 185: RETURNS. A PRODUCT THAT COMES BACK IS NOT A PAYMENT.
--
-- Reported by a shopkeeper on 2026-11-03: a client brings a product back, the
-- only way to write it down is an abono, and that abono counts as money that
-- came in. The owner's request, the same day: choose the exact product inside
-- the fiado, mark it as returned, and the fiado's total, the client's balance
-- and the inventory all follow.
--
-- ===========================================================================
-- A TYPE OF ITS OWN, NOT AN ABONO WITH A FLAG
--
-- `recalc_client_running_balance` and the insert trigger do
-- `charge ? +amount : -amount`, so a `type = 'return'` row subtracts from the
-- balance with no change to the function that computes every balance. And
-- every report of money coming in asks for `type = 'payment'`, so a return
-- stays out of them by default. With a flag on `payment` it would be the other
-- way round: every sum that forgets the flag counts money that never came in,
-- and nothing warns.
--
-- The readers that said «not a payment» meaning «a fiado» were the trap: they
-- were moved to `= 'charge'` (`admin_tx_rows` here; the reports in TypeScript).
--
-- ===========================================================================
-- WHAT HAPPENS TO THE MONEY -- owner's decisions of 2026-11-03
--
-- The value of a return is `quantity x unit_price`. It first lowers the fiado
-- the product came from. What is left over is money the client ALREADY PAID,
-- and only then is there anything to decide. All of it per currency, because
-- the balance is one number per book.
--
--   Situation, in that currency            | Left over | What is offered
--   ---------------------------------------|-----------|----------------------
--   That fiado owes at least the value     | Nothing   | No question
--   Left over, other fiados owe            | Yes       | Abono to them, or cash
--   Left over, nothing else owed           | Yes       | Saldo a favor, or cash
--   Abono to fiados and there is still more| Yes       | Saldo a favor, or cash
--
-- Why each line of that table:
--
--   · NO QUESTION WHEN NOTHING IS LEFT OVER. A client who paid nothing has no
--     money to take back; offering «Entregar en efectivo» there would hand out
--     cash the shop never received.
--   · SALDO A FAVOR ONLY WITH NO DEBT IN THAT CURRENCY. One number per book:
--     owing $20 with $5 in favour can only print «Por cobrar $15». It would be
--     the abono option without choosing the fiado.
--   · ABONO ONLY TO FIADOS OF THE SAME CURRENCY. The owner's 2026-10-22 ruling
--     stands: paying a dollar fiado with euros needs a rate nobody agreed on.
--     Migration 141's exception was for bolivares handed over, not this.
--   · CASH IS ALWAYS OFFERED when something is left over, and never touches
--     `movements`: the money leaves the till, not the ledger. It lives in
--     `sale_returns.to_cash`, and Reportes subtracts it on the return's date.
--
-- `registrar_devolucion` enforces all of it. `lib/returns/options.ts` draws the
-- same table for the screen; the database is the one that decides.
--
-- ===========================================================================
-- HOW IT IS WRITTEN
--
-- One `sale_returns` row is the event, and `movements` holds its ledger lines,
-- all sharing `payment_group_id = sale_returns.id` and therefore one
-- transaction code (migration 147's trigger):
--
--   · the line for its own fiado, ALWAYS, even at amount 0: a return paid back
--     entirely in cash moves no balance and still has to appear in the history.
--     That is the only reason `amount` may be zero, and only for this type;
--   · one line per other fiado chosen;
--   · one line with no fiado for the saldo a favor.
--
-- `sale_lines` stays untouched: rule 6 of migration 180 says a sale is written
-- once, so what came back lives beside the line, not in it.
--
-- ===========================================================================
-- THE SALDO A FAVOR REACHES THE NEXT FIADO BY THE ORDER OF THE QUEUE
--
-- `get_open_charges_for_client` walks the book in date order, and a payment
-- with no open charge in front of it disappears from the queue. A saldo a favor
-- is exactly that: it is written BEFORE the fiado it should pay. So the balance
-- would say $7 and the fiado would say $12, two figures for one debt.
--
-- The fix is one line: rows of a saldo a favor (`type = 'return'` with no fiado)
-- are walked LAST. By then every charge is in the queue and they settle the
-- oldest. Only those rows: an old overpayment keeps doing what it always did,
-- so no balance stored today changes. `lib/credit-score.ts` sorts the same way,
-- because two copies of this queue drifting apart is what `CT-124` cost.
--
-- USING IT IN A CASH SALE needs nothing new in the ledger. The part paid with
-- the saldo is a charge with no plazo, `paid_with_credit = true`, which the
-- queue settles at once. `get_client_credit` says how much can be used: only
-- what came from a return, so an old overpayment is never offered as money.
--
-- ===========================================================================
-- ACCEPTED, AND SAID OUT LOUD
--
--   · A fiado in cuotas counts a return as paid cuotas: 3 of $10 with $10
--     returned leaves the second one as the next due. The debt is right; the
--     calendar reads as if the first had been paid.
--   · The product goes back to the shelf whatever the reason, damaged too. It
--     is what the owner asked for. A quantity that was never counted stays
--     NULL (the warning at the top of migration 163).
--   · Deleting an abono that a past return relied on does not undo the cash.
--
-- ===========================================================================

begin;

-- ── 1. `movements` learns the new type ─────────────────────────────────────
--
-- By lookup and not by name: these two constraints were born inline in
-- `schema.sql`, and a name assumed here would be a silent no-op on a database
-- that spells them differently.
do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.movements'::regclass
      and contype = 'c'
      and (
        pg_get_constraintdef(oid) ~ 'type = ANY'
        or pg_get_constraintdef(oid) ~ '\(amount > '
        or conname in ('movements_type_check', 'movements_amount_check')
      )
  loop
    execute format('alter table public.movements drop constraint %I', c.conname);
  end loop;
end
$$;

alter table public.movements
  add constraint movements_type_check check (type in ('charge', 'payment', 'return'));

alter table public.movements
  add constraint movements_amount_check check (amount > 0 or (type = 'return' and amount = 0));

-- The part of a sale paid with saldo a favor. Only a label: the queue is what
-- settles it. A console that sets it by hand gains nothing but a wrong word.
alter table public.movements
  add column if not exists paid_with_credit boolean not null default false;

-- ── 2. The return itself ───────────────────────────────────────────────────
create table if not exists public.sale_returns (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owners (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  sale_id uuid not null references public.sales (id) on delete cascade,
  sale_line_id uuid not null references public.sale_lines (id) on delete cascade,
  -- The fiado it came from. Not a cascade target of `sales`: the guards below
  -- refuse to delete a fiado or a sale while a live return hangs from it.
  charge_movement_id uuid not null references public.movements (id) on delete cascade,
  -- Copied, not joined: the line says what was sold, and a product can be
  -- renamed or binned afterwards. `product_id` is null for a line with no
  -- product behind it, and then no inventory moves.
  product_id uuid references public.products (id) on delete set null,
  product_name text not null,
  quantity numeric(14, 3) not null check (quantity > 0),
  unit_price numeric(14, 4) not null,
  amount numeric(14, 4) not null check (amount > 0),
  -- The ledger's spelling: 'USD', 'EUR', or NULL for a Colombian book. Never
  -- 'COP', which is how `sale_lines` spells it.
  currency text check (currency is null or currency in ('USD', 'EUR')),
  -- WHERE THE VALUE WENT. These four add up to `amount`.
  to_own numeric(14, 4) not null default 0 check (to_own >= 0),
  to_fiados numeric(14, 4) not null default 0 check (to_fiados >= 0),
  to_credit numeric(14, 4) not null default 0 check (to_credit >= 0),
  to_cash numeric(14, 4) not null default 0 check (to_cash >= 0),
  -- What really went back on the shelf: null when the quantity was never
  -- counted. Deleting the return takes back exactly this.
  stock_returned numeric(14, 3),
  created_by uuid references public.owners (id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint sale_returns_adds_up check (
    abs(to_own + to_fiados + to_credit + to_cash - amount) <= 0.01
  )
);

create index if not exists sale_returns_owner_created_idx on public.sale_returns (owner_id, created_at);
create index if not exists sale_returns_line_idx on public.sale_returns (sale_line_id);
create index if not exists sale_returns_charge_idx on public.sale_returns (charge_movement_id);

alter table public.sale_returns enable row level security;

drop policy if exists "owners read own returns" on public.sale_returns;
create policy "owners read own returns" on public.sale_returns
  for select to authenticated
  using (owner_id = auth.uid());

-- READ ONLY FOR THE OWNER, and the grant is not optional: the lesson of
-- migration 108 is a correct policy with no grant. Writing goes through the
-- functions below, which is why there is no insert or update here.
grant select on public.sale_returns to authenticated;

-- ── 3. The queue walks a saldo a favor last ────────────────────────────────
create or replace function public.get_open_charges_for_client(p_client_id uuid)
returns table (
  movement_id uuid,
  sale_id uuid,
  charge_at timestamptz,
  currency text,
  amount numeric,
  pending numeric,
  plazo_dias int,
  cuotas int,
  description text
)
language plpgsql
stable
as $$
declare
  cur record;
  m record;
  queue_id uuid[];
  queue_sale uuid[];
  queue_amount numeric[];
  queue_total numeric[];
  queue_at timestamptz[];
  queue_plazo int[];
  queue_cuotas int[];
  queue_desc text[];
  remaining numeric;
  i int;
  dirigido boolean;
begin
  -- ONE LEDGER AT A TIME. `currency is not distinct from` keeps the NULL of a
  -- Colombian business as a ledger of its own and not as "no currency" -- the
  -- same detail the queue above has carried since migration 025.
  -- NO `as currency` ALIAS HERE: `currency` is also an OUT parameter of this
  -- function, and giving the query column the same name is exactly how plpgsql
  -- ends up reporting an ambiguous reference. Everything else in the body is
  -- qualified with `mv.` for the same reason -- `amount`, `description`,
  -- `cuotas`, `plazo_dias` and `sale_id` are all both OUT params and columns.
  for cur in
    select distinct mv.currency
    from public.movements mv
    where mv.client_id = p_client_id
      and mv.deleted_at is null
  loop
    queue_id := '{}';
    queue_sale := '{}';
    queue_amount := '{}';
    queue_total := '{}';
    queue_at := '{}';
    queue_plazo := '{}';
    queue_cuotas := '{}';
    queue_desc := '{}';

    for m in
      select mv.id, mv.sale_id, mv.type, mv.amount, mv.created_at,
             mv.plazo_dias, mv.cuotas, mv.description, mv.applies_to_movement_id
      from public.movements mv
      where mv.client_id = p_client_id
        and mv.currency is not distinct from cur.currency
        and mv.deleted_at is null
      order by (mv.type = 'return' and mv.applies_to_movement_id is null), mv.created_at asc, mv.id asc
    loop
      if m.type = 'charge' then
        queue_id := array_append(queue_id, m.id);
        queue_sale := array_append(queue_sale, m.sale_id);
        queue_amount := array_append(queue_amount, m.amount);
        queue_total := array_append(queue_total, m.amount);
        queue_at := array_append(queue_at, m.created_at);
        queue_plazo := array_append(queue_plazo, m.plazo_dias);
        queue_cuotas := array_append(queue_cuotas, m.cuotas);
        queue_desc := array_append(queue_desc, m.description);
      else
        dirigido := false;

        if m.applies_to_movement_id is not null then
          i := 1;
          while i <= coalesce(array_length(queue_id, 1), 0) loop
            if queue_id[i] = m.applies_to_movement_id then
              queue_amount[i] := greatest(queue_amount[i] - m.amount, 0);
              dirigido := true;
              exit;
            end if;
            i := i + 1;
          end loop;
        end if;

        if not dirigido then
          remaining := m.amount;
          i := 1;
          while remaining > 0 and i <= coalesce(array_length(queue_amount, 1), 0) loop
            if queue_amount[i] > 0 then
              if queue_amount[i] <= remaining then
                remaining := remaining - queue_amount[i];
                queue_amount[i] := 0;
              else
                queue_amount[i] := queue_amount[i] - remaining;
                remaining := 0;
              end if;
            end if;
            i := i + 1;
          end loop;
        end if;
      end if;
    end loop;

    -- OLDEST FIRST, which is the order the screen wants: the fiado the
    -- shopkeeper most likely wants to settle is the one that has been open
    -- longest. The screen's "Fecha" filter can reverse it.
    for i in 1 .. coalesce(array_length(queue_amount, 1), 0) loop
      if queue_amount[i] > 0 then
        movement_id := queue_id[i];
        sale_id := queue_sale[i];
        charge_at := queue_at[i];
        currency := cur.currency;
        amount := queue_total[i];
        pending := queue_amount[i];
        plazo_dias := queue_plazo[i];
        cuotas := queue_cuotas[i];
        description := queue_desc[i];
        return next;
      end if;
    end loop;
  end loop;

  return;
end;
$$;

create or replace function public.get_oldest_unpaid_charge_for_currency(
  p_client_id uuid,
  p_currency text
)
returns table (charge_at timestamptz, plazo_dias int, due_at timestamptz)
language plpgsql
stable
as $$
declare
  m record;
  -- `queue_id` IS THE ONLY NEW ARRAY: without the charge's own id there is no
  -- way for a directed payment to find the entry it belongs to.
  queue_id uuid[] := '{}';
  queue_amount numeric[] := '{}';  -- lo que queda por cubrir de cada cargo
  queue_total numeric[] := '{}';   -- su importe original, para contar cuotas
  queue_at timestamptz[] := '{}';
  queue_plazo int[] := '{}';
  queue_cuotas int[] := '{}';
  remaining numeric;
  i int;
  n int;
  cubiertas int;
  dirigido boolean;
begin
  for m in
    select mv.id, mv.type, mv.amount, mv.created_at, mv.plazo_dias, mv.cuotas,
           mv.applies_to_movement_id
    from public.movements mv
    where mv.client_id = p_client_id
      and mv.currency is not distinct from p_currency
      and mv.deleted_at is null
    order by (mv.type = 'return' and mv.applies_to_movement_id is null), mv.created_at asc, mv.id asc
  loop
    if m.type = 'charge' then
      queue_id := array_append(queue_id, m.id);
      queue_amount := array_append(queue_amount, m.amount);
      queue_total := array_append(queue_total, m.amount);
      queue_at := array_append(queue_at, m.created_at);
      queue_plazo := array_append(queue_plazo, m.plazo_dias);
      queue_cuotas := array_append(queue_cuotas, m.cuotas);
    else
      dirigido := false;

      if m.applies_to_movement_id is not null then
        i := 1;
        while i <= coalesce(array_length(queue_id, 1), 0) loop
          if queue_id[i] = m.applies_to_movement_id then
            -- `greatest(..., 0)` AND NOT A PLAIN SUBTRACTION: the screen caps a
            -- directed payment at what its fiado still owes, but this function
            -- is read by code that did not necessarily go through that screen.
            -- A negative entry here would read as "this charge is more than
            -- paid" and silently pull the next one forward.
            queue_amount[i] := greatest(queue_amount[i] - m.amount, 0);
            dirigido := true;
            exit;
          end if;
          i := i + 1;
        end loop;
      end if;

      -- NO DIRECTION, OR A DIRECTION POINTING AT A CHARGE THAT IS NOT HERE:
      -- the old rule, untouched. This is the branch every historical payment
      -- takes, which is why nothing stored today changes.
      if not dirigido then
        remaining := m.amount;
        i := 1;
        while remaining > 0 and i <= coalesce(array_length(queue_amount, 1), 0) loop
          if queue_amount[i] > 0 then
            if queue_amount[i] <= remaining then
              remaining := remaining - queue_amount[i];
              queue_amount[i] := 0;
            else
              queue_amount[i] := queue_amount[i] - remaining;
              remaining := 0;
            end if;
          end if;
          i := i + 1;
        end loop;
      end if;
    end if;
  end loop;

  for i in 1 .. coalesce(array_length(queue_amount, 1), 0) loop
    if queue_amount[i] > 0 then
      charge_at := queue_at[i];
      plazo_dias := queue_plazo[i];
      due_at := null;

      -- Sin plazo no hay vencimiento que calcular, y el estado del cliente ya
      -- tiene su propia etiqueta para eso ("Sin plazo").
      if queue_plazo[i] is not null then
        n := greatest(coalesce(queue_cuotas[i], 1), 1);

        -- CUÁNTAS CUOTAS ENTERAS TAPÓ LO ABONADO. `floor` es la decisión del
        -- dueño del 2026-10-16 escrita en aritmética: media cuota no cuenta.
        if queue_total[i] > 0 then
          cubiertas := floor((queue_total[i] - queue_amount[i]) / (queue_total[i] / n));
        else
          cubiertas := 0;
        end if;

        if cubiertas > n - 1 then
          cubiertas := n - 1;
        end if;

        due_at := queue_at[i]
          + (interval '1 day' * (queue_plazo[i]::numeric * (cubiertas + 1) / n));
      end if;

      return next;
      return;
    end if;
  end loop;

  return;
end;
$$;

-- ── 4. A report that said «not a payment» meaning «a fiado» ────────────────
create or replace function public.admin_tx_rows(
  p_country  text default null,
  p_currency text default null,
  p_owners   uuid[] default null,
  p_from     timestamptz default null,
  p_to       timestamptz default null
)
returns table (
  kind        text,
  origin      text,
  currency    text,
  amount      numeric,
  occurred_at timestamptz,
  country     text
)
language sql
stable
security definer
set search_path = public
as $$
  with duenos as (
    select o.id, o.country
    from public.owners o
    where (p_country is null or o.country = p_country)
      and (p_owners  is null or cardinality(p_owners) = 0 or o.id = any(p_owners))
  ),
  ventas as (
    select s.id, s.created_at, d.country
    from public.sales s
    join duenos d on d.id = s.owner_id
    where s.deleted_at is null
      and public.admin_en_ventana(s.created_at, d.country, p_from, p_to)
  ),
  pagos as (
    select sp.sale_id,
           case when sp.currency in ('USD', 'EUR') then sp.currency else 'COP' end as libro,
           sum(sp.amount) as amount
    from public.sale_payments sp
    join ventas v on v.id = sp.sale_id
    group by 1, 2
  ),
  libros_fiados as (
    select distinct m.sale_id, coalesce(m.currency, 'COP') as libro
    from public.movements m
    join ventas v on v.id = m.sale_id
    where m.type = 'charge' and m.deleted_at is null
  ),
  pares as (
    select p.libro, p.amount, (f.sale_id is not null) as dejo_fiado, v.created_at, v.country
    from pagos p
    join ventas v on v.id = p.sale_id
    left join libros_fiados f on f.sale_id = p.sale_id and f.libro = p.libro
    where p.amount > 0
  ),
  movs as (
    select m.type,
           m.amount,
           coalesce(m.currency, 'COP') as libro,
           case
             when m.sale_id is not null       then 'venta'
             when m.is_old_debt               then 'deuda_antigua'
             when m.source = 'photo_import'   then 'libreta'
             else 'manual'
           end as origen,
           coalesce(m.payment_group_id, m.id) as grupo,
           m.created_at,
           d.country
    from public.movements m
    join public.clients c on c.id = m.client_id
    join duenos d on d.id = c.owner_id
    where m.deleted_at is null
      and public.admin_en_ventana(m.created_at, d.country, p_from, p_to)
  ),
  filas as (
    select (case when dejo_fiado then 'abono' else 'contado' end)::text as kind,
           (case when dejo_fiado then 'al_vender' else 'venta' end)::text as origin,
           libro as currency, amount, created_at as occurred_at, country
    from pares
    union all
    -- A split payment is ONE transaction: its lines share a group, a book
    -- and a timestamp, so they collapse into one row here.
    select 'abono', 'abono', libro, sum(amount), min(created_at), min(country)
    from movs where type = 'payment'
    group by grupo, libro
    union all
    select 'fiado', origen, libro, amount, created_at, country
    from movs where type = 'charge'
  )
  select kind, origin, currency, amount, occurred_at, country
  from filas
  where p_currency is null or currency = p_currency;
$$;

-- ── 5. How much saldo a favor can be spent ─────────────────────────────────
--
-- WHAT THE BOOK IS IN FAVOUR, capped by what came from returns. Only that part
-- is settled by the queue, so offering an old overpayment would write a fiado
-- the queue never closes. Runs as the caller: RLS on `movements` is the fence.
create or replace function public.get_client_credit(p_client_id uuid)
returns table (currency text, credit numeric)
language sql
stable
as $$
  select
    mv.currency,
    greatest(
      0,
      least(
        -sum(case when mv.type = 'charge' then mv.amount else -mv.amount end),
        coalesce(sum(mv.amount) filter (
          where mv.type = 'return' and mv.applies_to_movement_id is null
        ), 0)
      )
    )
  from public.movements mv
  where mv.client_id = p_client_id
    and mv.deleted_at is null
  group by mv.currency;
$$;

revoke all on function public.get_client_credit(uuid) from public, anon;
grant execute on function public.get_client_credit(uuid) to authenticated;

-- ── 6. Registering a return ────────────────────────────────────────────────
--
-- `security definer` for the same reason as `registrar_abono_repartido`: several
-- ledger lines, the stock and the event have to land together or not at all,
-- and a server action cannot give that. It is also what exempts these inserts
-- from migration 180's direct-write rules.
create or replace function public.registrar_devolucion(
  p_movement_id uuid,
  p_line_id uuid,
  p_quantity numeric,
  p_fiados jsonb default '[]'::jsonb,
  p_a_favor numeric default 0,
  p_efectivo numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_owner uuid := auth.uid();
  v_fiado public.movements%rowtype;
  v_line public.sale_lines%rowtype;
  v_returned numeric;
  v_amount numeric;
  v_pending numeric;
  v_own numeric;
  v_excess numeric;
  v_item jsonb;
  v_target uuid;
  v_target_amount numeric;
  v_target_pending numeric;
  v_to_fiados numeric := 0;
  v_other_debt numeric;
  v_ceiling numeric;
  v_return_id uuid := gen_random_uuid();
  v_own_row uuid;
  v_stock numeric;
  v_code text;
  -- Half a cent, the tolerance the abonos use.
  v_holgura constant numeric := 0.005;
begin
  if v_owner is null then
    return jsonb_build_object('ok', false, 'code', 'sin_sesion');
  end if;
  if not public.owner_puede_escribir(v_owner) then
    return jsonb_build_object('ok', false, 'code', 'cuenta_pausada');
  end if;
  if p_quantity is null or p_quantity <= 0 then
    return jsonb_build_object('ok', false, 'code', 'cantidad_invalida');
  end if;
  if jsonb_typeof(coalesce(p_fiados, '[]'::jsonb)) <> 'array'
     or coalesce(p_a_favor, 0) < 0 or coalesce(p_efectivo, 0) < 0 then
    return jsonb_build_object('ok', false, 'code', 'formato');
  end if;
  if jsonb_array_length(coalesce(p_fiados, '[]'::jsonb)) > 50 then
    return jsonb_build_object('ok', false, 'code', 'tamano');
  end if;

  -- THE FIADO AND ITS OWNER, EXPLICITLY. The ids come from the browser and this
  -- function reads with its own rights, so this is the lock, not the backstop.
  select m.* into v_fiado
  from public.movements m
  join public.clients c on c.id = m.client_id
  where m.id = p_movement_id
    and m.type = 'charge'
    and m.deleted_at is null
    and c.owner_id = v_owner
    and c.trashed_at is null
    and c.deleted_at is null;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'fiado_ajeno');
  end if;

  -- An old debt has no purchase (CLAUDE.md), and a fiado with no sale has no
  -- lines to return.
  if v_fiado.is_old_debt or v_fiado.sale_id is null then
    return jsonb_build_object('ok', false, 'code', 'sin_productos');
  end if;

  if not exists (
    select 1 from public.sales s where s.id = v_fiado.sale_id and s.deleted_at is null
  ) then
    return jsonb_build_object('ok', false, 'code', 'venta_eliminada');
  end if;

  -- One at a time per client: two returns of the same line could each fit, and
  -- their fiados' pending is read just below.
  perform pg_advisory_xact_lock(hashtext('movements:' || v_fiado.client_id::text));

  -- THE LINE, IN THIS FIADO'S BOOK. `sale_lines` spells the Colombian book
  -- 'COP' and `movements` spells it NULL, so a raw comparison never matches for
  -- a Colombian business: the trap `qa:colombia` exists for.
  select l.* into v_line
  from public.sale_lines l
  where l.id = p_line_id
    and l.sale_id = v_fiado.sale_id
    and coalesce(case when l.currency in ('USD', 'EUR') then l.currency end, '')
        = coalesce(v_fiado.currency, '');

  if not found then
    return jsonb_build_object('ok', false, 'code', 'linea_ajena');
  end if;

  select coalesce(sum(r.quantity), 0) into v_returned
  from public.sale_returns r
  where r.sale_line_id = p_line_id and r.deleted_at is null;

  if p_quantity - (v_line.quantity - v_returned) > 0.0005 then
    return jsonb_build_object(
      'ok', false, 'code', 'excede_la_cantidad',
      'disponible', v_line.quantity - v_returned
    );
  end if;

  v_amount := round(p_quantity * v_line.unit_price, 2);
  if v_amount <= 0 then
    return jsonb_build_object('ok', false, 'code', 'sin_valor');
  end if;

  -- THE VALUE CANNOT PASS WHAT THIS BOOK OF THE SALE WAS WORTH. Older fiados
  -- could be typed below the sum of their lines (a rounded-down price), and
  -- returning at list price would give back more than was ever charged.
  select v_fiado.amount
         + coalesce((
             select sum(sp.amount) from public.sale_payments sp
             where sp.sale_id = v_fiado.sale_id
               and coalesce(case when sp.currency in ('USD', 'EUR') then sp.currency end, '')
                   = coalesce(v_fiado.currency, '')
           ), 0)
         - coalesce((
             select sum(r.amount) from public.sale_returns r
             where r.charge_movement_id = v_fiado.id and r.deleted_at is null
           ), 0)
    into v_ceiling;

  if v_amount - v_ceiling > v_holgura then
    return jsonb_build_object('ok', false, 'code', 'excede_la_venta', 'tope', v_ceiling);
  end if;

  -- WHAT THIS FIADO STILL OWES, from the one function that knows it. Called,
  -- never copied: `CT-124` is what a second copy of that sum cost.
  select coalesce(sum(o.pending), 0) into v_pending
  from public.get_open_charges_for_client(v_fiado.client_id) o
  where o.movement_id = v_fiado.id;

  v_own := least(v_amount, v_pending);
  v_excess := round(v_amount - v_own, 2);
  if v_excess < v_holgura then
    v_own := v_amount;
    v_excess := 0;
  end if;

  -- ── EVERY OTHER FIADO, VALIDATED BEFORE ANYTHING IS WRITTEN ──────────────
  for v_item in select * from jsonb_array_elements(coalesce(p_fiados, '[]'::jsonb))
  loop
    v_target := (v_item ->> 'fiado_id')::uuid;
    v_target_amount := (v_item ->> 'amount')::numeric;

    if v_target_amount is null or v_target_amount <= 0 then
      return jsonb_build_object('ok', false, 'code', 'monto_invalido', 'fiado_id', v_target);
    end if;

    if v_target = v_fiado.id then
      return jsonb_build_object('ok', false, 'code', 'fiado_propio', 'fiado_id', v_target);
    end if;

    if (select count(*) from jsonb_array_elements(p_fiados) x
        where (x ->> 'fiado_id')::uuid = v_target) > 1 then
      return jsonb_build_object('ok', false, 'code', 'fiado_repetido', 'fiado_id', v_target);
    end if;

    -- SAME CLIENT, LIVE CHARGE, SAME BOOK. `is not distinct from` keeps the
    -- NULL of a Colombian book as a book of its own.
    perform 1
    from public.movements t
    where t.id = v_target
      and t.client_id = v_fiado.client_id
      and t.type = 'charge'
      and t.deleted_at is null
      and t.currency is not distinct from v_fiado.currency;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'fiado_ajeno', 'fiado_id', v_target);
    end if;

    select o.pending into v_target_pending
    from public.get_open_charges_for_client(v_fiado.client_id) o
    where o.movement_id = v_target;

    if v_target_pending is null then
      return jsonb_build_object('ok', false, 'code', 'fiado_saldado', 'fiado_id', v_target);
    end if;
    if v_target_amount - v_target_pending > v_holgura then
      return jsonb_build_object(
        'ok', false, 'code', 'excede_el_fiado',
        'fiado_id', v_target, 'pendiente', v_target_pending
      );
    end if;

    v_to_fiados := v_to_fiados + v_target_amount;
  end loop;

  -- THE LEFT-OVER HAS TO BE SPOKEN FOR, WHOLE. Nothing is assumed: a browser
  -- that says nothing about it gets a refusal, never a default destination.
  if abs(v_to_fiados + coalesce(p_a_favor, 0) + coalesce(p_efectivo, 0) - v_excess) > 0.01 then
    return jsonb_build_object('ok', false, 'code', 'reparto_no_cuadra', 'sobrante', v_excess);
  end if;

  -- SALDO A FAVOR ONLY WITH NO DEBT LEFT IN THIS BOOK. See the header.
  if coalesce(p_a_favor, 0) > 0 then
    select coalesce(sum(o.pending), 0) into v_other_debt
    from public.get_open_charges_for_client(v_fiado.client_id) o
    where o.movement_id <> v_fiado.id
      and o.currency is not distinct from v_fiado.currency;

    if v_other_debt - v_to_fiados > v_holgura then
      return jsonb_build_object('ok', false, 'code', 'hay_deuda_en_esa_moneda', 'deuda', v_other_debt);
    end if;
  end if;

  -- ── AND ONLY NOW IT IS WRITTEN ───────────────────────────────────────────

  -- ITS OWN LINE, ALWAYS, even at zero. See the header.
  insert into public.movements (
    client_id, created_by, type, amount, currency, source,
    applies_to_movement_id, payment_group_id
  )
  values (
    v_fiado.client_id, v_owner, 'return', v_own, v_fiado.currency, 'manual',
    v_fiado.id, v_return_id
  )
  returning id, transaction_code into v_own_row, v_code;

  for v_item in select * from jsonb_array_elements(coalesce(p_fiados, '[]'::jsonb))
  loop
    insert into public.movements (
      client_id, created_by, type, amount, currency, source,
      applies_to_movement_id, payment_group_id
    )
    values (
      v_fiado.client_id, v_owner, 'return', (v_item ->> 'amount')::numeric,
      v_fiado.currency, 'manual', (v_item ->> 'fiado_id')::uuid, v_return_id
    );
  end loop;

  if coalesce(p_a_favor, 0) > 0 then
    insert into public.movements (
      client_id, created_by, type, amount, currency, source, payment_group_id
    )
    values (
      v_fiado.client_id, v_owner, 'return', p_a_favor, v_fiado.currency, 'manual', v_return_id
    );
  end if;

  -- BACK ON THE SHELF. Only a counted quantity: a 0 born here would switch the
  -- product off in the public catalogue (migration 163). `for update` for the
  -- same reason the sale trigger locks it.
  if v_line.product_id is not null then
    select p.stock_opening into v_stock
    from public.products p
    where p.id = v_line.product_id
    for update;

    if v_stock is not null then
      update public.products
         set stock_opening = v_stock + p_quantity,
             updated_at = now()
       where id = v_line.product_id;
      v_stock := p_quantity;
    end if;
  end if;

  insert into public.sale_returns (
    id, owner_id, client_id, sale_id, sale_line_id, charge_movement_id,
    product_id, product_name, quantity, unit_price, amount, currency,
    to_own, to_fiados, to_credit, to_cash, stock_returned, created_by
  )
  values (
    v_return_id, v_owner, v_fiado.client_id, v_fiado.sale_id, p_line_id, v_fiado.id,
    v_line.product_id, v_line.name, p_quantity, v_line.unit_price, v_amount, v_fiado.currency,
    v_own, v_to_fiados, coalesce(p_a_favor, 0), coalesce(p_efectivo, 0), v_stock, v_owner
  );

  -- SEVERAL ROWS IN ONE TRANSACTION SHARE `created_at`, so the insert trigger
  -- chains them in uuid order. CLAUDE.md: whoever writes several movements at
  -- once recalculates.
  perform public.recalc_client_running_balance(v_fiado.client_id);

  return jsonb_build_object(
    'ok', true,
    'return_id', v_return_id,
    'movement_id', v_own_row,
    'client_id', v_fiado.client_id,
    'transaction_code', v_code,
    'amount', v_amount,
    'to_own', v_own,
    'to_fiados', v_to_fiados,
    'to_credit', coalesce(p_a_favor, 0),
    'to_cash', coalesce(p_efectivo, 0)
  );
end;
$fn$;

revoke all on function public.registrar_devolucion(uuid, uuid, numeric, jsonb, numeric, numeric) from public, anon;
grant execute on function public.registrar_devolucion(uuid, uuid, numeric, jsonb, numeric, numeric) to authenticated;

-- ── 7. Deleting and restoring it ───────────────────────────────────────────
--
-- THE SAME PATTERN AS AN ABONO (button, confirmation, notice with «Restaurar»),
-- owner's decision of 2026-11-03, and it stays type «Devolución». A function and
-- not the app's generic soft delete, because the ledger lines, the event and
-- the shelf have to move together.
create or replace function public.eliminar_devolucion(p_movement_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_owner uuid := auth.uid();
  v_return public.sale_returns%rowtype;
  v_now timestamptz := now();
begin
  if v_owner is null then
    return jsonb_build_object('ok', false, 'code', 'sin_sesion');
  end if;
  if not public.owner_puede_escribir(v_owner) then
    return jsonb_build_object('ok', false, 'code', 'cuenta_pausada');
  end if;

  select r.* into v_return
  from public.sale_returns r
  join public.movements m on m.payment_group_id = r.id
  where m.id = p_movement_id
    and m.type = 'return'
    and r.owner_id = v_owner
    and r.deleted_at is null;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'no_encontrada');
  end if;

  perform pg_advisory_xact_lock(hashtext('movements:' || v_return.client_id::text));

  update public.movements
     set deleted_at = v_now
   where payment_group_id = v_return.id
     and type = 'return'
     and deleted_at is null;

  update public.sale_returns set deleted_at = v_now where id = v_return.id;

  -- WHAT WENT ON THE SHELF COMES OFF IT, clamped: those units may have been
  -- sold again since, and a negative shelf means nothing.
  if v_return.stock_returned is not null and v_return.product_id is not null then
    update public.products
       set stock_opening = greatest(0, stock_opening - v_return.stock_returned),
           updated_at = now()
     where id = v_return.product_id
       and stock_opening is not null;
  end if;

  -- ONE NOTICE, like a split abono: the shopkeeper did one thing.
  insert into public.movement_deletions (movement_id, owner_id, client_id)
  select m.id, v_owner, v_return.client_id
  from public.movements m
  where m.payment_group_id = v_return.id
    and m.applies_to_movement_id = v_return.charge_movement_id
  limit 1;

  perform public.recalc_client_running_balance(v_return.client_id);

  return jsonb_build_object('ok', true, 'client_id', v_return.client_id);
end;
$fn$;

revoke all on function public.eliminar_devolucion(uuid) from public, anon;
grant execute on function public.eliminar_devolucion(uuid) to authenticated;

create or replace function public.restaurar_devolucion(p_movement_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_owner uuid := auth.uid();
  v_return public.sale_returns%rowtype;
  v_line_qty numeric;
  v_returned numeric;
  v_row record;
  v_pending numeric;
  v_stock numeric;
begin
  if v_owner is null then
    return jsonb_build_object('ok', false, 'code', 'sin_sesion');
  end if;
  if not public.owner_puede_escribir(v_owner) then
    return jsonb_build_object('ok', false, 'code', 'cuenta_pausada');
  end if;

  select r.* into v_return
  from public.sale_returns r
  join public.movements m on m.payment_group_id = r.id
  where m.id = p_movement_id
    and m.type = 'return'
    and r.owner_id = v_owner
    and r.deleted_at is not null;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'no_encontrada');
  end if;

  perform pg_advisory_xact_lock(hashtext('movements:' || v_return.client_id::text));

  -- ITS FIADO AND ITS SALE HAVE TO STILL BE THERE.
  if not exists (
    select 1 from public.movements m
    where m.id = v_return.charge_movement_id and m.deleted_at is null
  ) or not exists (
    select 1 from public.sales s
    where s.id = v_return.sale_id and s.deleted_at is null
  ) then
    return jsonb_build_object('ok', false, 'code', 'fiado_eliminado');
  end if;

  -- THE SAME UNITS CANNOT COME BACK TWICE. Between the delete and this restore
  -- the shopkeeper may have registered the return again, which is the likely
  -- reason a return gets deleted at all.
  select l.quantity into v_line_qty from public.sale_lines l where l.id = v_return.sale_line_id;
  select coalesce(sum(r.quantity), 0) into v_returned
  from public.sale_returns r
  where r.sale_line_id = v_return.sale_line_id and r.deleted_at is null;

  if v_return.quantity - (v_line_qty - v_returned) > 0.0005 then
    return jsonb_build_object('ok', false, 'code', 'ya_devuelto');
  end if;

  -- EVERY LINE AIMED AT A FIADO HAS TO STILL FIT. Otherwise the balance would
  -- drop by money the queue cannot place, and the two figures would part.
  for v_row in
    select m.applies_to_movement_id, m.amount
    from public.movements m
    where m.payment_group_id = v_return.id
      and m.type = 'return'
      and m.applies_to_movement_id is not null
      and m.amount > 0
  loop
    select coalesce(sum(o.pending), 0) into v_pending
    from public.get_open_charges_for_client(v_return.client_id) o
    where o.movement_id = v_row.applies_to_movement_id;

    if v_row.amount - v_pending > 0.005 then
      return jsonb_build_object('ok', false, 'code', 'ya_no_cabe');
    end if;
  end loop;

  update public.movements
     set deleted_at = null
   where payment_group_id = v_return.id
     and type = 'return'
     and deleted_at = v_return.deleted_at;

  update public.sale_returns set deleted_at = null where id = v_return.id;

  if v_return.stock_returned is not null and v_return.product_id is not null then
    select p.stock_opening into v_stock
    from public.products p where p.id = v_return.product_id for update;

    if v_stock is not null then
      update public.products
         set stock_opening = v_stock + v_return.stock_returned,
             updated_at = now()
       where id = v_return.product_id;
    end if;
  end if;

  update public.movement_deletions d
     set restored_at = now()
   where d.restored_at is null
     and d.movement_id in (
       select m.id from public.movements m where m.payment_group_id = v_return.id
     );

  perform public.recalc_client_running_balance(v_return.client_id);

  return jsonb_build_object('ok', true, 'client_id', v_return.client_id);
end;
$fn$;

revoke all on function public.restaurar_devolucion(uuid) from public, anon;
grant execute on function public.restaurar_devolucion(uuid) to authenticated;

-- ── 8. The guards ──────────────────────────────────────────────────────────
--
-- ALWAYS ON, unlike migration 180's rules, which watch before they refuse.
-- Those had to prove they would not stop a real flow; these cannot stop one,
-- because the app has no path that does any of this. The app's own actions
-- check first and show a sentence; these are for the console.
--
-- THE STOCK IS WHY A SALE CANNOT GO WHILE A RETURN IS ALIVE: deleting a sale
-- gives back `stock_taken` whole (migration 163), so units already returned
-- would land on the shelf twice. Refusing is simpler and safer than teaching
-- that trigger to subtract, and the shopkeeper's way out is one tap away.
create or replace function public.movements_guard_returns()
returns trigger
language plpgsql
as $$
begin
  if not public.ledger_direct_write() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.type = 'return' then
      raise exception using
        message = 'Una devolución se registra desde el fiado.', errcode = 'SZ010';
    end if;
    return new;
  end if;

  if new.deleted_at is distinct from old.deleted_at then
    if old.type = 'return' then
      raise exception using
        message = 'Una devolución se elimina desde su detalle.', errcode = 'SZ010';
    end if;
    if new.deleted_at is not null and exists (
      select 1 from public.sale_returns r
      where r.charge_movement_id = old.id and r.deleted_at is null
    ) then
      raise exception using
        message = 'Este fiado tiene devoluciones. Elimínalas primero.', errcode = 'SZ011';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists movements_guard_returns on public.movements;
create trigger movements_guard_returns
  before insert or update on public.movements
  for each row execute function public.movements_guard_returns();

create or replace function public.sales_guard_returns()
returns trigger
language plpgsql
as $$
begin
  if public.ledger_direct_write()
     and new.deleted_at is not null
     and old.deleted_at is null
     and exists (
       select 1 from public.sale_returns r
       where r.sale_id = old.id and r.deleted_at is null
     ) then
    raise exception using
      message = 'Esta venta tiene devoluciones. Elimínalas primero.', errcode = 'SZ011';
  end if;
  return new;
end;
$$;

drop trigger if exists sales_guard_returns on public.sales;
create trigger sales_guard_returns
  before update on public.sales
  for each row execute function public.sales_guard_returns();

-- ── 9. What the client's link shows ────────────────────────────────────────
create or replace function public.get_shared_balance(p_token text, p_limit int default 50)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client public.clients%rowtype;
  v_business text;
  v_owner_whatsapp text;
  v_owner_logo_path text;
  v_payment_info text;
  v_movements json;
  -- LAS VENTAS PAGADAS ENTERAS y cuántas hay en total. Ver la cabecera.
  v_contado json;
  v_contado_total int;
  v_movement_total int;
  v_balance numeric(14, 4);
  v_balance_usd numeric(14, 4);
  v_balance_eur numeric(14, 4);
  v_owner_country text;
  v_settings public.owner_exchange_settings%rowtype;
  v_bcv_usd numeric;
  v_bcv_eur numeric;
  v_fiado_ids uuid[];
  v_cargo_ids uuid[];
  v_fiados json;
  v_abonos json;
begin
  select c.* into v_client
  from public.share_links sl
  join public.clients c on c.id = sl.client_id
  where sl.token = p_token;

  if not found then
    return null;
  end if;

  insert into public.link_opens (client_id, opened_date)
  values (v_client.id, current_date)
  on conflict (client_id, opened_date) do update
    set read_at = null,
        opened_at = now();

  select business_name, whatsapp, logo_path, payment_info, country
    into v_business, v_owner_whatsapp, v_owner_logo_path, v_payment_info, v_owner_country
  from public.owners where id = v_client.owner_id;

  select count(*) into v_movement_total
  from public.movements
  where client_id = v_client.id and deleted_at is null;

  select json_agg(
    json_build_object(
      'id', m.id,
      'type', m.type,
      'amount', m.amount,
      'currency', m.currency,
      'description', m.description,
      'running_balance', m.running_balance,
      'needs_review', m.needs_review,
      'transaction_code', m.transaction_code,
      'plazo_dias', m.plazo_dias,
      'cuotas', m.cuotas,
      'is_old_debt', m.is_old_debt,
      -- MIGRATION 185. Both are built field by field here, so a column this
      -- function does not name does not exist for the client.
      'paid_with_credit', m.paid_with_credit,
      'devolucion', case when m.type = 'return' then (
        select json_build_object(
          'product_name', r.product_name,
          'quantity', r.quantity,
          'unit_price', r.unit_price,
          'amount', r.amount,
          'to_own', r.to_own,
          'to_fiados', r.to_fiados,
          'to_credit', r.to_credit,
          'to_cash', r.to_cash,
          'charge_movement_id', r.charge_movement_id
        )
        from public.sale_returns r
        where r.id = m.payment_group_id
      ) end,
      'applies_to_movement_id', m.applies_to_movement_id,
      'photo_path', m.photo_path,
      -- THE NEW ONE. What was paid on the spot when this fiado was registered,
      -- summed over that sale's payments. Zero when there is no sale, no
      -- payment, or the movement is itself a payment -- see the header: zero
      -- is a value here, and the screen draws it.
      -- CHANGED IN 140: ONLY THE PAYMENTS IN THIS MOVEMENT'S OWN BOOK.
      -- The `coalesce(..., 'COP')` on both sides is the same normalization
      -- this function already uses for the sale's lines: `sale_payments`
      -- writes the Colombian book as 'COP' and `movements` writes it NULL.
      'abono_inicial', coalesce(
        (
          select sum(sp.amount)
          from public.sale_payments sp
          where sp.sale_id = m.sale_id
            and coalesce(sp.currency, 'COP') = coalesce(m.currency, 'COP')
        ),
        0
      ),
      -- LOS BOLÍVARES QUE EL TENDERO TECLEÓ AL COMPRAR, cuando los tecleó así.
      --
      -- Mandan sobre `abono_inicial × la tasa`, que es una reconversión y
      -- devuelve otra cifra: Bs. 1.000 entregados al registrar la venta salían
      -- como «Bs. 1.003,02». Regla crítica del 2026-10-24 en CLAUDE.md.
      --
      -- SOLO SI TODOS LOS PAGOS DE ESE LIBRO se teclearon en bolívares: con uno
      -- en bolívares y otro en divisa no hay una cifra tecleada que describa la
      -- suma, y entonces vale más la conversión, que al menos es coherente. Es
      -- la misma regla que ya aplican la fila de contado y la pantalla del
      -- tendero.
      'abono_inicial_bs', (
        select case
                 when count(*) > 0
                  and count(*) = count(*) filter (
                        where sp.entry_currency = 'VES' and sp.entry_amount is not null
                      )
                 then round(sum(sp.entry_amount), 2)
               end
        from public.sale_payments sp
        where sp.sale_id = m.sale_id
          and coalesce(sp.currency, 'COP') = coalesce(m.currency, 'COP')
      ),
      'rate_mode_used', m.rate_mode_used,
      'exchange_rate_used', m.exchange_rate_used,
      'official_bcv_rate_at_time', m.official_bcv_rate_at_time,
      'entry_currency', m.entry_currency,
      'entry_amount', m.entry_amount,
      'rate_usd_at_time', m.rate_usd_at_time,
      'rate_eur_at_time', m.rate_eur_at_time,
      'created_at', m.created_at,
      -- THE NEW ONE IN 132. What this fiado still owes, so the client's
      -- history can keep making sense once the abonos stop being listed.
      -- Null for a payment: a payment owes nothing, and zero would read as
      -- «settled», which is a statement about a debt.
      'pending',
        case when m.type = 'charge' then coalesce(oc.pending, 0) end,
      -- QUE SE LLEVO -- migracion 139. Las lineas de la venta de la que nacio
      -- este movimiento, SOLO LAS DE SU MONEDA. El porque del filtro y los
      -- bordes estan en la cabecera.
      'productos', coalesce(
        (
          select json_agg(
            json_build_object(
              'name', sl.name,
              'quantity', sl.quantity,
              'unit_price', sl.unit_price,
              -- MIGRATION 185: how many units came back, so the client's card
              -- marks the same line the owner's does.
              'devuelto', coalesce((
                select sum(r.quantity)
                from public.sale_returns r
                where r.sale_line_id = sl.id and r.deleted_at is null
              ), 0)
            ) order by sl.name
          )
          from public.sale_lines sl
          where sl.sale_id = m.sale_id
            and coalesce(sl.currency, 'COP') = coalesce(m.currency, 'COP')
        ),
        '[]'::json
      )
    ) order by m.created_at asc
  )
  into v_movements
  from (
    select *
    from public.movements
    where client_id = v_client.id and deleted_at is null
    order by created_at desc
    limit p_limit
  ) m
  -- THE SAME SOURCE THE OWNER'S SCREEN USES. `get_open_charges_for_client`
  -- is the only thing that knows what each fiado still owes; the row's own
  -- `running_balance` is the client's balance in that book, which is a
  -- different number and the one that stops being explainable here.
  --
  -- LEFT JOIN, and the missing rows are the answer, not a gap: a charge that
  -- is not among the open ones is fully paid, so `coalesce(..., 0)` is what
  -- marks it settled. An inner join would drop every paid fiado from the
  -- client's history, which is the opposite of what this is for.
  left join public.get_open_charges_for_client(v_client.id) oc
    on oc.movement_id = m.id;

  -- THE SAME WINDOW, ASKED AGAIN, AND IT HAS TO BE IDENTICAL: a different
  -- `limit` here would resolve cards for movements that are not on the page
  -- and miss the ones that are.
  select
    array_agg(m.applies_to_movement_id) filter (where m.applies_to_movement_id is not null),
    array_agg(m.id) filter (where m.type = 'charge')
  into v_fiado_ids, v_cargo_ids
  from (
    select *
    from public.movements
    where client_id = v_client.id and deleted_at is null
    order by created_at desc
    limit p_limit
  ) m;

  if v_fiado_ids is not null and array_length(v_fiado_ids, 1) > 0 then
    select json_object_agg(f.id, json_build_object(
      'movement_id', f.id,
      'sale_id', f.sale_id,
      'fecha', f.created_at,
      'currency', f.currency,
      'amount', f.amount,
      'pending', coalesce(a.pending, 0),
      'transaction_code', f.transaction_code,
      'plazo_dias', f.plazo_dias,
      'cuotas', f.cuotas,
      'description', f.description
    ))
    into v_fiados
    from public.movements f
    left join (
      select oc.movement_id, oc.pending
      from public.get_open_charges_for_client(v_client.id) oc
    ) a on a.movement_id = f.id
    where f.client_id = v_client.id
      and f.deleted_at is null
      and f.type = 'charge'
      and f.id = any(v_fiado_ids);
  end if;

  if v_cargo_ids is not null and array_length(v_cargo_ids, 1) > 0 then
    select json_object_agg(x.applies_to_movement_id, x.lista) into v_abonos
    from (
      select
        p.applies_to_movement_id,
        json_agg(json_build_object(
          'transaction_code', p.transaction_code,
          'entry_currency', p.entry_currency,
          'entry_amount', p.entry_amount,
          'movement_id', p.id,
          'fecha', p.created_at,
          'currency', p.currency,
          'amount', p.amount,
          'description', p.description,
          -- THE NEW ONE IN 133: the rate this payment sealed, so the client's
          -- card can print «Bs. … al día del abono» the way the owner's does.
          -- Null for a Colombian business and for anything older than sealing,
          -- and the card simply draws no line then.
          'exchange_rate_used', p.exchange_rate_used,
          -- MIGRATION 185: a return that reached this fiado is listed with
          -- its abonos, under its own name. It is not money that came in.
          'tipo', p.type
        ) order by p.created_at desc) as lista
      from public.movements p
      where p.client_id = v_client.id
        and p.deleted_at is null
        and p.type in ('payment', 'return')
        and p.amount > 0
        and p.applies_to_movement_id = any(v_cargo_ids)
      group by p.applies_to_movement_id
    ) x;
  end if;

  -- ── LAS VENTAS DE CONTADO ────────────────────────────────────────────
  --
  -- One row per (sale, book) that has payments in that book and NO live
  -- charge in it. The same rule `filasDeContado` applies on the owner's
  -- side, written again here because this function builds its JSON field by
  -- field and a column it does not name does not exist for the client.
  --
  -- THE JOIN KEY IS THE NORMALISED BOOK, never the raw column: the sale
  -- tables spell the Colombian book 'COP' and `movements` spells it NULL.
  -- The header explains what skipping that costs.
  with pagos as (
    select
      s.id as sale_id,
      s.transaction_code,
      s.created_at,
      -- NORMALISED TO THE LEDGER'S SPELLING, see the header. Grouping by the
      -- raw `sp.currency` would put a Colombian sale in a 'COP' bucket that
      -- nothing downstream can match.
      case when sp.currency in ('USD', 'EUR') then sp.currency end as currency,
      sum(sp.amount) as amount,
      -- Only when every payment of that book was typed the same way; mixing
      -- forms has no single honest figure and the screen falls back to what
      -- was stored. Same rule as the owner's screen.
      case when count(distinct coalesce(sp.entry_currency, sp.currency)) = 1
           then min(coalesce(sp.entry_currency, sp.currency)) end as entry_currency,
      case when count(distinct coalesce(sp.entry_currency, sp.currency)) = 1
           then sum(coalesce(sp.entry_amount, sp.amount)) end as entry_amount,
      min(sp.rate_used) as rate_used,
      min(sp.description) filter (where sp.description is not null and sp.description <> '') as description
    from public.sales s
    join public.sale_payments sp on sp.sale_id = s.id
    where s.client_id = v_client.id and s.deleted_at is null
    group by s.id, s.transaction_code, s.created_at, case when sp.currency in ('USD', 'EUR') then sp.currency end
  ),
  cargos as (
    select m.sale_id, coalesce(m.currency, '') as moneda
    from public.movements m
    where m.client_id = v_client.id
      and m.type = 'charge'
      and m.sale_id is not null
      and m.deleted_at is null
  ),
  contado as (
    select p.*
    from pagos p
    where not exists (
      select 1 from cargos c
      where c.sale_id = p.sale_id and c.moneda = coalesce(p.currency, '')
    )
  )
  select
    (select count(*) from contado),
    (
      select json_agg(x order by x.created_at desc)
      from (
        select
          c.sale_id,
          c.transaction_code,
          c.created_at,
          c.currency,
          c.amount,
          c.entry_currency,
          c.entry_amount,
          c.rate_used,
          c.description,
          coalesce(
            (
              select json_agg(json_build_object(
                'name', sl.name,
                'quantity', sl.quantity,
                'unit_price', sl.unit_price
              ) order by sl.name)
              from public.sale_lines sl
              where sl.sale_id = c.sale_id
                -- Same normalisation as the payments: `sale_lines` spells the
                -- Colombian book 'COP' and `c.currency` now holds NULL for it.
                and coalesce(case when sl.currency in ('USD', 'EUR') then sl.currency end, '')
                    = coalesce(c.currency, '')
            ),
            '[]'::json
          ) as lineas
        from contado c
        order by c.created_at desc
        limit p_limit
      ) x
    )
  into v_contado_total, v_contado;

  select coalesce(balance, 0), coalesce(balance_usd, 0), coalesce(balance_eur, 0)
    into v_balance, v_balance_usd, v_balance_eur
  from public.client_summary_all where client_id = v_client.id;

  if v_owner_country = 'VE' then
    select * into v_settings from public.owner_exchange_settings where owner_id = v_client.owner_id;
    select r.usd, r.eur into v_bcv_usd, v_bcv_eur from public.get_current_bcv_rate() r;
  end if;

  return json_build_object(
    'business_name', v_business,
    'owner_whatsapp', v_owner_whatsapp,
    'owner_logo_path', v_owner_logo_path,
    'client_name', v_client.name,
    'has_document_id', (v_client.document_id is not null and trim(v_client.document_id) <> ''),
    'whatsapp_last4', right(coalesce(v_client.whatsapp, ''), 4),
    'balance', coalesce(v_balance, 0),
    'balance_usd', coalesce(v_balance_usd, 0),
    'balance_eur', coalesce(v_balance_eur, 0),
    'movements', coalesce(v_movements, '[]'::json),
    'movement_total', coalesce(v_movement_total, 0),
    'ventas_de_contado', coalesce(v_contado, '[]'::json),
    'contado_total', coalesce(v_contado_total, 0),
    'fiados_abonados', coalesce(v_fiados, '{}'::json),
    'abonos_por_fiado', coalesce(v_abonos, '{}'::json),
    'owner_country', v_owner_country,
    'rate_mode', v_settings.rate_mode,
    'current_bcv_usd', v_bcv_usd,
    'current_bcv_eur', v_bcv_eur,
    'custom_rate_usd', v_settings.custom_rate_usd,
    'custom_rate_eur', v_settings.custom_rate_eur
  );
end;
$$;

insert into public.schema_migrations (key, description)
values (
  '185_devoluciones',
  'Devoluciones: tipo return en movements, tabla sale_returns, saldo a favor aplicado al siguiente fiado, registrar/eliminar/restaurar_devolucion, get_client_credit y get_shared_balance con la devolución.'
)
on conflict (key) do nothing;

commit;
