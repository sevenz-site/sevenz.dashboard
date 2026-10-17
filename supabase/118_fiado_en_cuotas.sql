-- 118: A FIADO CAN BE AGREED IN INSTALMENTS, AND THE TERM MOVES WITH THEM
--
-- Owner's decision, 2026-10-17, answering the question CT-77 left open --
-- "how much does a client have to pay for their term to refresh?":
--
--   *«Las cuotas deberían dividirse entre el plazo establecido, por ejemplo,
--   selecciona 3 cuotas en 30 días, entonces sería una cuota cada 10 días»*
--   *«Una cuota pagada a medias no refresca»*
--
-- ===========================================================================
-- WHAT WAS ALREADY TRUE, MEASURED BEFORE WRITING THIS
--
-- The owner first answered that the term should refresh on 100% of the fiado.
-- That is already what the app does, and it was measured against dev rather
-- than read: a client with a 100 USD charge from 60 days ago (term 15) and a 50 USD
-- charge from 2 days ago shows "Plazo vencido"; paying 90 of the 100 leaves
-- them "Plazo vencido" with the 60-day charge still at the head of the queue;
-- paying the last 10 moves the head to the 2-day charge and the label becomes
-- "Dentro del plazo".
--
-- So "100% refreshes, a partial payment does not" is the standing rule, and
-- this migration does not change it. What it adds is a SMALLER UNIT of 100%:
-- a cuota. The rule is identical, applied to a third of the fiado instead of
-- all of it.
-- ===========================================================================
--
-- WHAT THIS DOES NOT CHANGE, said out loud because it would be easy to slip in
-- while the file is open: which charge the status is judged against. That is
-- still the OLDEST UNPAID CHARGE by date, exactly as before. Selecting by
-- earliest due date instead would be a different product decision, it would
-- change the label of clients who have no cuotas at all, and it was not asked
-- for.

begin;

-- ===========================================================================
-- 1. THE COLUMN
-- ===========================================================================

-- NULL MEANS "NO CUOTAS", AND THAT IS THE SAME THING AS ONE CUOTA. It is the
-- design decision that keeps this cheap: today's behaviour becomes the N=1
-- case, every fiado already stored stays correct with no backfill, and the
-- code below has one path instead of two. A fiado of 120 with no cuotas is a
-- fiado of 120 in one instalment, due at the end of its term.
--
-- So the check starts at 2: a form that offers "1 cuota" stores null.
alter table public.movements
  add column if not exists cuotas int;

alter table public.movements
  drop constraint if exists movements_cuotas_check;

alter table public.movements
  add constraint movements_cuotas_check check (
    cuotas is null
    or (
      cuotas between 2 and 36
      -- CUOTAS NEED A TERM TO DIVIDE. The owner's rule is "3 cuotas en 30
      -- días = una cada 10": with no `plazo_dias` there is nothing to divide
      -- by, and a cuota with no date is not a deadline, it is a wish.
      and plazo_dias is not null
      -- Only a charge can be agreed in instalments. A payment IS the
      -- instalment.
      and type = 'charge'
    )
  );

comment on column public.movements.cuotas is
  'En cuantas cuotas se pacto este fiado. NULL = sin cuotas, que es lo mismo que una sola cuota y es el comportamiento de siempre. El vencimiento de la cuota i es created_at + plazo_dias * i / cuotas: 3 cuotas en 30 dias vence a los 10, 20 y 30.';

-- ===========================================================================
-- 2. THE QUEUE LEARNS TO RETURN THE NEXT DEADLINE
-- ===========================================================================
--
-- The two functions change their RETURN COLUMNS, which `create or replace`
-- cannot do -- it refuses any change to the output list. So they are dropped
-- and created.
--
-- ONE `drop` EACH AND NOT TWO, and this is the one place the house rule about
-- dropping both signatures does NOT apply: a function is identified for
-- dropping by its ARGUMENT list, and neither argument list changes here. The
-- rule exists for the case where a parameter is added or retyped, which
-- leaves the old overload alive beside the new one.
--
-- The views go first: both depend on `get_oldest_unpaid_charge` through a
-- lateral join, and Postgres refuses to drop a function something depends on.
drop view if exists public.client_summary;
drop view if exists public.client_summary_all;

drop function if exists public.get_oldest_unpaid_charge(uuid);
drop function if exists public.get_oldest_unpaid_charge_for_currency(uuid, text);

