-- THE DIRECTED PAYMENT, AND THE PENDING BALANCE OF EACH SINGLE FIADO.
--
-- Decision of the owner on 2026-10-19: *«el abono deberia SIEMPRE dirigirse»*.
-- From now on registering a payment starts by picking the fiado it pays, and
-- that choice is stored in `movements.applies_to_movement_id` -- the column
-- migration 124 added and nobody read.
--
-- ===========================================================================
-- TWO KINDS OF PAYMENT NOW LIVE SIDE BY SIDE, AND THAT IS THE WHOLE PROBLEM
--
-- · NEW payments carry a direction and come off THEIR charge.
-- · HISTORICAL payments -- hundreds in production -- carry none, and the FIFO
--   queue spread them oldest-first.
--
-- So "what does this fiado still owe" cannot be answered by one rule applied to
-- everything. The loop below applies both, deciding per payment.
--
-- THE PROPERTY THAT MAKES THIS SAFE, and the reason it is written this way:
-- for every row that exists today the new branch NEVER RUNS, because no
-- historical payment has a direction. The status of every client, the credit
-- score and the "plazo vencido" labels of all 24 businesses read exactly the
-- same the day this ships as they did the day before. Any other rule -- a
-- backfill, recomputing, assigning directions to what is already stored --
-- would move real customers' numbers without anyone asking for it.
--
-- ===========================================================================
-- A DIRECTED PAYMENT WHOSE CHARGE IS NOT IN THE QUEUE FALLS BACK TO FIFO
--
-- Deleting a movement is a SOFT delete (migration 021 says so in its first
-- line: `deleted_at` is set and the row stays), so a deleted fiado simply never
-- enters the queue. Its directed payments then find no target and are spread by
-- the old rule, which is what the owner was asked about: the money goes to the
-- oldest open fiado instead of vanishing.
--
-- AND IT SURVIVES A RESTORE, which is better than promising the direction is
-- lost: restoring the fiado puts the charge back in the queue, the payment
-- finds its target again and lands where the shopkeeper had said. Nothing has
-- to be rewritten on delete or on restore, because the behaviour falls out of
-- the read.
--
-- ===========================================================================
-- WHY `create or replace` AND NO VIEW DROPS, unlike migration 118
--
-- 118 had to drop `client_summary` and `client_summary_all` first because it
-- changed the function's signature. This one changes only the body: same
-- arguments, same `returns table` columns. `create or replace` is enough and
-- the views keep working untouched. (If a future migration touches the column
-- list, it has to drop the views again -- see the header of 118.)

-- ── 1. THE QUEUE LEARNS TO RESPECT A DIRECTION ─────────────────────────
create or replace function public.get_oldest_unpaid_charge_for_currency(
  p_client_id uuid,
  p_currency text
)
returns table (charge_at timestamptz, plazo_dias int, due_at timestamptz)
language plpgsql
stable
as $$
declare
  m record;
  -- `queue_id` IS THE ONLY NEW ARRAY: without the charge's own id there is no
  -- way for a directed payment to find the entry it belongs to.
  queue_id uuid[] := '{}';
  queue_amount numeric[] := '{}';  -- lo que queda por cubrir de cada cargo
  queue_total numeric[] := '{}';   -- su importe original, para contar cuotas
  queue_at timestamptz[] := '{}';
  queue_plazo int[] := '{}';
  queue_cuotas int[] := '{}';
  remaining numeric;
  i int;
  n int;
  cubiertas int;
  dirigido boolean;
