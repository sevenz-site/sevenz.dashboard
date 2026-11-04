-- ENVIRONMENT: run in DEV first (vzqppwrwnmlbrxizskdh). Production comes later,
-- with its own green light, AFTER 185 and BEFORE the code (CLAUDE.md, deploy
-- step 1). The old code keeps working against this file: no cash return exists
-- until the new code writes one. Re-runnable: every function is `create or
-- replace` with the signature it already has, and dropping a NOT NULL twice is
-- not an error.
--
-- ===========================================================================
-- 186: A SALE PAID IN FULL CAN COME BACK TOO.
--
-- `CT-163`. Owner's request of 2026-11-04: *«Implementa devoluciones en el caso
-- de "De contado" estas también afectarán las métricas en reportes»*, and what
-- a shopkeeper really does, in his words: *«1. Regresarle el dinero; 2. Darle
-- otros productos por el valor devuelto; 3. Usar el valor devuelto como parte
-- de pago para otro producto más costoso. Básicamente serían los mismos casos
-- que la devolución en un fiado»*.
--
-- ===========================================================================
-- THE THREE CASES, WITH A $10 SHIRT PAID IN CASH
--
--   1. Money back             → «Devolver dinero». `to_cash` = 10.
--   2. Takes another $10 shirt → saldo a favor, spent in a new sale.
--   3. Takes $15 trousers      → saldo a favor, spent in a new sale, $5 in cash.
--
-- Cases 2 and 3 need nothing new: 185 already lets a sale be paid with saldo a
-- favor. A return of a cash sale only has to leave that saldo behind.
--
-- `lib/returns/options.ts` holds the table of what is offered; it is the same
-- one, because a sale paid in full is a fiado that owes nothing:
--
--   Other fiados owe in that currency  → abono to them, or cash
--   Nothing owed in that currency      → saldo a favor, or cash
--   A sale with no client (Mostrador)  → cash only: nobody to hold the saldo
--
-- ===========================================================================
-- WHAT «VENTAS» DOES: IT ONLY FALLS BY MONEY THAT LEFT THE TILL
--
-- «Ventas» is what was collected de contado, and a sale paid with saldo a favor
-- adds nothing to it (185). So if a saldo a favor lowered it, case 2 would read
-- $0 with $10 in the till. With only `to_cash` lowering it the three cases read
-- $0, $10 and $15: exactly the money that stayed. Units fall in every case, in
-- «Más vendidos» and the profit. See `lib/reports/devoluciones.ts`.
--
-- ===========================================================================
-- HOW IT IS WRITTEN
--
-- One `sale_returns` row, now with `charge_movement_id` null: there is no fiado.
-- `movements` keeps one line for it, ALWAYS, for the same reason as 185: a
-- return paid back entirely in cash moves no balance and still has to appear in
-- the history and be deletable. That line has no fiado, carries the saldo a
-- favor if there is one, and is 0 if there is not. A line per fiado follows.
--
-- A `return` with no fiado and amount 0 is harmless by construction: the queue
-- walks it last and subtracts nothing, and `get_client_credit` adds nothing.
--
-- The sale itself stays untouched: rule 6 of migration 180. Whether a book of a
-- sale is «cash» is the definition the history uses: it left no charge.
-- ===========================================================================

begin;

alter table public.sale_returns alter column charge_movement_id drop not null;

