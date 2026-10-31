-- ENVIRONMENT: run in DEV first (vzqppwrwnmlbrxizskdh). Production comes later,
-- with its own green light, BEFORE the code (the code only adds messages; this
-- is the lock). Re-runnable: every policy is dropped by name before it is
-- created, and the function keeps its signature (`create or replace`).
--
-- ===========================================================================
-- 170: THE BLOCK COVERS EVERYTHING AN OWNER CAN WRITE -- phase B of the plan
-- of 2026-10-31
--
-- The owner's request of 2026-10-31: a blocked account (trial ended, or
-- unpaid) «también debe bloquear: registrar pedidos, crear producto, publicar
-- producto en catálogo, registrar fiado o venta, registrar abono, registrar
-- cliente. Se mantiene la regla de negocio de solo lectura».
--
-- `061` put `owner_puede_escribir` on `clients` and `movements` only. Measured
-- on 2026-10-31, a blocked owner could still, with the database accepting it:
--   - create, edit, publish and trash products (no check in the action either);
--   - register a CONTADO sale -- it writes `sales`/`sale_lines`/`sale_payments`
--     and no movement, so 061 never sees it;
--   - register, discard or trim a catalog order;
--   - register a SPLIT abono: `registrar_abono_repartido` (142) is SECURITY
--     DEFINER, so its inserts bypass the policies 061 added.
--
-- SAME SHAPE AS 061, for the same reason: each `for all` policy is split into
-- a READ policy with exactly today's condition, untouched, and WRITE policies
-- with the block added. Adding the block to a `for all` policy would stop a
-- blocked owner from READING their own products and sales -- the opposite of
-- «solo lectura».
--
-- ---------------------------------------------------------------------------
-- WHAT IS NOT BLOCKED, ON PURPOSE
--
--   Reading anything ............................ open
--   The client's balance link (/s/...) .......... open -- SECURITY DEFINER,
--                                                 never passes through here
--   The public catalog receiving orders ......... open -- the owner's decision
--                                                 of 2026-10-31. Orders come in
--                                                 through `create_catalog_order`,
--                                                 SECURITY DEFINER, so they skip
--                                                 these policies
--   Sharing the catalog link .................... open -- like the client link,
--                                                 it is reading, not registering
--   Marking the bell's notifications as read .... open -- `client_hides` and
--                                                 `product_hides` keep UPDATE
--                                                 unblocked: that is `read_at`,
--                                                 and a blocked owner must still
--                                                 be able to empty the bell
--   Profile and logo ............................ open (061 already said so)
--
-- ---------------------------------------------------------------------------
-- HOW TO REVERT, if something goes wrong. Keep it before running this:
--
--   For each table below: drop the new policies by name and recreate the old
--   one, which was a single `for all` with the same condition as the read
--   policy (names: "owners manage own products", "owners manage own product
--   price overrides", "owners manage own product currencies", "owners manage
--   own product hides", "owners manage own sales", "owners manage own sale
--   lines", "owners manage own sale payments", catalog_orders_owner_all,
--   catalog_order_items_owner_all, "owners manage own client flags", "owners
--   manage own client hides"). For the photos, re-run the three policies of
--   084 without the `owner_puede_escribir` clause. For the function, re-run
--   its definition from 142.

begin;

-- ── products ─────────────────────────────────────────────────────────────
drop policy if exists "owners manage own products" on public.products;
drop policy if exists "owners read own products" on public.products;
drop policy if exists "owners insert own products" on public.products;
drop policy if exists "owners update own products" on public.products;
drop policy if exists "owners delete own products" on public.products;
create policy "owners read own products" on public.products
  for select using (owner_id = auth.uid());
create policy "owners insert own products" on public.products
  for insert with check (owner_id = auth.uid() and public.owner_puede_escribir(auth.uid()));
-- Publishing is an update (`published_retail` / `published_wholesale`), and so
-- is trashing: both fall under this one.
create policy "owners update own products" on public.products
  for update using (owner_id = auth.uid() and public.owner_puede_escribir(auth.uid()))
  with check (owner_id = auth.uid() and public.owner_puede_escribir(auth.uid()));
create policy "owners delete own products" on public.products
  for delete using (owner_id = auth.uid() and public.owner_puede_escribir(auth.uid()));

-- ── product_price_overrides (via the product) ────────────────────────────
drop policy if exists "owners manage own product price overrides" on public.product_price_overrides;
drop policy if exists "owners read own product price overrides" on public.product_price_overrides;
drop policy if exists "owners insert own product price overrides" on public.product_price_overrides;
drop policy if exists "owners update own product price overrides" on public.product_price_overrides;
drop policy if exists "owners delete own product price overrides" on public.product_price_overrides;
create policy "owners read own product price overrides" on public.product_price_overrides
  for select using (exists (select 1 from public.products p where p.id = product_id and p.owner_id = auth.uid()));
create policy "owners insert own product price overrides" on public.product_price_overrides
  for insert with check (
    exists (select 1 from public.products p where p.id = product_id and p.owner_id = auth.uid())
    and public.owner_puede_escribir(auth.uid()));
create policy "owners update own product price overrides" on public.product_price_overrides
  for update using (
    exists (select 1 from public.products p where p.id = product_id and p.owner_id = auth.uid())
    and public.owner_puede_escribir(auth.uid()))
  with check (
    exists (select 1 from public.products p where p.id = product_id and p.owner_id = auth.uid())
    and public.owner_puede_escribir(auth.uid()));
create policy "owners delete own product price overrides" on public.product_price_overrides
  for delete using (
    exists (select 1 from public.products p where p.id = product_id and p.owner_id = auth.uid())
    and public.owner_puede_escribir(auth.uid()));

-- ── product_currencies (via the product) ─────────────────────────────────
drop policy if exists "owners manage own product currencies" on public.product_currencies;
drop policy if exists "owners read own product currencies" on public.product_currencies;
drop policy if exists "owners insert own product currencies" on public.product_currencies;
drop policy if exists "owners delete own product currencies" on public.product_currencies;
create policy "owners read own product currencies" on public.product_currencies
  for select using (exists (select 1 from public.products p where p.id = product_id and p.owner_id = auth.uid()));
create policy "owners insert own product currencies" on public.product_currencies
  for insert with check (
    exists (select 1 from public.products p where p.id = product_id and p.owner_id = auth.uid())
    and public.owner_puede_escribir(auth.uid()));
-- No update policy: 087 grants only select, insert and delete on this table.
create policy "owners delete own product currencies" on public.product_currencies
  for delete using (
    exists (select 1 from public.products p where p.id = product_id and p.owner_id = auth.uid())
    and public.owner_puede_escribir(auth.uid()));

-- ── product_hides (the trash events of products) ─────────────────────────
-- UPDATE stays open: it is how the bell marks a row as read (`read_at`).
drop policy if exists "owners manage own product hides" on public.product_hides;
drop policy if exists "owners read own product hides" on public.product_hides;
drop policy if exists "owners insert own product hides" on public.product_hides;
drop policy if exists "owners update own product hides" on public.product_hides;
drop policy if exists "owners delete own product hides" on public.product_hides;
create policy "owners read own product hides" on public.product_hides
  for select using (owner_id = auth.uid());
create policy "owners insert own product hides" on public.product_hides
  for insert with check (owner_id = auth.uid() and public.owner_puede_escribir(auth.uid()));
create policy "owners update own product hides" on public.product_hides
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owners delete own product hides" on public.product_hides
  for delete using (owner_id = auth.uid() and public.owner_puede_escribir(auth.uid()));

-- ── sales, sale_lines, sale_payments ─────────────────────────────────────
-- The contado sale writes only these three, never a movement: this is what
-- closes it.
drop policy if exists "owners manage own sales" on public.sales;
drop policy if exists "owners read own sales" on public.sales;
drop policy if exists "owners insert own sales" on public.sales;
drop policy if exists "owners update own sales" on public.sales;
drop policy if exists "owners delete own sales" on public.sales;
create policy "owners read own sales" on public.sales
  for select using (owner_id = auth.uid());
create policy "owners insert own sales" on public.sales
  for insert with check (owner_id = auth.uid() and public.owner_puede_escribir(auth.uid()));
create policy "owners update own sales" on public.sales
  for update using (owner_id = auth.uid() and public.owner_puede_escribir(auth.uid()))
  with check (owner_id = auth.uid() and public.owner_puede_escribir(auth.uid()));
create policy "owners delete own sales" on public.sales
  for delete using (owner_id = auth.uid() and public.owner_puede_escribir(auth.uid()));

drop policy if exists "owners manage own sale lines" on public.sale_lines;
drop policy if exists "owners read own sale lines" on public.sale_lines;
drop policy if exists "owners insert own sale lines" on public.sale_lines;
drop policy if exists "owners update own sale lines" on public.sale_lines;
drop policy if exists "owners delete own sale lines" on public.sale_lines;
create policy "owners read own sale lines" on public.sale_lines
  for select using (exists (select 1 from public.sales s where s.id = sale_id and s.owner_id = auth.uid()));
create policy "owners insert own sale lines" on public.sale_lines
  for insert with check (
    exists (select 1 from public.sales s where s.id = sale_id and s.owner_id = auth.uid())
    and public.owner_puede_escribir(auth.uid()));
create policy "owners update own sale lines" on public.sale_lines
  for update using (
    exists (select 1 from public.sales s where s.id = sale_id and s.owner_id = auth.uid())
    and public.owner_puede_escribir(auth.uid()))
  with check (
    exists (select 1 from public.sales s where s.id = sale_id and s.owner_id = auth.uid())
    and public.owner_puede_escribir(auth.uid()));
create policy "owners delete own sale lines" on public.sale_lines
  for delete using (
    exists (select 1 from public.sales s where s.id = sale_id and s.owner_id = auth.uid())
    and public.owner_puede_escribir(auth.uid()));

drop policy if exists "owners manage own sale payments" on public.sale_payments;
drop policy if exists "owners read own sale payments" on public.sale_payments;
drop policy if exists "owners insert own sale payments" on public.sale_payments;
drop policy if exists "owners update own sale payments" on public.sale_payments;
drop policy if exists "owners delete own sale payments" on public.sale_payments;
create policy "owners read own sale payments" on public.sale_payments
  for select using (exists (select 1 from public.sales s where s.id = sale_id and s.owner_id = auth.uid()));
create policy "owners insert own sale payments" on public.sale_payments
  for insert with check (
    exists (select 1 from public.sales s where s.id = sale_id and s.owner_id = auth.uid())
    and public.owner_puede_escribir(auth.uid()));
create policy "owners update own sale payments" on public.sale_payments
  for update using (
    exists (select 1 from public.sales s where s.id = sale_id and s.owner_id = auth.uid())
    and public.owner_puede_escribir(auth.uid()))
  with check (
    exists (select 1 from public.sales s where s.id = sale_id and s.owner_id = auth.uid())
    and public.owner_puede_escribir(auth.uid()));
create policy "owners delete own sale payments" on public.sale_payments
  for delete using (
    exists (select 1 from public.sales s where s.id = sale_id and s.owner_id = auth.uid())
    and public.owner_puede_escribir(auth.uid()));

-- ── catalog_orders, catalog_order_items ──────────────────────────────────
-- What the OWNER does to an order: register it, discard it, restore it, trim a
-- line or a currency. The CLIENT's order comes in through
-- `create_catalog_order` (SECURITY DEFINER) and is not affected: a blocked
-- shop keeps receiving orders, as decided.
drop policy if exists catalog_orders_owner_all on public.catalog_orders;
drop policy if exists "owners read own catalog orders" on public.catalog_orders;
drop policy if exists "owners insert own catalog orders" on public.catalog_orders;
drop policy if exists "owners update own catalog orders" on public.catalog_orders;
drop policy if exists "owners delete own catalog orders" on public.catalog_orders;
create policy "owners read own catalog orders" on public.catalog_orders
  for select using (owner_id = auth.uid());
create policy "owners insert own catalog orders" on public.catalog_orders
  for insert with check (owner_id = auth.uid() and public.owner_puede_escribir(auth.uid()));
create policy "owners update own catalog orders" on public.catalog_orders
  for update using (owner_id = auth.uid() and public.owner_puede_escribir(auth.uid()))
  with check (owner_id = auth.uid() and public.owner_puede_escribir(auth.uid()));
create policy "owners delete own catalog orders" on public.catalog_orders
  for delete using (owner_id = auth.uid() and public.owner_puede_escribir(auth.uid()));

drop policy if exists catalog_order_items_owner_all on public.catalog_order_items;
drop policy if exists "owners read own catalog order items" on public.catalog_order_items;
drop policy if exists "owners insert own catalog order items" on public.catalog_order_items;
drop policy if exists "owners update own catalog order items" on public.catalog_order_items;
drop policy if exists "owners delete own catalog order items" on public.catalog_order_items;
create policy "owners read own catalog order items" on public.catalog_order_items
  for select using (exists (select 1 from public.catalog_orders o where o.id = order_id and o.owner_id = auth.uid()));
create policy "owners insert own catalog order items" on public.catalog_order_items
  for insert with check (
    exists (select 1 from public.catalog_orders o where o.id = order_id and o.owner_id = auth.uid())
    and public.owner_puede_escribir(auth.uid()));
create policy "owners update own catalog order items" on public.catalog_order_items
  for update using (
    exists (select 1 from public.catalog_orders o where o.id = order_id and o.owner_id = auth.uid())
    and public.owner_puede_escribir(auth.uid()))
  with check (
    exists (select 1 from public.catalog_orders o where o.id = order_id and o.owner_id = auth.uid())
    and public.owner_puede_escribir(auth.uid()));
create policy "owners delete own catalog order items" on public.catalog_order_items
  for delete using (
    exists (select 1 from public.catalog_orders o where o.id = order_id and o.owner_id = auth.uid())
    and public.owner_puede_escribir(auth.uid()));

-- ── client_flags (mala paga) ─────────────────────────────────────────────
drop policy if exists "owners manage own client flags" on public.client_flags;
drop policy if exists "owners read own client flags" on public.client_flags;
drop policy if exists "owners insert own client flags" on public.client_flags;
drop policy if exists "owners update own client flags" on public.client_flags;
drop policy if exists "owners delete own client flags" on public.client_flags;
create policy "owners read own client flags" on public.client_flags
  for select using (owner_id = auth.uid());
create policy "owners insert own client flags" on public.client_flags
  for insert with check (owner_id = auth.uid() and public.owner_puede_escribir(auth.uid()));
create policy "owners update own client flags" on public.client_flags
  for update using (owner_id = auth.uid() and public.owner_puede_escribir(auth.uid()))
  with check (owner_id = auth.uid() and public.owner_puede_escribir(auth.uid()));
create policy "owners delete own client flags" on public.client_flags
  for delete using (owner_id = auth.uid() and public.owner_puede_escribir(auth.uid()));

-- ── client_hides (the trash events of clients) ───────────────────────────
-- UPDATE stays open, as in product_hides: it is the bell's `read_at`.
drop policy if exists "owners manage own client hides" on public.client_hides;
drop policy if exists "owners read own client hides" on public.client_hides;
drop policy if exists "owners insert own client hides" on public.client_hides;
drop policy if exists "owners update own client hides" on public.client_hides;
drop policy if exists "owners delete own client hides" on public.client_hides;
create policy "owners read own client hides" on public.client_hides
  for select using (owner_id = auth.uid());
create policy "owners insert own client hides" on public.client_hides
  for insert with check (owner_id = auth.uid() and public.owner_puede_escribir(auth.uid()));
create policy "owners update own client hides" on public.client_hides
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owners delete own client hides" on public.client_hides
  for delete using (owner_id = auth.uid() and public.owner_puede_escribir(auth.uid()));

-- ── product photos (storage) ─────────────────────────────────────────────
-- 084's three policies, with the block added. Reading the photos is a public
-- bucket and is not touched.
drop policy if exists "owners upload own product photos" on storage.objects;
create policy "owners upload own product photos" on storage.objects for insert to public
  with check (bucket_id = 'product-photos' and (storage.foldername(name))[1] = auth.uid()::text
              and public.owner_puede_escribir(auth.uid()));

drop policy if exists "owners update own product photos" on storage.objects;
create policy "owners update own product photos" on storage.objects for update to public
  using (bucket_id = 'product-photos' and (storage.foldername(name))[1] = auth.uid()::text
         and public.owner_puede_escribir(auth.uid()));

drop policy if exists "owners delete own product photos" on storage.objects;
create policy "owners delete own product photos" on storage.objects for delete to public
  using (bucket_id = 'product-photos' and (storage.foldername(name))[1] = auth.uid()::text
         and public.owner_puede_escribir(auth.uid()));

-- ── registrar_abono_repartido: 142's definition, with ONE check added ────
-- It is SECURITY DEFINER, so its inserts never meet the policies 061 put on
-- `movements`. The check goes right after the session check, before anything
-- is read, and answers with the same code `import_libreta` (078) already uses.

create or replace function public.registrar_abono_repartido(p_lineas jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_owner uuid := auth.uid();
  v_client uuid;
  v_grupo uuid := gen_random_uuid();
  v_n int;
  v_linea jsonb;
  v_fiado uuid;
  v_monto numeric;
  v_pendiente numeric;
  v_moneda text;
  v_monedas text[] := '{}';
  v_monedas_reales text[] := '{}';
  v_ids uuid[] := '{}';
  v_nuevo uuid;
  -- Half a cent, the same tolerance `registrarAbonoDirigido` uses when it
  -- compares what was typed against what the fiado owes. Without it, a payment
  -- converted from bolivares that lands on 5,8399 would be refused against a
  -- pending of 5,84 by a ten-thousandth.
  v_holgura constant numeric := 0.005;
begin
  -- NO SESSION, NO WRITE. This is `security definer`, so without this check it
  -- would write on behalf of anyone who could reach it -- including the
  -- service key, where `auth.uid()` is null.
  if v_owner is null then
    return json_build_object('ok', false, 'code', 'sin_sesion');
  end if;

  -- A BLOCKED ACCOUNT DOES NOT WRITE (migration 170). See the header.
  if not public.owner_puede_escribir(v_owner) then
    return json_build_object('ok', false, 'code', 'cuenta_pausada');
  end if;

  if jsonb_typeof(p_lineas) <> 'array' then
    return json_build_object('ok', false, 'code', 'formato');
  end if;

  v_n := jsonb_array_length(p_lineas);
  -- A ceiling, not a guess at the shape of a bodega: a client with more than
  -- fifty open fiados at once is a sign of something else going on, and an
  -- unbounded array here is an unbounded transaction.
  if v_n < 1 or v_n > 50 then
    return json_build_object('ok', false, 'code', 'tamano');
  end if;

  -- ── THE CLIENT AND ITS OWNER, FIRST AND EXPLICITLY ──────────────────
  --
  -- The ids come from the browser. This is the rule in `CLAUDE.md`: the policy
  -- is the backstop, this is the lock -- and here it carries more than usual,
  -- because every read below runs with this function's rights.
  select m.client_id into v_client
  from public.movements m
  join public.clients c on c.id = m.client_id
  where m.id = (p_lineas -> 0 ->> 'fiado_id')::uuid
    and m.deleted_at is null
    and c.owner_id = v_owner
    and c.trashed_at is null
    and c.deleted_at is null;

  if v_client is null then
    return json_build_object('ok', false, 'code', 'fiado_ajeno');
  end if;

  -- ── EVERY LINE, VALIDATED BEFORE ANYTHING IS WRITTEN ────────────────
  for v_linea in select * from jsonb_array_elements(p_lineas)
  loop
    v_fiado := (v_linea ->> 'fiado_id')::uuid;
    v_monto := (v_linea ->> 'amount')::numeric;

    if v_monto is null or v_monto <= 0 then
      return json_build_object('ok', false, 'code', 'monto_invalido', 'fiado_id', v_fiado);
    end if;

    -- SAME CLIENT, LIVE CHARGE, and the currency comes back from the same read.
    -- A line pointing at another client's fiado would otherwise ride in on the
    -- first line's ownership check.
    --
    -- THE CHECK THAT USED TO BE HERE IS GONE ON PURPOSE: until today this
    -- compared each fiado's currency against the first one's and refused
    -- `monedas_mezcladas`. See the header for whose decision that was and
    -- whose decision removed it.
    select m.currency into v_moneda
    from public.movements m
    where m.id = v_fiado
      and m.client_id = v_client
      and m.type = 'charge'
      and m.deleted_at is null;

    -- `found` AND NOT `v_moneda is null`: a Colombian fiado has a currency of
    -- null and is perfectly valid. Using the value to detect the missing row
    -- would reject every Colombian line -- which is the exact shape of bug
    -- `qa:currency` has existed to catch since 2026-09-11.
    if not found then
      return json_build_object('ok', false, 'code', 'fiado_ajeno', 'fiado_id', v_fiado);
    end if;

    -- The same fiado twice in one split would pass each line's cap on its own
    -- and break it together.
    if (select count(*) from jsonb_array_elements(p_lineas) l
        where (l ->> 'fiado_id')::uuid = v_fiado) > 1 then
      return json_build_object('ok', false, 'code', 'fiado_repetido', 'fiado_id', v_fiado);
    end if;

    -- THE CAP, read from the one function that knows it. `get_open_charges_for_client`
    -- is CALLED, not copied: it honours directed payments, which a plain
    -- `amount - sum(payments)` does not, and `CT-124` is what a second copy of
    -- that sum cost.
    select o.pending into v_pendiente
    from public.get_open_charges_for_client(v_client) o
    where o.movement_id = v_fiado;

    if v_pendiente is null then
      return json_build_object('ok', false, 'code', 'fiado_saldado', 'fiado_id', v_fiado);
    end if;

    if v_monto - v_pendiente > v_holgura then
      return json_build_object(
        'ok', false, 'code', 'excede_el_fiado',
        'fiado_id', v_fiado, 'pendiente', v_pendiente
      );
    end if;

    -- DOS ARRAYS EN PARALELO, y el segundo no es redundante. El primero
    -- lleva el centinela, que es lo que permite distinguir «todavía no he
    -- visto este libro» de «este libro es el colombiano, cuya moneda es
    -- null»; el segundo lleva la moneda de verdad, que es lo que sale en la
    -- respuesta. Traducir el centinela de vuelta al final exigía un
    -- `array(select …)` dentro del `return`, que es justo la construcción que
    -- no hay forma de probar sin correrla.
    if not (coalesce(v_moneda, '~COP~') = any (v_monedas)) then
      v_monedas := array_append(v_monedas, coalesce(v_moneda, '~COP~'));
      v_monedas_reales := array_append(v_monedas_reales, v_moneda);
    end if;
  end loop;

  -- ── AND ONLY NOW SE ESCRIBE ─────────────────────────────────────────
  for v_linea in select * from jsonb_array_elements(p_lineas)
  loop
    v_fiado := (v_linea ->> 'fiado_id')::uuid;

    -- READ AGAIN, FROM THE FIADO. See the header: taking the currency from the
    -- payload would let a browser file a dollar payment in the euro ledger of
    -- the same client, and nothing downstream would question it.
    select m.currency into v_moneda
    from public.movements m
    where m.id = v_fiado;

    insert into public.movements (
      client_id, created_by, type, amount, currency, description, source,
      photo_path, applies_to_movement_id, payment_group_id,
      rate_mode_used, exchange_rate_used, official_bcv_rate_at_time,
      entry_currency, entry_amount, rate_usd_at_time, rate_eur_at_time
    )
    values (
      v_client,
      v_owner,
      'payment',
      (v_linea ->> 'amount')::numeric,
      v_moneda,
      nullif(btrim(coalesce(v_linea ->> 'description', '')), ''),
      'manual',
      nullif(btrim(coalesce(v_linea ->> 'photo_path', '')), ''),
      v_fiado,
      v_grupo,
      v_linea ->> 'rate_mode_used',
      (v_linea ->> 'exchange_rate_used')::numeric,
      (v_linea ->> 'official_bcv_rate_at_time')::numeric,
      v_linea ->> 'entry_currency',
      (v_linea ->> 'entry_amount')::numeric,
      (v_linea ->> 'rate_usd_at_time')::numeric,
      (v_linea ->> 'rate_eur_at_time')::numeric
    )
    returning id into v_nuevo;

    v_ids := array_append(v_ids, v_nuevo);
  end loop;

  -- ── Y SE RECALCULA LA CADENA DEL CLIENTE ───────────────────────────
  --
  -- ESTE `perform` ES EL ARREGLO ENTERO DE LA 142. Sin el, el saldo que la
  -- app le ensena al tendero y a su cliente queda MAL despues de cada
  -- reparto.
  --
  -- POR QUE: `running_balance` lo pone un disparador BEFORE INSERT que busca
  -- la fila anterior con `order by created_at desc, id desc`. Dentro de una
  -- transaccion, `now()` es el instante de la TRANSACCION, asi que las N
  -- lineas de un reparto se guardan todas con el MISMO `created_at` y el
  -- desempate queda en `id`, que es un uuid aleatorio. A partir de la tercera
  -- linea, cada una encadena desde una hermana cualquiera en vez de desde la
  -- anterior, y la cadena deja de sumar.
  --
  -- Y NO SE QUEDA EN UNA FILA RARA: `client_summary` es una vista que lee el
  -- `running_balance` de la ULTIMA fila viva de cada moneda. Una cadena
  -- descuadrada es un SALDO descuadrado en la ficha del cliente, en Cartera y
  -- en el enlace que abre el cliente.
  --
  -- MEDIDO EN DEV EL 2026-10-23, en un cliente con cuatro repartos: la suma
  -- real de sus movimientos en dolares daba 0,00 y la app ensenaba 1,14.
  --
  -- `recalc_client_running_balance` recorre cada moneda con
  -- `order by created_at asc, id asc` --el orden exactamente inverso al de la
  -- vista-- asi que la ultima fila que reescribe es justo la que la vista
  -- lee. Es la misma funcion que ya llaman `deleteMovement` e
  -- `import_libreta`, por la misma razon y sin copiar su logica.
  perform public.recalc_client_running_balance(v_client);

  return json_build_object(
    'ok', true,
    'group_id', v_grupo,
    'client_id', v_client,
    -- `currency` SURVIVES AND MEANS WHAT IT MEANT: the one currency of the
    -- split, or null when there is not one. The caller that reads it today was
    -- written when there was always exactly one, so a mixed split hands it
    -- null rather than a currency picked out of a hat.
    'currency', case
      when array_length(v_monedas_reales, 1) = 1 then v_monedas_reales[1]
      else null
    end,
    -- AND THE FULL LIST, which is the new fact. It carries the real
    -- currencies, so nothing downstream has to know about the sentinel.
    'currencies', to_jsonb(v_monedas_reales),
    'movement_ids', to_jsonb(v_ids)
  );
end;
$fn$;

-- `create or replace` keeps the grants of 142 (authenticated only).

insert into public.schema_migrations (key, description)
values (
  '170_el_bloqueo_cubre_todo',
  'Fase B del plan del 2026-10-31: una cuenta bloqueada deja de poder crear, editar, publicar o borrar productos (y sus fotos), registrar ventas (también de contado), registrar, descartar o recortar pedidos, marcar malas pagas y registrar un abono repartido. Cada política for all se parte en una de leer, intacta, y las de escribir con owner_puede_escribir, como la 061. Sigue abierto: leer, el enlace del cliente, el catálogo público recibiendo pedidos, compartir el enlace del catálogo y marcar como leídas las notificaciones.'
)
on conflict (key) do nothing;

commit;
