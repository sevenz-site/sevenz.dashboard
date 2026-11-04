-- ENVIRONMENT: run in DEV first (vzqppwrwnmlbrxizskdh). Production comes later,
-- with its own green light, AFTER 188 and BEFORE the code (CLAUDE.md, deploy
-- step 1). Re-runnable: both functions are `create or replace` with the
-- signature they already have.
--
-- ===========================================================================
-- 189: A RETURN WHOSE SALDO WAS ALREADY SPENT CANNOT BE DELETED
--
-- B3 of the returns audit. Owner's decision of 2026-11-04: *«Me parece correcto
-- bloquear, al mencionar que se debe eliminar primero la venta, el aviso debe
-- incluir botón para redirigir a la venta que lo usó»*.
--
-- The case: Carla returns a $10 shirt and leaves it as saldo a favor, then pays
-- $10 shoes with that saldo. Deleting the return took the saldo away from under
-- the shoes: she owed $10 for something already paid, on the link she opens
-- herself, and a shirt left an inventory where it was sitting. There was a
-- warning, which is one distracted tap away from a false debt.
--
-- If the return never happened the debt would be right, and that case is still
-- reachable: delete the sale that spent the saldo first, then the return.
--
-- WHAT «SPENT» MEANS: the client cannot cover this return's saldo any more. It
-- is `get_client_credit`, not a look at the rows, so with two returns of $10 and
-- $10 spent, either can go: the other one still covers the shoes.
--
-- WHICH SALE IT NAMES: the queue settles the oldest charge first, so the oldest
-- charge after the return, with the ones marked as paid with saldo ahead. That
-- is the first thing to delete. With more than one, the button comes back with
-- the next.
--
-- NOT BLOCKED: a saldo that shrank with no charge after it, which takes deleting
-- an old abono. There is no sale to send anybody to, and blocking would leave
-- the return stuck for good.
-- ===========================================================================

begin;

-- Not `security definer`: read by the owner's page it stays under RLS, and a
-- return of someone else simply finds nothing.
create or replace function public.return_credit_spent_on(p_return_id uuid)
returns uuid
language sql
stable
as $$
  select m.id
  from public.sale_returns r
  join public.movements m
    on m.client_id = r.client_id
   and m.type = 'charge'
   and m.deleted_at is null
   and m.currency is not distinct from r.currency
   and m.created_at > r.created_at
  where r.id = p_return_id
    and r.deleted_at is null
    and r.to_credit > 0
    and coalesce((
      select max(g.credit)
      from public.get_client_credit(r.client_id) g
      where g.currency is not distinct from r.currency
    ), 0) < r.to_credit - 0.005
  order by m.paid_with_credit desc, m.created_at asc
  limit 1;
$$;

revoke all on function public.return_credit_spent_on(uuid) from public, anon;
grant execute on function public.return_credit_spent_on(uuid) to authenticated;

create or replace function public.eliminar_devolucion(p_movement_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_owner uuid := auth.uid();
  v_return public.sale_returns%rowtype;
  v_now timestamptz := now();
  v_stock numeric;
  v_removed numeric;
  v_spent_on uuid;
begin
  if v_owner is null then
    return jsonb_build_object('ok', false, 'code', 'sin_sesion');
  end if;
  if not public.owner_puede_escribir(v_owner) then
    return jsonb_build_object('ok', false, 'code', 'cuenta_pausada');
  end if;

  select r.* into v_return
  from public.sale_returns r
  join public.movements m on m.payment_group_id = r.id
  where m.id = p_movement_id
    and m.type = 'return'
    and r.owner_id = v_owner
    and r.deleted_at is null
  for update of r;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'no_encontrada');
  end if;

  perform pg_advisory_xact_lock(hashtext('movements:' || v_return.client_id::text));

  -- THE SALDO ALREADY PAID FOR SOMETHING. See the header.
  v_spent_on := public.return_credit_spent_on(v_return.id);
  if v_spent_on is not null then
    return jsonb_build_object('ok', false, 'code', 'saldo_usado', 'charge_id', v_spent_on);
  end if;

  update public.movements
     set deleted_at = v_now
   where payment_group_id = v_return.id
     and type = 'return'
     and deleted_at is null;

  update public.sale_returns set deleted_at = v_now where id = v_return.id;

  -- WHAT WENT ON THE SHELF COMES OFF IT, clamped: those units may have been
  -- sold again since, and a negative shelf means nothing. What really came off
  -- is written down, because that and not `stock_returned` is what a restore
  -- may put back. See 188's header.
  if v_return.stock_returned is not null and v_return.product_id is not null then
    select p.stock_opening into v_stock
    from public.products p where p.id = v_return.product_id for update;

    if v_stock is not null then
      v_removed := least(v_stock, v_return.stock_returned);
      update public.products
         set stock_opening = v_stock - v_removed,
             updated_at = now()
       where id = v_return.product_id;
      update public.sale_returns set stock_removed = v_removed where id = v_return.id;
    end if;
  end if;

  -- ONE NOTICE, like a split abono: the shopkeeper did one thing.
  insert into public.movement_deletions (movement_id, owner_id, client_id)
  select m.id, v_owner, v_return.client_id
  from public.movements m
  where m.payment_group_id = v_return.id
    and m.applies_to_movement_id is not distinct from v_return.charge_movement_id
  limit 1;

  perform public.recalc_client_running_balance(v_return.client_id);

  return jsonb_build_object('ok', true, 'client_id', v_return.client_id);
end;
$fn$;

insert into public.schema_migrations (key, description)
values (
  '189_saldo_usado_no_se_elimina',
  'Una devolucion cuyo saldo a favor ya se gasto no se elimina: primero la venta que lo uso.'
)
on conflict (key) do nothing;

commit;
