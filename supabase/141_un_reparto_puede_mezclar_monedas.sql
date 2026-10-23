-- 141 -- UN REPARTO PUEDE MEZCLAR MONEDAS
--
-- Reverses the owner's decision of 2026-10-22, and the old one is written down
-- here because that is the rule: when a decision displaces another, both are
-- recorded, so that reverting this one does not need archaeology.
--
-- WHAT WAS DECIDED THEN. Asked straight -- «¿Un reparto puede mezclar
-- monedas?» -- and answered «No de momento no mezcla monedas». Migration 137
-- enforced it in SQL, not only on the screen, with this reasoning: paying a
-- dollar fiado with euros needs a rate nobody agreed on.
--
-- WHAT IS DECIDED NOW, 2026-10-23, asked just as straight -- what happens when
-- a single «Bolívares» option meets a client who owes in euros AND in dollars:
-- «A los fiados más críticos sin importar moneda, es decir, en algunos casos
-- los fiados más críticos pueden ser en dólares, en otros casos en euros y en
-- otros casos mixtos».
--
-- AND THE OLD REASONING DOES NOT APPLY TO THIS CASE, which is why the reversal
-- is narrow rather than a change of mind. The 2026-10-22 answer was about
-- paying a dollar fiado WITH euros: two ledgers, one rate between them that
-- nobody set. What the screen does now is different -- the shopkeeper is handed
-- BOLIVARES, and bolivares convert to each ledger by the rate of the day that
-- this product already seals on every movement. There is no euro/dollar rate
-- anywhere in it: there are two independent conversions from the same note.
--
-- ===========================================================================
-- WHAT THIS FILE CHANGES, AND WHAT IT DELIBERATELY DOES NOT
--
--   * `registrar_abono_repartido` stops demanding one currency for the whole
--     split. Each line is written in the currency of ITS OWN fiado, read from
--     the fiado, never from the payload.
--   * `payment_group_summary` learns to describe a mixed group -- and still
--     refuses to hand out a single total for one. See the long note on it.
--
-- WHAT IT DOES NOT CHANGE: the per-fiado cap, the ownership check, the
-- all-or-nothing transaction, the repeated-fiado check. Those had nothing to
-- do with the currency rule and every one of them is load-bearing.
--
-- ===========================================================================
-- THE CURRENCY IS READ FROM THE FIADO, NEVER FROM THE PAYLOAD
--
-- It would have been one line shorter to take a `currency` per line from the
-- JSON. It must not be: the payload comes from the browser, and a line that
-- named a currency different from its fiado's would file a dollar payment in
-- the euro ledger of the same client. The old code was safe from this by
-- accident -- one currency, read from the first fiado -- and the safety has to
-- survive the rule it was attached to.
--
-- ===========================================================================
-- THE EDGES, ENUMERATED BEFORE WRITING IT
--
--   * COLOMBIAN BUSINESS: every fiado carries `currency = null`. A split of
--     his is «mixed» only in the sense that null = null, so nothing changes
--     for him, and `payment_group_summary` keeps using `coalesce(…, '~COP~')`
--     so that his group reads as single-currency, which it is.
--   * A SPLIT THAT ENDS UP IN ONE CURRENCY ANYWAY -- the common case, and
--     every split written before today. It behaves exactly as before,
--     including what the receipt sender receives. Checked by `qa:reparto`.
--   * A FIADO WITH NO RATE: nothing here converts anything. Each line arrives
--     already in its own ledger, with its own sealed rate in the payload. A
--     line whose conversion could not be made is a line the screen does not
--     send.
--   * THE RECEIPT, which is the one that costs something. See below.
--
-- WORST CASE, SAID OUT LOUD: a client is told he paid a total that added up
-- two ledgers -- «abonaste 150» when he handed over bolivares that became 100
-- euros and 50 dollars. That number is false in both currencies and it reaches
-- the person who is least able to check it. That is what the refusal in
-- `payment_group_summary` exists to prevent, and why this file does not simply
-- sum `amount`.
--
-- RE-RUNNABLE: both functions are dropped by their exact argument list and
-- recreated. The signatures do not change, so the drops match on every run.

begin;

