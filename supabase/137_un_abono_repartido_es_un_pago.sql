-- 137. A PAYMENT SPLIT ACROSS SEVERAL FIADOS IS ONE PAYMENT.
--
-- `registrarAbonoDirigido` takes ONE `fiadoId`. A shopkeeper whose client
-- hands over one note that covers three fiados has to register three payments,
-- one at a time, choosing a fiado each time. That is the request behind the
-- new flow (frames `1526:11182` and the four sheets of «Abono V3»).
--
-- ===========================================================================
-- THE MODEL ALREADY FORCES SEVERAL ROWS, AND THAT IS THE STARTING POINT
--
-- `applies_to_movement_id` holds ONE destination per payment, so a note split
-- across three fiados is three rows today and stays three rows. What is
-- missing is not the model: it is a way to say that those three rows are one
-- thing that happened.
--
-- `payment_group_id` is that. Same value on every row of one split, null on
-- every payment made the old way -- which is every payment in production
-- today, and they stay valid and untouched.
--
-- ===========================================================================
-- WHAT THE GROUP IS ACTUALLY FOR, AND IT IS NOT BOOKKEEPING
--
-- It is the client's WhatsApp receipt. `abono_confirmation_v3` fires once per
-- payment row (see `app/(app)/abonos/actions.ts`), so without a group a note
-- split across three fiados sends the client THREE messages for one note, and
-- shows him three payments in his history where he made one.
--
-- That is not a cosmetic problem. `MS-39` is the entry in this project's
-- history where 12 of 12 receipts were rejected and nobody noticed for days,
-- because the shopkeeper's screen said everything was fine and the failure
-- lived in a row of `whatsapp_sends` that nobody read. A client receiving
-- three messages fails the other way -- loudly, to the person Sevenz is trying
-- not to look like a scammer to.
--
-- So the column exists before the screens do, and the receipt starts reading
-- it in the same release.
--
-- ===========================================================================
-- ALL THE LINES OR NONE, AND WHY THAT IS NOT OPTIONAL
--
-- The worked precedent is `import_libreta` (migration 073). Before it,
-- `confirmImport` walked the rows one by one and returned on the first error
-- with the earlier ones already written: row 27 of 30 left 26 in the database,
-- the shopkeeper read «no se importó», tried again, and 26 clients ended up
-- with duplicated fiados.
--
-- A split payment fails the same way and costs more, because it is money the
-- client already handed over: two of three lines written, the screen says it
-- failed, he registers it again, and now the client has paid five times for
-- one note. One function, one transaction, and the caller gets ids or an
-- error -- never half.
--
-- ===========================================================================
-- ONE CURRENCY PER SPLIT. OWNER'S DECISION, 2026-10-22
--
-- Asked straight -- *«¿Un reparto puede mezclar monedas?»* -- and answered
-- *«No de momento no mezcla monedas»*. The amount is typed in one currency and
-- every line of the split lives in that same ledger.
--
-- It is enforced HERE and not only on the screen, because the reason is not a
-- layout one: paying a dollar fiado with euros needs a rate nobody agreed on,
-- and a client's balance that silently crossed ledgers is the kind of error
-- that is found months later by someone who remembers what he paid.
--
-- ===========================================================================
-- THE PER-FIADO CAP IS CHECKED AGAIN IN HERE, ON PURPOSE
--
-- `registrarAbonoDirigido` checks it in TypeScript, reading the pending amount
-- and then inserting. Between those two statements nothing holds: two payments
-- registered at the same moment both read the same pending and both pass. It
-- has never been reported, and a split makes it likelier -- several lines, one
-- action, more time between the read and the write.
--
-- Checking it inside the transaction closes it for the new door. The old door
-- keeps its own check; this file does not touch it.
--
-- `get_open_charges_for_client` is CALLED, not copied. It is the single source
-- of what a fiado still owes -- it honours directed payments, which a plain
-- `amount - sum(payments)` does not -- and `CT-124` is the entry about what a
-- second copy of that sum cost. It runs as the caller, with no
-- `security definer` of its own, so calling it from in here runs it with this
-- function's rights: which is why the ownership check below is explicit and
-- comes first.

begin;

-- ---------------------------------------------------------------------------
-- 1. The column
-- ---------------------------------------------------------------------------
alter table public.movements
  add column if not exists payment_group_id uuid;

comment on column public.movements.payment_group_id is
  'Agrupa los abonos de UN pago repartido entre varios fiados: el mismo valor en cada fila del reparto, null en todo abono registrado de uno en uno --que son todos los de produccion hasta la 137--. Existe sobre todo para el recibo del cliente: abono_confirmation_v3 sale por fila, asi que sin grupo un billete repartido en tres le manda TRES WhatsApp y le ensena tres abonos donde hizo uno.';

-- Partial: only the split payments are in it, which today is none of the
-- millions of rows that carry null.
create index if not exists movements_payment_group_idx
  on public.movements (payment_group_id)
  where payment_group_id is not null;

