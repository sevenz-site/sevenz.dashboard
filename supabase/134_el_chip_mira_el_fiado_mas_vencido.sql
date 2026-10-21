-- THE STATUS BADGE STOPS READING THE OLDEST FIADO AND READS THE WORST ONE.
--
-- Raised by the owner on 2026-10-21, looking at his own client list: «el
-- estado principal que se le muestra al cliente debería ser el más crítico y
-- no el más antiguo... ese es el principal cue visual para el tendero decidir
-- si continuar fiándole o marcarlo como mala paga».
--
-- ===========================================================================
-- WHAT WAS WRONG, MEASURED IN DEV WITH A CONTROL
--
-- `client_summary` fed the badge from `get_oldest_unpaid_charge`, which picks
-- by DATE OF THE CHARGE across both ledgers. So a fiado that is older and
-- still within its term decided the badge for the whole client.
--
--   A client registered 100 days ago who has NEVER paid anything, owing $50
--   still within term (120 days) and $400 OVERDUE BY 73 DAYS, showed
--   «Dentro del plazo». Removing only the $50 fiado, the same client showed
--   «Crítico».
--
-- A small fiado in good standing was switching off the alarm of a large
-- overdue one. And worse than hiding a state: `getClientStatus` returns
-- «dentro_del_plazo» BEFORE it checks the 30-days-without-paying escalation,
-- so that quiet old fiado also silenced «Crítico».
--
-- It crossed currencies too: `get_oldest_unpaid_charge` walks both and keeps
-- the oldest date, so an overdue fiado in euros hid behind a current one in
-- dollars.
--
-- ===========================================================================
-- ONE RULE PICKS THE WINNER, AND IT COVERS BOTH CASES
--
-- Order every open fiado by its OWN due date, ascending, and take the first.
-- When that date is in the past it is the most overdue one; when it is in the
-- future it is the one that will fall due soonest. A single comparison, with
-- no branch for "is anybody overdue".
--
-- A FIADO WITH NO TERM COUNTS AS DUE THE DAY IT WAS TAKEN. `plazo_dias` null
-- already produces an overdue-equivalent state in `getClientStatus`
-- («sin_plazo», same severity as «plazo_vencido»), so sorting it by its
-- charge date puts it among the overdue ones, where it belongs. `due_at`
-- itself is still returned as null, because that is what the caller needs in
-- order to tell «plazo_vencido» from «sin_plazo».
--
-- ===========================================================================
-- AND AMONG OVERDUE ONES, A FIADO *WITH* A TERM WINS THE TIE
--
-- The owner's call on 2026-10-21, after seeing what this did to the one real
-- client it moved: Juan Pablo II has two fiados taken the same day, one on a
-- 7-day term overdue by 5, and one with no term at all, waiting for 12. By
-- "most overdue" alone the termless one won and the badge read «Sin plazo».
--
-- Both labels are amber and carry the same severity, so nothing was hidden --
-- but they are not equally useful. «Plazo vencido» says a date was agreed and
-- has passed, which is a thing to go and collect. «Sin plazo» says nobody
-- ever set a date, which is a thing to go and fix. Facing a client the
-- shopkeeper is about to lend to again, the first is the one that decides.
--
-- So the ordering is three keys deep: overdue before current, then WITH a
-- term before without, then most overdue first. The second key only applies
-- among overdue fiados -- a current one is never pulled ahead of an overdue
-- one by having a term, because that would hide exactly what this migration
-- exists to stop hiding.
--
-- ===========================================================================
-- IT BUILDS ON `get_open_charges_for_client`, AND THAT IS THE WHOLE POINT
--
-- That function already walks the payments applying BOTH rules -- directed
-- payments come off their own charge, historical ones spread oldest-first --
-- and returns what each fiado still owes. Writing a third copy of that walk
-- here is exactly how the credit score ended up disagreeing with the ledger
-- (`CT-124`): the same arithmetic written twice drifts apart the day one of
-- them learns something the other does not.
--
-- The due date is the only thing it does not return, so it is recomputed here
-- with the formula migration `126` uses, whole cuotas only.
--
-- ===========================================================================
-- THE COLUMNS ARE ADDED, THE OLD ONES ARE NOT REMOVED
--
-- `oldest_unpaid_charge_*` has no reader left in the new code -- every one of
-- the nine call sites moves to the new columns -- but production's CURRENT
-- code reads them, and migrations run before the deploy. Dropping them would
-- break every client screen for as long as that window lasts.

begin;

create or replace function public.get_worst_unpaid_charge(p_client_id uuid)
returns table (
  charge_at timestamptz,
  plazo_dias int,
  due_at timestamptz,
  overdue_count int
)
language plpgsql
stable
as $$
declare
  f record;
  n int;
  cubiertas int;
  vence timestamptz;
  efectivo timestamptz;
  vencido boolean;
  rank1 int;
  rank2 int;
  peor timestamptz;
  peor_rank1 int;
  peor_rank2 int;
  cuenta int := 0;
