-- ENVIRONMENT: DEV ONLY (vzqppwrwnmlbrxizskdh). NEVER run this in production
-- (rabmiyqodnvnrwiartuj): 196 never reached it, so there is nothing there to remove.
-- Production registers both keys as no-ops, see the end of this file.
-- Re-runnable: every statement is `if exists`, and the ledger row is `on conflict do nothing`.
--
-- ===========================================================================
-- 197: THE COST OF A LINE ALREADY SOLD IS NOT CORRECTED. 196 COMES OUT
--
-- Owner's decision of 2026-11-06, the same day 196 was written: *«la quitamos, cierra CT-168
-- como decidido no hacer»*. His reason: *«debería mantenerse el costo con el que se agregó el
-- producto»*. It displaces his *«Vamos con A, acotada como propones»* of a few hours earlier.
--
-- WHAT THIS ACCEPTS. A cost mistyped and sold stays wrong on that line for good, and only in
-- Reportes: no balance, no charge and nothing the client sees depends on it. Nobody had
-- reported the case; it was left written in `CT-168` by the release that froze the cost.
--
-- WHY IT CAME OUT. A table, a function, a trigger, eight frames and two screens for a rare
-- typo in one report, and it opened a way for a stolen session to rewrite past margins.
--
-- `sale_lines.unit_cost` itself STAYS: that is 194, in production, and it is the decision
-- this one protects. Only the door to edit it afterwards goes. Dropping the trigger leaves
-- the column guarded as it was before 196: the rules of 180 and 188, and no screen writes it.
--
-- 196 STAYS IN THE REPO so that its ledger key keeps pointing at a file.

begin;

drop trigger if exists sale_lines_guard_cost on public.sale_lines;
drop function if exists public.sale_lines_guard_cost();
drop function if exists public.correct_sale_line_cost(uuid, numeric);
drop table if exists public.sale_line_cost_changes;

insert into public.schema_migrations (key, description)
values (
  '197_remove_sale_line_cost_correction',
  'DEV-ONLY: quita lo que creó la 196 (correct_sale_line_cost, sale_line_cost_changes y el candado sale_lines_guard_cost). CT-168 se cerró como decidido no hacer el 2026-11-06. sale_lines.unit_cost se queda: es la 194.'
)
on conflict (key) do nothing;

commit;

-- ── verification, after running the above ──────────────────────────────────
--   select
--     (select count(*) from pg_proc where proname in ('correct_sale_line_cost', 'sale_lines_guard_cost')) as funciones,   -- 0
--     (select count(*) from pg_trigger where tgname = 'sale_lines_guard_cost') as candado,                                -- 0
--     to_regclass('public.sale_line_cost_changes') as tabla,                                                               -- null
--     (select count(*) from information_schema.columns
--       where table_schema = 'public' and table_name = 'sale_lines' and column_name = 'unit_cost') as unit_cost_sigue;    -- 1
--
-- ── production, at the next release, NOT before ─────────────────────────────
-- Two rows so the ledger comparison of `qa-regression-checklist` keeps meaning something
-- (CLAUDE.md, «Migraciones que solo existen en un entorno»). Neither file runs there.
--
--   insert into public.schema_migrations (key, description)
--   values
--     ('196_correct_sale_line_cost',
--      'DEV-ONLY, registrada aquí como no-op para que la comparación de ledgers del checklist siga significando algo. NUNCA ejecutar este archivo contra producción: la corrección de costos se descartó el 2026-11-06 (CT-168) y nunca salió de dev.'),
--     ('197_remove_sale_line_cost_correction',
--      'DEV-ONLY, registrada aquí como no-op para que la comparación de ledgers del checklist siga significando algo. NUNCA ejecutar este archivo contra producción: quita de dev lo que creó la 196, que aquí nunca existió.')
--   on conflict (key) do nothing;
