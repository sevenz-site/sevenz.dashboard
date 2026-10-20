-- 131. The CLIENT sees the cash sales too — `CT-104`.
--
-- Asked for by the owner on 2026-10-19 (*«Sí pongámoslo también en la pantalla
-- del cliente»*) and again on 2026-10-20: *«aún no puedo ver el detalle de
-- venta de contado»*.
--
-- ===========================================================================
-- WHY THIS NEEDS A MIGRATION AT ALL
--
-- A fully-paid sale writes NOTHING to `movements` (migration `124`), on
-- purpose: that is what keeps cash out of the balance, the credit score and
-- the charts without a single filter anywhere. The OWNER's screen solves it by
-- reading `sales` + `sale_payments` + `sale_lines` with his own session and
-- merging at paint time.
--
-- The client cannot do that. `/s/[token]` has no session: its only door is
-- this function, which is `security definer` and builds its JSON field by
-- field. **A column this function does not name does not exist for the
-- client.** So the cash sale is invisible there, and no amount of work in the
-- page can change it.
--
-- WHAT THAT COSTS, in plain words: Pedro pays in full, takes his goods, opens
-- his link to check — and the purchase he just made is not there. The owner
-- sees it and he does not. Two people looking at the same account reading
-- different things is the one thing Sevenz exists to prevent.
--
-- ===========================================================================
-- THE RULE IS PER (SALE, BOOK), NOT PER SALE
--
-- Same rule as `filasDeContado` on the owner's side, and it is written twice
-- on purpose: that function is TypeScript inside a `"use server"` module and
-- cannot be called from SQL. What the two have to agree on is the rule, and
-- it is stated in both headers so a future change to one is an obvious
-- omission in the other.
--
-- A mixed sale — dollars paid on the spot, euros on credit — produces a cash
-- row for dollars and nothing for euros, because euros already have their
-- charge. Excluding the whole sale was the bug the owner reported on
-- 2026-10-20: the ten dollars he had charged appeared nowhere.
--
-- ===========================================================================
-- THE TWO TABLES DO NOT SPELL "COLOMBIA" THE SAME WAY
--
-- This is the trap, and the first version of this migration fell into it.
--
--   `sale_payments.currency` / `sale_lines.currency`   store 'COP'
--   `movements.currency`                               stores NULL
--
-- Same book, two spellings. `registrarVenta` writes the sale tables with the
-- catalogue's `PriceCurrency` and the movement with `libroDeMoneda(...)`,
-- which maps 'COP' to NULL. The owner's side already knows this — its `libro()`
-- helper in `lib/ventas-de-contado.ts` exists for exactly this translation —
-- and the first draft of this file did not replicate it.
--
-- What that would have done: joined 'COP' against '', never matched, excluded
-- nothing, and given **every Colombian fiado a phantom cash row beside it**,
-- for the full amount, on the client's own screen. The customer would see his
-- debt listed twice: once as owed and once as already paid.
--
-- AND NOTHING IN DEV WOULD HAVE CAUGHT IT. There is not one row with 'COP' in
-- `sale_payments` — every Colombian business in dev has fiados and zero sales.
-- The migration ran, returned correct rows for the Venezuelan client it was
-- tested against, and was wrong for an entire country.
--
-- So every comparison below normalises FIRST, with the same rule as `libro()`:
-- anything that is not USD or EUR is the null book. `coalesce(..., '')` on top
-- is still needed because `NULL = NULL` is NULL and never true, so the null
-- book would not match itself either.
--
-- ===========================================================================
-- THE WINDOW, AND WHAT IT CANNOT PROMISE
--
-- Movements come capped at `p_limit` (50 by default). The cash sales are
-- capped the same way and counted separately, so the page can say how many of
-- each it is showing.
--
-- What this does NOT give is a single merged window: at the boundary, a cash
-- sale older than the 50th movement can appear while an older movement does
-- not. Every row shown is true; what is not exact is "these are the N most
-- recent things". Merging properly would mean one query over a union of two
-- tables with different shapes, and the page would still have to split them
-- again to draw them. Said out loud here rather than discovered later.
--
-- `create or replace`, so `anon` keeps its grant — and the grant is restated
-- at the end anyway, as `044` learned the hard way. The body is copied
-- verbatim from `129` with the new block and two new keys, which is the
-- pattern this function has followed since `044`: the diff is what gets read.

