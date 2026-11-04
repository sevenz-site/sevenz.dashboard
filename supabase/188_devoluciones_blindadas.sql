-- ENVIRONMENT: run in DEV first (vzqppwrwnmlbrxizskdh). Production comes later,
-- with its own green light, AFTER 185 and 186 and BEFORE the code (CLAUDE.md,
-- deploy step 1). The old code keeps working against this file: it refuses
-- nothing the screens do. Re-runnable: functions are `create or replace` with
-- the signature they already have, triggers are dropped first, the column is
-- `if not exists`.
--
-- ===========================================================================
-- 188: RETURNS, CLOSED AGAINST THE CONSOLE, AND THE CASES THAT WERE STUCK
--
-- The returns audit of 2026-11-04, measured in dev. The owner asked for it to be
-- fixed the same day.
--
-- WHY THESE GUARDS DO NOT WAIT FOR MIGRATION 180'S SWITCH. 180's rules are
-- observing in production until `PL-21` turns them on. With them observing, a
-- return line went from $10 to $5.000 by console, and that was $5.000 of saldo a
-- favor a client could spend. A return is a new kind of row with no legitimate
-- direct write at all, so nothing here needs a trial period: every guard is on
-- from the first run, for direct session writes only (`ledger_direct_write`).
-- The functions, being definer, and `service_role` are exempt as in 180.
--
--   A2 · A return line cannot be edited, and no row can become one.
--   A3 · Nothing with a live return under it can be hard-deleted. Inside 180's
--        ten-minute window a sale went and its event with it, leaving $10 of
--        spendable saldo with no sale behind it and a unit too many on the shelf.
--        A fiado's return lines fell to `applies_to` null and became saldo.
--        A sale also cannot gain or lose a line or a payment once it has a live
--        return: that is what the ceiling below is computed from.
--   A5 · `paid_with_credit` is a claim about the book, and the book now checks
--        it: the amount cannot pass `get_client_credit`, and the check takes the
--        client's lock, so two sales at once cannot spend the same saldo. `$5.000
--        paid with saldo` by console was a real debt hidden from «Fiados».
--
-- NOT CLOSED HERE, and said out loud: A4. A sale is written by direct inserts, so
-- for ten minutes a session can invent one with a $5.000 payment and return it
-- as saldo a favor. The database cannot tell it from a real one. The fix is
-- writing the sale inside a function, which is days of work on the money path.
--
-- ===========================================================================
-- THE CASES WITH NO ATTACKER
--
--   B1 · THE LAST UNIT COULD NOT COME BACK. Three at $4,50 charged at $13 because
--        the shopkeeper rounded down: two returns of $4,50 and the third refused
--        with no way out, which sends him back to writing a false abono, the bug
--        185 was born to fix. Now the unit is worth what is left of the sale,
--        $4,00. Same for a cash sale collected below its lines. The screen says
--        so before anything is pressed.
--        And the value is rounded on the line's running total, not unit by unit:
--        three of $3,335 are $3,34 + $3,33 + $3,34, the $10,01 of the line. Unit
--        by unit it was $10,02 and the third was refused for one cent. It also
--        ends a rounding gain measured by console: 0,005 units of $1 were worth
--        $0,01 each, twice their value.
--   B2 · A FIADO THAT RECEIVED MONEY FROM A RETURN CANNOT BE DELETED while that
--        line lives. It left the book at -$10 that `get_client_credit` would not
--        offer: a saldo on the card that no sale could spend.
--   B4 · A RESTORE PUTS BACK ONLY WHAT THE DELETE TOOK OFF. Delete clamps at zero
--        and restore added everything, so with units resold in between the shelf
--        showed units nobody had. The catalogue would sell them.
--
-- Both `eliminar` and `restaurar` also lock the event before reading it: two at
-- once could not be made to fail in dev, but the read came before the lock.
-- ===========================================================================

begin;

-- What a delete really took off the shelf. Null while the return is alive.
alter table public.sale_returns add column if not exists stock_removed numeric(14, 3);

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
  v_returned_value numeric;
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
    select 1 from public.sales s
    where s.id = v_fiado.sale_id and s.owner_id = v_owner and s.deleted_at is null
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

  select coalesce(sum(r.quantity), 0), coalesce(sum(r.amount), 0) into v_returned, v_returned_value
  from public.sale_returns r
  where r.sale_line_id = p_line_id and r.deleted_at is null;

  if p_quantity - (v_line.quantity - v_returned) > 0.0005 then
    return jsonb_build_object(
      'ok', false, 'code', 'excede_la_cantidad',
      'disponible', v_line.quantity - v_returned
    );
  end if;

  -- THE VALUE OF THE LINE SO FAR, LESS WHAT ALREADY CAME BACK. Rounded on the
  -- running total and not unit by unit, so three returns of $3,335 add up to the
  -- $10,01 of the line. See 188's header.
  v_amount := round((v_returned + p_quantity) * v_line.unit_price, 2) - v_returned_value;
  if v_amount <= 0 then
    return jsonb_build_object('ok', false, 'code', 'sin_valor');
  end if;

  -- THE VALUE CANNOT PASS WHAT THIS BOOK OF THE SALE WAS WORTH. A fiado can be
  -- typed below the sum of its lines (a rounded-down price), so the last unit
  -- is worth what is left. See 188's header.
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

  if v_ceiling <= v_holgura then
    return jsonb_build_object('ok', false, 'code', 'excede_la_venta', 'tope', v_ceiling);
  end if;
  v_amount := least(v_amount, round(v_ceiling, 2));

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
  v_returned_value numeric;
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

  select coalesce(sum(r.quantity), 0), coalesce(sum(r.amount), 0) into v_returned, v_returned_value
  from public.sale_returns r
  where r.sale_line_id = p_line_id and r.deleted_at is null;

  if p_quantity - (v_line.quantity - v_returned) > 0.0005 then
    return jsonb_build_object(
      'ok', false, 'code', 'excede_la_cantidad',
      'disponible', v_line.quantity - v_returned
    );
  end if;

  -- Rounded on the running total of the line. See 188's header.
  v_amount := round((v_returned + p_quantity) * v_line.unit_price, 2) - v_returned_value;
  if v_amount <= 0 then
    return jsonb_build_object('ok', false, 'code', 'sin_valor');
  end if;

  -- THE VALUE CANNOT PASS WHAT WAS COLLECTED IN THIS BOOK, less what already
  -- came back. Paying back more than came in is the worst this function can do,
  -- so the last unit of a sale collected below its lines is worth what is left.
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

  if v_ceiling <= v_holgura then
    return jsonb_build_object('ok', false, 'code', 'excede_la_venta', 'tope', v_ceiling);
  end if;
  v_amount := least(v_amount, round(v_ceiling, 2));

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
  v_stock numeric;
  v_removed numeric;
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
    and r.deleted_at is null
  for update of r;

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
  -- sold again since, and a negative shelf means nothing. What really came off
  -- is written down, because that and not `stock_returned` is what a restore
  -- may put back. See 188's header.
  if v_return.stock_returned is not null and v_return.product_id is not null then
    select p.stock_opening into v_stock
    from public.products p where p.id = v_return.product_id for update;

    if v_stock is not null then
      v_removed := least(v_stock, v_return.stock_returned);
      update public.products
         set stock_opening = v_stock - v_removed,
             updated_at = now()
       where id = v_return.product_id;
      update public.sale_returns set stock_removed = v_removed where id = v_return.id;
    end if;
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
    and r.deleted_at is not null
  for update of r;

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

  update public.sale_returns set deleted_at = null, stock_removed = null where id = v_return.id;

  if v_return.stock_returned is not null and v_return.product_id is not null then
    select p.stock_opening into v_stock
    from public.products p where p.id = v_return.product_id for update;

    if v_stock is not null then
      update public.products
         set stock_opening = v_stock + coalesce(v_return.stock_removed, v_return.stock_returned),
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

-- ── THE GUARDS ─────────────────────────────────────────────────────────────

create or replace function public.movements_guard_returns()
returns trigger
language plpgsql
as $$
declare
  v_credit numeric;
begin
  if not public.ledger_direct_write() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.type = 'return' then
      raise exception using
        message = 'Una devolución se registra desde el fiado.', errcode = 'SZ010';
    end if;

    -- A5. `amount` is what the saldo has to cover, whole: the app only sets the
    -- flag on a charge the saldo pays entirely. The lock is the client's, the
    -- one every return takes.
    if new.paid_with_credit then
      perform pg_advisory_xact_lock(hashtext('movements:' || new.client_id::text));
      select coalesce(max(g.credit), 0) into v_credit
      from public.get_client_credit(new.client_id) g
      where g.currency is not distinct from new.currency;

      if new.type <> 'charge' or new.amount - v_credit > 0.005 then
        raise exception using
          message = 'El saldo a favor de este cliente cambió. Revísalo y vuelve a intentarlo.',
          errcode = 'SZ013';
      end if;
    end if;
    return new;
  end if;

  -- A2. `running_balance` stays out of this list: the recalculation runs as the
  -- caller, and 177's trigger owns it. `deleted_at` is handled just below.
  if (old.type = 'return' or new.type = 'return')
     and (new.type, new.amount, new.currency, new.client_id, new.sale_id,
          new.applies_to_movement_id, new.payment_group_id, new.created_at)
         is distinct from
         (old.type, old.amount, old.currency, old.client_id, old.sale_id,
          old.applies_to_movement_id, old.payment_group_id, old.created_at) then
    raise exception using
      message = 'Una devolución no se puede editar.', errcode = 'SZ010';
  end if;

  if new.paid_with_credit is distinct from old.paid_with_credit then
    raise exception using
      message = 'Una transacción no se puede editar. Bórrala y regístrala de nuevo.', errcode = 'SZ010';
  end if;

  if new.deleted_at is distinct from old.deleted_at then
    if old.type = 'return' then
      raise exception using
        message = 'Una devolución se elimina desde su detalle.', errcode = 'SZ010';
    end if;
    -- B2 joins here: its own line always exists, and the lines of other returns
    -- that paid into this fiado are the same kind of row.
    if new.deleted_at is not null and exists (
      select 1 from public.movements r
      where r.applies_to_movement_id = old.id
        and r.type = 'return'
        and r.deleted_at is null
    ) then
      raise exception using
        message = 'Este fiado tiene devoluciones. Elimínalas primero.', errcode = 'SZ011';
    end if;
  end if;

  return new;
end;
$$;

-- A3. BEFORE DELETE, which 185 did not cover. The rollback of `registrarVenta`
-- deletes rows it wrote seconds ago, and those cannot have a return yet.
create or replace function public.movements_guard_returns_delete()
returns trigger
language plpgsql
as $$
begin
  if public.ledger_direct_write()
     and (old.type = 'return' or exists (
       select 1 from public.movements r
       where r.applies_to_movement_id = old.id
         and r.type = 'return'
         and r.deleted_at is null
     )) then
    raise exception using
      message = 'Eso tiene devoluciones. Elimínalas primero.', errcode = 'SZ011';
  end if;
  return old;
end;
$$;

drop trigger if exists movements_guard_returns_delete on public.movements;
create trigger movements_guard_returns_delete
  before delete on public.movements
  for each row execute function public.movements_guard_returns_delete();

create or replace function public.sales_guard_returns_delete()
returns trigger
language plpgsql
as $$
begin
  if public.ledger_direct_write() and exists (
    select 1 from public.sale_returns r
    where r.sale_id = old.id and r.deleted_at is null
  ) then
    raise exception using
      message = 'Esta venta tiene devoluciones. Elimínalas primero.', errcode = 'SZ011';
  end if;
  return old;
end;
$$;

drop trigger if exists sales_guard_returns_delete on public.sales;
create trigger sales_guard_returns_delete
  before delete on public.sales
  for each row execute function public.sales_guard_returns_delete();

-- Lines and payments are what the value and the ceiling of a return come from.
create or replace function public.sale_rows_guard_returns()
returns trigger
language plpgsql
as $$
declare
  v_sale uuid := case when tg_op = 'DELETE' then old.sale_id else new.sale_id end;
begin
  if public.ledger_direct_write() and exists (
    select 1 from public.sale_returns r
    where r.sale_id = v_sale and r.deleted_at is null
  ) then
    raise exception using
      message = 'Esta venta tiene devoluciones. Elimínalas primero.', errcode = 'SZ011';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists sale_lines_guard_returns on public.sale_lines;
create trigger sale_lines_guard_returns
  before insert or update or delete on public.sale_lines
  for each row execute function public.sale_rows_guard_returns();

drop trigger if exists sale_payments_guard_returns on public.sale_payments;
create trigger sale_payments_guard_returns
  before insert or update or delete on public.sale_payments
  for each row execute function public.sale_rows_guard_returns();

insert into public.schema_migrations (key, description)
values (
  '188_devoluciones_blindadas',
  'Devoluciones: las filas no se editan ni se borran por consola, el saldo usado se comprueba, la ultima unidad vale lo que queda, un fiado con devolucion no se borra y restaurar solo repone lo que salio del estante.'
)
on conflict (key) do nothing;

commit;
