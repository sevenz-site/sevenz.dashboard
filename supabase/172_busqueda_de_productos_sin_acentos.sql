-- ENVIRONMENT: run in DEV first (vzqppwrwnmlbrxizskdh). Production comes later,
-- with its own green light, and BEFORE the code that reads `name_search`.
-- Re-runnable: the extension, the column and the function are all created
-- «if not exists» / «or replace».
--
-- ===========================================================================
-- 172: PRODUCT SEARCH IGNORES ACCENTS, LIKE EVERY OTHER SEARCH BOX
--
-- The owner's request of 2026-10-31: «sin distinguir acentos, mayúsculas o
-- minúsculas, ejemplo: Sofía = Sofia = sofia = sofía», extended the same day to
-- every search box («pásalos todos»), and to this migration («sí, mete la
-- migración de unaccent en la fase C»).
--
-- WHY THE DATABASE, when every other box folds in the browser: these two
-- searches (picking a product in a sale, and the product picker of a fiado)
-- ask the database for the first 12 matches, so the browser never holds the
-- whole list to filter. `ilike` already ignores case; it does not ignore
-- accents, so «azucar» did not find «Azúcar» while selling.
--
-- HOW: a stored generated column, `name_search` = lower(unaccent(name)). The
-- code folds what the shopkeeper typed with `foldForSearch` and compares it to
-- this column. A generated column needs an IMMUTABLE function, and
-- `unaccent()` is only STABLE (its dictionary could change), so it is wrapped
-- with the dictionary named explicitly -- the standard way to make it
-- immutable. If the dictionary were ever edited, existing rows would keep the
-- old folding until their name is next written; for accent stripping that
-- dictionary does not change.
--
-- WORST CASE, and why it is covered: code shipped before this migration asks
-- for a column that does not exist, every product search returns nothing, and
-- a sale cannot find a single product. That is what the deploy order exists
-- for (migrations first), and the ledger row below is what the launch
-- checklist compares.
--
-- KNOWN DIFFERENCE from `foldForSearch`, accepted: unaccent also expands a few
-- ligatures («ß» -> «ss», «æ» -> «ae») that the browser's NFD does not. No
-- Spanish product name is affected.

begin;

create extension if not exists unaccent with schema extensions;

create or replace function public.unaccent_immutable(p_text text)
returns text
language sql
immutable
parallel safe
strict
set search_path = public, extensions
as $$
  select extensions.unaccent('extensions.unaccent'::regdictionary, p_text);
$$;

alter table public.products
  add column if not exists name_search text
  generated always as (lower(public.unaccent_immutable(name))) stored;

insert into public.schema_migrations (key, description)
values (
  '172_busqueda_de_productos_sin_acentos',
  'Fase C del 2026-10-31. Columna generada products.name_search = lower(unaccent(name)), para que buscar un producto al vender o al fiar ignore acentos como todos los demás buscadores («azucar» encuentra «Azúcar»). Activa la extensión unaccent en el esquema extensions. Tiene que correr ANTES que el código que lee name_search.'
)
on conflict (key) do nothing;

commit;