-- ── FIFO, per currency, now also saying WHEN the next instalment is due ──
--
-- The queue itself is unchanged from migration 025, including the detail that
-- matters most: `currency is not distinct from p_currency`, so the NULL of a
-- Colombian business is a ledger of its own and not "no currency".
--
-- What is new is the tail: for the charge that comes out at the head, it works
-- out how many whole cuotas the payments already covered and returns the date
-- of the FIRST ONE THEY DID NOT.
create function public.get_oldest_unpaid_charge_for_currency(
  p_client_id uuid,
  p_currency text
)
returns table (charge_at timestamptz, plazo_dias int, due_at timestamptz)
language plpgsql
stable
as $$
declare
  m record;
  queue_amount numeric[] := '{}';  -- lo que queda por cubrir de cada cargo
  queue_total numeric[] := '{}';   -- su importe original, para contar cuotas
  queue_at timestamptz[] := '{}';
  queue_plazo int[] := '{}';
  queue_cuotas int[] := '{}';
  remaining numeric;
  i int;
  n int;
  cubiertas int;
begin
  for m in
    select mv.type, mv.amount, mv.created_at, mv.plazo_dias, mv.cuotas
    from public.movements mv
    where mv.client_id = p_client_id
      and mv.currency is not distinct from p_currency
      and mv.deleted_at is null
    order by mv.created_at asc, mv.id asc
  loop
    if m.type = 'charge' then
      queue_amount := array_append(queue_amount, m.amount);
      queue_total := array_append(queue_total, m.amount);
      queue_at := array_append(queue_at, m.created_at);
      queue_plazo := array_append(queue_plazo, m.plazo_dias);
      queue_cuotas := array_append(queue_cuotas, m.cuotas);
    else
      remaining := m.amount;
      i := 1;
      while remaining > 0 and i <= coalesce(array_length(queue_amount, 1), 0) loop
        if queue_amount[i] > 0 then
          if queue_amount[i] <= remaining then
            remaining := remaining - queue_amount[i];
            queue_amount[i] := 0;
          else
            queue_amount[i] := queue_amount[i] - remaining;
            remaining := 0;
          end if;
        end if;
        i := i + 1;
      end loop;
    end if;
  end loop;

  for i in 1 .. coalesce(array_length(queue_amount, 1), 0) loop
    if queue_amount[i] > 0 then
      charge_at := queue_at[i];
      plazo_dias := queue_plazo[i];
      due_at := null;

      -- Sin plazo no hay vencimiento que calcular, y el estado del cliente ya
      -- tiene su propia etiqueta para eso ("Sin plazo").
      if queue_plazo[i] is not null then
        n := greatest(coalesce(queue_cuotas[i], 1), 1);

        -- CUÁNTAS CUOTAS ENTERAS TAPÓ LO ABONADO. `floor` es la decisión del
        -- dueño del 2026-10-17 escrita en aritmética: media cuota no cuenta.
        -- Pagar 29 de una cuota de 30 deja la cuota sin cubrir y el
        -- vencimiento donde estaba.
        if queue_total[i] > 0 then
          cubiertas := floor((queue_total[i] - queue_amount[i]) / (queue_total[i] / n));
        else
          cubiertas := 0;
        end if;

        -- No puede haberlas cubierto todas: si lo hubiera hecho, este cargo no
        -- estaría en la cola. El tope evita que un redondeo lo empuje fuera.
        if cubiertas > n - 1 then
          cubiertas := n - 1;
        end if;

        -- «3 cuotas en 30 días» = una cada 10. La siguiente sin pagar es la
        -- `cubiertas + 1`, y vence en `plazo * (cubiertas + 1) / n` días.
        -- Numérico y no entero: 30 días en 4 cuotas son 7,5 días, no 7.
        due_at := queue_at[i]
          + (interval '1 day' * (queue_plazo[i]::numeric * (cubiertas + 1) / n));
      end if;

      return next;
      return;
    end if;
  end loop;

  return;
end;
$$;

grant execute on function public.get_oldest_unpaid_charge_for_currency(uuid, text) to authenticated;

-- ── El combinado, que es el que lee la vista ────────────────────────────
-- Sigue eligiendo por FECHA DEL CARGO, igual que antes, y se lleva consigo el
-- vencimiento calculado de ese cargo.
create function public.get_oldest_unpaid_charge(p_client_id uuid)
returns table (charge_at timestamptz, plazo_dias int, due_at timestamptz)
language plpgsql
stable
as $$
declare
  cur record;
  r record;
  best_at timestamptz;
  best_plazo int;
  best_due timestamptz;
begin
  for cur in
    select distinct currency
    from public.movements
    where client_id = p_client_id and deleted_at is null
  loop
    select * into r
    from public.get_oldest_unpaid_charge_for_currency(p_client_id, cur.currency);

    if r.charge_at is not null and (best_at is null or r.charge_at < best_at) then
      best_at := r.charge_at;
      best_plazo := r.plazo_dias;
      best_due := r.due_at;
    end if;
  end loop;

  if best_at is not null then
    charge_at := best_at;
    plazo_dias := best_plazo;
    due_at := best_due;
    return next;
  end if;

  return;