begin
  for m in
    select mv.id, mv.type, mv.amount, mv.created_at, mv.plazo_dias, mv.cuotas,
           mv.applies_to_movement_id
    from public.movements mv
    where mv.client_id = p_client_id
      and mv.currency is not distinct from p_currency
      and mv.deleted_at is null
    order by mv.created_at asc, mv.id asc
  loop
    if m.type = 'charge' then
      queue_id := array_append(queue_id, m.id);
      queue_amount := array_append(queue_amount, m.amount);
      queue_total := array_append(queue_total, m.amount);
      queue_at := array_append(queue_at, m.created_at);
      queue_plazo := array_append(queue_plazo, m.plazo_dias);
      queue_cuotas := array_append(queue_cuotas, m.cuotas);
    else
      dirigido := false;

      if m.applies_to_movement_id is not null then
        i := 1;
        while i <= coalesce(array_length(queue_id, 1), 0) loop
          if queue_id[i] = m.applies_to_movement_id then
            -- `greatest(..., 0)` AND NOT A PLAIN SUBTRACTION: the screen caps a
            -- directed payment at what its fiado still owes, but this function
            -- is read by code that did not necessarily go through that screen.
            -- A negative entry here would read as "this charge is more than
            -- paid" and silently pull the next one forward.
            queue_amount[i] := greatest(queue_amount[i] - m.amount, 0);
            dirigido := true;
            exit;
          end if;
          i := i + 1;
        end loop;
      end if;

      -- NO DIRECTION, OR A DIRECTION POINTING AT A CHARGE THAT IS NOT HERE:
      -- the old rule, untouched. This is the branch every historical payment
      -- takes, which is why nothing stored today changes.
      if not dirigido then
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
        -- dueño del 2026-10-16 escrita en aritmética: media cuota no cuenta.
        if queue_total[i] > 0 then
          cubiertas := floor((queue_total[i] - queue_amount[i]) / (queue_total[i] / n));
        else
          cubiertas := 0;
        end if;

        if cubiertas > n - 1 then
          cubiertas := n - 1;
        end if;

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

-- ── 2. EVERY OPEN FIADO, WITH WHAT IT STILL OWES ───────────────────────
--
-- This is what the "Seleccionar fiado / crédito" screen lists, and the figure
-- its card shows as «Debe $200.00». IT DOES NOT EXIST ANYWHERE TODAY: the queue
-- above only ever returned its head, because the only question anyone asked was
-- "is this client late". Now the shopkeeper has to pick among them.
--
-- SAME LOOP, DELIBERATELY. The pending balance per fiado has to be the same
-- arithmetic that decides a client's status, or the screen would offer a figure
-- the rest of the app disagrees with. Copying the loop is the cost of keeping
-- them identical; the alternative -- two functions drifting apart -- is the
-- failure CLAUDE.md describes for the SQL/TypeScript pair.
--
-- RETURNS `sale_id`, NOT THE PRODUCT NAME. The card reads «Fiado · nombre de
-- producto», and those names live in `sale_lines`, which the owner's session
-- can already read. Resolving them here would tie this function to a label, and
-- the label changes more often than the money does.
drop function if exists public.get_open_charges_for_client(uuid);

create function public.get_open_charges_for_client(p_client_id uuid)
returns table (
  movement_id uuid,
  sale_id uuid,
  charge_at timestamptz,
  currency text,
  amount numeric,
  pending numeric,
  plazo_dias int,
  cuotas int,
  description text
)
language plpgsql
stable
as $$
declare
  cur record;
  m record;
  queue_id uuid[];
  queue_sale uuid[];
  queue_amount numeric[];
  queue_total numeric[];
  queue_at timestamptz[];
  queue_plazo int[];
  queue_cuotas int[];
  queue_desc text[];
  remaining numeric;
  i int;
  dirigido boolean;
begin
  -- ONE LEDGER AT A TIME. `currency is not distinct from` keeps the NULL of a
  -- Colombian business as a ledger of its own and not as "no currency" -- the
  -- same detail the queue above has carried since migration 025.
  -- NO `as currency` ALIAS HERE: `currency` is also an OUT parameter of this
  -- function, and giving the query column the same name is exactly how plpgsql
  -- ends up reporting an ambiguous reference. Everything else in the body is
  -- qualified with `mv.` for the same reason -- `amount`, `description`,
  -- `cuotas`, `plazo_dias` and `sale_id` are all both OUT params and columns.
  for cur in
    select distinct mv.currency
    from public.movements mv
    where mv.client_id = p_client_id
      and mv.deleted_at is null
  loop
    queue_id := '{}';
    queue_sale := '{}';
    queue_amount := '{}';
    queue_total := '{}';
    queue_at := '{}';
    queue_plazo := '{}';
    queue_cuotas := '{}';
    queue_desc := '{}';

    for m in
      select mv.id, mv.sale_id, mv.type, mv.amount, mv.created_at,
             mv.plazo_dias, mv.cuotas, mv.description, mv.applies_to_movement_id
      from public.movements mv
      where mv.client_id = p_client_id
        and mv.currency is not distinct from cur.currency
        and mv.deleted_at is null
      order by mv.created_at asc, mv.id asc
    loop
      if m.type = 'charge' then
        queue_id := array_append(queue_id, m.id);
        queue_sale := array_append(queue_sale, m.sale_id);
        queue_amount := array_append(queue_amount, m.amount);
        queue_total := array_append(queue_total, m.amount);
        queue_at := array_append(queue_at, m.created_at);
        queue_plazo := array_append(queue_plazo, m.plazo_dias);
        queue_cuotas := array_append(queue_cuotas, m.cuotas);
        queue_desc := array_append(queue_desc, m.description);
      else
        dirigido := false;

        if m.applies_to_movement_id is not null then
          i := 1;
          while i <= coalesce(array_length(queue_id, 1), 0) loop
            if queue_id[i] = m.applies_to_movement_id then
              queue_amount[i] := greatest(queue_amount[i] - m.amount, 0);
              dirigido := true;
              exit;
            end if;
            i := i + 1;
          end loop;
        end if;

        if not dirigido then
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
      end if;
    end loop;

    -- OLDEST FIRST, which is the order the screen wants: the fiado the
    -- shopkeeper most likely wants to settle is the one that has been open
    -- longest. The screen's "Fecha" filter can reverse it.
    for i in 1 .. coalesce(array_length(queue_amount, 1), 0) loop
      if queue_amount[i] > 0 then
        movement_id := queue_id[i];
        sale_id := queue_sale[i];
        charge_at := queue_at[i];
        currency := cur.currency;
        amount := queue_total[i];
        pending := queue_amount[i];
        plazo_dias := queue_plazo[i];
        cuotas := queue_cuotas[i];
        description := queue_desc[i];
        return next;
      end if;
    end loop;
  end loop;

  return;
