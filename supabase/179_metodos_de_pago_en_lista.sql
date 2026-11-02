-- ENVIRONMENT: run in DEV first (vzqppwrwnmlbrxizskdh). Production comes later,
-- with its own green light, and BEFORE the code that reads this table: the new
-- "Mi negocio" screen lists methods from here, so deploying it first would show
-- every owner an empty list while their old `payment_info` sits untouched.
-- Re-runnable: `if not exists` on the table, drop/create on every policy, and
-- the backfill guarded by this migration's own ledger row (see step 4).
--
-- ===========================================================================
-- 179: PAYMENT METHODS BECOME A LIST
--
-- Frame `1928:24764`, ordered by the owner on 2026-11-02: «Patrón para agregar
-- y gestionar métodos de pago». Until now an owner had ONE free-text field,
-- `owners.payment_info`, for every way he gets paid. The new screen shows one
-- card per method, each with Copiar / Editar / Eliminar, and the "Agregar"
-- dialog saves the method on its own the moment it closes -- the owner's
-- choice the same day («Al instante»), the way the logo and the WhatsApp
-- switch already save.
--
-- WHY A TABLE AND NOT AN ARRAY ON `owners`. Saving on its own means editing or
-- deleting ONE method by itself. With an array that is "replace element 2",
-- and element 2 is whatever was second when the screen loaded: two open tabs,
-- or a delete followed by an edit, and the wrong method gets overwritten. A row
-- with its own id cannot be confused with its neighbour.
--
-- WHAT CLIENTS SEE: NOTHING, still. `get_shared_balance` stopped returning
-- payment details in `043` (2026-09-07) because a stranger quoting the shop's
-- real payment handle next to a real balance is the raw material for
-- impersonating it. Asked again on 2026-11-02 and kept: «Siguen fuera». Owners
-- share a method by copying it into WhatsApp. No public function reads this
-- table, and none should without reopening that decision.
--
-- `owners.payment_info` IS LEFT IN PLACE, NOT DROPPED. It is copied here once
-- and the new code stops writing it, but the previous release still reads it:
-- rolling the code back (Vercel first, per CLAUDE.md) must find the owner's
-- text where that code expects it.

-- 1. The table.
create table if not exists public.owner_payment_methods (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owners(id) on delete cascade,
  -- Same 500-character ceiling the old single field had, now per method.
  -- Trimmed and non-empty, so a card never renders blank.
  body text not null check (char_length(btrim(body)) between 1 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists owner_payment_methods_owner_idx
  on public.owner_payment_methods (owner_id, created_at);

-- 2. Row-level security: each owner sees and touches only his own rows.
alter table public.owner_payment_methods enable row level security;

drop policy if exists owner_payment_methods_select on public.owner_payment_methods;
create policy owner_payment_methods_select on public.owner_payment_methods
  for select to authenticated using (owner_id = auth.uid());

drop policy if exists owner_payment_methods_insert on public.owner_payment_methods;
create policy owner_payment_methods_insert on public.owner_payment_methods
  for insert to authenticated with check (owner_id = auth.uid());

drop policy if exists owner_payment_methods_update on public.owner_payment_methods;
create policy owner_payment_methods_update on public.owner_payment_methods
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists owner_payment_methods_delete on public.owner_payment_methods;
create policy owner_payment_methods_delete on public.owner_payment_methods
  for delete to authenticated using (owner_id = auth.uid());

-- 3. Grants. The policies above are worth nothing without them: `108` wrote
-- correct policies on `catalog_orders`, granted nothing, and the Pedidos
-- screen said "no orders yet" with three in the table. Anonymous callers get
-- nothing at all -- a payment handle is exactly what `043` took away from them.
revoke all on public.owner_payment_methods from anon;
grant select, insert, update, delete on public.owner_payment_methods to authenticated;

-- 4. Backfill: every non-empty `payment_info` becomes that owner's first
-- method, verbatim (bold/italic markers included -- the cards render them).
--
-- Guarded by THIS migration's ledger row rather than by "owner has no methods
-- yet": an owner who deletes his only method and then sees it come back after
-- a re-run would read it as the app ignoring him. The ledger row is written in
-- step 5, in the same transaction, so the copy happens exactly once per
-- database.
do $$
begin
  if not exists (
    select 1 from public.schema_migrations where key = '179_metodos_de_pago_en_lista'
  ) then
    insert into public.owner_payment_methods (owner_id, body)
    select o.id, left(btrim(o.payment_info), 500)
    from public.owners o
    where nullif(btrim(o.payment_info), '') is not null
      and not exists (
        select 1 from public.owner_payment_methods m where m.owner_id = o.id
      );
  end if;
end $$;

-- 5. Ledger.
insert into public.schema_migrations (key, description)
values (
  '179_metodos_de_pago_en_lista',
  'Métodos de pago en lista (frame 1928:24764): tabla owner_payment_methods con RLS por dueño y grants a authenticated, sin acceso anónimo; copia una vez el payment_info de cada negocio como su primer método. payment_info se conserva para poder volver atrás.'
)
on conflict (key) do nothing;

-- Verification (read-only), to run right after:
--   select
--     (select relrowsecurity from pg_class where oid = 'public.owner_payment_methods'::regclass) as rls,
--     has_table_privilege('authenticated', 'public.owner_payment_methods', 'insert') as dueno_escribe,
--     has_table_privilege('anon', 'public.owner_payment_methods', 'select') as anonimo_lee,
--     (select count(*) from public.owners where nullif(btrim(payment_info), '') is not null) as con_texto_viejo,
--     (select count(distinct owner_id) from public.owner_payment_methods) as con_metodos,
--     exists (select 1 from public.schema_migrations where key = '179_metodos_de_pago_en_lista') as apuntada;
