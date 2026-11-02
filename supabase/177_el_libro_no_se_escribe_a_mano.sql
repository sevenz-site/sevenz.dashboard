-- ENVIRONMENT: run in DEV first (vzqppwrwnmlbrxizskdh). Production comes later,
-- with its own green light. Re-runnable: functions are `create or replace`
-- with their signatures unchanged, triggers are dropped first, and the
-- revoke/grant pairs are idempotent.
--
-- ===========================================================================
-- 177: THE LEDGER CANNOT BE WRITTEN BY HAND
--
-- Found by the offensive audit of 2026-11-02, run against dev at the owner's
-- request («actúa como hacker con el objetivo de encontrar vulnerabilidades»),
-- and fixed with his decisions of the same day.
--
-- 1. `running_balance` -- «Rehacer cualquier cambio que no venga del
--    recálculo». The owner's `update` policy on `movements` covers every
--    column, so one request from the browser console could set
--    running_balance = 777 on a $50 fiado. `client_summary_all` reads the
--    balance from the last row of each book, and `get_shared_balance` reads
--    `client_summary_all`: the CLIENT saw $777 owed, with a history that only
--    added up to $50. Measured in dev the same day.
--
--    Fix: a BEFORE UPDATE trigger puts the old value back unless the change
--    comes from `recalc_client_running_balance`, which raises a
--    transaction-local flag while it runs. Silently restored, not rejected:
--    an edit that touches other columns of the same row still goes through.
--    The flag is a transaction-local setting, so it cannot leak to another
--    request, and PostgREST runs each request as one statement -- an attacker
--    cannot set it and then update in the same transaction.
--
--    On INSERT the value was never the caller's: `set_movement_running_balance`
--    already computes it before the row is written.
--
-- 2. `created_by` -- «disparador before insert que fije created_by =
--    auth.uid() cuando hay sesión. Los scripts con la clave de servicio siguen
--    poniendo el suyo». An owner could sign a fiado as somebody else. Today a
--    business has one user, so it was cosmetic; with employees it would not
--    be. Also frozen on UPDATE: the author of a row never changes.
--
-- 4. `owner_puede_escribir` -- anyone without an account could ask whether a
--    given business is blocked. It needed the business's internal id, which is
--    not public, so the leak was small; there is still no reason for a
--    stranger to run it. The policies that call it are all write policies,
--    evaluated for a logged-in owner; the public catalogue enters through
--    SECURITY DEFINER functions, which run as their owner.
--
-- (3, the security headers, is code: `next.config.ts`.)

begin;

-- ── 1. running_balance only moves through the recalculation ─────────────

-- 025's function, unchanged except for the flag around its loop.
create or replace function public.recalc_client_running_balance(p_client_id uuid)
returns void
language plpgsql
as $$
declare
  cur record;
  m record;
  running numeric(14, 4);
begin
  perform set_config('sevenz.recalculo', 'on', true);
  for cur in
    select distinct currency
    from public.movements
    where client_id = p_client_id and deleted_at is null
  loop
    running := 0;
    for m in
      select id, type, amount
      from public.movements
      where client_id = p_client_id
        and currency is not distinct from cur.currency
        and deleted_at is null
      order by created_at asc, id asc
    loop
      running := running + (case when m.type = 'charge' then m.amount else -m.amount end);
      update public.movements set running_balance = running where id = m.id;
    end loop;
  end loop;
  perform set_config('sevenz.recalculo', 'off', true);
end;
$$;

grant execute on function public.recalc_client_running_balance(uuid) to authenticated;

create or replace function public.movements_protege_el_libro()
returns trigger
language plpgsql
as $$
begin
  if new.running_balance is distinct from old.running_balance
     and coalesce(current_setting('sevenz.recalculo', true), 'off') <> 'on' then
    new.running_balance := old.running_balance;
  end if;
  -- The author of a row never changes, whoever asks.
  new.created_by := old.created_by;
  return new;
end;
$$;

drop trigger if exists movements_protege_el_libro on public.movements;
create trigger movements_protege_el_libro
  before update on public.movements
  for each row execute function public.movements_protege_el_libro();

-- ── 2. created_by is the session, when there is one ─────────────────────

create or replace function public.movements_autor_es_la_sesion()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is not null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists movements_autor_es_la_sesion on public.movements;
create trigger movements_autor_es_la_sesion
  before insert on public.movements
  for each row execute function public.movements_autor_es_la_sesion();

-- ── 4. A stranger cannot ask whether a business is blocked ──────────────

revoke execute on function public.owner_puede_escribir(uuid) from public, anon;
grant execute on function public.owner_puede_escribir(uuid) to authenticated, service_role;

insert into public.schema_migrations (key, description)
values (
  '177_el_libro_no_se_escribe_a_mano',
  'Auditoría ofensiva del 2026-11-02. (1) running_balance solo cambia por recalc_client_running_balance: cualquier otro update lo devuelve a su valor (un dueño podía hacer que su cliente viera 777 con un fiado de 50). (2) created_by es siempre el usuario de la sesión al insertar, y ya no cambia nunca; con la clave de servicio se respeta el que se mande. (4) owner_puede_escribir deja de poder ejecutarla un anónimo.'
)
on conflict (key) do nothing;

commit;
