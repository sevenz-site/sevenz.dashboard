-- ENVIRONMENT: DEV ONLY (vzqppwrwnmlbrxizskdh). NEVER run this file against
-- production. In production its ledger key is registered as a no-op (see the
-- block at the end, which is the only part that runs there), so the
-- checklist's ledger comparison keeps meaning something -- the rule of
-- CLAUDE.md «Migraciones que solo existen en un entorno».
--
-- ===========================================================================
-- 181: A FAULT THE QA SUITE CAN PROVOKE HALFWAY THROUGH A SALE (dev only)
--
-- Asked for by the owner on 2026-11-02, with emphasis: «no olvides construir
-- la prueba para provocar el fallo a mitad de la venta». `registrarVenta`
-- writes a sale in four steps -- sale, lines, payments, then one fiado per
-- currency -- and undoes what it already wrote when a later step fails. That
-- undo is a hard delete, and migration 180 now refuses hard deletes of rows
-- older than 10 minutes. The undo path had never been exercised by any suite
-- (`CT-123`); with 180 in place, an untested undo is the one thing that could
-- leave a client owing a sale that "failed".
--
-- A suite cannot inject a failure from outside: it talks to the database
-- through the data API, which has no DDL. So the failure is a trigger that
-- lives only in dev and fires on a marker nobody would type: a payment or a
-- fiado whose description is exactly 'QA PROVOCAR FALLO'. `qa:sale-rollback`
-- sends that marker in the step it wants to break and then checks, in the
-- database, that nothing of the sale survived.
--
-- Why not ship the marker trigger to production too: it would be a magic
-- string in the money path of real shops, for the benefit of a dev suite. The
-- suite refuses to run against any project but dev anyway.

create or replace function public.qa_fault_on_marker()
returns trigger
language plpgsql
as $$
begin
  if new.description = 'QA PROVOCAR FALLO' then
    raise exception 'QA: fallo provocado en %', tg_table_name
      using errcode = 'SZ999';
  end if;
  return new;
end;
$$;

-- Named with a leading "zz" so it fires AFTER every real BEFORE INSERT
-- trigger on the same tables (Postgres fires same-event triggers in name
-- order): the real guards run first, exactly as in production, and the
-- provoked failure lands last.
drop trigger if exists zz_qa_fault_on_marker on public.movements;
create trigger zz_qa_fault_on_marker
  before insert on public.movements
  for each row execute function public.qa_fault_on_marker();

drop trigger if exists zz_qa_fault_on_marker on public.sale_payments;
create trigger zz_qa_fault_on_marker
  before insert on public.sale_payments
  for each row execute function public.qa_fault_on_marker();

-- And dev ENFORCES the rules of 180 from day one: production observes first,
-- dev is where the attacks have to be refused for `qa:ledger-console` and
-- `qa:attack` to mean anything. `qa:ledger-console` checks this switch as its
-- control 0.
update public.ledger_rules set enforce = true, updated_at = now() where id;

insert into public.schema_migrations (key, description)
values (
  '181_dev_fallo_provocado_para_qa',
  'DEV-ONLY: enciende las reglas de la 180 (ledger_rules.enforce = true) y un disparador que falla a propósito cuando un pago o un fiado llevan la descripción «QA PROVOCAR FALLO», para que qa:sale-rollback pruebe que una venta que falla a medias se deshace entera bajo la regla de los 10 minutos de la 180.'
)
on conflict (key) do nothing;

-- ===========================================================================
-- PRODUCTION: run ONLY this block, so the ledgers match. It installs nothing.
-- ===========================================================================
-- insert into public.schema_migrations (key, description)
-- values (
--   '181_dev_fallo_provocado_para_qa',
--   'DEV-ONLY, registrada aquí como no-op para que la comparación de ledgers del checklist siga significando algo. NUNCA ejecutar este archivo contra producción: instala un disparador que hace fallar a propósito pagos y fiados con una descripción marcada, solo para la suite qa:sale-rollback.'
-- )
-- on conflict (key) do nothing;