begin;

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
      'plazo_dias', m.plazo_dias,
      'cuotas', m.cuotas,
      'applies_to_movement_id', m.applies_to_movement_id,
      'photo_path', m.photo_path,
      -- THE NEW ONE. What was paid on the spot when this fiado was registered,
      -- summed over that sale's payments. Zero when there is no sale, no
      -- payment, or the movement is itself a payment -- see the header: zero
      -- is a value here, and the screen draws it.
      'abono_inicial', coalesce(
        (
          select sum(sp.amount)
          from public.sale_payments sp
          where sp.sale_id = m.sale_id
        ),
        0
      ),
      'rate_mode_used', m.rate_mode_used,
      'exchange_rate_used', m.exchange_rate_used,
      'official_bcv_rate_at_time', m.official_bcv_rate_at_time,
      'entry_currency', m.entry_currency,
      'entry_amount', m.entry_amount,
      'rate_usd_at_time', m.rate_usd_at_time,
      'rate_eur_at_time', m.rate_eur_at_time,
      'created_at', m.created_at
    ) order by m.created_at asc
  )
  into v_movements
  from (
    select *
    from public.movements
    where client_id = v_client.id and deleted_at is null
    order by created_at desc
    limit p_limit
  ) m;

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
          'movement_id', p.id,
          'fecha', p.created_at,
          'currency', p.currency,
          'amount', p.amount,
          'description', p.description
        ) order by p.created_at desc) as lista
      from public.movements p
      where p.client_id = v_client.id
        and p.deleted_at is null
        and p.type = 'payment'
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
    group by s.id, s.created_at, case when sp.currency in ('USD', 'EUR') then sp.currency end
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

-- `create or replace` vuelve a conceder EXECUTE, y esta función la llama
-- `anon`: es la que sirve la página pública del cliente. Se repite tal cual la
-- dejó la `044`.

-- `create or replace` vuelve a conceder EXECUTE, y esta función la llama
-- `anon`: es la que sirve la página pública del cliente. Se repite tal cual la
-- dejó la `044`.
grant execute on function public.get_shared_balance(text, int) to anon, authenticated;

insert into public.schema_migrations (key, description)
values (
  '131_el_cliente_ve_el_contado',
  'get_shared_balance() devuelve ventas_de_contado y contado_total: las ventas pagadas enteras del cliente, una fila por (venta, libro), con sus lineas, lo que entrego, la tasa sellada del pago y su descripcion. Cierra CT-104, pedido por el dueno el 2026-10-19 y repetido el 2026-10-20. · POR QUE HACIA FALTA UNA MIGRACION: una venta pagada entera no escribe nada en movements (la 124), asi que la pantalla del DUENO la arma leyendo sales + sale_payments + sale_lines con su sesion, y la del CLIENTE no puede porque su unica puerta es esta funcion, que es security definer y arma el JSON campo a campo -- una columna que no nombra no existe para el cliente. El resultado era que el cliente pagaba de contado y no veia su compra, mientras el tendero si: los dos mirando la misma cuenta y leyendo cosas distintas. · LA REGLA ES POR (VENTA, LIBRO) y no por venta, la misma que filasDeContado en el lado del dueno: una venta mixta saca fila de contado en la moneda cobrada y ninguna en la fiada, que ya tiene su cargo. Escribirla dos veces es deliberado -- aquella es TypeScript en un modulo use server y no se puede llamar desde SQL. · coalesce(currency, '') en la clave del cruce: un negocio colombiano guarda NULL y NULL nunca es igual a NULL, asi que un cruce normal no excluiria nada y cada fiado colombiano sacaria ademas una fila de contado fantasma. Habria pasado cualquier prueba venezolana. · LA VENTANA NO ES UNICA: los movimientos y las ventas se acotan por separado con p_limit, asi que en el borde puede salir una venta mas vieja que el movimiento numero 50. Cada fila es cierta; lo que no es exacto es «estas son las N cosas mas recientes». · CORRE DESPUES DE LA 129; el cuerpo va copiado verbatim de ella con un bloque mas y dos claves mas. · CORREGIDA EL 2026-10-20 DESPUES DE CORRERSE EN DEV: la primera version cruzaba coalesce(sp.currency,'') contra coalesce(m.currency,''), y las dos tablas NO escriben Colombia igual -- sale_payments y sale_lines guardan 'COP' y movements guarda NULL. Asi que el cruce nunca casaba, no excluia nada, y CADA FIADO COLOMBIANO habria sacado ademas una fila de contado fantasma por su importe entero en la pantalla del propio cliente: su deuda listada dos veces, una como debida y otra como ya pagada. No lo habria cazado ninguna prueba en dev porque no hay NI UNA fila con 'COP' en sale_payments. Ahora toda comparacion normaliza primero con la misma regla que libro() en lib/ventas-de-contado.ts.'
)
-- `do update` Y NO `do nothing`, solo en esta migración y con motivo: el
-- archivo se CORRIGIÓ después de correrse en dev --el cruce de monedas estaba
-- mal para Colombia, ver la cabecera-- así que la fila que ya existe describe
-- una versión que ya no está en ninguna parte. Con `do nothing` el ledger
-- seguiría afirmando algo falso y la comparación de entornos lo daría por
-- bueno. La clave no cambia; lo que se pone al día es lo que dice.
on conflict (key) do update set description = excluded.description;

commit;
