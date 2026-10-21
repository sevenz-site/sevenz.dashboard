-- 127 — THE CLIENT'S TRANSACTION DETAIL NEEDS TWO MORE FIELDS
--
-- NO TICKET: this came straight from the owner on 2026-10-19, not from
-- `PENDIENTES.md`. An earlier draft of this header cited CT-104; that is a
-- DIFFERENT pendiente -- «la pantalla del CLIENTE no enseña las ventas de
-- contado», which needs its own migration and is still open.
--
-- =============================================================================
-- WHY A MIGRATION AND NOT JUST CODE
--
-- `/s/[token]` does not read `movements`. It reads this function, which is
-- SECURITY DEFINER and builds each movement's JSON field by field, so a column
-- that is not named here does not exist for that page. Same reason migration
-- 121 had to exist for `cuotas`.
--
-- =============================================================================
-- WHAT THE TWO FIELDS ARE FOR
--
-- `applies_to_movement_id` — which fiado an abono paid. The owner's screen has
-- shown this since 2026-10-19 (the «Abonó a» card, frame `1465:18349`), and
-- the owner asked for the same on the client's side the same day, in these
-- words: *«para que cliente puede ver la info rápido sin abrir el fiado al que
-- abonó»*. It is also what lets the client's detail inherit the fiado's plazo,
-- cuotas and próximas cuotas.
--
-- `photo_path` — the attachment. THIS IS A DELIBERATE WIDENING AND IT WAS
-- ASKED FOR. Until today the client saw no photo at all, on purpose: the
-- attachment can be a receipt, an invoice or an ID card. Put to the owner on
-- 2026-10-19 with that risk stated, he chose that the client does see it.
--
-- The path alone is not the photo. `attachments` is a PRIVATE bucket, so the
-- page still has to sign a URL for it; what this function hands over is which
-- object to sign, having already proved the visitor holds a valid token.
--
-- =============================================================================
-- SAFE TO RE-RUN, AND SAFE FOR WHAT IS ALREADY STORED
--
-- The signature does not change, so `create or replace` replaces rather than
-- overloading — no drop needed, and running it twice is a no-op. And the two
-- fields are additive: every page that reads this JSON ignores keys it does
-- not know, so nothing that works today stops working.

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
  v_movement_total int;
  v_balance numeric(14, 4);
  v_balance_usd numeric(14, 4);
  v_balance_eur numeric(14, 4);
  v_owner_country text;
  v_settings public.owner_exchange_settings%rowtype;
  v_bcv_usd numeric;
  v_bcv_eur numeric;
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
      -- THE TWO NEW FIELDS. Everything else is byte-for-byte migration 121.
      'applies_to_movement_id', m.applies_to_movement_id,
      'photo_path', m.photo_path,
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

  -- The one changed line. client_summary now excludes hidden clients; this
  -- function is the one reader that must still see them.
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

insert into public.schema_migrations (key, description)
values (
  '127_detalle_de_transaccion_del_cliente',
  'get_shared_balance() devuelve tambien applies_to_movement_id y photo_path en el JSON de cada movimiento, para el detalle de transaccion del CLIENTE en /s/[token], que el 2026-10-19 dejo de ser un dialogo y paso a ser una pantalla. El primero dice a que fiado fue un abono: con el, la pantalla del cliente puede ensenar la tarjeta de ese fiado y heredar su plazo, sus cuotas y sus proximas cuotas sin tener que abrirlo. El segundo es la foto adjunta, que hasta hoy el cliente NO veia a proposito porque un adjunto puede ser un recibo, una factura o una cedula; se le planteo asi al dueno el 2026-10-19 y eligio que si la vea. La ruta no basta para ver la foto: el bucket attachments es privado y la pagina tiene que firmar la URL, asi que lo que esta funcion entrega es QUE objeto firmar, habiendo comprobado ya que quien mira trae un token valido. Hace falta migracion y no solo codigo porque esa pantalla no lee movements: lee esta funcion, que arma el JSON campo a campo. El cuerpo va copiado verbatim de la 121 salvo esas dos lineas, la firma no cambia y los campos son aditivos, asi que no rompe nada de lo que ya funciona.'
)
on conflict (key) do nothing;

commit;
