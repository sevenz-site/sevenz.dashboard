-- ENVIRONMENT: run in DEV first (vzqppwrwnmlbrxizskdh). Production comes later, with its
-- own green light, and BEFORE the code that reads these columns (CLAUDE.md, deploy step
-- 1). Safe in that order: the columns are new and empty, and get_shared_catalog only ADDS
-- keys, so the code already live keeps reading exactly what it reads today.
-- Re-runnable: `add column if not exists`, constraints dropped by name before being
-- added, functions `create or replace` with unchanged signatures, `on conflict` on the
-- ledger.
--
-- ===========================================================================
-- 210: THE OWNER BRANDS HIS CATALOGUE (CT-170, phase 1: identity)
--
-- Owner's request of 2026-11-12: «Como dueño de negocio quiero customizar mi catálogo en
-- función de mi marca, información de negocio y productos». Phase 1, approved with its
-- frames that day («Sí apruebo fase 1», section `2115:21701`): a brand colour, a cover
-- image, a welcome message and, if he wants, the address. Built for v0.8.0 (first named v0.7.3), owner's
-- request of 2026-11-15.
--
-- THE COLUMNS, on `owners` because they are the business's own and the owner already
-- updates his row with his session (policy «owners update own row», grant in schema.sql):
--
--   brand_color          '#RRGGBB', the colour the catalogue USES. When the owner's pick
--                        cannot carry readable text, the app moves it the least it takes
--                        and stores the moved one (owner's decision: «ajustarlo y
--                        avisar»). The check only guards the format; the contrast is
--                        decided in `lib/catalog/brand-color.ts`, by the server action.
--   catalog_cover_path   the cover, in the `logos` bucket under the owner's folder: the
--                        same bucket, policies and size limit as the logo.
--   catalog_welcome      140 characters at most, plain text, no links (enforced in the
--                        action, `lib/catalog/welcome.ts`; the length here as well).
--   catalog_show_address OFF by default: «muchos negocios funcionan desde la casa del
--                        dueño». The address itself stays in `owners.address`.
--
-- ---------------------------------------------------------------------------
-- WORST CASES, AND WHERE EACH ONE IS CLOSED
--
--   - The nightly cleanup deletes any file in `logos` that no row names. A cover is named
--     by a NEW column, so 182/204/209 would have deleted every cover a week after upload,
--     silently: the catalogue just loses its cover. The two cleanup functions are
--     redefined below with the new column (copied from 209, one line added each).
--   - `get_shared_catalog` builds its answer key by key: a value it does not name does
--     not exist for the customer. The four new keys are added below.
--   - The address of a home business leaking: decided in SQL, not in the page.
-- ===========================================================================

begin;

alter table public.owners add column if not exists brand_color text;
alter table public.owners add column if not exists catalog_cover_path text;
alter table public.owners add column if not exists catalog_welcome text;
alter table public.owners add column if not exists catalog_show_address boolean not null default false;

alter table public.owners drop constraint if exists owners_brand_color_format;
alter table public.owners
  add constraint owners_brand_color_format check (brand_color is null or brand_color ~ '^#[0-9A-F]{6}$');

alter table public.owners drop constraint if exists owners_catalog_welcome_length;
alter table public.owners
  add constraint owners_catalog_welcome_length check (catalog_welcome is null or char_length(catalog_welcome) <= 140);

comment on column public.owners.brand_color is
  'CT-170. The colour the public catalogue uses, #RRGGBB, already adjusted for contrast by lib/catalog/brand-color.ts. Null: the catalogue looks as before (#272727). Migration 210.';
comment on column public.owners.catalog_cover_path is
  'CT-170. The catalogue cover, a path in the logos bucket under the owner''s folder. Known to the nightly cleanup since 210.';
comment on column public.owners.catalog_welcome is
  'CT-170. Welcome message of the public catalogue: plain text, no links, 140 characters at most.';
comment on column public.owners.catalog_show_address is
  'CT-170. Whether owners.address is shown in the public catalogue. Off by default: many businesses run from the owner''s home.';

-- ───────────────────────────────────────────────────────────────────────────
-- The customer's catalogue: 184's body, with the branding added.
-- ───────────────────────────────────────────────────────────────────────────
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
  -- NEW on 210 (CT-170): the owner's branding.
  v_brand_color text;
  v_cover_path text;
  v_welcome text;
  v_address text;
  v_show_address boolean;
begin
  select owner_id into v_owner_id
  from public.catalog_share_links
  where token = p_token;

  if not found then
    return null;
  end if;

  select business_name, logo_path, whatsapp, country, low_stock_threshold,
         brand_color, catalog_cover_path, catalog_welcome, address, catalog_show_address
    into v_business, v_logo_path, v_whatsapp, v_country, v_low_stock,
         v_brand_color, v_cover_path, v_welcome, v_address, v_show_address
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
    'custom_rate_eur', v_settings.custom_rate_eur,
    -- NEW on 210 (CT-170). The address travels ONLY when the owner ticked «Mostrar mi
    -- dirección en el catálogo»: the decision is taken here, server side, so a
    -- business run from the owner's home never sends it to the browser at all.
    'brand_color', v_brand_color,
    'catalog_cover_path', v_cover_path,
    'catalog_welcome', v_welcome,
    'catalog_address', case when coalesce(v_show_address, false) then nullif(btrim(v_address), '') end
  );
