-- 216 · BOLIVARS WITH FOUR DECIMALS
--
-- Owner's decision of 2026-11-17: «Calculadora y montos en bolívares debe tener 4 decimales en
-- toda la app porque así lo exige la ley», and, asked as a choice, «Todo, y se teclean 4». The
-- app formats and rounds bolivars to four decimals from that day (`BS_DECIMALS` in
-- lib/exchange-rate/format.ts). Two functions in the database still cut them to two, and each
-- would make a screen disagree with another:
--
--   1. `get_shared_balance` sums the bolivars typed at the moment of a sale (`abono_inicial_bs`)
--      with `round(…, 2)`. The owner's screen sums the same rows with four, so the client's link
--      would show Bs. 1.000,12 for a payment the owner sees as Bs. 1.000,1234.
--   2. `create_catalog_order_core` converts a product's price into the order's currency with
--      `round(…, 2)`. The cart converts with `priceIn`, now four in bolivars, so an order paid in
--      bolivars would store a price the customer never saw.
--
-- Each function is copied WHOLE from its latest definition and only the rounding changes:
-- `get_shared_balance` from 214, the core from 155 (renamed to `_core` in 157, never redefined
-- since). Read the latest definition before editing either again (CLAUDE.md, «lee la ÚLTIMA»).
--
-- NOTHING ELSE CHANGES. Columns already hold four decimals: `sale_payments.entry_amount`,
-- `catalog_order_items.unit_price` and the product prices are numeric(14, 4), and
-- `movements.entry_amount` is unbounded. Stored figures are not rewritten: what was saved with
-- two decimals reads as «,xx00», which is the same amount.
--
-- RE-RUNNABLE: both are `create or replace` on the signature that already exists, so a second
-- run replaces them again. `create or replace` keeps each function's grants; the core's revoke
-- is repeated anyway, because that function must never be callable from outside.

begin;

-- ── 1. get_shared_balance: 214's definition, typed bolivars summed with four decimals ─────────
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
                 then round(sum(sp.entry_amount), 4)
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

