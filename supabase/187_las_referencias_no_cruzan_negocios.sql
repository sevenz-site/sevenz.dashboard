-- ENVIRONMENT: run in DEV first (vzqppwrwnmlbrxizskdh). Production comes later,
-- with its own green light. It does NOT depend on 185 or 186, so it can go to
-- production on its own and ahead of them: that is why it is a file of its own.
-- It can go before or after the code, which never writes what this refuses.
-- Re-runnable: functions are `create or replace`, triggers are dropped first.
--
-- ===========================================================================
-- 187: A ROW CANNOT POINT AT ANOTHER BUSINESS
--
-- Finding A1 of the returns audit of 2026-11-04. Measured in dev with an owner's
-- own session, writing straight to the tables the way the browser console can:
--
--   · A `movements` row of owner A with `sale_id` of owner B went through, and
--     A's client link then listed B's sale lines, names and prices included:
--     `get_shared_balance` is security definer and reads `sale_lines` by that id.
--     `registrar_devolucion` also accepted it, up to its last check.
--   · A sale of owner A on a client of owner B went through. B's client link
--     lists cash sales by `client_id`, so A could plant a purchase in it.
--   · An abono of A aimed at a fiado of B went through. It moved nothing and
--     showed nothing, but `applies_to_movement_id` is a loose reference that the
--     code itself says nothing enforces.
--
-- All three need a uuid of the victim. A sale's id reaches anyone with one of
-- B's client links, so it is a real leak and not a theoretical one. The hole
-- predates returns: migrations 124 and 139 opened it.
--
-- RLS DID NOT CATCH THIS, and it is worth saying why: the policies check the row
-- being written (`client_id` is A's own), not the row it points at. A foreign
-- key checks that the target exists, with no view of who owns it.
--
-- ALWAYS ON, AND ON EVERY ROLE. Unlike migration 180's rules this has no
-- observing mode: there is no legitimate flow that crosses businesses, and
-- every row in dev was already clean when this was written. The worst case the
-- owner worried about on 2026-11-02, a rule that stops every shop from selling,
-- would need a sale whose client belongs to someone else.
--
-- PRODUCTION: before running this there, run the read-only count at the bottom.
-- ===========================================================================

begin;

create or replace function public.movements_guard_references()
returns trigger
language plpgsql
as $$
begin
  if new.sale_id is not null and (tg_op = 'INSERT' or new.sale_id is distinct from old.sale_id) then
    if not exists (
      select 1
      from public.sales s
      join public.clients c on c.owner_id = s.owner_id
      where s.id = new.sale_id and c.id = new.client_id
    ) then
      raise exception using
        message = 'Esa venta no es de este negocio.', errcode = 'SZ012';
    end if;
  end if;

  if new.applies_to_movement_id is not null
     and (tg_op = 'INSERT' or new.applies_to_movement_id is distinct from old.applies_to_movement_id) then
    if not exists (
      select 1 from public.movements t
      where t.id = new.applies_to_movement_id and t.client_id = new.client_id
    ) then
      raise exception using
        message = 'Ese fiado no es de este cliente.', errcode = 'SZ012';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists movements_guard_references on public.movements;
create trigger movements_guard_references
  before insert or update on public.movements
  for each row execute function public.movements_guard_references();

create or replace function public.sales_guard_client()
returns trigger
language plpgsql
as $$
begin
  if new.client_id is not null
     and (tg_op = 'INSERT' or new.client_id is distinct from old.client_id or new.owner_id is distinct from old.owner_id) then
    if not exists (
      select 1 from public.clients c
      where c.id = new.client_id and c.owner_id = new.owner_id
    ) then
      raise exception using
        message = 'Ese cliente no es de este negocio.', errcode = 'SZ012';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists sales_guard_client on public.sales;
create trigger sales_guard_client
  before insert or update on public.sales
  for each row execute function public.sales_guard_client();

insert into public.schema_migrations (key, description)
values (
  '187_las_referencias_no_cruzan_negocios',
  'Un movimiento no puede apuntar a una venta de otro negocio ni a un fiado de otro cliente, y una venta no puede ir sobre un cliente de otro negocio.'
)
on conflict (key) do nothing;

commit;

-- READ-ONLY, to run BEFORE this file in production. All three must say 0: a row
-- that already crosses would mean someone used the hole.
--
--   select
--     (select count(*) from public.movements m
--        join public.clients c on c.id = m.client_id
--        join public.sales s on s.id = m.sale_id
--       where s.owner_id <> c.owner_id) as cargos_cruzados,
--     (select count(*) from public.sales s
--        join public.clients c on c.id = s.client_id
--       where s.owner_id <> c.owner_id) as ventas_cruzadas,
--     (select count(*) from public.movements m
--        join public.movements t on t.id = m.applies_to_movement_id
--       where t.client_id <> m.client_id) as abonos_cruzados;
