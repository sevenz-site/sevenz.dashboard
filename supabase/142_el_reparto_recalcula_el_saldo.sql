-- 142 -- UN REPARTO DEJABA EL SALDO DEL CLIENTE MAL
--
-- Found in dev on 2026-10-23, while diagnosing whether changing the SIGN a
-- fiado is drawn with could have altered anyone's accounts. It could not --
-- that change is two literal characters in JSX -- but the check that proved
-- it found this, which is worse and entirely real.
--
-- WHAT WAS WRONG. A client with four split payments had a true USD sum of
-- 0,00 and the app was showing him 1,14. Not a rounding drift: a broken
-- chain.
--
-- ===========================================================================
-- WHY, AND WHY IT ONLY BITES A SPLIT
--
-- `running_balance` is written by a BEFORE INSERT trigger that reads the
-- previous row with `order by created_at desc, id desc`. Inside a
-- transaction, `now()` is the TRANSACTION's timestamp -- so the N lines of
-- one split are all stored with the SAME `created_at`, and the tiebreak falls
-- to `id`, which is a random uuid.
--
-- With one line there is no tie. With two, the second can only chain from the
-- first. FROM THE THIRD ON, each line chains from an arbitrary sibling
-- instead of from the one before it, and the chain stops adding up.
--
-- AND IT IS NOT A STRANGE-LOOKING ROW: `client_summary` is a view that reads
-- the `running_balance` of the LAST live movement of each currency. A broken
-- chain is a wrong BALANCE -- in the client's card, in Cartera, and in the
-- shared link the client opens.
--
-- ===========================================================================
-- NEVER REACHED PRODUCTION, and that is the only good news here
--
-- `registrar_abono_repartido` and the whole split flow live on `dev` and have
-- never been merged to `main` -- checked with `git log origin/main` over
-- migration 137 and the screen. So this fixes a defect before anyone's real
-- balance ever saw it.
--
-- ===========================================================================
-- TWO THINGS: THE FIX AND THE REPAIR
--
--   1. The writer now calls `recalc_client_running_balance` after inserting
--      its lines. One `perform`; that is the whole fix.
--   2. Every client that already has a split gets recalculated, because the
--      bug has already written wrong chains in dev. Same shape as migrations
--      024 and 025, which repaired their own ledgers this way.
--
-- WHY NOT FIX THE TRIGGER INSTEAD, which is the other obvious answer: that
-- trigger is on the hot path of EVERY movement this product writes, including
-- every one already in production. Changing how it picks the previous row, to
-- serve a case that does not exist in production yet, would put the whole
-- ledger at risk to fix one caller. The caller calls the repair function that
-- already exists for exactly this.
--
-- RE-RUNNABLE: `create or replace` on an unchanged signature, and the repair
-- is idempotent -- recalculating a correct chain rewrites it to itself.

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
      -- `min()` SOBRE EL TOTAL Y `array_agg` SOBRE EL ID, y la diferencia no
      -- es estilo: Postgres no tiene `min(uuid)`. Con `min(p.ultimo)` el
      -- archivo entero fallaba al crearse —42883, medido en dev el
      -- 2026-10-23— y como todo va en una transacción, se deshacía sin dejar
      -- rastro.
      --
      -- Las dos ramas solo se evalúan cuando hay UNA fila, así que cualquier
      -- agregado que devuelva ese único valor sirve; `(array_agg(…))[1]`
      -- funciona para cualquier tipo y por eso es el que va en el uuid.
      case when count(*) = 1 then min(p.total) end as total_unico,
      case when count(*) = 1 then (array_agg(p.ultimo))[1] end as ultimo_unico,
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


-- ---------------------------------------------------------------------------
-- 2. La reparacion de lo que el fallo ya escribio
-- ---------------------------------------------------------------------------
--
-- Cada cliente que tenga al menos un reparto. Recalcular una cadena que ya
-- estaba bien la reescribe igual, asi que esto es seguro de repetir.
do $rep$
declare
  r record;
begin
  for r in
    select distinct m.client_id
    from public.movements m
    where m.payment_group_id is not null
  loop
    perform public.recalc_client_running_balance(r.client_id);
  end loop;
end;
$rep$;

insert into public.schema_migrations (key, description)
values (
  '142_el_reparto_recalcula_el_saldo',
  'registrar_abono_repartido recalcula la cadena del cliente despues de escribir sus lineas. SIN ESTO EL SALDO QUEDABA MAL tras cada reparto: running_balance lo pone un disparador BEFORE INSERT que busca la fila anterior ordenando por created_at y, como desempate, por id; dentro de una transaccion now() es el instante de la TRANSACCION, asi que todas las lineas de un reparto comparten created_at y el desempate cae en un uuid aleatorio. De la tercera linea en adelante cada una encadena desde una hermana cualquiera en vez de desde la anterior. Y no se queda en una fila rara: client_summary es una vista que lee el running_balance de la ULTIMA fila viva de cada moneda, asi que una cadena descuadrada es un SALDO descuadrado en la ficha del cliente, en Cartera y en el enlace que abre el cliente. Medido en dev el 2026-10-23: un cliente con cuatro repartos sumaba 0,00 en dolares y la app ensenaba 1,14. NUNCA LLEGO A PRODUCCION, comprobado con git log sobre origin/main: el reparto entero vive solo en dev. Se repara ademas cada cliente que ya tiene algun reparto, igual que hicieron las migraciones 024 y 025 con sus propios libros. NO se toca el disparador, que es el camino caliente de TODOS los movimientos del producto incluidos los de produccion: cambiarlo para servir a un caso que en produccion todavia no existe pondria en riesgo el libro entero por un solo llamante.'
)
on conflict (key) do nothing;

commit;