-- ---------------------------------------------------------------------------
-- 1. The writer: one currency per LINE, taken from its own fiado
-- ---------------------------------------------------------------------------
drop function if exists public.registrar_abono_repartido(jsonb);

create function public.registrar_abono_repartido(p_lineas jsonb)
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
      entry_currency, entry_amount, rate_usd_at_time, rate_eur_at_time
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
      (v_linea ->> 'rate_eur_at_time')::numeric
    )
    returning id into v_nuevo;

    v_ids := array_append(v_ids, v_nuevo);
  end loop;

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

-- `authenticated` ONLY. Postgres grants EXECUTE to PUBLIC by default, so the
-- revoke is not decoration -- it is the same thing `126` had to fix after
-- `qa:abono-dirigido` caught it on its first run.
revoke execute on function public.registrar_abono_repartido(jsonb) from public, anon;
grant execute on function public.registrar_abono_repartido(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The receipt's summary, now that a group may hold two ledgers
-- ---------------------------------------------------------------------------
--
-- THIS STILL REFUSES TO HAND OUT A SINGLE TOTAL FOR A MIXED GROUP, and that
-- refusal is the point of this half of the file rather than an omission.
--
-- `abono_confirmation_v3` carries ONE amount. Summing a mixed group would put
-- a number in it that is false in both currencies -- «abonaste 150» for
-- bolivares that became 100 euros and 50 dollars -- and it would reach the
-- person least able to check it. `lib/whatsapp/recibo-cliente.ts` already
-- treats `ok: false` as «omitido» with its reason, counted and not an error,
-- so a mixed split sends no receipt instead of a wrong one.
--
-- NO RECEIPT IS NOT A GOOD ANSWER EITHER, and this file does not pretend it
-- is. It is the safe one until the owner decides between the two real options,
-- which is why `por_moneda` is returned even when `ok` is false: the decision
-- can be built on top without another migration.
--
--   * ONE MESSAGE PER CURRENCY -- at most two, since there are two ledgers.
--     Truthful, and the client gets a receipt for everything he paid. Costs
--     two template sends for one payment.
--   * ONE MESSAGE FOR THE BIGGER HALF, mentioning the rest. Needs a template
--     that does not exist, so it needs Meta's approval and its waiting time.
--
-- `por_moneda` carries each ledger's own total AND its own last line, because
-- `new_balance` in the template is that movement's `running_balance` -- the
-- balance after it. The last line of the whole group is in the wrong ledger
-- half the time.
drop function if exists public.payment_group_summary(uuid);

create function public.payment_group_summary(p_group_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  select case
    when x.libros = 0 then null
    else jsonb_build_object(
      -- UN SOLO LIBRO = LA FORMA QUE ESTO SIEMPRE TUVO, intacta, para que el
      -- emisor siga funcionando sin tocarlo: en todos los repartos escritos
      -- antes de hoy y en todos los de una sola moneda escritos despues.
      'ok', x.libros = 1,
      'reason', case when x.libros > 1 then 'monedas_mezcladas'::text end,
      'group_id', p_group_id,
      'lines', x.lineas,
      -- NULL CUANDO HAY DOS LIBROS, y nunca una suma: ver la nota de arriba.
      'total', x.total_unico,
      'last_movement_id', x.ultimo_unico,
      'por_moneda', x.por_moneda
    )
  end
  from (
    select
      count(*)::int as libros,
      coalesce(sum(p.lineas), 0)::int as lineas,
      case when count(*) = 1 then min(p.total) end as total_unico,
      case when count(*) = 1 then min(p.ultimo) end as ultimo_unico,
      jsonb_agg(
        jsonb_build_object(
          'currency', p.moneda,
          'lines', p.lineas,
          'total', p.total,
          'last_movement_id', p.ultimo
        )
        order by p.libro
      ) as por_moneda
    from (
      select
        coalesce(m.currency, '~COP~') as libro,
        m.currency as moneda,
        count(*)::int as lineas,
        sum(m.amount) as total,
        -- LA ULTIMA DE SU LIBRO. `array_agg` ordenado y su primer elemento, en
        -- vez de un subselect correlacionado: dice lo mismo y se lee de una
        -- pasada.
        (array_agg(m.id order by m.created_at desc, m.id desc))[1] as ultimo
      from public.movements m
      where m.payment_group_id = p_group_id
        and m.deleted_at is null
      group by coalesce(m.currency, '~COP~'), m.currency
    ) p
  ) x;
$fn$;


-- `service_role` ONLY, like `movement_notice_target`: this is read by the
-- sender, never by a browser.
revoke execute on function public.payment_group_summary(uuid) from public, anon, authenticated;
grant execute on function public.payment_group_summary(uuid) to service_role;

comment on function public.registrar_abono_repartido(jsonb) is
  'Registra UN pago repartido entre varios fiados: N abonos dirigidos con el mismo payment_group_id, o ninguno. DESDE LA 141 PUEDE MEZCLAR MONEDAS --decision del dueno del 2026-10-23, que desplaza la del 2026-10-22-- porque lo que el tendero recibe son BOLIVARES y los bolivares se convierten a cada libro por la tasa del dia que este producto ya sella: no hay ninguna tasa euro/dolar de por medio, hay dos conversiones independientes del mismo billete. La moneda de cada linea se LEE DE SU FIADO y nunca del payload, porque el payload viene del navegador y una linea que nombrara otra moneda archivaria un pago en el libro equivocado del mismo cliente. Lo demas no cambia: propiedad comprobada en codigo antes de leer nada, tope de cada fiado dentro de la transaccion llamando a get_open_charges_for_client, fiado repetido rechazado, y todas las lineas o ninguna.';

comment on function public.payment_group_summary(uuid) is
  'Las dos cosas que el recibo no puede saber de un reparto: cuanto suma y cual es su ULTIMA linea. DESDE LA 141 un grupo puede tener dos libros, y entonces esto devuelve ok=false con reason=monedas_mezcladas: abono_confirmation_v3 lleva UN importe, y sumar dos libros pondria ahi un numero que es falso en las dos monedas. El emisor ya trata ok=false como omitido, asi que un reparto mixto no manda recibo en vez de mandar uno equivocado. Eso NO es una buena respuesta, es la segura: por_moneda viaja en los dos casos --con el total y la ultima linea DE CADA LIBRO-- para que la decision del dueno entre mandar un mensaje por moneda o uno solo se pueda construir encima sin otra migracion. La ultima linea de cada libro y no la del grupo porque new_balance es el running_balance de esa fila, y la ultima del grupo esta en el libro equivocado la mitad de las veces.';

insert into public.schema_migrations (key, description)
values (
  '141_un_reparto_puede_mezclar_monedas',
  'registrar_abono_repartido deja de exigir una sola moneda por reparto: cada linea se escribe en la moneda de SU fiado. Decision del dueno del 2026-10-23, preguntada en claro al disenar la opcion unica de Bolivares: a los fiados mas criticos sin importar moneda, que en algunos casos seran en dolares, en otros en euros y en otros mixtos. DESPLAZA la decision del 2026-10-22 --no mezclar-- y la razon de aquella no cubre este caso: aquella era sobre pagar un fiado en dolares CON euros, que exige una tasa euro/dolar que nadie acordo; aqui lo que el cliente entrega son BOLIVARES, y los bolivares se convierten a cada libro por la tasa del dia que el producto ya sella en cada movimiento. Son dos conversiones independientes del mismo billete, no una entre libros. LA MONEDA SE LEE DEL FIADO Y NUNCA DEL PAYLOAD: el payload viene del navegador, y una linea que nombrara una moneda distinta de la de su fiado archivaria un pago en el libro equivocado del mismo cliente sin que nada lo cuestionara. EL RECIBO DEL CLIENTE sigue sin mandarse para un reparto mixto, a proposito: abono_confirmation_v3 lleva UN importe y sumar dos libros pondria ahi un numero falso en las dos monedas. payment_group_summary devuelve ok=false con monedas_mezcladas, que el emisor ya trata como omitido, y ademas devuelve por_moneda con el total y la ultima linea de cada libro para que la decision de mandar un mensaje por moneda se pueda construir encima sin otra migracion. No cambia nada mas: ni el tope por fiado, ni la comprobacion de propiedad, ni el todo-o-nada, ni el rechazo del fiado repetido.'
)
on conflict (key) do nothing;

commit;
