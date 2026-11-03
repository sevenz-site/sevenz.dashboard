-- ENVIRONMENT: run in DEV first (vzqppwrwnmlbrxizskdh). Production comes later,
-- with its own green light, and it can go BEFORE or AFTER the code: the only
-- code change that pairs with it is the error mapping in
-- `lib/errores-legibles.ts`, and without it a rejected write still fails
-- safely with the generic message. Re-runnable: every function is `create or
-- replace`, every trigger is dropped before being created, the tables are
-- `if not exists`.
--
-- ===========================================================================
-- 180: THE LEDGER CANNOT BE REWRITTEN FROM THE BROWSER CONSOLE
--
-- Finding 6 of the 2026-11-02 audit, widened the same day at the owner's
-- request: «si un hacker accede a las credenciales de un tendero puede alterar
-- su cartera. Evitemos cualquier tipo de edición del camino del dinero».
--
-- Measured in dev with an owner's own session, writing straight to the tables
-- the way the browser console can: a $5,000 payment on a $50 debt, a fiado
-- edited from 50 to 1, a fiado turned into a payment, a debt moved to another
-- client, a fiado dated a year back, the typed bolivars the client sees
-- changed, a movement deleted for good (no papelera), a $999 payment pinned
-- to a sale, a sale deleted for good. All nine went through. None is possible
-- from the screens: the app only ever INSERTS money rows with today's date and
-- flips `deleted_at` -- "Editar abono" was removed on 2026-10-23 by the owner's
-- own decision. What the console adds is the irreversible, the invisible and
-- the retroactive. This migration takes exactly that away.
--
-- WHO IS SUBJECT TO THE RULES -- and this is the design decision.
-- `current_user` is `authenticated` only for a write that comes straight from
-- a session: the app's direct inserts, and the console. Inside a SECURITY
-- DEFINER function it is the function's owner, so `import_libreta` (which
-- legitimately writes old dates) and `registrar_abono_repartido` (which
-- validates its own split) are exempt by how they are declared, with no flag
-- anybody can forget. Service-role scripts (`qa/`) are `service_role` and
-- exempt too, as with 177. `recalc_client_running_balance` is NOT definer and
-- runs as the caller: it only touches `running_balance`, which rule 1 leaves
-- to 177's own trigger.
--
-- THE FIVE RULES, on direct session writes only:
--   1. A movement is never edited. Only `deleted_at` may change (papelera and
--      restore). `running_balance` and `created_by` stay with 177's trigger.
--   2. `created_at` is set by the database. The app never sends it; the
--      console no longer can.
--   3. A payment cannot exceed what the client owes in that ledger, with the
--      same 0.005 tolerance the app uses (`HOLGURA` in abonos/actions.ts). The
--      comparison is on `amount` -- the ledger figure -- and never touches
--      `entry_amount`, the bolivars the shopkeeper typed, which stay verbatim
--      (owner's rule of 2026-10-24) and which rule 1 now also makes
--      un-editable. Payments on the same client are serialised with an
--      advisory lock, so two at once cannot each fit and together overshoot.
--   4. DROPPED before being written: "typed bolivars must equal amount x rate"
--      would reject every legitimate bolivar payment, by that same rule of
--      2026-10-24. Rule 1 covers the attack instead.
--   5. No hard delete of money rows older than 10 minutes. The window exists
--      for `registrarVenta`, which undoes what it just wrote when a later
--      step fails (sale -> lines -> payments -> movements, seconds apart).
--      Everything older goes to the papelera or stays.
--   6. A sale is written once: lines and payments only within 10 minutes of
--      the sale, never edited; the sale row itself only flips `deleted_at`.
--
-- ===========================================================================
-- OBSERVE FIRST, ENFORCE SECOND -- how the worst case is taken off the table
--
-- The owner asked (2026-11-02) how to bring "a wrong rule blocks every shop
-- from selling" as close to zero as it goes. The answer is that the rules
-- ship SWITCHED OFF and watching:
--
--   · `ledger_rules.enforce = false` (the default here) means every rule
--     still runs, still decides, and when it WOULD refuse a write it only
--     writes a row to `ledger_rule_hits` and lets the write through. Nothing
--     the app does changes by one byte.
--   · Production runs like that for a few days of real traffic. The hits table
--     then says, by table, rule, owner and detail, whether any legitimate
--     flow would have been refused. Expected: zero rows from the app, only the
--     attacks the suite throws at dev.
--   · Only then: `update public.ledger_rules set enforce = true`. One row, no
--     DDL, instant -- and the same row flipped back is the kill switch,
--     seconds, from the SQL editor, with nothing to redeploy and nothing
--     lost. Dropping the triggers remains the second way out.
--   · Both helpers FAIL OPEN: if reading the switch or writing a hit ever
--     errors, the write is allowed. A money row must never be lost to a
--     logging table. `qa:ledger-console` asserts enforce = true in dev as its
--     control 0, so the switch being silently off cannot pass as green.
--
-- What this costs: while observing, the console attacks still work. That is
-- today's state, for a few days more, in exchange for never finding out in
-- production that a rule was wrong.
--
-- AND THE LOG ONLY FILLS WHILE OBSERVING. Measured in dev on 2026-11-02:
-- after a full run of `qa:ledger-console` with the rules on, the hits table
-- had zero rows. A refusal is an exception, the exception rolls back the
-- whole transaction, and the hit written a line earlier goes with it. So in
-- enforce mode the attacker gets the error and no trail stays; a durable
-- trail would need a second connection (dblink), which is not worth it here.
-- The table's purpose -- "would a real flow have been refused?" -- is served
-- in observe mode, where nothing raises and every row persists.

-- ───────────────────────────────────────────────────────────────────────────
-- 0. The switch, the log, and who is writing
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.ledger_rules (
  -- A single row, pinned by a boolean primary key that can only be true.
  id boolean primary key default true check (id),
  enforce boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.ledger_rules (id, enforce) values (true, false) on conflict (id) do nothing;

create table if not exists public.ledger_rule_hits (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  owner_id uuid,
  table_name text not null,
  rule text not null,
  enforced boolean not null,
  detail text
);
create index if not exists ledger_rule_hits_at_idx on public.ledger_rule_hits (at);
create index if not exists ledger_rule_hits_owner_at_idx on public.ledger_rule_hits (owner_id, at);

-- Neither table is for the app or for anyone with a session. The triggers
-- reach them through the two SECURITY DEFINER helpers below, so no grant is
-- needed -- and none is given, so a session cannot flip the switch or erase
-- its own trail.
alter table public.ledger_rules enable row level security;
alter table public.ledger_rule_hits enable row level security;
revoke all on public.ledger_rules from public, anon, authenticated;
revoke all on public.ledger_rule_hits from public, anon, authenticated;
grant select, update on public.ledger_rules to service_role;
grant select, delete on public.ledger_rule_hits to service_role;

create or replace function public.ledger_direct_write()
returns boolean
language sql
stable
as $$
  select current_user = 'authenticated';
$$;

-- Fails open: an unreadable switch means "observe", never "refuse".
-- Executable by `authenticated` on purpose: the insert guard below runs as
-- the caller and asks it. The first version revoked it, and in dev every
-- direct fiado and abono died with 42501 -- the exact worst case this
-- migration exists to avoid, caught by `qa:ledger-console`'s controls. All a
-- session learns from it is a boolean.
create or replace function public.ledger_rules_enforced()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  return coalesce((select enforce from public.ledger_rules where id), false);
exception when others then
  return false;
end;
$$;
revoke execute on function public.ledger_rules_enforced() from public, anon;
grant execute on function public.ledger_rules_enforced() to authenticated, service_role;

-- Fails open too: a hit that cannot be logged is dropped, the write goes on.
-- Two bounds keep an attacker from growing the table at will: at most 100
-- hits per owner per hour (the first 100 already say everything), and a
-- prune of anything older than 90 days now and then.
create or replace function public.ledger_rule_hit(p_table text, p_rule text, p_enforced boolean, p_detail text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.ledger_rule_hits
      where owner_id is not distinct from auth.uid() and at > now() - interval '1 hour') >= 100 then
    return;
  end if;
  insert into public.ledger_rule_hits (owner_id, table_name, rule, enforced, detail)
  values (auth.uid(), p_table, p_rule, p_enforced, left(p_detail, 500));
  if random() < 0.01 then
    delete from public.ledger_rule_hits where at < now() - interval '90 days';
  end if;
exception when others then
  null;
end;
$$;
revoke execute on function public.ledger_rule_hit(text, text, boolean, text) from public, anon, authenticated;

-- The one place a rule decides: logs the hit, and raises only when enforcing.
-- Trigger functions run as the caller, and `authenticated` may not execute
-- the two helpers above -- so this one is SECURITY DEFINER to reach them,
-- with a fixed search_path and no table access of its own. It is granted to
-- `authenticated` because the triggers need it, and it refuses to do
-- anything unless a trigger is what is calling: called straight over RPC
-- (`pg_trigger_depth() = 0`) it neither logs nor raises, so a session cannot
-- use it to fill the log with noise.
create or replace function public.ledger_refuse(p_table text, p_rule text, p_message text, p_detail text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enforce boolean;
begin
  if pg_trigger_depth() = 0 then
    return false;
  end if;
  v_enforce := public.ledger_rules_enforced();
  perform public.ledger_rule_hit(p_table, p_rule, v_enforce, p_detail);
  if v_enforce then
    raise exception using message = p_message, errcode = p_rule;
  end if;
  return false;
end;
$$;
revoke execute on function public.ledger_refuse(text, text, text, text) from public, anon;
grant execute on function public.ledger_refuse(text, text, text, text) to authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- 1 + 2 + 3. Movements: insert
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.movements_guard_insert()
returns trigger
language plpgsql
as $$
declare
  v_debt numeric(14, 4);
begin
  if not public.ledger_direct_write() then
    return new;
  end if;

  -- Rule 2: the date is the database's, never the caller's. A date sent from
  -- outside is REFUSED when enforcing (the app never sends one), and only
  -- logged while observing -- observing must not change a single byte.
  if new.created_at is distinct from now() and abs(extract(epoch from (new.created_at - now()))) > 60 then
    perform public.ledger_refuse('movements', 'SZ005',
      'La fecha de una transacción la pone Sevenz.', 'created_at enviado: ' || new.created_at::text);
  end if;

  -- Rule 3: a payment fits in the debt of its ledger.
  if new.type = 'payment' then
    -- One payment at a time per client: without this, two payments that each
    -- fit could land together and leave the client "a favor".
    perform pg_advisory_xact_lock(hashtext('movements:' || new.client_id::text));

    select coalesce(sum(case when m.type = 'charge' then m.amount else -m.amount end), 0)
      into v_debt
    from public.movements m
    where m.client_id = new.client_id
      and m.currency is not distinct from new.currency
      and m.deleted_at is null;

    if new.amount - v_debt > 0.005 then
      perform public.ledger_refuse('movements', 'SZ001',
        'Ese abono es mayor que lo que te deben en ese libro.',
        format('abono %s sobre deuda %s en %s', new.amount, v_debt, coalesce(new.currency, 'COP')));
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists movements_guard_insert on public.movements;
-- Postgres fires same-event triggers in name order. On this table that is
-- `movements_autor_es_la_sesion` (177), then this one, then
-- `movements_transaction_code` (147), then `trg_set_movement_running_balance`
-- -- so the balance is computed with the date this trigger just fixed.
create trigger movements_guard_insert
  before insert on public.movements
  for each row execute function public.movements_guard_insert();

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Movements: update -- only the papelera flag may change
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.movements_guard_update()
returns trigger
language plpgsql
as $$
begin
  if not public.ledger_direct_write() then
    return new;
  end if;
  -- `running_balance` and `created_by` are 177's business: it restores them
  -- silently, and the recalc (running as the caller) must keep working.
  if (to_jsonb(new) - 'deleted_at' - 'running_balance' - 'created_by')
     is distinct from
     (to_jsonb(old) - 'deleted_at' - 'running_balance' - 'created_by') then
    perform public.ledger_refuse('movements', 'SZ002',
      'Una transacción no se puede editar. Bórrala y regístrala de nuevo.', 'id ' || old.id::text);
  end if;
  return new;
end;
$$;

drop trigger if exists movements_guard_update on public.movements;
create trigger movements_guard_update
  before update on public.movements
  for each row execute function public.movements_guard_update();

-- ───────────────────────────────────────────────────────────────────────────
-- 5. Hard deletes: only what was written in the last 10 minutes
-- ───────────────────────────────────────────────────────────────────────────
-- Shared by movements, sales, sale_lines and clients, all of which carry
-- `created_at`. `clients` is here because deleting a client cascades into
-- its movements -- those rows' own trigger would refuse anyway, but a client
-- without movements would still vanish, and the app only hard-deletes a
-- client it created seconds earlier and failed to finish (clients/nuevo,
-- productos/ordenes).
create or replace function public.ledger_guard_delete()
returns trigger
language plpgsql
as $$
begin
  if not public.ledger_direct_write() then
    return old;
  end if;
  if old.created_at < now() - interval '10 minutes' then
    perform public.ledger_refuse(tg_table_name::text, 'SZ003',
      'Eso no se puede borrar del todo. Mándalo a la papelera.', 'id ' || old.id::text || ' de ' || old.created_at::text);
  end if;
  return old;
end;
$$;

drop trigger if exists movements_guard_delete on public.movements;
create trigger movements_guard_delete
  before delete on public.movements
  for each row execute function public.ledger_guard_delete();

drop trigger if exists sales_guard_delete on public.sales;
create trigger sales_guard_delete
  before delete on public.sales
  for each row execute function public.ledger_guard_delete();

drop trigger if exists sale_lines_guard_delete on public.sale_lines;
create trigger sale_lines_guard_delete
  before delete on public.sale_lines
  for each row execute function public.ledger_guard_delete();

-- A client is different: its delete CASCADES into its movements, and a
-- cascade runs with the table owner's privileges, so the movements' own
-- trigger does not see it as a direct write. Found by `qa:ledger-console`
-- row 12 on 2026-11-02: a client created a minute ago whose fiado was an
-- hour old went, fiado included. So a client with any movement at all is
-- never hard-deleted from a session, whatever its age; the app only
-- hard-deletes a client it just created and could not give its first
-- movement (clients/nuevo, productos/ordenes).
create or replace function public.clients_guard_delete()
returns trigger
language plpgsql
as $$
begin
  if not public.ledger_direct_write() then
    return old;
  end if;
  if old.created_at < now() - interval '10 minutes'
     or exists (select 1 from public.movements m where m.client_id = old.id) then
    perform public.ledger_refuse('clients', 'SZ003',
      'Un cliente con transacciones no se puede borrar del todo. Mándalo a la papelera.', 'id ' || old.id::text);
  end if;
  return old;
end;
$$;

drop trigger if exists clients_guard_delete on public.clients;
create trigger clients_guard_delete
  before delete on public.clients
  for each row execute function public.clients_guard_delete();

-- `sale_payments` has no `created_at`: it borrows the sale's. In a cascade
-- from the sale's own delete the parent row is already gone when this runs,
-- and that is fine -- the parent passed its own check a moment ago.
create or replace function public.sale_payments_guard_delete()
returns trigger
language plpgsql
as $$
declare
  v_sale_created timestamptz;
begin
  if not public.ledger_direct_write() then
    return old;
  end if;
  select s.created_at into v_sale_created from public.sales s where s.id = old.sale_id;
  if found and v_sale_created < now() - interval '10 minutes' then
    perform public.ledger_refuse('sale_payments', 'SZ003',
      'Eso no se puede borrar del todo. Mándalo a la papelera.', 'venta ' || old.sale_id::text);
  end if;
  return old;
end;
$$;

drop trigger if exists sale_payments_guard_delete on public.sale_payments;
create trigger sale_payments_guard_delete
  before delete on public.sale_payments
  for each row execute function public.sale_payments_guard_delete();

-- ───────────────────────────────────────────────────────────────────────────
-- 6. A sale is written once
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.sales_guard_update()
returns trigger
language plpgsql
as $$
begin
  if not public.ledger_direct_write() then
    return new;
  end if;
  if (to_jsonb(new) - 'deleted_at') is distinct from (to_jsonb(old) - 'deleted_at') then
    perform public.ledger_refuse('sales', 'SZ002',
      'Una venta no se puede editar. Bórrala y regístrala de nuevo.', 'id ' || old.id::text);
  end if;
  return new;
end;
$$;

drop trigger if exists sales_guard_update on public.sales;
create trigger sales_guard_update
  before update on public.sales
  for each row execute function public.sales_guard_update();

-- Lines and payments: inserted only while the sale is being written, and
-- never edited afterwards. The parent lookup runs as the caller, so a sale
-- the session cannot see (someone else's) reads as "not found" and is refused
-- -- RLS already says so; this says it in words.
create or replace function public.sale_children_guard_insert()
returns trigger
language plpgsql
as $$
declare
  v_sale_created timestamptz;
begin
  if not public.ledger_direct_write() then
    return new;
  end if;
  select s.created_at into v_sale_created from public.sales s where s.id = new.sale_id;
  if not found or v_sale_created < now() - interval '10 minutes' then
    perform public.ledger_refuse(tg_table_name::text, 'SZ004',
      'A una venta ya registrada no se le puede añadir nada. Regístrala de nuevo.', 'venta ' || new.sale_id::text);
  end if;
  return new;
end;
$$;

create or replace function public.sale_children_guard_update()
returns trigger
language plpgsql
as $$
begin
  if not public.ledger_direct_write() then
    return new;
  end if;
  perform public.ledger_refuse(tg_table_name::text, 'SZ002',
    'Una venta no se puede editar. Bórrala y regístrala de nuevo.', 'venta ' || old.sale_id::text);
  return new;
end;
$$;

drop trigger if exists sale_lines_guard_insert on public.sale_lines;
create trigger sale_lines_guard_insert
  before insert on public.sale_lines
  for each row execute function public.sale_children_guard_insert();

drop trigger if exists sale_lines_guard_update on public.sale_lines;
create trigger sale_lines_guard_update
  before update on public.sale_lines
  for each row execute function public.sale_children_guard_update();

drop trigger if exists sale_payments_guard_insert on public.sale_payments;
create trigger sale_payments_guard_insert
  before insert on public.sale_payments
  for each row execute function public.sale_children_guard_insert();

drop trigger if exists sale_payments_guard_update on public.sale_payments;
create trigger sale_payments_guard_update
  before update on public.sale_payments
  for each row execute function public.sale_children_guard_update();

-- ───────────────────────────────────────────────────────────────────────────
-- Ledger
-- ───────────────────────────────────────────────────────────────────────────
insert into public.schema_migrations (key, description)
values (
  '180_el_libro_no_se_reescribe_por_consola',
  'Hallazgo 6 ampliado (2026-11-02): con la sesión del dueño escrita directo a las tablas (consola), un movimiento ya no se edita (solo papelera), la fecha la pone la base, un abono no pasa de la deuda del libro (con bloqueo por cliente para dos a la vez), no se borra del todo nada de más de 10 minutos, y una venta se escribe una sola vez. Nace en modo OBSERVAR (ledger_rules.enforce = false): cada rechazo se apunta en ledger_rule_hits y la escritura pasa; se enciende con un update cuando los apuntes digan que ningún flujo legítimo choca. Las funciones security definer (libreta, reparto) y los scripts de servicio quedan fuera por cómo están declarados. Errores SZ001-SZ005 con mensaje en cristiano.'
)
on conflict (key) do nothing;

-- Verification (read-only), to run right after:
--   select
--     (select count(*) from pg_trigger where tgname in (
--        'movements_guard_insert','movements_guard_update','movements_guard_delete',
--        'sales_guard_delete','sale_lines_guard_delete','clients_guard_delete',
--        'sale_payments_guard_delete','sales_guard_update','sale_lines_guard_insert',
--        'sale_lines_guard_update','sale_payments_guard_insert','sale_payments_guard_update')
--        and not tgisinternal) as reglas,
--     (select enforce from public.ledger_rules) as en_vigor,
--     has_table_privilege('authenticated', 'public.ledger_rules', 'update') as dueno_toca_interruptor,
--     exists (select 1 from schema_migrations where key = '180_el_libro_no_se_reescribe_por_consola') as apuntada;
--   -- reglas = 12, en_vigor = false (production, observing) / true (dev, after 181),
--   -- dueno_toca_interruptor = false, apuntada = true
--
-- Watching production while observing:
--   select at, table_name, rule, enforced, owner_id, detail
--   from public.ledger_rule_hits order by at desc limit 50;
--   -- zero rows from the app means the rules can be switched on:
--   update public.ledger_rules set enforce = true, updated_at = now() where id;
-- Kill switch, the other way round:
--   update public.ledger_rules set enforce = false, updated_at = now() where id;