-- ── 2. create_catalog_order_core: 155's body, prices in bolivars with four decimals ──────────
create or replace function public.create_catalog_order_core(
  p_token text,
  p_customer_name text,
  p_customer_document text,
  -- LA LETRA DEL DOCUMENTO: 'V'/'E'/'J' o 'CC'/'CE'/'NIT'. Opcional y
  -- validada contra el país del negocio más abajo -- un 'NIT' llegando de una
  -- bodega venezolana es un error o una petición escrita a mano, y en los dos
  -- casos se descarta en vez de guardarse. Es el mismo criterio que
  -- `isDocumentTypeFor` aplica en las dos altas de cliente del dueño.
  p_customer_document_type text,
  p_customer_whatsapp text,
  p_wants_notices boolean,
  -- The literal sentence the checkbox had on screen. It is THE evidence for
  -- Meta, same rule as every other consent: two different texts turn the proof
  -- into a reconstruction.
  p_consent_text text,
  -- [{ "product_id": uuid, "quantity": number, "currency": text,
  --    "comment": text|null }]
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  -- THE CAPS, TOGETHER AND AT THE TOP so they can be seen at a glance and
  -- changed in one place. The numbers have reasons; they are not round for
  -- the sake of it:
  --
  --   50 lines: a real corner-shop order does not pass ten. Fifty leaves room
  --   to spare and cuts off a megabyte-sized request.
  --
  --   20 per minute per link: a script does thousands a minute and a shop does
  --   not do twenty. The limit tells the two apart by their SHAPE, not by
  --   their volume, which is what stops it blocking a real customer. Watching
  --   it is `CT-68`, because setting it too low costs sales and says nothing.
  c_max_lineas constant int := 50;
  c_max_por_minuto constant int := 20;

  v_owner_id uuid;
  v_link_id uuid;
  v_recientes int;
  v_phone text;
  v_nombre text;
  v_documento text;
  v_tipo_documento text;
  v_order_id uuid;
  v_item jsonb;
  v_n_items int;

  p public.products%rowtype;
  v_cantidad numeric;
  v_moneda text;
  v_tier text;
  -- THE TIER'S BASE (114). It is read once, right after the tier is decided,
  -- and every line below uses THIS and never `p.base_currency` -- which since
  -- 114 is only the product's default and prices nothing.
  v_base text;
  v_precio numeric;
  v_fijado numeric;
  v_min numeric;

  -- WHAT THE CONVERSION NEEDS, new in migration 111.
  v_monedas json;
  v_country text;
  v_settings public.owner_exchange_settings%rowtype;
  v_rate_usd numeric;
  v_rate_eur numeric;
  -- NEW IN 113. It does not come from `get_current_bcv_rate()` like the other
  -- two: the USDT price is not published by the central bank, it is scraped
  -- from CriptoYa and stored by migration 112.
  v_rate_usdt numeric;
  v_bs_base numeric;
  v_bs_destino numeric;
begin
  -- ── PADLOCK 1: the owner comes from the TOKEN ─────────────────────────
  select owner_id, id into v_owner_id, v_link_id
  from public.catalog_share_links
  where token = p_token;

  if not found then
    -- The same "no" for a token that never existed and one that was revoked,
    -- like every other public surface: anyone trying tokens at random learns
    -- nothing from the difference.
    return jsonb_build_object('ok', false, 'reason', 'enlace_invalido');
  end if;

  -- ── PADLOCK 4: cap per link, per minute ───────────────────────────────
  select count(*) into v_recientes
  from public.catalog_orders
  where catalog_link_id = v_link_id
    and created_at > now() - interval '1 minute';

  if v_recientes >= c_max_por_minuto then
    return jsonb_build_object('ok', false, 'reason', 'demasiadas_ordenes');
  end if;

  -- ── Who is ordering ───────────────────────────────────────────────────
  v_nombre := btrim(coalesce(p_customer_name, ''));
  v_documento := btrim(coalesce(p_customer_document, ''));

  if v_nombre = '' or length(v_nombre) > 120 then
    return jsonb_build_object('ok', false, 'reason', 'nombre_invalido');
  end if;

  if v_documento = '' or length(v_documento) > 40 then
    return jsonb_build_object('ok', false, 'reason', 'documento_invalido');
  end if;

  -- Normalised HERE and never by the caller, which is the same rule as the
  -- rest of the product: the phone is the key of the consent, and two
  -- spellings of the same number are two different people to the database.
  v_phone := public.normalize_whatsapp_phone(p_customer_whatsapp);
  if v_phone is null then
    return jsonb_build_object('ok', false, 'reason', 'whatsapp_invalido');
  end if;

  -- ── PADLOCK 3: size ───────────────────────────────────────────────────
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    return jsonb_build_object('ok', false, 'reason', 'sin_productos');
  end if;

  v_n_items := jsonb_array_length(p_items);
  if v_n_items = 0 then
    return jsonb_build_object('ok', false, 'reason', 'sin_productos');
  end if;
  if v_n_items > c_max_lineas then
    return jsonb_build_object('ok', false, 'reason', 'demasiados_productos');
  end if;

  -- ── THE SHOP'S RATE, ONCE FOR THE WHOLE ORDER (111) ───────────────────
  --
  -- Outside the loop on purpose: with the rate read per line, a twelve-product
  -- order could cross the cron refresh halfway through and end up holding two
  -- different rates inside it. A quote with two rates cannot be explained to
  -- anybody.
  --
  -- SAME RULE AS THE SCREEN, which builds it in `app/c/[token]/page.tsx`: if
  -- the shop set its own rate and has both, that one wins; otherwise the BCV
  -- one. The two have to agree, or the customer would see one number and the
  -- order would store another BY DESIGN, not by drift.
  select country into v_country from public.owners where id = v_owner_id;

  -- ── LA LETRA DEL DOCUMENTO, VALIDADA CONTRA EL PAÍS ──────────────────
  --
  -- AQUÍ Y NO ARRIBA CON EL RESTO DE LAS VALIDACIONES, y esto estuvo a punto
  -- de salir mal: `v_country` se lee en la línea de encima. Escrito junto a
  -- la comprobación del documento —51 líneas antes— leía NULL siempre, caía
  -- en la rama de país desconocido y descartaba TODAS las letras. El
  -- formulario habría mandado la V, la orden se habría guardado, y la letra
  -- no estaría; sin un solo error en ninguna parte.
  --
  -- SE DESCARTA EN SILENCIO SI NO CORRESPONDE AL PAÍS, y no se rechaza la
  -- orden: la letra es un adorno del documento, no el documento. Tumbar la
  -- compra de un cliente por eso sería cobrarle el error de otro. Es el mismo
  -- criterio que `isDocumentTypeFor` aplica en las dos altas del dueño.
  v_tipo_documento := nullif(btrim(coalesce(p_customer_document_type, '')), '');
  if v_tipo_documento is not null then
    if v_country = 'VE' and v_tipo_documento not in ('V', 'E', 'J') then
      v_tipo_documento := null;
    elsif v_country = 'CO' and v_tipo_documento not in ('CC', 'CE', 'NIT') then
      v_tipo_documento := null;
    elsif v_country is null then
      v_tipo_documento := null;
    end if;
  end if;
  if v_country = 'VE' then
    select * into v_settings from public.owner_exchange_settings where owner_id = v_owner_id;
    if v_settings.rate_mode = 'CUSTOM'
       and v_settings.custom_rate_usd is not null and v_settings.custom_rate_usd > 0
       and v_settings.custom_rate_eur is not null and v_settings.custom_rate_eur > 0 then
      v_rate_usd := v_settings.custom_rate_usd;
      v_rate_eur := v_settings.custom_rate_eur;
    else
      select r.usd, r.eur into v_rate_usd, v_rate_eur from public.get_current_bcv_rate() r;
    end if;

    -- THE USDT RATE IS READ EVEN WHEN THE SHOP USES ITS OWN RATE, and that is
    -- deliberate. `rate_mode = 'CUSTOM'` lets a shopkeeper set their own
    -- bolivar rate for the dollar and the euro; it says nothing about the P2P
    -- price of the USDT, which is a market price and not theirs to set. The
    -- product form treats it the same way.
    --
    -- Null is the normal state when nobody has opened this catalogue in 24
    -- hours, and null means USDT is simply not offered -- same as before
    -- migration 112 existed. See `get_current_usdt_rate()` for why stale is
    -- treated as absent.
    v_rate_usdt := public.get_current_usdt_rate();
  end if;

  -- ── The order ─────────────────────────────────────────────────────────
  insert into public.catalog_orders (
    owner_id, catalog_link_id,
    customer_name, customer_document, customer_document_type,
    customer_whatsapp, customer_whatsapp_raw,
    wants_whatsapp_notices
  )
  values (
    v_owner_id, v_link_id,
    v_nombre, v_documento, v_tipo_documento,
    v_phone, btrim(coalesce(p_customer_whatsapp, '')),
    coalesce(p_wants_notices, false)
  )
  returning id into v_order_id;

  -- ── The lines, one by one ─────────────────────────────────────────────
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    -- PADLOCK 2: the product belongs to THIS owner, is not in the bin and is
    -- published. Any old id pasted into the request does not get in.
    select * into p
    from public.products
    where id = (v_item ->> 'product_id')::uuid
      and owner_id = v_owner_id
      and trashed_at is null
      and (published_retail or published_wholesale);

    if not found then
      -- The whole order is undone. Half an order is worse than none: the
      -- shopkeeper would serve a request missing what the customer believed
      -- they had ordered, with nothing saying so.
      raise exception 'producto_invalido' using errcode = 'P0001';
    end if;

    v_cantidad := (v_item ->> 'quantity')::numeric;
    if v_cantidad is null or v_cantidad <= 0 or v_cantidad > 99999999999 then
      raise exception 'cantidad_invalida' using errcode = 'P0001';
    end if;

    -- THE TIER, under the same rule as `escalonParaCantidad`. See the header:
    -- this is where it is DECIDED, the TypeScript only displays it.
    --
    -- With no minimum quantity the wholesale tier is NEVER reached, and that
    -- is the safe side: a wholesale price charged for one unit is money lost.
    -- Migration 088 permits the null and documents the opposite reading; it is
    -- discarded here on purpose.
    v_min := p.wholesale_min_quantity;
    if not (p.published_retail and p.price_retail is not null) then
      v_tier := 'wholesale';
    elsif not (p.published_wholesale and p.price_wholesale is not null) then
      v_tier := 'retail';
    elsif v_min is null then
      v_tier := 'retail';
    elsif v_cantidad >= v_min then
      v_tier := 'wholesale';
    else
      v_tier := 'retail';
    end if;

    -- THE MINIMUM IS A HARD BARRIER ONLY WHEN THERE IS NOWHERE TO FALL. A
    -- product sold only by wholesale has no retail price to drop to, so
    -- ordering less than the minimum means nothing. With both tiers published,
    -- ordering few does mean something: it is the retail price.
    if v_tier = 'wholesale'
       and not (p.published_retail and p.price_retail is not null)
       and v_min is not null and v_cantidad < v_min then
      raise exception 'cantidad_bajo_el_minimo' using errcode = 'P0001';
    end if;

    v_precio := case when v_tier = 'wholesale' then p.price_wholesale else p.price_retail end;
    if v_precio is null then
      raise exception 'sin_precio' using errcode = 'P0001';
    end if;

    -- THE BASE OF THE TIER THAT APPLIES, read next to the price it belongs to
    -- so the two cannot come from different tiers.
    v_base := case when v_tier = 'wholesale'
                   then p.base_currency_wholesale
                   else p.base_currency_retail end;
    if v_base is null then
      -- Impossible once 114 has run -- both columns are NOT NULL -- but a
      -- null base would convert against nothing and quote a wrong number, so
      -- it refuses instead of guessing.
      raise exception 'sin_precio' using errcode = 'P0001';
    end if;

    -- PADLOCK 5: THIS function computes the amount, and the price NEVER
    -- travels in the request. That does not change. What changed on
    -- 2026-10-15 is where the number comes from -- the product record, or the
    -- product record plus the rate -- and the cost of that change is measured
    -- in this migration's header.
    v_moneda := upper(btrim(coalesce(v_item ->> 'currency', '')));

    -- FIRST: the currency has to be one this product actually sells in.
    -- Without this check any convertible currency would do -- a customer could
    -- order in euros a product the shopkeeper only sells in dollars, and the
    -- conversion would work perfectly.
    --
    -- PINNED PRICES COUNT EVEN WHEN THEY ARE NOT IN `product_currencies`, and
    -- this is not a belt-and-braces: without it migration 111 would BREAK
    -- products that work today. Migration 087 only carried `base_currency`
    -- over to that table (`select id, base_currency from products`), so a
    -- product not re-saved since then holds ONE enabled currency even when it
    -- carries pinned prices in others. A price pinned for a tier is the
    -- strongest possible statement that the product sells in that currency:
    -- the shopkeeper typed it by hand.
    --
    -- `qa:orden` 3a catches it, using a freshly created product -- no rows in
    -- `product_currencies` and the euro pinned at wholesale.
    v_monedas := public.product_catalog_currencies(p.id, v_tier, v_base);
    if v_moneda <> v_base
       and not exists (
         select 1 from json_array_elements_text(v_monedas) m where m.value = v_moneda
       )
       and not exists (
         select 1 from public.product_price_overrides o
         where o.product_id = p.id and o.tier = v_tier and o.currency = v_moneda
       )
    then
      raise exception 'moneda_invalida' using errcode = 'P0001';
    end if;

    -- THE SAME ORDER AS `priceIn` IN TYPESCRIPT: pinned by hand, then the
    -- base, then the conversion. The order matters and is not the intuitive
    -- one -- a pinned price wins EVEN over the base, because a closed padlock
    -- is an explicit decision by the shopkeeper and the base is the starting
    -- value.
    select amount into v_fijado
    from public.product_price_overrides
    where product_id = p.id and tier = v_tier and currency = v_moneda;

    if found and v_fijado is not null and v_fijado > 0 then
      v_precio := v_fijado;
    elsif v_moneda <> v_base then
      -- BOLIVARES PER UNIT OF EACH CURRENCY, same as `bolivaresPorUnidad`.
      --
      -- USDT JOINED THE LIST IN 113. Until then it was deliberately left out
      -- because its rate was stored nowhere, so every USDT order was rejected
      -- with `sin_tasa` unless the shopkeeper had pinned the price by hand.
      -- Migration 112 stores it, and `v_rate_usdt` is null exactly when it is
      -- missing or stale -- so the old behaviour is still what happens then,
      -- through the same branch, rather than through a special case.
      --
      -- COP IS STILL OUT, and that is not an omission: there is no
      -- bolivar/peso rate anywhere in the product and none is invented. A
      -- Colombian shop sells in its own currency and converts nothing.
      v_bs_base := case v_base
        when 'VES' then 1
        when 'USD' then nullif(v_rate_usd, 0)
        when 'EUR' then nullif(v_rate_eur, 0)
        when 'USDT' then nullif(v_rate_usdt, 0)
        else null end;
      v_bs_destino := case v_moneda
        when 'VES' then 1
        when 'USD' then nullif(v_rate_usd, 0)
        when 'EUR' then nullif(v_rate_eur, 0)
        when 'USDT' then nullif(v_rate_usdt, 0)
        else null end;

      if v_bs_base is null or v_bs_destino is null then
        -- A NEW REASON, DISTINCT FROM `moneda_invalida` ON PURPOSE. "We do not
        -- sell it in that currency" and "we do sell it but right now we have
        -- no rate" are two problems with two different fixes: the first the
        -- shopkeeper fixes by enabling the currency, the second fixes itself
        -- or is a fault of ours. One reason for both makes them
        -- indistinguishable in the log, which is where they get diagnosed.
        raise exception 'sin_tasa' using errcode = 'P0001';
      end if;

      -- TWO DECIMALS, ordinary rounding, same as `redondear` in price.ts.
      --
      -- CAREFUL, THE ARITHMETIC IS NOT THE SAME: `numeric` here and 64-bit
      -- floating point in the browser. On an exact tie the two could part
      -- company on the last cent, and then the customer would see one number
      -- and the order would store another. Not observed; written down because
      -- if someone ever reports "it stored a cent too much", this is the cause
      -- to look at first, not the rate drift. `qa:orden` 14a/14b compare the
      -- two sides to the cent, and `CT-72` holds what they do not cover.
      -- FOUR DECIMALS IN BOLIVARS since 216 (owner's decision of 2026-11-17), the same as
      -- `priceIn` in price.ts, so the cart and the stored order still say the same figure.
      v_precio := round(
        (v_precio * v_bs_base) / v_bs_destino,
        case when v_moneda = 'VES' then 4 else 2 end
      );

      if v_precio <= 0 then
        raise exception 'sin_precio' using errcode = 'P0001';
      end if;
    end if;

    insert into public.catalog_order_items (
      order_id, product_id, product_name,
      quantity, unit_price, currency, tier, comment
    )
    values (
      v_order_id, p.id, p.name,
      v_cantidad, v_precio, v_moneda, v_tier,
      nullif(btrim(coalesce(left(v_item ->> 'comment', 500), '')), '')
    );
  end loop;

  -- ── The consent, if they asked for it ─────────────────────────────────
  --
  -- OWNER'S DECISION ON 2026-10-15, displacing the "exit A" the same owner had
  -- decided on 2026-10-14. The old reason stays written down because it is the
  -- one needed to revert: the consent is valid for ALL businesses (migration
  -- 081) and here the number is typed by an anonymous visitor, so anyone could
  -- sign up a third party's number.
  --
  -- What displaces it is that the shopkeeper now OPENS the order and verifies
  -- name, document and phone -- and can correct them -- before serving it.
  -- That is the double check that did not exist on the 14th.
  --
  -- The remaining risk, stated: the consent exists from the moment the box is
  -- ticked until the shopkeeper looks. In that window no message goes out by
  -- itself -- that number also has to be a client of some shop and have a
  -- movement registered -- but the window exists. That is why the source is
  -- `client_order` and not `client_self`: if they ever have to be found and
  -- revoked, this column is the only way.
  if coalesce(p_wants_notices, false) and btrim(coalesce(p_consent_text, '')) <> '' then
    insert into public.client_whatsapp_consents (phone, event, consent_text, source)
    values (v_phone, 'granted', btrim(p_consent_text), 'client_order');
  end if;

  return jsonb_build_object('ok', true, 'order_id', v_order_id);

exception
  when sqlstate 'P0001' then
    -- The `raise` text is a stable code, not a sentence to display. The caller
    -- translates it; the public page NEVER shows raw text from the database,
    -- which is CLAUDE.md's rule about masking errors.
    --
    -- AND CATCHING IT HERE UNDOES THE WHOLE ORDER, which is the wanted
    -- behaviour: a block with an `exception` clause is a subtransaction, so
    -- entering here takes the already-inserted rows with it. Half an order is
    -- worse than none -- the shopkeeper would serve a request missing what the
    -- customer believed they had ordered, with nothing saying so.
    return jsonb_build_object('ok', false, 'reason', sqlerrm);

  when others then
    -- WHAT WE DID NOT FORESEE. A `product_id` that is not a uuid, a quantity
    -- that is not a number: things that do not come from a normal browser and
    -- that, without this, would surface as a raw Postgres error.
    --
    -- The caller gets a generic reason -- the masking rule -- and the real
    -- detail goes to the server log with `raise warning`, which is the only
    -- place we want to see it. Without the `warning`, this `when others` would
    -- swallow our own failures too and we would never know.
    raise warning 'create_catalog_order fallo inesperado: % (%)', sqlerrm, sqlstate;
    return jsonb_build_object('ok', false, 'reason', 'error');
end;
$fn$;

revoke execute on function public.create_catalog_order_core(text, text, text, text, text, boolean, text, jsonb) from public, anon, authenticated;

insert into public.schema_migrations (key, description)
values (
  '216_bolivars_four_decimals',
  'Bolívares con 4 decimales en la base: el enlace del cliente suma los bolívares tecleados al comprar con 4 decimales (get_shared_balance) y el pedido del catálogo convierte los precios a bolívares con 4 (create_catalog_order_core). Decisión del dueño del 2026-11-17. No reescribe nada guardado.'
)
on conflict (key) do nothing;

commit;
