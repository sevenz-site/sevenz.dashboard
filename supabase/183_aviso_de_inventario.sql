-- ===========================================================================
-- 183 · THE BELL SAYS WHEN A PRODUCT IS RUNNING OUT (CT-162)
--
-- Until this migration the threshold `owners.low_stock_threshold` (163) was
-- stored and nobody was told anything: the toast that saves it said «Listo, te
-- avisaremos con ese número» and the web v3 promised «Notificación cuando un
-- producto está por agotarse». Both were false. Owner's decision, 2026-11-03:
-- *«Iniciemos CT-162 al lanzar la web»*, and, asked the three open questions:
--
--   · WHERE: the in-app bell (`/notificaciones`), like every other notice.
--   · HOW OFTEN: «Cada día mientras siga bajo» — one notice per product per
--     day while it stays at or under the threshold, not one per crossing. He
--     was told the cost: ten low products are ten notices a day.
--   · ZERO: «Sí, aviso aparte» — reaching 0 is its own notice, «se agotó»,
--     because a sold-out product can no longer be sold.
--
-- ---------------------------------------------------------------------------
-- HOW THE «EVERY DAY» HAPPENS WITHOUT A CRON
--
-- One row per (product, local day, kind), enforced by a unique key, written
-- by ONE function, `sync_stock_alert(product)`, which is idempotent. It runs:
--
--   1. from a trigger on `products`, the moment `stock_opening` (the live
--      count since 163) or `trashed_at` changes — so the sale that empties the
--      shelf raises the notice right away, whatever door the sale came through
--      (registrarVenta, registrarPedidoComoVenta, an edit of the product);
--   2. from a trigger on `owners` when the threshold changes;
--   3. from `refresh_stock_alerts()`, which the app calls when it loads and
--      when the bell opens. That is what produces TOMORROW's notice for a
--      product nobody touched: the owner only ever sees notices when the app
--      is open, so «each day the app is opened» is «each day» for him.
--
-- A cron would send nothing he could see — these are not messages — and would
-- write rows for owners who have not opened the app in a month.
--
-- ---------------------------------------------------------------------------
-- WHEN IT ALERTS — the same rule as `stockState()` in
-- `lib/products/availability.ts`, so the bell and the amber/red chips never
-- disagree, with ONE deliberate difference:
--
--   · count NULL (never counted)  → nothing. A NULL is not a 0 (see 107, 163).
--   · count <= 0                  → 'out'  («se agotó»)
--   · 0 < count <= threshold      → 'low'  («se está agotando»)
--   · threshold = 0               → NOTHING, not even 'out'. The chip still
--     says «Agotado» (that is a fact about the shelf), but 0 is the owner's
--     «no me avises» (163's comment on the column), and a notice he turned
--     off is the one thing this table must not produce.
--   · product in the bin          → nothing.
--
-- A notice that stopped being true the SAME DAY and was never read is
-- removed: restocking, or restoring the sale that emptied the shelf, must not
-- leave «se agotó» waiting in the bell (CT-162's own edge). A READ one stays:
-- it was true when he read it, and the bell is a history.
-- ===========================================================================

create table if not exists public.stock_alerts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owners(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  kind text not null check (kind in ('low', 'out')),
  -- The business's local date (Caracas for VE, Bogota otherwise, as 168).
  alert_day date not null,
  -- What was on the shelf and what the threshold was when the notice was
  -- written: the row has to read true later, after both have moved on.
  quantity numeric(14, 3) not null,
  threshold integer not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint stock_alerts_one_per_day unique (product_id, alert_day, kind)
);

create index if not exists stock_alerts_owner_idx
  on public.stock_alerts (owner_id, created_at desc);

comment on table public.stock_alerts is
  'Avisos de inventario de la campana (CT-162): uno por producto, por día y por tipo (low = por agotarse, out = agotado) mientras siga bajo el umbral. Decisión del dueño el 2026-11-03: «cada día mientras siga bajo» y aviso aparte al llegar a 0. Solo los escribe sync_stock_alert(); el dueño solo puede leerlos y marcarlos leídos.';

alter table public.stock_alerts enable row level security;

-- The owner reads his own and marks them read. Nobody writes them by hand:
-- inserts and deletes are the definer function's alone.
drop policy if exists "owners read own stock alerts" on public.stock_alerts;
create policy "owners read own stock alerts" on public.stock_alerts
  for select to authenticated
  using (owner_id = auth.uid());

drop policy if exists "owners mark own stock alerts read" on public.stock_alerts;
create policy "owners mark own stock alerts read" on public.stock_alerts
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- The grant goes next to the policy (lesson of 108). Supabase grants ALL on a
-- new table to anon and authenticated by default, so revoke first, then give
-- back exactly SELECT and an UPDATE limited to `read_at`.
revoke all on public.stock_alerts from anon, authenticated;
grant select on public.stock_alerts to authenticated;
grant update (read_at) on public.stock_alerts to authenticated;

-- ---------------------------------------------------------------------------
-- THE ONE WRITER

create or replace function public.sync_stock_alert(p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_qty numeric(14, 3);
  v_trashed timestamptz;
  v_threshold integer;
  v_day date;
  v_kind text;
begin
  select p.owner_id, p.stock_opening, p.trashed_at, o.low_stock_threshold,
         (now() at time zone case when o.country = 'VE' then 'America/Caracas' else 'America/Bogota' end)::date
    into v_owner, v_qty, v_trashed, v_threshold, v_day
  from public.products p
  join public.owners o on o.id = p.owner_id
  where p.id = p_product_id;

  if v_owner is null then
    return;
  end if;

  v_kind := case
    when v_qty is null or v_trashed is not null or v_threshold <= 0 then null
    when v_qty <= 0 then 'out'
    when v_qty <= v_threshold then 'low'
    else null
  end;

  -- What stopped being true today and nobody read yet goes away. A 'low'
  -- left unread when the product hits 0 goes too: «se está agotando» right
  -- under «se agotó» says the same thing twice.
  delete from public.stock_alerts
   where product_id = p_product_id
     and alert_day = v_day
     and read_at is null
     and kind is distinct from v_kind;

  if v_kind is not null then
    insert into public.stock_alerts (owner_id, product_id, kind, alert_day, quantity, threshold)
    values (v_owner, p_product_id, v_kind, v_day, v_qty, v_threshold)
    on conflict on constraint stock_alerts_one_per_day do nothing;
  end if;
end;
$$;

comment on function public.sync_stock_alert(uuid) is
  'Único escritor de stock_alerts. Idempotente: asegura el aviso de HOY (en la zona del negocio) que corresponde al producto, y quita los de hoy sin leer que dejaron de ser ciertos. Interna: la llaman los disparadores y refresh_stock_alerts().';

-- Internal. All three roles named: on Supabase, revoking only `public, anon`
-- leaves every signed-in owner able to call it (hallazgo 9, 2026-11-02).
revoke execute on function public.sync_stock_alert(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. THE MOMENT THE COUNT MOVES

create or replace function public.products_sync_stock_alert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- A NOTICE MUST NEVER COST A SALE. This trigger runs inside the
  -- transaction that writes the sale (163's trigger updates the count), so an
  -- error here would roll the sale back. It is caught and logged instead.
  begin
    perform public.sync_stock_alert(new.id);
  exception when others then
    raise warning 'stock alert for product % failed: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

revoke execute on function public.products_sync_stock_alert() from public, anon, authenticated;

drop trigger if exists products_stock_alert on public.products;
create trigger products_stock_alert
  after insert or update of stock_opening, trashed_at on public.products
  for each row execute function public.products_sync_stock_alert();

-- ---------------------------------------------------------------------------
-- 2. THE THRESHOLD MOVES: every product of that owner is re-judged, so the
-- toast's «te avisaremos con ese número» is true from the moment it shows.

create or replace function public.owners_sync_stock_alerts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  -- Same guard as above: saving the threshold must not fail over a notice.
  begin
    for r in select id from public.products where owner_id = new.id loop
      perform public.sync_stock_alert(r.id);
    end loop;
  exception when others then
    raise warning 'stock alerts for owner % failed: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

revoke execute on function public.owners_sync_stock_alerts() from public, anon, authenticated;

drop trigger if exists owners_stock_alerts on public.owners;
create trigger owners_stock_alerts
  after update of low_stock_threshold on public.owners
  for each row
  when (old.low_stock_threshold is distinct from new.low_stock_threshold)
  execute function public.owners_sync_stock_alerts();

-- ---------------------------------------------------------------------------
-- 3. «EACH DAY»: called by the app for the signed-in owner. It acts only on
-- `auth.uid()`'s products and takes no argument, so there is nothing to point
-- at another business.

create or replace function public.refresh_stock_alerts()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  if auth.uid() is null then
    return;
  end if;
  for r in
    select id from public.products
    where owner_id = auth.uid()
      and trashed_at is null
      and stock_opening is not null
  loop
    perform public.sync_stock_alert(r.id);
  end loop;
end;
$$;

comment on function public.refresh_stock_alerts() is
  'Asegura los avisos de inventario de HOY para el dueño de la sesión. La llama la app al cargar y al abrir la campana: es lo que hace que un producto que sigue bajo vuelva a avisar al día siguiente sin un cron. Solo toca los productos de auth.uid().';

revoke execute on function public.refresh_stock_alerts() from public, anon, authenticated;
grant execute on function public.refresh_stock_alerts() to authenticated;

insert into public.schema_migrations (key, description)
values (
  '183_aviso_de_inventario',
  'CT-162: la campana avisa cada día de los productos por agotarse (umbral del dueño) y aparte de los agotados. Tabla stock_alerts, escrita solo por sync_stock_alert() desde disparadores en products y owners y desde refresh_stock_alerts(). Umbral 0 = no avisa.'
)
on conflict (key) do nothing;
