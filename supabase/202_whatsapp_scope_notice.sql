-- ENVIRONMENT: run in DEV first (vzqppwrwnmlbrxizskdh). Production comes later, with its
-- own green light, and BEFORE the code that reads it (CLAUDE.md, deploy step 1).
-- Re-runnable: `if not exists` on the column, `on conflict` on the ledger row.
--
-- ===========================================================================
-- 202: WHEN AN OWNER WAS TOLD THAT THE WEEKLY WHATSAPP CHANGED
--
-- With v0.6.0 the weekly message adds sales, products and orders. Owners who accepted the
-- old sentence («resumen semanal de cartera») are not asked again, owner's decision of
-- 2026-11-06: they are told once, in Inicio. This column is the «once». Null until the
-- notice is shown; it is written the moment it appears, so closing it with the X does not
-- bring it back.
--
-- No new grant: `authenticated` already updates its own `owners` row (the dialog that asks
-- for permission writes `whatsapp_prompt_last_at` the same way), and the row-level policy
-- keeps it to `id = auth.uid()`. The worst a forged value can do is hide a notice from the
-- owner who forged it.
-- ===========================================================================

begin;

alter table public.owners
  add column if not exists whatsapp_scope_notice_at timestamptz;

comment on column public.owners.whatsapp_scope_notice_at is
  'When the one-time notice «tu resumen semanal ahora incluye ventas y productos» was shown in Inicio (v0.6.0). Null until then.';

insert into public.schema_migrations (key, description)
values (
  '202_whatsapp_scope_notice',
  'owners.whatsapp_scope_notice_at: cuándo se le enseñó al dueño, una sola vez, el aviso de que su resumen semanal de WhatsApp ahora incluye ventas y productos (v0.6.0).'
)
on conflict (key) do nothing;

commit;