end;
$$;

-- RLS DOES THE GUARDING, as it does for the queue above: these are `stable`
-- functions with no `security definer`, so they run as the caller and
-- `movements`' own policy decides which client ids are visible. An owner asking
-- for someone else's client gets an empty table, not an error -- the same shape
-- `get_oldest_unpaid_charge` has always had.
--
-- THE `revoke` IS NOT DECORATION, and it was missing in the first version of
-- this file. Postgres grants EXECUTE on a new function to PUBLIC by default, so
-- `grant ... to authenticated` adds nothing: `anon` could call it already.
-- `qa:abono-dirigido` caught it on the first run.
--
-- Nothing leaked -- without `security definer` the function runs as `anon` and
-- `movements`' policy hands it zero rows -- but a public surface that answers
-- at all is a surface, and migration 114 already set the house pattern with
-- `create_catalog_order`: revoke from public first, then grant to who should
-- have it.
revoke execute on function public.get_open_charges_for_client(uuid) from public;
grant execute on function public.get_open_charges_for_client(uuid) to authenticated;

insert into public.schema_migrations (key, description)
values (
  '126_abono_dirigido',
  'El abono dirigido: la cola FIFO aprende a respetar movements.applies_to_movement_id, y nace get_open_charges_for_client() que devuelve cada fiado abierto con lo que TODAVIA debe. Decision del dueno el 2026-10-19: el abono siempre se dirige, y la pantalla 1/3 del flujo lista los fiados con su «Debe $200.00» -- cifra que hoy no existe en ningun sitio porque la cola solo devolvia su cabeza. · CONVIVEN DOS CLASES DE ABONO: los nuevos llevan direccion y se restan de SU cargo; los historicos no la llevan y los reparte la cola de mas viejo a mas nuevo. El bucle decide por abono. · LA PROPIEDAD QUE LO HACE SEGURO: para todas las filas que existen hoy la rama nueva NO SE EJECUTA NI UNA VEZ, porque ningun abono historico tiene direccion, asi que el estado de los clientes, el puntaje de credito y las etiquetas de plazo vencido de los 24 negocios no se mueven. Un backfill o un recalculo habrian movido cifras de clientes reales sin que nadie lo pidiera. · UN ABONO DIRIGIDO A UN CARGO QUE NO ESTA EN LA COLA cae en el reparto viejo: borrar es BLANDO (021), asi que un fiado borrado no entra en la cola, su abono no encuentra destino y cubre el mas antiguo abierto -- y si el fiado se restaura, el abono vuelve a aterrizar donde el tendero dijo, sin reescribir nada. · get_open_charges_for_client COPIA EL BUCLE a proposito: el saldo por fiado tiene que salir de la misma aritmetica que decide el estado del cliente, o la pantalla ofreceria una cifra con la que el resto de la app no esta de acuerdo. · Devuelve sale_id y no el nombre del producto: esos nombres viven en sale_lines y la etiqueta cambia mas a menudo que el dinero. · create or replace sin tocar las vistas, al reves que la 118: aqui solo cambia el cuerpo, no la firma.'
)
on conflict (key) do nothing;