create or replace function public.registrar_devolucion_contado(
  p_sale_id uuid,
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
  v_sale public.sales%rowtype;
  v_walk_in boolean;
  v_line public.sale_lines%rowtype;
  v_book text;
  v_returned numeric;
  v_amount numeric;
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

  -- THE SALE AND ITS OWNER, EXPLICITLY. The ids come from the browser and this
  -- function reads with its own rights, so this is the lock, not the backstop.
  select s.* into v_sale
  from public.sales s
  join public.clients c on c.id = s.client_id
  where s.id = p_sale_id
    and s.owner_id = v_owner
    and s.deleted_at is null
    and c.owner_id = v_owner
    and c.trashed_at is null
    and c.deleted_at is null;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'venta_ajena');
  end if;

  select c.is_walk_in into v_walk_in from public.clients c where c.id = v_sale.client_id;

  -- One at a time per client: two returns of the same line could each fit.
  perform pg_advisory_xact_lock(hashtext('movements:' || v_sale.client_id::text));

  select l.* into v_line
  from public.sale_lines l
  where l.id = p_line_id and l.sale_id = p_sale_id;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'linea_ajena');
  end if;

  -- `sale_lines` spells the Colombian book 'COP' and `movements` spells it NULL.
  v_book := case when v_line.currency in ('USD', 'EUR') then v_line.currency end;

  -- A BOOK THAT LEFT A CHARGE IS NOT CASH. It has a fiado, also one settled with
  -- saldo a favor, and `registrar_devolucion` is the one that knows its debt.
  if exists (
    select 1 from public.movements m
    where m.sale_id = p_sale_id
      and m.type = 'charge'
      and m.deleted_at is null
      and m.currency is not distinct from v_book
  ) then
    return jsonb_build_object('ok', false, 'code', 'tiene_fiado');
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

  -- THE VALUE CANNOT PASS WHAT WAS COLLECTED IN THIS BOOK, less what already
  -- came back. Paying back more than came in is the worst this function can do.
  select coalesce((
           select sum(sp.amount) from public.sale_payments sp
           where sp.sale_id = p_sale_id
             and (case when sp.currency in ('USD', 'EUR') then sp.currency end)
                 is not distinct from v_book
         ), 0)
         - coalesce((
           select sum(r.amount) from public.sale_returns r
           where r.sale_id = p_sale_id
             and r.deleted_at is null
             and r.currency is not distinct from v_book
         ), 0)
    into v_ceiling;

  if v_amount - v_ceiling > v_holgura then
    return jsonb_build_object('ok', false, 'code', 'excede_la_venta', 'tope', v_ceiling);
  end if;

  -- ── EVERY FIADO, VALIDATED BEFORE ANYTHING IS WRITTEN ────────────────────
  for v_item in select * from jsonb_array_elements(coalesce(p_fiados, '[]'::jsonb))
  loop
    v_target := (v_item ->> 'fiado_id')::uuid;
    v_target_amount := (v_item ->> 'amount')::numeric;

    if v_target_amount is null or v_target_amount <= 0 then
      return jsonb_build_object('ok', false, 'code', 'monto_invalido', 'fiado_id', v_target);
    end if;

    if (select count(*) from jsonb_array_elements(p_fiados) x
        where (x ->> 'fiado_id')::uuid = v_target) > 1 then
      return jsonb_build_object('ok', false, 'code', 'fiado_repetido', 'fiado_id', v_target);
    end if;

    -- SAME CLIENT, LIVE CHARGE, SAME BOOK.
    perform 1
    from public.movements t
    where t.id = v_target
      and t.client_id = v_sale.client_id
      and t.type = 'charge'
      and t.deleted_at is null
      and t.currency is not distinct from v_book;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'fiado_ajeno', 'fiado_id', v_target);
    end if;

    select o.pending into v_target_pending
    from public.get_open_charges_for_client(v_sale.client_id) o
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

  -- ALL OF IT HAS TO BE SPOKEN FOR. Nothing is assumed: a browser that says
  -- nothing about the money gets a refusal, never a default destination.
  if abs(v_to_fiados + coalesce(p_a_favor, 0) + coalesce(p_efectivo, 0) - v_amount) > 0.01 then
    return jsonb_build_object('ok', false, 'code', 'reparto_no_cuadra', 'valor', v_amount);
  end if;

  if coalesce(p_a_favor, 0) > 0 then
    -- NOBODY TO HOLD IT. The Mostrador is every anonymous buyer at once, and
    -- `qa:venta-accion` already keeps it from carrying a balance.
    if v_walk_in then
      return jsonb_build_object('ok', false, 'code', 'sin_cliente');
    end if;

    -- SALDO A FAVOR ONLY WITH NO DEBT LEFT IN THIS BOOK. See 185's header.
    select coalesce(sum(o.pending), 0) into v_other_debt
    from public.get_open_charges_for_client(v_sale.client_id) o
    where o.currency is not distinct from v_book;

    if v_other_debt - v_to_fiados > v_holgura then
      return jsonb_build_object('ok', false, 'code', 'hay_deuda_en_esa_moneda', 'deuda', v_other_debt);
    end if;
  end if;

  -- ── AND ONLY NOW IT IS WRITTEN ───────────────────────────

  -- ITS LINE, ALWAYS, even at zero. See the header.
  insert into public.movements (
    client_id, created_by, type, amount, currency, source, payment_group_id
  )
  values (
    v_sale.client_id, v_owner, 'return', coalesce(p_a_favor, 0), v_book, 'manual', v_return_id
  )
  returning id, transaction_code into v_own_row, v_code;

  for v_item in select * from jsonb_array_elements(coalesce(p_fiados, '[]'::jsonb))
  loop
    insert into public.movements (
      client_id, created_by, type, amount, currency, source,
      applies_to_movement_id, payment_group_id
    )
    values (
      v_sale.client_id, v_owner, 'return', (v_item ->> 'amount')::numeric,
      v_book, 'manual', (v_item ->> 'fiado_id')::uuid, v_return_id
    );
  end loop;

  -- BACK ON THE SHELF. Only a counted quantity: a 0 born here would switch the
  -- product off in the public catalogue (migration 163).
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
    v_return_id, v_owner, v_sale.client_id, p_sale_id, p_line_id, null,
    v_line.product_id, v_line.name, p_quantity, v_line.unit_price, v_amount, v_book,
    0, v_to_fiados, coalesce(p_a_favor, 0), coalesce(p_efectivo, 0), v_stock, v_owner
  );

  -- CLAUDE.md: whoever writes several movements at once recalculates.
  perform public.recalc_client_running_balance(v_sale.client_id);

  return jsonb_build_object(
    'ok', true,
    'return_id', v_return_id,
    'movement_id', v_own_row,
    'client_id', v_sale.client_id,
    'transaction_code', v_code,
    'amount', v_amount,
    'to_fiados', v_to_fiados,
    'to_credit', coalesce(p_a_favor, 0),
    'to_cash', coalesce(p_efectivo, 0)
  );
