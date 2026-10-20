-- 128 — THE FIADO SHOWS ITS PAYMENTS, AND THE CARD SHOWS WHAT IT STILL OWES
--
-- Two things the owner asked for on 2026-10-20, looking at the screen:
--
--   1. *«Detalle de los fiados también deben mostrar la lista de lo que se ha
--      abonado (mismo patrón como abono muestra los fiados)»*. The abono's
--      detail has shown its fiado since 2026-10-19; this is the mirror.
--   2. *«avanza con CT-109»* — the fiado card on the CLIENT's screen hides
--      «Debe $X», where the owner's shows it.
--
-- =============================================================================
-- WHY BOTH LAND IN THE SAME MIGRATION, AND IN SQL AT ALL
--
-- Same reason as `121` and `127`: `/s/[token]` does not read `movements`, it
-- reads this function, which builds each movement's JSON field by field. But
-- there is a second reason here, and it is the one that decided the shape.
--
-- THE CLIENT'S PAGE ONLY RECEIVES 50 MOVEMENTS (`DEFAULT_MOVEMENT_LIMIT`); the
-- owner's screen loads all of them. So anything resolved by searching the list
-- that travelled is wrong for a client with history:
--
--   · a payment whose fiado fell off the page reads as "not directed" and the
--     detail says *«Repartidos al saldo total»* — FALSE for a directed abono.
--     That is `CT-110`, which the owner made a hard gate before releasing.
--   · and now, a fiado whose payments fell off the page would list only SOME
--     of them. That is worse than CT-110 and it is new today: the client opens
--     their fiado, counts two of the three payments they made, and concludes
--     the shop lost their money. An incomplete list of someone's own payments
--     is not a missing detail, it is an accusation.
--
-- So BOTH relationships are resolved HERE, against the whole table, and travel
-- as two maps keyed by the charge's id. The page stops searching and starts
-- looking up. `CT-110` closes as a consequence rather than as a separate job.
--
-- =============================================================================
-- `fiados_abonados` — THE CARD OF THE FIADO A PAYMENT WENT TO
--
-- Everything `TarjetaDeFiado` draws, plus `pending`: what that fiado STILL
-- owes, which is `CT-109`.
--
-- `pending` EXISTS IN EXACTLY ONE PLACE, `get_open_charges_for_client`
-- (migration `126`), and that function is `stable` with no `security definer`:
-- it runs as the caller, and a page with no session cannot call it. The code
-- comment that hid the line said so and concluded the figure was unreachable.
-- That is true of the PAGE and false of THIS FUNCTION: `get_shared_balance` is
-- SECURITY DEFINER and already holds `v_client.id`, and inside its body the
-- current user IS the definer, which owns both functions. So the
-- `revoke … from public` on it is no obstacle and `movements`' RLS does not
-- apply.
--
-- WHAT WAS REJECTED: copying the FIFO loop a third time. It already exists
-- twice on purpose — `get_oldest_unpaid_charge_for_currency` and
-- `get_open_charges_for_client` copy each other so the figure a screen offers
-- cannot disagree with the one that decides a client's status. A third copy is
-- where they start to drift.
--
-- A CHARGE THAT IS FULLY PAID IS NOT "UNKNOWN", IT IS ZERO: it is absent from
-- the open list precisely because nothing is left. `coalesce(pending, 0)` is
-- the truth, not a fallback — the same `?? 0` the owner's screen writes.
--
-- =============================================================================
-- `abonos_por_fiado` — THE PAYMENTS MADE AGAINST A CHARGE
--
-- Keyed by the CHARGE's id, so the fiado's detail looks its own list up.
-- ONLY DIRECTED PAYMENTS APPEAR, and that is not a limitation to fix: a
-- payment from before migration `126` carries no direction because the FIFO
-- queue spread it across the balance, so there is no "this one paid that one"
-- to show. Listing it under some fiado would be inventing a decision the
-- shopkeeper never made. The hundreds of historical payments therefore leave
-- every old fiado's list empty, which is the honest answer.
--
-- NEWEST FIRST, unlike the open-charges queue: here the question is "what has
-- been paid lately", and the last payment is the one being checked.
--
-- =============================================================================
-- OWNERSHIP IS CHECKED IN BOTH DIRECTIONS, AND IT IS NOT DECORATION
--
-- `applies_to_movement_id` is a plain FK to `movements (id)` (migration `124`,
-- `on delete set null`) with NOTHING constraining it to the same client. So a
-- row pointing across clients is possible in the data model, and both queries
-- below filter on `client_id = v_client.id` to make sure neither map can hand
-- one client a figure out of someone else's ledger. It is the SQL twin of the
-- explicit `.eq("owner_id", …)` rule in CLAUDE.md: RLS is the backstop, not
-- the only line of defence.
--
-- A SOFT-DELETED MOVEMENT APPEARS IN NEITHER MAP, which is correct rather than
-- a gap: migration `126` spreads a directed payment whose charge is not in the
-- queue by the old FIFO rule, so for a deleted fiado *«Repartidos al saldo
-- total»* is exactly what happened to the money.
--
-- NO `sale_lines` AND SO NO PRODUCT NAMES, keeping the decision of migration
-- `122`: what a client took home is a conversation between the two of them,
-- but the shop's inventory is not. The cards fall back to the description,
-- which this page already shows on the history row they were opened from.
--
-- =============================================================================
-- RUNS AFTER `126` AND `127`, AND SURVIVES BEING RE-RUN
--
-- It calls `get_open_charges_for_client`, which `126` creates, and it builds on
-- the body `127` left. The signature does not change, so `create or replace`
-- replaces rather than overloading — no drop needed, and running it twice is a
-- no-op. The `grant` is repeated and the ledger insert is
-- `on conflict do nothing`.
--
-- NOTHING STORED TODAY CHANGES: both maps are empty for every client with no
-- directed payment, which is every client until 2026-10-19.

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
  -- The charges that the payments ON THIS PAGE point at, and the charges that
  -- ARE on this page. Two different questions, one pass over the same window.
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
      -- The two the migration 127 added. A directed payment names its fiado,
      -- and a photo travels as a PRIVATE Storage path that the page signs
      -- server-side -- never as a URL.
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

  -- THE SAME WINDOW, ASKED AGAIN, AND IT HAS TO BE IDENTICAL: a different
  -- `limit` here would resolve cards for movements that are not on the page
  -- and miss the ones that are. Repeating the subquery matches how
  -- `v_movement_total` above also re-queries; plpgsql has no cheap way to hold
  -- a row set in a variable.
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

  -- GUARDED, because today this is the rare case: no client has a directed
  -- payment on their page unless the shopkeeper made one since 2026-10-19.
  -- Without the guard every visit by every client would run the whole FIFO
  -- loop to build an empty object.
  if v_fiado_ids is not null and array_length(v_fiado_ids, 1) > 0 then
    select json_object_agg(f.id, json_build_object(
      'movement_id', f.id,
      'sale_id', f.sale_id,
      'fecha', f.created_at,
      'currency', f.currency,
      'amount', f.amount,
      -- CT-109. Absent from the open list means fully paid, which is zero and
      -- not unknown. See the header.
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

  -- THE PAYMENTS MADE AGAINST EACH CHARGE ON THIS PAGE, resolved against the
  -- WHOLE table so a payment older than the window still shows up under its
  -- fiado. See the header: a list of someone's own payments that is missing
  -- one reads as money that went missing.
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
    -- Both keyed by the CHARGE's id, so the page looks a card or a list up by
    -- an id it already has. Empty objects and never null: the page indexes
    -- into them.
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

insert into public.schema_migrations (key, description)
values (
  '128_el_fiado_ensena_sus_abonos',
  'get_shared_balance() devuelve dos mapas mas, los dos indexados por el id del CARGO: fiados_abonados (la tarjeta del fiado al que fue cada abono de la pagina, CON lo que ese fiado todavia debe) y abonos_por_fiado (la lista de abonos dirigidos a cada cargo de la pagina). Dos peticiones del dueno el 2026-10-20: «Detalle de los fiados tambien deben mostrar la lista de lo que se ha abonado (mismo patron como abono muestra los fiados)» y «avanza con CT-109». · CIERRA CT-109: el «Debe $X» de la tarjeta se callaba en la pantalla del cliente porque sale de get_open_charges_for_client, que no es security definer y corre como quien llama. Eso es cierto de la PAGINA y falso de ESTA FUNCION: aqui el usuario actual ES el definer, que es dueno de las dos, asi que el revoke no estorba y la RLS no aplica. · CIERRA TAMBIEN CT-110, que era la parada antes de liberar, y no de rebote sino porque hacia falta: la pagina del cliente solo recibe 50 movimientos y la del dueno los carga todos, asi que todo lo que se resuelva buscando en la lista que viajo esta mal para un cliente con historia. Un abono cuyo fiado se cayo de la pagina decia «Repartidos al saldo total», que es falso; y un fiado cuyos abonos se cayeron habria listado solo algunos, que es peor y es nuevo hoy -- una lista incompleta de los pagos de alguien no es un detalle que falta, es una acusacion. Los dos mapas se resuelven contra la tabla entera. · SOLO SALEN LOS ABONOS DIRIGIDOS, y no es una limitacion por arreglar: un abono anterior a la 126 no lleva direccion porque la cola FIFO lo repartio, asi que no hay ningun «este pago a aquel» que ensenar y colgarlo de un fiado seria inventarse una decision que el tendero no tomo. · La pertenencia se comprueba en los dos sentidos con client_id = v_client.id: applies_to_movement_id es una FK suelta a movements(id) y nada la obliga a ser del mismo cliente. · Sin sale_lines y por tanto sin nombres de producto, que conserva la decision de la 122. · CORRE DESPUES DE LA 126 Y LA 127. Los dos mapas van vacios para todo cliente sin abono dirigido, que son todos hasta el 2026-10-19.'
)
on conflict (key) do nothing;

commit;
