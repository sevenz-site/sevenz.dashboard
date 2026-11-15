-- ENVIRONMENT: run in DEV first (vzqppwrwnmlbrxizskdh). Production comes later, with its
-- own green light.
-- Re-runnable: every check on `position` is dropped by lookup (the old one and, on a
-- second run, this file's own), then the new one is added; `on conflict` on the ledger.
--
-- ===========================================================================
-- 208: A PRODUCT TAKES UP TO TWO PHOTOS, NOT FIVE
--
-- Owner's request of 2026-11-15: «limitemos la carga de fotos a los productos solo a 2».
-- It was five from v0.6.0 (CT-171, migration 204).
--
-- The cover stays in `products.photo_path`, so two photos means ONE row here, at
-- position 1. Migration 204 allowed positions 1 to 4.
--
-- NOBODY'S PHOTOS ARE DELETED. A product saved with three, four or five photos keeps its
-- rows at positions 2 to 4: the new check is added NOT VALID, which makes Postgres enforce
-- it on every row written from now on and leave the existing ones alone. Trimming those
-- products is a decision for the owner, and it would be a different migration.
--
-- WHY THE DATABASE AND NOT ONLY THE SERVER ACTION. The shopkeeper's own session can
-- insert into this table directly (204 grants it, under RLS), so the action's cap can be
-- walked around with one request to the Data API. This check is the only thing that
-- request meets.
--
-- ---------------------------------------------------------------------------
-- ORDER IN PRODUCTION: THIS MIGRATION GOES AFTER THE CODE, NOT BEFORE IT.
--
-- That is the opposite of the standing rule (CLAUDE.md, deploy step 1), and for the
-- reason that rule gives: pick the order whose failure is the mild one.
--
--   - MIGRATION FIRST, OLD CODE STILL LIVE: the old save deletes every photo row of the
--     product and re-inserts them at positions 1 to 4 in one statement. With this check
--     in place that insert is refused whole, after the delete already ran. Any product
--     with three or more photos loses ALL its extra photos on its next save, even one that
--     only changed a price, and saving again fails the same way.
--   - CODE FIRST, OLD CHECK STILL LIVE: nothing breaks. The new save writes one row at
--     position 1 and never rewrites a product that is over the cap, and both are legal
--     under the old check too. The only gap is that, for those minutes, the database
--     still accepts positions 2 to 4 from a hand-written request.
--
-- So: code to `main`, then this file. The departure has to be approved by the owner at
-- launch like any other; it is written here so it is proposed before, not explained after.
-- ===========================================================================

begin;

do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.product_photos'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%position%'
  loop
    execute format('alter table public.product_photos drop constraint %I', c.conname);
  end loop;
end $$;

-- NOT VALID: checked on every insert and update from here on, never against the rows
-- that already exist. Do not `validate constraint` this: it would fail on every product
-- that kept more than two photos, and "fixing" that failure means deleting their rows.
alter table public.product_photos
  add constraint product_photos_position_cap check (position = 1) not valid;

comment on table public.product_photos is
  'The second photo of a product (position 1); the cover stays in products.photo_path. Two photos per product since 2026-11-15 (migration 208). Products saved before that may keep rows at positions 2-4 (cap of five, CT-171, v0.6.0): the check is NOT VALID on purpose.';

comment on function public.get_shared_product_photos(text, uuid) is
  'Extra photos of a product in the public catalogue, in order: one since the cap of two (migration 208), up to four on a product saved before it. Empty unless get_shared_product would show the product. CT-171.';

insert into public.schema_migrations (key, description)
values (
  '208_product_photos_cap_two',
  'Un producto lleva hasta 2 fotos, no 5 (pedido del dueño del 2026-11-15): la tabla product_photos solo acepta filas nuevas en la posición 1. No borra fotos de nadie: los productos que ya tenían 3, 4 o 5 conservan sus filas (la regla es NOT VALID a propósito). En producción va DESPUÉS del código, no antes.'
)
on conflict (key) do nothing;

commit;
