-- 133. The client's payment cards get their bolívares back.
--
-- Asked for by the owner on 2026-10-21, as a question: *«¿por qué eliminaste
-- las equivalencias en Bs. de los saldos abonados? no los elimines»*.
--
-- ===========================================================================
-- NOBODY DELETED THEM. THEY WERE NEVER THERE.
--
-- Worth writing down, because the screen genuinely looks like a regression and
-- the next person to see it will reach the same conclusion.
--
-- The line «Bs. … al día del abono» is drawn by `TarjetaDeAbono` whenever the
-- payment carries its sealed rate. The OWNER's page reads `movements` with his
-- session and passes `exchange_rate_used` straight through, so his cards have
-- always had it. The CLIENT's page has no session: everything it knows comes
-- from `get_shared_balance`, and the `abonos_por_fiado` map that migration
-- `128` added never included that column. So the client's cards have been
-- silent since the day they existed.
--
-- WHAT MADE IT VISIBLE was the card added on 2026-10-21 for the payment made
-- at purchase time. That one takes the fiado's own `exchange_rate_used`, which
-- the client DOES receive, so it prints its bolívares — and sat right on top
-- of two cards that print none. Three cards, one with the figure and two
-- without, in the same box. The inconsistency was there all along; adding a
-- correct card is what put it next to its absence.
--
-- ===========================================================================
-- WHY IT NEEDS A MIGRATION AND NOT A PROP
--
-- Same reason as `131` and `132`: this function is `security definer` and
-- builds its JSON field by field, so a column it does not name does not exist
-- for the client. The page cannot reach `movements` to fetch the rate itself.
--
-- ===========================================================================
-- THE RATE IS THE PAYMENT'S OWN, NOT TODAY'S
--
-- That distinction is the whole point of the line, and it is already written
-- in `tarjeta-de-abono.tsx`: that money changed hands on a given day. Telling
-- a customer that the abono he made two months ago «is» today's bolívares
-- describes a conversion nobody performed. Null where there is none —a
-- Colombian business, or anything older than sealing— and the card draws no
-- line rather than inventing one.
--
-- ===========================================================================
-- RUNS AFTER `132`. The body is copied from it verbatim with one key added to
-- the `abonos_por_fiado` objects. The signature does not change, so `create or
-- replace` is enough and re-running it is a no-op.

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
      'created_at', m.created_at,
      -- THE NEW ONE IN 132. What this fiado still owes, so the client's
      -- history can keep making sense once the abonos stop being listed.
      -- Null for a payment: a payment owes nothing, and zero would read as
      -- «settled», which is a statement about a debt.
      'pending',
        case when m.type = 'charge' then coalesce(oc.pending, 0) end
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


-- LA DESCRIPCION NO LLEVA NI UNA COMILLA SIMPLE: es una CADENA de SQL,
-- no un comentario. Se cuentan las comillas del bloque y tienen que ser
-- CUATRO. Le paso al dueno con la `131` el 2026-10-20.
insert into public.schema_migrations (key, description)
values (
  '133_el_cliente_ve_la_tasa_del_abono',
  'get_shared_balance() manda ademas exchange_rate_used en cada abono de abonos_por_fiado: la tasa que ESE abono sello, para que la tarjeta del cliente pueda escribir Bs. al dia del abono igual que la del dueno. NADIE LAS BORRO, NUNCA ESTUVIERON: esa linea la dibuja TarjetaDeAbono cuando el abono trae su tasa sellada, y la pagina del DUENO lee movements con su sesion y la pasa tal cual, asi que sus tarjetas siempre la tuvieron. La del CLIENTE no tiene sesion y todo lo que sabe sale de esta funcion, donde el mapa abonos_por_fiado que anadio la 128 nunca incluyo esa columna. Lo que lo hizo visible fue la tarjeta del pago hecho al comprar, anadida el 2026-10-21: esa toma la tasa del propio fiado, que el cliente SI recibe, asi que imprime sus bolivares y quedo encima de dos tarjetas que no imprimen ninguno. La incoherencia llevaba ahi desde el principio; anadir una tarjeta correcta es lo que la puso al lado de su ausencia. POR QUE PIDE MIGRACION Y NO UNA PROP: esta funcion es security definer y arma el JSON campo a campo, asi que una columna que no nombra no existe para el cliente, y la pagina no puede ir a movements a buscarla. LA TASA ES LA DEL ABONO Y NO LA DE HOY, que es el sentido entero de la linea: ese dinero ya cambio de manos, y decirle al cliente que su abono de hace dos meses son los bolivares de hoy describe una conversion que nadie hizo. Null donde no la hay -un negocio colombiano, o algo anterior al sellado- y la tarjeta no dibuja la linea. CORRE DESPUES DE LA 132; el cuerpo va copiado de ella con una clave mas. La firma no cambia, asi que create or replace basta y volver a correrla no hace nada.'
)
on conflict (key) do nothing;

commit;
