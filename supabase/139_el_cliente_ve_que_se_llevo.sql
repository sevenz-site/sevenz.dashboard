-- EL CLIENTE VE QUE SE LLEVO, igual que el dueno -- migracion 139.
--
-- Encargo del dueno el 2026-10-22: *<<En el detalle del cliente falta mostrar
-- el producto que se llevo, muestralo igual que en el dueno con la misma
-- tabla>>*.
--
-- ===========================================================================
-- ESTO REVIERTE UNA DECISION DE LA 122, Y LAS DOS QUEDAN ESCRITAS
--
-- Aquella decia que el inventario del negocio no viaja a la pantalla del
-- cliente, y la pantalla del cliente lleva desde entonces sin la tabla de
-- productos. El argumento no era malo -- que mi cliente sepa que vendo cascos
-- a 45,50 es informacion de mi negocio -- pero gana el otro: el cliente que
-- abre su enlace quiere comprobar QUE le fiaron, y una ficha que dice
-- <<Fiado 44,36>> sin decir de que no se puede comprobar contra nada.
--
-- ===========================================================================
-- POR QUE ES UNA MIGRACION Y NO UNA PROP
--
-- `get_shared_balance` es security definer y arma el JSON campo a campo, asi
-- que una columna que no nombra no existe para el cliente. La pagina no tiene
-- sesion y no puede ir a `sale_lines` por su cuenta.
--
-- ===========================================================================
-- SOLO LAS LINEAS DE SU MONEDA, Y ESO NO ES UNA PRECAUCION
--
-- Es el arreglo de un fallo reportado el 2026-10-20: una venta mixta -- unos
-- productos en dolares, otros en euros -- salia entera como si fuera de una
-- sola moneda, y la pantalla del dueno sumaba diez dolares a lo abonado en
-- euros. La pagina del dueno ya filtra; aqui se filtra en SQL, con la misma
-- normalizacion que ya usan los pagos de contado mas abajo: `sale_lines`
-- escribe el libro colombiano como 'COP' y `movements` lo escribe NULL.
--
-- ===========================================================================
-- LOS BORDES, ENUMERADOS ANTES DE ESCRIBIRLO
--
--   * Movimiento sin venta detras (todo lo anterior al 2026-10-17 y todo lo
--     que entra por la libreta): no hay lineas, la clave viaja como `[]` y la
--     tabla no se dibuja. Es el mismo caso que ya maneja la del dueno.
--   * Venta mixta: solo las lineas de la moneda de ESE movimiento, ver arriba.
--   * Un abono: tiene `sale_id` nulo, asi que tampoco dibuja tabla. Correcto:
--     un pago no se lleva productos.
--   * La ventana de 50 movimientos: las lineas se calculan DENTRO del mismo
--     subselect, asi que solo se resuelven para los que viajan.
--
-- EL PEOR ESCENARIO que esto podria abrir seria que un cliente viera los
-- productos de OTRO. No puede: el subselect de `sale_lines` esta atado a
-- `m.sale_id`, y `m` ya viene filtrado por `client_id = v_client.id`, que a su
-- vez sale del token. No hay ningun parametro del visitante en esa cadena.
--
-- CORRE DESPUES DE LA 133; el cuerpo va copiado de ella con una clave mas. La
-- firma no cambia, asi que create or replace basta y volver a correrla no hace
-- nada.

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
  '139_el_cliente_ve_que_se_llevo',
  'get_shared_balance() manda ademas productos en cada movimiento: las lineas de sale_lines de la venta de la que nacio, solo las de SU moneda. Encargo del dueno el 2026-10-22, y revierte la decision de la 122 de que el inventario del negocio no viajara a la pantalla del cliente. Aquel argumento era que mi cliente no tiene por que saber a cuanto vendo; gana el otro, que es que el cliente abre su enlace para comprobar QUE le fiaron y una ficha que dice Fiado 44,36 sin decir de que no se comprueba contra nada. EL FILTRO POR MONEDA NO ES UNA PRECAUCION: es el arreglo de la venta mixta del 2026-10-20, donde unos productos en dolares y otros en euros salian como si fueran de una sola. BORDES: un movimiento sin venta detras -lo anterior al 2026-10-17 y lo que entra por la libreta- viaja con la lista vacia y la pantalla no dibuja tabla; un abono tiene sale_id nulo y tampoco; y las lineas se resuelven dentro del subselect de los 50 movimientos, asi que no se calculan para los que no viajan. NINGUN CLIENTE PUEDE VER LOS PRODUCTOS DE OTRO: el subselect cuelga de m.sale_id y m ya viene filtrado por el client_id que sale del token, sin ningun parametro del visitante por medio. Corre despues de la 133 y la firma no cambia, asi que volver a correrla no hace nada.'
)
on conflict (key) do nothing;

commit;
