-- ENVIRONMENT: run in DEV first (vzqppwrwnmlbrxizskdh). Production (rabmiyqodnvnrwiartuj) comes
-- later, in its release window, with its own green light. Either order with the code is safe:
-- the code reads the column as it is, and only the switch's comments change with it.
-- Re-runnable: the default is set every time, the data step is guarded by
-- `applied_data_migrations`, and the ledger insert does nothing the second time.
--
-- ===========================================================================
-- 221: «TRABAJAR CON CÓDIGOS DE BARRAS» IS ON BY DEFAULT, FOR EVERYONE (CT-182)
--
-- Owner's request of 2026-11-26: «la card en mi negocio "Trabajar con código de barras" debe
-- estar activada por defecto, tanto a los que crean su cuenta como los que ya están usando
-- sevenz».
--
-- WHAT THIS DISPLACES. Migration 219 (2026-11-23) made the switch off by default, by the owner's
-- decision that day, so that a shopkeeper who does not work with codes saw the app exactly as
-- before. From now on every business sees the scan button above «Registrar» on the phone and the
-- code field on its products, and turns them off in Mi negocio if it does not want them. The
-- costs written in 219 and in `mobile-nav.tsx` now reach every owner: on Inicio the button sits
-- over part of the Pedidos card, and on the catalogue it covers share buttons of the right column.
--
-- TWO PARTS:
--   1. The column's default: a business created from now on starts with it on. The signup
--      trigger (`handle_new_user`) does not name the column, so the default is what applies.
--   2. Existing businesses: every row that is off is turned on, ONCE. Guarded by
--      `applied_data_migrations`, because an owner who turns it off after this runs must not be
--      turned on again by a re-run. That is the one way this file could undo an owner's choice.
--
-- THE EDGE IT ACCEPTS: the switch shipped on 2026-11-25 at 21:39. An owner who turned it on and
-- then off again between then and this migration is indistinguishable from one who never touched
-- it (nothing records the history), so it comes back on for them too. The owner's words are «los
-- que ya están usando sevenz», all of them. They can turn it off again in Mi negocio.
--
-- NO EXACT REVERSE, and that is deliberate: which rows were off before is not kept. Reverting the
-- default is `alter column barcodes_enabled set default false`; owners turn their own switch off.
-- The codes on products are untouched either way.
-- ===========================================================================

begin;

alter table public.owners
  alter column barcodes_enabled set default true;

do $$
declare
  turned_on integer;
begin
  if exists (select 1 from public.applied_data_migrations where key = '221_barcodes_on_by_default') then
    raise notice '221: existing businesses were already turned on in an earlier run; nothing to do.';
    return;
  end if;

  update public.owners set barcodes_enabled = true where barcodes_enabled = false;
  get diagnostics turned_on = row_count;
  raise notice '221: % businesses turned on.', turned_on;

  insert into public.applied_data_migrations (key) values ('221_barcodes_on_by_default');
end $$;

comment on column public.owners.barcodes_enabled is
  'Mi negocio › «Trabajar con códigos de barras». On by default since migration 221 (owner, 2026-11-26). Shows the scan button, the code field and the gun listener. The guard that keeps a gun burst out of money fields runs whatever this says. CT-182.';

insert into public.schema_migrations (key, description)
values (
  '221_barcodes_on_by_default',
  'Códigos de barras encendidos por defecto (pedido del dueño del 2026-11-26): el valor por defecto de owners.barcodes_enabled pasa a true, y todos los negocios que lo tenían apagado se encienden una sola vez, con guarda en applied_data_migrations para que una segunda corrida no vuelva a encender a quien lo apagó después.'
)
on conflict (key) do nothing;

commit;
