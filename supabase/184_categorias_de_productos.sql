-- ===========================================================================
-- 184 · PRODUCT CATEGORIES
--
-- Owner's request, 2026-11-03: under «Proveedor» in the create-product flow,
-- a way to create a category, assign it to a product, edit and delete the
-- ones created, show them as chips in the owner's catalogue AND the client's,
-- and filter the catalogue by the chip chosen. Asked before building:
--
--   · ONE category per product («Una sola»), so a column on `products` and
--     not a join table.
--   · Deleting a category with products leaves them WITHOUT a category
--     («Quedan sin categoría»); the products are never touched otherwise.
--   · The client's catalogue only shows categories that have at least one
--     published product («Solo con productos publicados»): a chip must never
--     lead a client to an empty grid.
--
-- ---------------------------------------------------------------------------
-- WHY THE FOREIGN KEY IS ON (owner_id, category_id)
--
-- A plain FK on `category_id` would let a product point at ANOTHER business's
-- category: the id is a uuid the browser sends, and RLS on `products` only
-- checks who owns the product. The composite key makes «a product's category
-- belongs to the same owner» a fact the database enforces, not a check one
-- server action remembers to do (CLAUDE.md asks for the explicit check too,
-- and the action has it; this is the second line).
--
-- `on delete set null (category_id)` — the column list matters: a bare
-- `set null` on a composite key would null `owner_id` as well and orphan the
-- product. It needs Postgres 15 or later.
-- ===========================================================================

create table if not exists public.product_categories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owners(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Trimmed and non-empty, at most 30 characters: a chip has to fit on a
  -- phone. The action trims first and says it in words; this is the guarantee.
  constraint product_categories_name_shape
    check (name = btrim(name) and char_length(name) between 1 and 30),
  -- The target of the composite foreign key below.
  constraint product_categories_owner_id_id unique (owner_id, id)
);

-- One «Bebidas» per business, whatever the case: two chips reading the same
-- word is a bug the owner would have to find by himself.
create unique index if not exists product_categories_owner_name_uniq
  on public.product_categories (owner_id, lower(name));

comment on table public.product_categories is
  'Categorías de producto de cada negocio (2026-11-03). Una por producto (products.category_id). Borrar una deja sus productos sin categoría.';

alter table public.product_categories enable row level security;

drop policy if exists "owners manage own product categories" on public.product_categories;
create policy "owners manage own product categories" on public.product_categories
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- The grant next to the policy (lesson of 108). Supabase grants ALL to anon by
-- default on a new table; the client's catalogue reads names only through
-- the security-definer get_shared_catalog below, never this table.
revoke all on public.product_categories from anon, authenticated;
grant select, insert, update, delete on public.product_categories to authenticated;

-- ---------------------------------------------------------------------------
-- THE PRODUCT'S CATEGORY

alter table public.products
  add column if not exists category_id uuid;

alter table public.products
  drop constraint if exists products_category_same_owner;
alter table public.products
  add constraint products_category_same_owner
  foreign key (owner_id, category_id)
  references public.product_categories (owner_id, id)
  on delete set null (category_id);

create index if not exists products_category_idx
  on public.products (category_id)
  where category_id is not null;

comment on column public.products.category_id is
  'La categoría del producto (184), o null. La llave foránea es (owner_id, category_id): un producto no puede apuntar a la categoría de otro negocio. Borrar la categoría lo deja en null.';

-- ---------------------------------------------------------------------------
-- THE CLIENT'S CATALOGUE: each product carries its category id, and the
-- payload carries the chips — only categories with a product that this very
-- query publishes, ordered by name.
--
-- `create or replace` and not drop + create: same name, same argument, same
-- `returns json`, so nothing about the signature changes (CLAUDE.md's rule is
-- about changing one). Everything below is 164's body verbatim except the
-- two marked additions.

