-- 214 · HOW THE MONEY ARRIVED: `payment_method` on a sale payment and on an abono.
--
-- Owner's request of 2026-11-17: a «Método de pago» field in the payment of an abono, a cash sale
-- and a fiado, and a chart in Reportes › Facturación answering «¿Cuáles son los métodos de pago
-- que generan mayor ingreso?». The list and its labels live in `lib/payments/methods.ts`; this
-- file stores the value and lets the client's link return it.
--
-- WHAT IT DOES
--   1. `sale_payments.payment_method` and `movements.payment_method`, nullable text with a check
--      on the list. NULL is every payment recorded before today, and any written by a path that
--      does not ask (the libreta import): the chart calls them «Sin registrar». Nothing is
--      backfilled: nobody knows how those were paid, and guessing would present a guess as a
--      record (CLAUDE.md, «No se rellena el pasado con datos de hoy»).
--   2. `registrar_abono_repartido`: 170's definition, writing `payment_method` from each line.
--   3. `get_shared_balance`: 186's definition, returning the method of each abono, of a cash
--      sale, of what was paid at the moment of a purchase and of the cash a return handed back
--      (owner's decision of 2026-11-17: the client sees it as the owner does).
--   4. `sale_returns.refund_method` and the two return functions, which ask how the cash went
--      back (owner's decision of 2026-11-17, «Preguntar al devolver»).
--
-- EDITING IT BY CONSOLE IS ALREADY REFUSED: `movements_guard_update` (180) allows only
-- `deleted_at` to change, so a new column is covered without touching it.
--
-- VALUES IN ENGLISH, as CLAUDE.md asks of anything stored in the database.
--
-- RE-RUNNABLE: `add column if not exists`, the constraints dropped and added again, and both
-- functions `create or replace` with the signature they always had.
--
-- ORDER: dev first (`vzqppwrwnmlbrxizskdh`), then production (`rabmiyqodnvnrwiartuj`) in its
-- release window, BEFORE the code. The old code against this schema simply writes NULL.

begin;

alter table public.sale_payments add column if not exists payment_method text;
alter table public.sale_payments drop constraint if exists sale_payments_payment_method_check;
alter table public.sale_payments add constraint sale_payments_payment_method_check
  check (payment_method is null or payment_method in ('mobile_payment', 'cash', 'card', 'bank_transfer', 'binance_usdt', 'zelle', 'paypal', 'zinli', 'nequi', 'qr'));

alter table public.movements add column if not exists payment_method text;
alter table public.movements drop constraint if exists movements_payment_method_check;
-- Only a payment carries one: a fiado, an old debt or a return is not money that came in.
alter table public.movements add constraint movements_payment_method_check
  check (payment_method is null or (type = 'payment' and payment_method in ('mobile_payment', 'cash', 'card', 'bank_transfer', 'binance_usdt', 'zelle', 'paypal', 'zinli', 'nequi', 'qr')));

-- ── registrar_abono_repartido: 170's definition, with the method of each line ────────────────
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
      entry_currency, entry_amount, rate_usd_at_time, rate_eur_at_time,
      payment_method
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
      (v_linea ->> 'rate_eur_at_time')::numeric,
      -- MIGRATION 214. The check constraint on the column refuses a value outside the list, so a
      -- browser sending anything else fails the whole split, not one line of it.
      nullif(btrim(coalesce(v_linea ->> 'payment_method', '')), '')
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

-- ── 4. HOW THE MONEY WENT BACK: `sale_returns.refund_method` ────────────────────────────────
-- Owner's decision of 2026-11-17, asked with the chart in front of him: the return asks «¿Cómo le
-- devolviste el dinero?» and the Reportes chart takes the cash back off that method, instead of
-- off «Efectivo» by assumption. Only a return that hands cash back carries one; a return before
-- today has none and the chart takes it off «Sin registrar».
alter table public.sale_returns add column if not exists refund_method text;
alter table public.sale_returns drop constraint if exists sale_returns_refund_method_check;
alter table public.sale_returns add constraint sale_returns_refund_method_check
  check (refund_method is null or (to_cash > 0 and refund_method in ('mobile_payment', 'cash', 'card', 'bank_transfer', 'binance_usdt', 'zelle', 'paypal', 'zinli', 'nequi', 'qr')));

-- THE TWO RETURN FUNCTIONS: 188's definitions with one parameter more, `p_metodo`, written into
-- the row. A new parameter is a new signature, so both the old and the new one are dropped
-- first (CLAUDE.md, «A migration must survive being re-run»), and the grants of 185 and 186 are
-- written again. `default null` keeps the code from before this migration working: it calls
-- with six arguments and lands on this function.
drop function if exists public.registrar_devolucion(uuid, uuid, numeric, jsonb, numeric, numeric);
drop function if exists public.registrar_devolucion(uuid, uuid, numeric, jsonb, numeric, numeric, text);
create function public.registrar_devolucion(
  p_movement_id uuid,
  p_line_id uuid,
  p_quantity numeric,
  p_fiados jsonb default '[]'::jsonb,
  p_a_favor numeric default 0,
  p_efectivo numeric default 0,
  -- MIGRATION 214: how the cash went back. Ignored when no cash goes back.
  p_metodo text default null
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
    to_own, to_fiados, to_credit, to_cash, stock_returned, created_by,
    refund_method
  )
  values (
    v_return_id, v_owner, v_fiado.client_id, v_fiado.sale_id, p_line_id, v_fiado.id,
    v_line.product_id, v_line.name, p_quantity, v_line.unit_price, v_amount, v_fiado.currency,
    v_own, v_to_fiados, coalesce(p_a_favor, 0), coalesce(p_efectivo, 0), v_stock, v_owner,
    -- No cash back, no method: the column's check refuses one on a return with no cash.
    case when coalesce(p_efectivo, 0) > 0 then nullif(btrim(coalesce(p_metodo, '')), '') end
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

revoke all on function public.registrar_devolucion(uuid, uuid, numeric, jsonb, numeric, numeric, text) from public, anon;
grant execute on function public.registrar_devolucion(uuid, uuid, numeric, jsonb, numeric, numeric, text) to authenticated;

drop function if exists public.registrar_devolucion_contado(uuid, uuid, numeric, jsonb, numeric, numeric);
drop function if exists public.registrar_devolucion_contado(uuid, uuid, numeric, jsonb, numeric, numeric, text);
create function public.registrar_devolucion_contado(
  p_sale_id uuid,
  p_line_id uuid,
  p_quantity numeric,
  p_fiados jsonb default '[]'::jsonb,
  p_a_favor numeric default 0,
  p_efectivo numeric default 0,
  -- MIGRATION 214: how the cash went back. Ignored when no cash goes back.
  p_metodo text default null
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
    to_own, to_fiados, to_credit, to_cash, stock_returned, created_by,
    refund_method
  )
  values (
    v_return_id, v_owner, v_sale.client_id, p_sale_id, p_line_id, null,
    v_line.product_id, v_line.name, p_quantity, v_line.unit_price, v_amount, v_book,
    0, v_to_fiados, coalesce(p_a_favor, 0), coalesce(p_efectivo, 0), v_stock, v_owner,
    -- No cash back, no method: the column's check refuses one on a return with no cash.
    case when coalesce(p_efectivo, 0) > 0 then nullif(btrim(coalesce(p_metodo, '')), '') end
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

revoke all on function public.registrar_devolucion_contado(uuid, uuid, numeric, jsonb, numeric, numeric, text) from public, anon;
grant execute on function public.registrar_devolucion_contado(uuid, uuid, numeric, jsonb, numeric, numeric, text) to authenticated;

-- ── get_shared_balance: 186's definition, with the method of each payment ────────────────────
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
          -- MIGRATION 214: how the cash went back, as the owner sees it.
          'refund_method', r.refund_method,
          -- MIGRATION 186: a return of a cash sale has no fiado to link back
          -- to, so its detail links to the sale.
          'sale_id', r.sale_id
        )
        from public.sale_returns r
        where r.id = m.payment_group_id
      ) end,
      'applies_to_movement_id', m.applies_to_movement_id,
      'photo_path', m.photo_path,
      -- MIGRATION 214: how an abono was paid. The client sees it as the owner does (owner's
      -- decision of 2026-11-17, «Sí, igual que el dueño»).
      'payment_method', m.payment_method,
      -- And how what was paid at the moment of the purchase came in, when every payment of this
      -- book used the same method. Two methods have no single honest answer, and null draws none.
      'abono_inicial_metodo', (
        select case when count(distinct sp.payment_method) = 1 and count(*) = count(sp.payment_method)
                    then min(sp.payment_method) end
        from public.sale_payments sp
        where sp.sale_id = m.sale_id
          and coalesce(sp.currency, 'COP') = coalesce(m.currency, 'COP')
      ),
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
          'payment_method', p.payment_method,
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
      min(sp.description) filter (where sp.description is not null and sp.description <> '') as description,
      -- MIGRATION 214, the same rule as `abono_inicial_metodo`: one method for every payment of
      -- that book, or none.
      case when count(distinct sp.payment_method) = 1 and count(*) = count(sp.payment_method)
           then min(sp.payment_method) end as payment_method
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
          c.payment_method,
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
  '214_payment_method',
  'Método de pago en los pagos de una venta y en los abonos (sale_payments.payment_method y movements.payment_method), y cómo se devolvió el dinero de una devolución (sale_returns.refund_method). Lo escriben el abono repartido y las dos funciones de devolución, y lo devuelve el enlace del cliente. Lo de antes queda sin método: no se rellena.'
)
on conflict (key) do nothing;

commit;
