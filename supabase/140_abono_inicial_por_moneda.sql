-- 140 -- EL ABONO INICIAL QUE VE EL CLIENTE, SUMADO SOLO EN SU MONEDA
--
-- Fixes a live defect, measured against the dev branch on 2026-10-22: a fiado
-- of 40,69 EUR whose sale also took 10 USD in cash told the CLIENT he had paid
-- 50,45 EUR -- more than the debt itself, in a currency he never handed over.
--
-- ===========================================================================
-- THE OWNER'S SCREEN ALREADY FIXED THIS. THE CLIENT'S DID NOT.
--
-- `app/(app)/transacciones/[movementId]/page.tsx` started filtering these
-- payments by currency on 2026-10-20, for this exact reason: the mixed sale was
-- adding the 40 dollars of cash to the «Abono» of the fiado in euros. That fix
-- never reached `get_shared_balance`, which sums every payment of the sale with
-- no filter at all -- so since that day the two screens have disagreed about
-- the same fiado, and only the owner's one was right.
--
-- WHY IT WENT UNNOTICED FOR TWO DAYS: it needs a sale paid in two currencies,
-- which dev has exactly one of. Nothing errors, no total looks impossible on
-- its own, and the number is only wrong when compared with the other screen.
--
-- ===========================================================================
-- AND THE COLOMBIAN HALF, found the same day on the owner's side
--
-- The owner's filter was `(p.currency ?? null) === m.currency`, which compares
-- 'COP' against NULL and never matches, so a Colombian fiado of 16.000 with
-- 8.000 paid at the counter showed «Abono $0» to the shopkeeper. That half is
-- fixed in TypeScript in the same commit; this file carries the same
-- normalization into SQL so the two cannot drift apart again.
--
-- ===========================================================================
-- THE EDGES, ENUMERATED BEFORE WRITING IT
--
--   * Colombian business: payment 'COP' vs movement NULL -> both normalize to
--     'COP' and match. This is what the `coalesce` is for.
--   * Venezuelan mixed sale: 'USD' and 'EUR' still do not match each other,
--     which is the whole point.
--   * Payment with no currency at all (anything predating the 124): normalizes
--     to 'COP' and so only joins a movement with no currency -- a Colombian
--     one. Correct: a Venezuelan movement always carries its book.
--   * Movement with no sale behind it: the subselect finds nothing, `coalesce`
--     gives 0, and the card prints zero -- the owner's instruction of
--     2026-10-20, unchanged.
--
-- WORST CASE IF THIS IS WRONG IN THE OTHER DIRECTION: a down payment that the
-- client stops seeing, which reads as the shopkeeper not having recorded it.
-- That is why `qa:colombia` row 6 compares the two screens rather than
-- checking each one against what this file intends.
--
-- RE-RUNNABLE: the signature does not change, so `create or replace` is
-- enough and running it twice does nothing. The body is copied from 139 with
-- one subselect changed -- the same way 139 was copied from 133.
--
-- VIGILADO POR: `qa:colombia` (filas 5 y 6) y `qa:venta` (filas 10, 10b, 10c).

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
              'unit_price', sl.unit_price
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
          'description', p.description,
          -- THE NEW ONE IN 133: the rate this payment sealed, so the client's
          -- card can print «Bs. … al día del abono» the way the owner's does.
          -- Null for a Colombian business and for anything older than sealing,
          -- and the card simply draws no line then.
          'exchange_rate_used', p.exchange_rate_used
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
grant execute on function public.get_shared_balance(text, int) to anon, authenticated;


-- LA DESCRIPCION NO LLEVA NI UNA COMILLA SIMPLE: es una CADENA de SQL, no un
-- comentario. Se cuentan las comillas del bloque y tienen que ser CUATRO.
insert into public.schema_migrations (key, description)
values (
  '140_abono_inicial_por_moneda',
  'El abono inicial que ve el CLIENTE se suma solo en la moneda de SU fiado. Antes mezclaba: medido en dev el 2026-10-22, un fiado de 40,69 EUR cuya venta cobro ademas 10 USD de contado le decia al cliente que habia abonado 50,45 EUR, mas que la propia deuda y en una moneda que nunca entrego. La pantalla del DUENO ya filtraba por moneda desde el 2026-10-20, por este mismo motivo; ese arreglo nunca llego a get_shared_balance, asi que desde ese dia las dos pantallas decian cifras distintas del mismo fiado y solo la del dueno acertaba. La normalizacion con coalesce a COP en los dos lados es la que ya usa esta misma funcion para las lineas de la venta: sale_payments escribe el libro colombiano como COP y movements lo escribe NULL, asi que sin ella un fiado colombiano de 16.000 con 8.000 entregados al comprar no casaba con su propio pago. BORDES: en Venezuela USD y EUR siguen sin casar entre si, que es el objetivo; un pago sin moneda -anterior a la 124- normaliza a COP y solo casa con un movimiento sin moneda, o sea colombiano; y un movimiento sin venta detras sigue dando cero, que es la instruccion del dueno del 2026-10-20. La firma no cambia, asi que volver a correrla no hace nada. Vigilada por qa:colombia, filas 5 y 6.'
)
on conflict (key) do nothing;

commit;