create or replace function public.get_shared_catalog(p_token text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_business text;
  v_logo_path text;
  v_whatsapp text;
  v_country text;
  v_settings public.owner_exchange_settings%rowtype;
  v_bcv_usd numeric;
  v_bcv_eur numeric;
  v_products json;
  v_low_stock integer;
  -- NEW on 184.
  v_categories json;
begin
  select owner_id into v_owner_id
  from public.catalog_share_links
  where token = p_token;

  if not found then
    return null;
  end if;

  select business_name, logo_path, whatsapp, country, low_stock_threshold
    into v_business, v_logo_path, v_whatsapp, v_country, v_low_stock
  from public.owners
  where id = v_owner_id;

  select json_agg(
    json_build_object(
      'id', p.id,
      'name', p.name,
      'unit', p.unit,
      'photo_path', p.photo_path,
      'base_currency', pr.base,
      'currencies', public.product_catalog_currencies(p.id, pr.tier, pr.base),
      'stock', p.stock_opening,
      'price', pr.amount,
      'tier', pr.tier,
      'pinned', coalesce(ov.pinned, '{}'::json),
      -- NEW on 184.
      'category_id', p.category_id
    ) order by p.name asc
  )
  into v_products
  from public.products p
  join lateral (
    select c.tier, c.amount, c.base
    from (
      select 'retail'::text as tier, p.price_retail as amount,
             p.base_currency_retail as base, 1 as prioridad
      where p.published_retail and p.price_retail is not null
      union all
      select 'wholesale'::text, p.price_wholesale,
             p.base_currency_wholesale, 2
      where p.published_wholesale and p.price_wholesale is not null
    ) c
    order by c.prioridad asc
    limit 1
  ) pr on true
  left join lateral (
    select json_object_agg(o.currency, o.amount) as pinned
    from public.product_price_overrides o
    where o.product_id = p.id and o.tier = pr.tier
  ) ov on true
  where p.owner_id = v_owner_id
    and p.trashed_at is null
    and (p.published_retail or p.published_wholesale);

  -- NEW on 184: the chips. Same filter as the grid above (published in a tier
  -- that has a price, not in the bin), so a chip can never lead to an empty
  -- grid -- the owner's choice. Only id and name travel.
  select json_agg(json_build_object('id', c.id, 'name', c.name) order by lower(c.name))
    into v_categories
  from public.product_categories c
  where c.owner_id = v_owner_id
    and exists (
      select 1 from public.products p
      where p.category_id = c.id
        and p.owner_id = v_owner_id
        and p.trashed_at is null
        and ((p.published_retail and p.price_retail is not null)
          or (p.published_wholesale and p.price_wholesale is not null))
    );

  if v_country = 'VE' then
    select * into v_settings from public.owner_exchange_settings where owner_id = v_owner_id;
    select r.usd, r.eur into v_bcv_usd, v_bcv_eur from public.get_current_bcv_rate() r;
  end if;

  return json_build_object(
    'business_name', v_business,
    'owner_logo_path', v_logo_path,
    'owner_whatsapp', v_whatsapp,
    'owner_country', v_country,
    'low_stock_threshold', v_low_stock,
    'products', coalesce(v_products, '[]'::json),
    'categories', coalesce(v_categories, '[]'::json),
    'rate_mode', v_settings.rate_mode,
    'current_bcv_usd', v_bcv_usd,
    'current_bcv_eur', v_bcv_eur,
    'custom_rate_usd', v_settings.custom_rate_usd,
    'custom_rate_eur', v_settings.custom_rate_eur
  );
end;
$$;

revoke execute on function public.get_shared_catalog(text) from public;
grant execute on function public.get_shared_catalog(text) to anon, authenticated;

comment on function public.get_shared_catalog(text) is
  'The public catalogue behind a catalog_share_links token. Since 164 it also returns low_stock_threshold, the shop''s «avísame cuando queden N o menos», so a card can go amber with its count when a product is running low. Since 184 each product carries its category_id and the payload carries «categories»: only those with a published product, for the client''s filter chips.';

insert into public.schema_migrations (key, description)
values (
  '184_categorias_de_productos',
  'Categorías de producto: tabla product_categories (una por producto, products.category_id con llave (owner_id, category_id) para que no se cuele la de otro negocio; borrar deja el producto sin categoría) y get_shared_catalog devuelve la categoría de cada producto y los chips con productos publicados.'
)
on conflict (key) do nothing;