-- ---------------------------------------------------------------------------
-- 2. The atomic writer
-- ---------------------------------------------------------------------------
--
-- `drop` + `create` and not `create or replace`: the day this signature
-- changes, `create or replace` would quietly add a SECOND overload and
-- PostgREST would resolve calls to whichever it liked. The drop names the
-- exact argument list, so the file re-runs cleanly from here.
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
  v_currency text;
  -- A SEPARATE FLAG, BECAUSE `null` IS A REAL CURRENCY HERE. A Colombian
  -- owner's movements carry `currency = null` -- that is the rule the whole
  -- `qa:currency` suite exists to protect -- so using "v_currency is null" as
  -- "I have not read it yet" would make the mixing check below never engage
  -- for a CO owner, and never fire in the one place it is most invisible.
  v_moneda_leida boolean := false;
  v_grupo uuid := gen_random_uuid();
  v_n int;
  v_linea jsonb;
  v_fiado uuid;
  v_monto numeric;
  v_pendiente numeric;
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

    -- Same client, live charge. A line pointing at another client's fiado
    -- would otherwise ride in on the first line's ownership check.
    if not exists (
      select 1 from public.movements m
      where m.id = v_fiado
        and m.client_id = v_client
        and m.type = 'charge'
        and m.deleted_at is null
    ) then
      return json_build_object('ok', false, 'code', 'fiado_ajeno', 'fiado_id', v_fiado);
    end if;

    -- ONE CURRENCY FOR THE WHOLE SPLIT. See the header: owner's decision of
    -- 2026-10-22, enforced here because the cost of breaking it is a balance
    -- that crossed ledgers without anyone deciding it.
    if not v_moneda_leida then
      select m.currency into v_currency from public.movements m where m.id = v_fiado;
      v_moneda_leida := true;
    elsif v_currency is distinct from (select m.currency from public.movements m where m.id = v_fiado) then
      -- `is distinct from` and not `<>`: with `<>` a null on either side makes
      -- the whole comparison null, the branch never runs, and a Colombian
      -- fiado would slip into a dollar split without a word.
      return json_build_object('ok', false, 'code', 'monedas_mezcladas');
    end if;

    -- The same fiado twice in one split would pass each line's cap on its own
    -- and break it together.
    if (select count(*) from jsonb_array_elements(p_lineas) l
        where (l ->> 'fiado_id')::uuid = v_fiado) > 1 then
      return json_build_object('ok', false, 'code', 'fiado_repetido', 'fiado_id', v_fiado);
    end if;

    -- THE CAP, read from the one function that knows it. See the header.
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
  end loop;

  -- ── AND ONLY NOW SE ESCRIBE ─────────────────────────────────────────
  for v_linea in select * from jsonb_array_elements(p_lineas)
  loop
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
      v_currency,
      nullif(btrim(coalesce(v_linea ->> 'description', '')), ''),
      'manual',
      nullif(btrim(coalesce(v_linea ->> 'photo_path', '')), ''),
      (v_linea ->> 'fiado_id')::uuid,
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
    'currency', v_currency,
    'movement_ids', to_jsonb(v_ids)
  );
end;
$fn$;

-- `authenticated` ONLY. Postgres grants EXECUTE to PUBLIC by default, so the
-- revoke is not decoration -- it is the same thing `126` had to fix after
-- `qa:abono-dirigido` caught it on its first run.
revoke execute on function public.registrar_abono_repartido(jsonb) from public, anon;
grant execute on function public.registrar_abono_repartido(jsonb) to authenticated;

comment on function public.registrar_abono_repartido(jsonb) is
  'Registra UN pago repartido entre varios fiados: N abonos dirigidos con el mismo payment_group_id, o ninguno. Mismo patron que import_libreta (073) y por la misma razon --media operacion escrita es peor que ninguna, y aqui es dinero que el cliente ya entrego--. Comprueba la propiedad en codigo antes de leer nada, porque es security definer; exige una sola moneda para todo el reparto (decision del dueno del 2026-10-22); y vuelve a comprobar el tope de cada fiado DENTRO de la transaccion, llamando a get_open_charges_for_client en vez de recalcular el pendiente, que es la copia que costo CT-124.';

insert into public.schema_migrations (key, description)
values (
  '137_un_abono_repartido_es_un_pago',
  'movements.payment_group_id y registrar_abono_repartido(jsonb): un billete que cubre varios fiados deja de ser varias transacciones. Hoy registrarAbonoDirigido recibe UN fiadoId, asi que el tendero cuyo cliente le paga una cantidad que cubre tres fiados tiene que registrar tres abonos eligiendo un fiado cada vez. EL MODELO YA OBLIGA A VARIAS FILAS y eso no cambia --applies_to_movement_id admite un destino por abono-- lo que faltaba era decir que esas filas son UNA cosa que paso. PARA LO QUE DE VERDAD SIRVE EL GRUPO ES PARA EL RECIBO DEL CLIENTE: abono_confirmation_v3 sale por fila, asi que sin grupo un billete repartido en tres le manda TRES WhatsApp y le ensena tres abonos donde hizo uno; a un cliente que ya recibe mensajes de un numero de EE.UU. sobre su deuda, eso lo acerca justo a lo que Sevenz intenta no parecer. TODAS LAS LINEAS O NINGUNA, con el patron de import_libreta (073): antes de aquella, confirmImport escribia fila a fila y volvia al primer error con las anteriores ya dentro --la 27 de 30 dejaba 26 escritas, el tendero leia que no se importo, lo reintentaba, y 26 clientes acababan con sus fiados duplicados--. Un reparto falla igual y cuesta mas, porque es dinero que el cliente ya entrego. UNA SOLA MONEDA POR REPARTO, decision del dueno del 2026-10-22 preguntada en claro: pagar un fiado en dolares con euros exige una tasa que nadie acordo. Y EL TOPE DE CADA FIADO SE VUELVE A COMPROBAR DENTRO de la transaccion: hoy se valida solo en TypeScript, entre la lectura del pendiente y el insert no sujeta nada, y dos pagos a la vez pasan los dos. Llama a get_open_charges_for_client en vez de recalcular el pendiente --esa suma honra los abonos dirigidos y una segunda copia suya es lo que costo CT-124--. Los abonos de uno en uno siguen igual y con payment_group_id null, que son todos los de produccion hasta hoy.'
)
on conflict (key) do nothing;

commit;