end;
$$;

revoke execute on function public.get_shared_catalog(text) from public;
grant execute on function public.get_shared_catalog(text) to anon, authenticated;

comment on function public.get_shared_catalog(text) is
  'The public catalogue behind a catalog_share_links token. Since 164 it also returns low_stock_threshold. Since 184 each product carries its category_id and the payload carries «categories». Since 210 (CT-170) it carries the owner''s branding: brand_color, catalog_cover_path, catalog_welcome, and catalog_address only when the owner chose to show it.';

-- ───────────────────────────────────────────────────────────────────────────
-- The nightly cleanup: 209's bodies, with the catalogue cover kept.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.storage_orphan_candidates(
  p_min_age interval,
  p_limit integer,
  p_scope_owner uuid default null
)
returns table (bucket_id text, name text, size_bytes bigint, file_created_at timestamptz)
language sql
stable
security definer
set search_path = public, storage
as $$
  select o.bucket_id, o.name, (o.metadata ->> 'size')::bigint, o.created_at
  from storage.objects o
  -- 209: the photo this file is the thumbnail of; the file's own name when it is not one.
  cross join lateral (select regexp_replace(o.name, '\.thumb\.jpg$', '') as photo) t
  where o.bucket_id in ('logos', 'product-photos')
    -- A negative interval would make every fresh upload "old enough".
    and o.created_at < now() - greatest(p_min_age, interval '0 seconds')
    and o.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$'
    and o.name not like '%/.emptyFolderPlaceholder'
    and (p_scope_owner is null or split_part(o.name, '/', 1) = p_scope_owner::text)
    and not exists (select 1 from public.owners w where w.logo_path in (o.name, t.photo))
    -- 210: the catalogue cover lives in `logos` too. Without this line every cover
    -- would be deleted a week after upload, with the cleanup turned on in production.
    and not exists (select 1 from public.owners w where w.catalog_cover_path in (o.name, t.photo))
    and not exists (select 1 from public.products p where p.photo_path in (o.name, t.photo))
    -- 204: photos 2 to 5. Without this line they would be deleted a week after upload.
    and not exists (select 1 from public.product_photos pp where pp.path in (o.name, t.photo))
  order by o.created_at
  limit greatest(1, least(coalesce(p_limit, 200), 1000));
$$;

revoke execute on function public.storage_orphan_candidates(interval, integer, uuid) from public, anon, authenticated;
grant execute on function public.storage_orphan_candidates(interval, integer, uuid) to service_role;

create or replace function public.storage_orphan_recheck(p_bucket text, p_names text[])
returns setof text
language sql
stable
security definer
set search_path = public, storage
as $$
  select n
  from unnest(p_names) as n
  cross join lateral (select regexp_replace(n, '\.thumb\.jpg$', '') as photo) t
  where p_bucket in ('logos', 'product-photos')
    and not exists (select 1 from public.owners w where w.logo_path in (n, t.photo))
    and not exists (select 1 from public.owners w where w.catalog_cover_path in (n, t.photo))
    and not exists (select 1 from public.products p where p.photo_path in (n, t.photo))
    and not exists (select 1 from public.product_photos pp where pp.path in (n, t.photo));
$$;

revoke execute on function public.storage_orphan_recheck(text, text[]) from public, anon, authenticated;
grant execute on function public.storage_orphan_recheck(text, text[]) to service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- get_catalog_brand: created by an earlier draft of this file, dropped by this one.
-- ───────────────────────────────────────────────────────────────────────────
-- A draft of 210 created a public function that handed the brand colour to every page under
-- /c/<token>, so the customer's buttons could take it. The owner then kept the buttons
-- black («mantengamos los botones en negro como ya están», 2026-11-15): only the header and
-- the selected chip take the colour, both on the catalogue page, which already gets it from
-- get_shared_catalog. A public function nobody calls is surface for nothing, so it goes. It
-- only ever existed in dev; in production this line drops nothing.
drop function if exists public.get_catalog_brand(text);

insert into public.schema_migrations (key, description)
values (
  '210_catalog_branding',
  'CT-170, fase 1 del catálogo personalizable: owners.brand_color (el color que usa el catálogo, ya ajustado para que el texto se lea), catalog_cover_path (la portada, en el bucket logos), catalog_welcome (bienvenida de 140 caracteres sin enlaces) y catalog_show_address (apagada de salida). get_shared_catalog devuelve la marca, y la dirección solo si el dueño la quiere mostrar; la limpieza nocturna conoce la portada para no borrarla.'
)
on conflict (key) do nothing;

commit;