begin
  charge_at := null;
  plazo_dias := null;
  due_at := null;
  overdue_count := 0;

  for f in select * from public.get_open_charges_for_client(p_client_id)
  loop
    vence := null;

    if f.plazo_dias is not null then
      n := greatest(coalesce(f.cuotas, 1), 1);

      -- WHOLE CUOTAS ONLY, the owner's decision of 2026-10-16 written as
      -- arithmetic: half a cuota does not move the deadline. Copied from
      -- `126` deliberately -- if that rule ever changes, both have to change,
      -- and a grep for `cubiertas` finds them.
      if f.amount > 0 then
        cubiertas := floor((f.amount - f.pending) / (f.amount / n));
      else
        cubiertas := 0;
      end if;
      if cubiertas > n - 1 then
        cubiertas := n - 1;
      end if;

      vence := f.charge_at + (interval '1 day' * (f.plazo_dias::numeric * (cubiertas + 1) / n));
    end if;

    efectivo := coalesce(vence, f.charge_at);

    if efectivo < now() then
      cuenta := cuenta + 1;
    end if;

    -- LAS TRES CLAVES, en orden. `rank1` pone los vencidos delante; `rank2`,
    -- SOLO entre los vencidos, pone los que tienen plazo delante de los que
    -- no; y a igualdad de las dos manda la fecha, con `<` estricto para que
    -- un empate se quede con el primero que devolvió el recorrido —el más
    -- antiguo— en vez de depender del orden de las filas.
    vencido := efectivo < now();
    rank1 := case when vencido then 0 else 1 end;
    rank2 := case when vencido and f.plazo_dias is null then 1 else 0 end;

    if peor is null
       or rank1 < peor_rank1
       or (rank1 = peor_rank1 and rank2 < peor_rank2)
       or (rank1 = peor_rank1 and rank2 = peor_rank2 and efectivo < peor)
    then
      peor := efectivo;
      peor_rank1 := rank1;
      peor_rank2 := rank2;
      charge_at := f.charge_at;
      plazo_dias := f.plazo_dias;
      due_at := vence;
    end if;
  end loop;

  overdue_count := cuenta;

  if charge_at is not null then
    return next;
  end if;

  return;
end;
$$;

grant execute on function public.get_worst_unpaid_charge(uuid) to authenticated;

-- THE FOUR COLUMNS GO LAST, for the reason `118` and `130` both give: some
-- screens read these views with `select *`, and a different order would
-- change what each one receives with nothing to warn anybody.
create or replace view public.client_summary_all
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
  oldest_unpaid.due_at as oldest_unpaid_charge_due_at,
  coalesce(
    greatest(last_movement.created_at, last_sale.created_at),
    c.created_at
  ) as last_movement_at,
  worst_unpaid.charge_at as worst_unpaid_charge_at,
  worst_unpaid.plazo_dias as worst_unpaid_charge_plazo_dias,
  worst_unpaid.due_at as worst_unpaid_charge_due_at,
  -- NULL AND NOT ZERO when the client owes nothing: `get_worst_unpaid_charge`
  -- returns no row at all then, so the left join leaves every column null.
  -- The screen coalesces it; writing a zero here would need a second lateral
  -- for a number no badge draws.
  worst_unpaid.overdue_count as overdue_charge_count
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
left join lateral (
  select m.created_at from public.movements m
  where m.client_id = c.id and m.deleted_at is null
  order by m.created_at desc limit 1
) last_movement on true
left join lateral (
  select s.created_at from public.sales s
  where s.client_id = c.id and s.deleted_at is null
  order by s.created_at desc limit 1
) last_sale on true
left join lateral public.get_oldest_unpaid_charge(c.id) oldest_unpaid on true
left join lateral public.get_worst_unpaid_charge(c.id) worst_unpaid on true;

grant select on public.client_summary_all to authenticated;

-- RE-EXPANDING THE `*`, same as `130`: this view's body is `select *`, which
-- Postgres froze into a fixed column list when it was created. Replacing
-- `client_summary_all` above does not widen this one on its own, and leaving
-- this statement out is the silent failure -- the migration succeeds, the
-- columns exist in one view and not the other, and the badge reads undefined.
create or replace view public.client_summary
with (security_invoker = on) as
select * from public.client_summary_all
where trashed_at is null and deleted_at is null;

grant select on public.client_summary to authenticated;

insert into public.schema_migrations (key, description)
values (
  '134_el_chip_mira_el_fiado_mas_vencido',
  'client_summary.worst_unpaid_charge_at / _plazo_dias / _due_at y overdue_charge_count: el chip de estado pasa a salir del fiado MAS VENCIDO y no del mas antiguo, y trae cuantos fiados vencidos hay para el contador del chip. Pedido por el dueno el 2026-10-21 porque el chip es el unico aviso que mira antes de volver a fiar. Medido en dev con control: un cliente de 100 dias que nunca abono, con 50 al dia y 400 vencidos hace 73, salia «Dentro del plazo»; quitandole el fiado de 50 salia «Critico». Elige ordenando cada fiado abierto por SU propio vencimiento y tomando el primero: en el pasado es el mas vencido, en el futuro el que vence antes. Un fiado sin plazo cuenta como vencido el dia que se tomo, pero entre vencidos manda uno CON plazo si lo hay: «Plazo vencido» y «Sin plazo» son igual de graves y del mismo color, pero el primero dice que habia una fecha acordada y se paso, que es lo que decide delante de un cliente al que se le va a fiar otra vez (decision del dueno el 2026-10-21). Se apoya en get_open_charges_for_client para no escribir una tercera copia del reparto de abonos. Las columnas oldest_* se quedan: el codigo que hay en produccion las lee mientras corre esta migracion.'
)
on conflict (key) do nothing;

commit;
