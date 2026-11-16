-- ENVIRONMENT: run in DEV first (vzqppwrwnmlbrxizskdh). Production comes later, with its
-- own green light, after 210 and BEFORE the code that writes this column (CLAUDE.md, deploy
-- step 1). Safe in that order: the column is new and empty, and nothing that is live reads it.
-- Re-runnable: `add column if not exists`, the constraint dropped by name before being added,
-- `on conflict` on the ledger.
--
-- ===========================================================================
-- 211: THE OWNER DESCRIBES HIS BRAND (CT-170, phase 1, revised 2026-11-15)
--
-- Owner's decision of 2026-11-15, with frame `2163:955`: «Portada, color (no se aplica),
-- bienvenida, descripción de la marca (nuevo) y dirección». And on who reads it: «solo lo
-- ve el dueño, no lo ve el cliente, servirá para generación de creación de contenido de
-- marketing de la marca». Limits, his choice the same day: 500 characters, line breaks
-- allowed, no links (enforced in the action, `checkDescription` in `lib/catalog/welcome.ts`; the length here
-- as well).
--
-- THE COLUMN, on `owners` like the rest of the branding: the owner already updates his row
-- with his session (policy «owners update own row», grant in schema.sql).
--
-- WORST CASE, AND WHERE IT IS CLOSED: the description is the owner's private text, and the
-- catalogue is public. `get_shared_catalog` builds its answer key by key (210), so a column
-- it does not name never travels -- and this migration deliberately does not touch it.
-- `qa:catalogo-marca` checks that the key is absent from what a customer receives.
-- ===========================================================================

alter table public.owners add column if not exists brand_description text;

alter table public.owners drop constraint if exists owners_brand_description_length;
alter table public.owners
  add constraint owners_brand_description_length
  check (brand_description is null or char_length(brand_description) <= 500);

insert into public.schema_migrations (key, description)
values (
  '211_brand_description',
  'Descripción de la marca del dueño (hasta 500 caracteres), privada: no sale en el catálogo del cliente'
)
on conflict (key) do nothing;
