-- 121: THE CLIENT SEES THE CUOTAS TOO
--
-- Owner's decision, 2026-10-16: *«en el detalle del movimiento en la vista del
-- link que se le comparte al cliente no se están viendo las cuotas, deben
-- verse al igual que en la vista del dueño, mismo componente»*.
--
-- ===========================================================================
-- AND IT REPLACES A DECISION WRITTEN EARLIER THE SAME DAY, so both are on the
-- record. `MovementDetailPopover` carried a comment saying the client's page
-- deliberately does not pass `cuotas`, reasoning that `CT-86` -- "the client's
-- screen does not say when the next cuota falls due" -- asked for something
-- else: the NEXT deadline on the balance card, not the whole agreement on each
-- movement's card. That reasoning was mine, not the owner's, and he wants
-- both. `CT-86` stays open and unchanged; this is a different surface.
--
-- WHY IT TAKES A MIGRATION AT ALL, which is the non-obvious part: the client's
-- page does not read `movements`. It reads `get_shared_balance()`, which is
-- SECURITY DEFINER and builds each movement's JSON FIELD BY FIELD -- so a
-- column the function does not name simply does not exist for that page. No
-- amount of React gets `cuotas` there. That hand-built list is also why this
-- is safe: nothing else leaks with it.
--
-- ONE LINE CHANGES. The body is copied verbatim from `044`, which holds the
-- latest definition of the six this function has had, and the only difference
-- is `'cuotas', m.cuotas` next to `'plazo_dias'`. Written from memory the
-- first time, migration `119` came out with six silent differences; it is not
-- a mistake worth making twice.
--
-- NOTHING THE CLIENT SEES CHANGES FOR ANYTHING STORED TODAY: `cuotas` is null
-- for every row saved before 2026-10-16, and the card draws the table only
-- when it is not null.

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

-- El drop no se usa aqui --la firma no cambia-- pero `create or replace` si
-- vuelve a conceder EXECUTE, y esta funcion la llama `anon`: es la que sirve
-- la pagina publica del cliente. Se repite tal cual la dejo la `044`.
grant execute on function public.get_shared_balance(text, int) to anon, authenticated;

insert into public.schema_migrations (key, description)
values (
  '121_saldo_compartido_con_cuotas',
  'get_shared_balance() devuelve tambien cuotas en el JSON de cada movimiento, para que la ficha del movimiento en la pantalla del cliente (/s/[token]) ensene la misma tabla de cuotas que la del dueno. Decision del dueno el 2026-10-16: «deben verse al igual que en la vista del dueno, mismo componente». REEMPLAZA una decision escrita esa misma manana en MovementDetailPopover, que decia que la pantalla del cliente deliberadamente NO las pasaba porque CT-86 pedia otra cosa; CT-86 sigue abierta y es otra superficie. Hace falta migracion y no solo codigo porque esa pantalla no lee movements: lee esta funcion, que es security definer y arma el JSON campo a campo, asi que una columna que no se nombre aqui no existe para esa pagina. Cambia UNA linea; el resto del cuerpo va copiado verbatim de la 044. No cambia nada de lo guardado hasta hoy: cuotas es null en todas las filas anteriores y la tabla solo se dibuja cuando no lo es.'
)
on conflict (key) do nothing;

commit;