end;
$fn$;

revoke all on function public.registrar_devolucion_contado(uuid, uuid, numeric, jsonb, numeric, numeric) from public, anon;
grant execute on function public.registrar_devolucion_contado(uuid, uuid, numeric, jsonb, numeric, numeric) to authenticated;

-- Deleting and restoring, redefined only for a return with no fiado: the notice
-- has to find its line, and there is no fiado that must still be there.

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
    and m.applies_to_movement_id is not distinct from v_return.charge_movement_id
  limit 1;

  perform public.recalc_client_running_balance(v_return.client_id);

  return jsonb_build_object('ok', true, 'client_id', v_return.client_id);
end;
$fn$;

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

  -- ITS FIADO, IF IT HAS ONE, AND ITS SALE HAVE TO STILL BE THERE.
  if (v_return.charge_movement_id is not null and not exists (
    select 1 from public.movements m
    where m.id = v_return.charge_movement_id and m.deleted_at is null
  )) or not exists (
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

-- The sale link of a return and the returned units of a cash sale, for the client.
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
          'charge_movement_id', r.charge_movement_id,
          -- MIGRATION 186: a return of a cash sale has no fiado to link back
          -- to, so its detail links to the sale.
          'sale_id', r.sale_id
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
                'unit_price', sl.unit_price,
                -- MIGRATION 186: the same mark a fiado's lines carry.
                'devuelto', coalesce((
                  select sum(r.quantity)
                  from public.sale_returns r
                  where r.sale_line_id = sl.id and r.deleted_at is null
                ), 0)
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
  '186_devoluciones_de_contado',
  'Devoluciones de ventas de contado: sale_returns.charge_movement_id admite null, registrar_devolucion_contado, y eliminar, restaurar y get_shared_balance las reconocen.'
)
on conflict (key) do nothing;

commit;