end;
$$;

grant execute on function public.get_oldest_unpaid_charge(uuid) to authenticated;

-- ===========================================================================
-- 3. LAS DOS VISTAS, CON UNA COLUMNA MÁS
-- ===========================================================================
--
-- Copia de la definición viva (migración `044`) con `oldest_unpaid_charge_due_at`
-- añadida al final. Deliberadamente una copia y no un refactor: es la consulta
-- de la que depende cada pantalla del tendero, y que el diff se lea importa
-- más que la duplicación. Es la misma decisión que explica la `044`.
create view public.client_summary_all
with (security_invoker = on) as
select
  c.id as client_id,
  c.owner_id,
  c.name,
  c.whatsapp,
  c.created_at as client_created_at,
  coalesce(latest_cop.running_balance, 0) as balance,
  coalesce(latest_usd.running_balance, 0) as balance_usd,
  coalesce(latest_eur.running_balance, 0) as balance_eur,
  coalesce(review.any_needs_review, false) as has_pending_review,
  last_payment.created_at as last_payment_at,
  coalesce(last_payment.created_at, c.created_at) as mora_reference_at,
  extract(day from now() - coalesce(last_payment.created_at, c.created_at))::int as days_since_payment,
  oldest_unpaid.charge_at as oldest_unpaid_charge_at,
  oldest_unpaid.plazo_dias as oldest_unpaid_charge_plazo_dias,
  c.document_id,
  c.is_flagged,
  c.trashed_at,
  c.deleted_at,
  c.trashed_balance,
  c.trashed_balance_usd,
  c.trashed_balance_eur,
  -- LA COLUMNA NUEVA, AL FINAL. Va la última porque hay pantallas que leen
  -- esta vista con `select *` y un orden distinto cambiaría lo que recibe
  -- cada una sin que nada avise.
  oldest_unpaid.due_at as oldest_unpaid_charge_due_at
from public.clients c
left join lateral (
  select m.running_balance from public.movements m
  where m.client_id = c.id and m.currency is null and m.deleted_at is null
  order by m.created_at desc, m.id desc limit 1
) latest_cop on true
left join lateral (
  select m.running_balance from public.movements m
  where m.client_id = c.id and m.currency = 'USD' and m.deleted_at is null
  order by m.created_at desc, m.id desc limit 1
) latest_usd on true
left join lateral (
  select m.running_balance from public.movements m
  where m.client_id = c.id and m.currency = 'EUR' and m.deleted_at is null
  order by m.created_at desc, m.id desc limit 1
) latest_eur on true
left join lateral (
  select bool_or(m.needs_review) as any_needs_review from public.movements m
  where m.client_id = c.id and m.deleted_at is null
) review on true
left join lateral (
  select m.created_at from public.movements m
  where m.client_id = c.id and m.type = 'payment' and m.deleted_at is null
  order by m.created_at desc limit 1
) last_payment on true
left join lateral public.get_oldest_unpaid_charge(c.id) oldest_unpaid on true;

grant select on public.client_summary_all to authenticated;

create view public.client_summary
with (security_invoker = on) as
select * from public.client_summary_all
where trashed_at is null and deleted_at is null;

-- El drop se llevó el grant por delante. Restaurarlo no es opcional: sin esta
-- línea cada pantalla del tendero contesta "permission denied". La `044` lo
-- aprendió y lo dejó escrito.
grant select on public.client_summary to authenticated;

insert into public.schema_migrations (key, description)
values (
  '118_fiado_en_cuotas',
  'movements.cuotas: en cuantas cuotas se pacto un fiado, y el vencimiento de la cola FIFO pasa a ser el de la PROXIMA cuota sin pagar en vez del final del plazo entero. Decision del dueno del 2026-10-17: «las cuotas se dividen entre el plazo establecido -- 3 cuotas en 30 dias es una cada 10» y «una cuota pagada a medias no refresca» (de ahi el floor). NULL = sin cuotas = una sola cuota, asi que lo ya guardado sigue correcto sin backfill y el codigo tiene un solo camino. Antes de escribir esto se midio contra dev que «el 100 % del fiado refresca y un abono parcial no» YA era la regla vigente desde la 025: esto no la cambia, solo le da una unidad mas pequena. Las dos funciones cambian sus columnas de salida, que create or replace no admite, asi que van con drop+create y las dos vistas delante porque dependen de ellas por un lateral join. NO cambia contra que cargo se juzga el estado: sigue siendo el mas antiguo por fecha.'
)
on conflict (key) do nothing;

commit;
