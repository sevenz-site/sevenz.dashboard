-- ═══════════════════════════════════════════════════════════════════════
-- THE ORDER CAN BECOME A SALE: address, the sale it produced, and when
--
-- Asked for by the owner on 2026-10-24, with the sitemap of the flow: he wants
-- to open a catalogue order and register it as a cash sale or a fiado, without
-- retyping it. This migration is only the data that flow needs; the screens
-- come after.
--
-- ───────────────────────────────────────────────────────────────────────
-- THIS DISPLACES DECISION 7 OF 2026-10-14, AND BOTH ARE WRITTEN DOWN
--
-- That decision said THE ORDER DOES NOT TOUCH THE MONEY LEDGER: an order lived
-- in `catalog_orders`, the money lived in `movements`, and nothing joined
-- them. The reason was good and still is -- an order is what a customer ASKED
-- for, and until the shopkeeper agrees it is not a debt. Writing it into the
-- ledger the moment it arrives would let anyone with the catalogue link create
-- debt in somebody else's book.
--
-- What changes is WHO joins them: not the order, the shopkeeper. He opens it,
-- reads it, fixes what is wrong and then registers it. The order still does
-- not touch the ledger by itself; it gains a door that only he can walk
-- through. Confirmed by him on 2026-10-24: *«de acuerdo, la orden tocaría el
-- flujo del dinero»*.
--
-- ───────────────────────────────────────────────────────────────────────
-- THE THREE COLUMNS, AND WHY EACH ONE
--
-- `customer_address`  The card in the design shows «Dirección:» and nothing in
--                     the database could fill it. Decision of 2026-10-24:
--                     *«la sacamos de la ficha del cliente ya existente y la
--                     dejamos vacía cuando no existe. Pidámosla en el
--                     carrito»*. So the cart starts asking for it, and the
--                     screen prefers the client's own ficha when there is one
--                     -- that is the address the shopkeeper maintains, and an
--                     order from six months ago should not overwrite it on
--                     screen.
--
-- `sale_id`           Which sale came out of this order. Two jobs, and the
--                     second is the one that matters: it is the proof that
--                     this order was ALREADY registered, so it cannot be
--                     registered twice. *«No, al seleccionarlo desde
--                     notificaciones o la lista de pedidos se debe mostrar el
--                     detalle del pedido pero con estado de registrado»*.
--
-- `registered_at`     When. He asked for the date on that screen explicitly,
--                     and `status` alone cannot carry it: it is one word.
--
-- WHY `sale_id` IS NOT ENOUGH ON ITS OWN, and `registered_at` is not either:
-- a sale can be deleted. `on delete set null` then empties `sale_id` and the
-- order would look unregistered again -- which is exactly the state that lets
-- it be registered a second time, with the debt duplicated. `registered_at`
-- survives that, so the screen can say «se registró el 24 de octubre y esa
-- venta ya no existe», which is the truth and not an invitation.
--
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. THE COLUMNS ─────────────────────────────────────────────────────
alter table public.catalog_orders
  add column if not exists customer_address text;

alter table public.catalog_orders
  add column if not exists sale_id uuid;

alter table public.catalog_orders
  add column if not exists registered_at timestamptz;

-- The length cap matches `clients.address`'s own form: this value ends up
-- prefilling that field when the shopkeeper creates the client from the order,
-- and a value that does not fit there would be refused at the worst moment.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'catalog_orders_customer_address_len'
      and conrelid = 'public.catalog_orders'::regclass
  ) then
    alter table public.catalog_orders
      add constraint catalog_orders_customer_address_len
      check (customer_address is null or length(customer_address) <= 200);
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'catalog_orders_sale_id_fkey'
      and conrelid = 'public.catalog_orders'::regclass
  ) then
    alter table public.catalog_orders
      add constraint catalog_orders_sale_id_fkey
      foreign key (sale_id) references public.sales (id) on delete set null;
  end if;
end;
$$;

-- ONE SALE BELONGS TO AT MOST ONE ORDER. Without this, a bug that re-runs the
-- registration could point two orders at the same sale and the shop would
-- believe it sold twice what it sold once. Partial, because `null` is the
-- normal state of every order that has not been registered.
create unique index if not exists catalog_orders_sale_id_unico
  on public.catalog_orders (sale_id)
  where sale_id is not null;

-- ── 2. THE CART ASKS FOR THE ADDRESS ───────────────────────────────────
--
-- THE EXISTING FUNCTION IS RENAMED, NOT COPIED. Its body is four hundred
-- lines of padlocks -- the rate limit, «this product belongs to this owner»,
-- «the price is computed here and never travels in the request». Copying all
-- of that to add one column is how two versions of those padlocks start
-- existing, and only one of them gets the next fix. `alter function ... rename
-- to` moves it whole, keeping its `security definer`, its `search_path` and
-- its owner.
--
-- What callers see is unchanged: `create_catalog_order` still exists, still
-- takes the same eight arguments, and now takes a ninth.
--
-- RE-RUNNABLE, which this project requires: the rename only happens if the
-- eight-argument `create_catalog_order` is still there. On a second run it is
-- not -- it is already called `_core` -- and the block does nothing instead of
-- failing. Same for the drop of the wrapper below.
do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'create_catalog_order'
      and pg_get_function_identity_arguments(p.oid)
          = 'text, text, text, text, text, boolean, text, jsonb'
  ) then
    alter function public.create_catalog_order(text, text, text, text, text, boolean, text, jsonb)
      rename to create_catalog_order_core;
  end if;
end;
$$;

-- THE CORE STOPS BEING PUBLIC. Nobody outside this file should call it: it is
-- the same function minus the address, so a caller that reached it directly
-- would silently save orders without one. The wrapper below is `security
-- definer`, so it runs as its owner and can still call this.
revoke execute on function public.create_catalog_order_core(text, text, text, text, text, boolean, text, jsonb) from public, anon, authenticated;

comment on function public.create_catalog_order_core(text, text, text, text, text, boolean, text, jsonb) is
  'El cuerpo de create_catalog_order desde la 109. Renombrado en la 157 para anadirle la direccion sin copiar sus candados. No se llama desde fuera: llamalo a traves de create_catalog_order.';

-- ── 3. THE WRAPPER, WITH THE ADDRESS ───────────────────────────────────
--
-- ONE MORE ARGUMENT, WITH A DEFAULT, AND THAT IS DELIBERATE. A browser that
-- still holds the PREVIOUS bundle keeps calling this with eight named
-- arguments for hours after a deploy. With `default null` that call still
-- resolves and the order is saved without an address -- which is exactly what
-- happened before this migration. The alternative degrades the other way:
-- every order from a stale tab refused, which is a sale lost for a reason
-- nobody can see. Same preference `CLAUDE.md` states for deploy order.
drop function if exists public.create_catalog_order(text, text, text, text, text, boolean, text, jsonb, text);

create function public.create_catalog_order(
  p_token text,
  p_customer_name text,
  p_customer_document text,
  p_customer_document_type text,
  p_customer_whatsapp text,
  p_wants_notices boolean,
  p_consent_text text,
  p_items jsonb,
  -- WHERE TO TAKE IT. Optional on purpose: a customer who does not want to
  -- give an address still gets to order, and the shopkeeper can fill it in
  -- when he creates the client. Making it required would turn a nice-to-have
  -- into a reason not to buy.
  p_customer_address text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_resultado jsonb;
  v_direccion text;
begin
  v_direccion := nullif(btrim(coalesce(p_customer_address, '')), '');

  v_resultado := public.create_catalog_order_core(
    p_token,
    p_customer_name,
    p_customer_document,
    p_customer_document_type,
    p_customer_whatsapp,
    p_wants_notices,
    p_consent_text,
    p_items
  );

  -- The address is written AFTER, and only when the order was created. It is
  -- the same transaction, so an order either has its lines and its address or
  -- does not exist: there is no half-saved state to find later.
  if coalesce((v_resultado ->> 'ok')::boolean, false) and v_direccion is not null then
    update public.catalog_orders
      set customer_address = left(v_direccion, 200)
      where id = (v_resultado ->> 'order_id')::uuid;
  end if;

  return v_resultado;
end;
$fn$;

revoke execute on function public.create_catalog_order(text, text, text, text, text, boolean, text, jsonb, text) from public;
grant execute on function public.create_catalog_order(text, text, text, text, text, boolean, text, jsonb, text) to anon, authenticated;

comment on function public.create_catalog_order(text, text, text, text, text, boolean, text, jsonb, text) is
  'Crea un pedido del catalogo desde la pantalla publica. Desde la 157 acepta la direccion del cliente, opcional, y delega el resto en create_catalog_order_core.';

insert into public.schema_migrations (key, description)
values (
  '157_el_pedido_se_registra_como_venta',
  'catalog_orders guarda la direccion del cliente, la venta que salio del pedido y cuando se registro. create_catalog_order acepta la direccion y su cuerpo pasa a create_catalog_order_core.'
)
on conflict (key) do nothing;
