-- ENVIRONMENT: run in DEV first (vzqppwrwnmlbrxizskdh). Production comes later, with its
-- own green light, and BEFORE the code that reads these columns (CLAUDE.md, deploy step
-- 1). Safe in that order: the columns are new, the WhatsApp box is OFF for everyone, and
-- get_shared_catalog only ADDS keys, so the code already live keeps reading what it reads.
-- Re-runnable: `add column if not exists`, constraints dropped by name before being added,
-- the function `create or replace` with an unchanged signature, `on conflict` on the ledger.
--
-- ===========================================================================
-- 225: «CONTACTAR VÍA WHATSAPP» AND ONE EXTRA LINK IN THE CUSTOMER'S CATALOGUE
--
-- Owner's request of 2026-11-26: «en el catálogo en la vista del cliente agrega botones
-- "Contactar vía WhatsApp + ícono WhatsApp" y en la sección de personalizar catálogo agrega
-- checkbox para que dueño decida si mostrar botón para ser contactado vía WhatsApp en el
-- catálogo. También agrega input para agregar 1 URL adicional y ser mostrada en la vista
-- principal del catálogo». Frames approved the same day («Sí, constrúyelo»), section
-- `2291:25034`. His answers that day: only in the catalogue's header; the box OFF by
-- default; the link's text is chosen from a list (Sitio web, Instagram, Facebook, TikTok)
-- with its icon; WhatsApp opens with a greeting already written.
--
-- THE COLUMNS, on `owners` like the rest of the catalogue's branding (210): the owner
-- already updates his row with his session (policy «owners update own row»).
--
--   catalog_show_whatsapp  OFF by default. On 2026-10-15 the owner had removed a WhatsApp
--                          button from this page (the customer came from the business's
--                          own chat, and the number sat in a public page); it comes back
--                          as each owner's choice, so nobody's number appears unasked.
--   catalog_link_kind      'website' | 'instagram' | 'facebook' | 'tiktok'. Stored in
--                          English (CLAUDE.md: stored values outlive the code); the label
--                          the customer reads is decided by the app, never typed.
--   catalog_link_url       https only, 300 characters at most. The rule that a link
--                          labelled «Instagram» really goes to instagram.com lives in
--                          `lib/catalog/extra-link.ts`, checked by the server action and
--                          again when the page draws it; here only what SQL can say.
--
-- ---------------------------------------------------------------------------
-- WORST CASES, AND WHERE EACH ONE IS CLOSED
--
--   - A link used for a scam from Sevenz's domain (the reason the welcome takes no links,
--     owner's decision of 2026-11-12): a fixed label means the customer cannot see where
--     the button goes, so the host must match the label, shorteners are refused, and the
--     page re-checks before drawing (an old or hand-edited row draws nothing).
--   - `get_shared_catalog` builds its answer key by key: the three keys are added below.
--     The number itself already travelled (`owner_whatsapp`, used by the cart), so the box
--     does not change what the browser receives; it changes what the page draws.
--   - Kind and URL out of step (a label with no link, a link with no label): refused here.
-- ===========================================================================

begin;

alter table public.owners add column if not exists catalog_show_whatsapp boolean not null default false;
alter table public.owners add column if not exists catalog_link_kind text;
alter table public.owners add column if not exists catalog_link_url text;

alter table public.owners drop constraint if exists owners_catalog_link_kind_values;
alter table public.owners
  add constraint owners_catalog_link_kind_values
  check (catalog_link_kind is null or catalog_link_kind in ('website', 'instagram', 'facebook', 'tiktok'));

alter table public.owners drop constraint if exists owners_catalog_link_url_format;
alter table public.owners
  add constraint owners_catalog_link_url_format
  check (catalog_link_url is null or (catalog_link_url ~ '^https://\S+$' and char_length(catalog_link_url) <= 300));

alter table public.owners drop constraint if exists owners_catalog_link_pair;
alter table public.owners
  add constraint owners_catalog_link_pair
  check ((catalog_link_kind is null) = (catalog_link_url is null));

comment on column public.owners.catalog_show_whatsapp is
  'Whether the public catalogue draws «Contactar vía WhatsApp» with owners.whatsapp. Off by default. Migration 225.';
comment on column public.owners.catalog_link_kind is
  'The extra link''s label in the public catalogue: website, instagram, facebook or tiktok. Set together with catalog_link_url. Migration 225.';
comment on column public.owners.catalog_link_url is
  'The extra link of the public catalogue, https only. Its host is checked against catalog_link_kind by lib/catalog/extra-link.ts. Migration 225.';

-- ───────────────────────────────────────────────────────────────────────────
-- The customer's catalogue: 210's body, with the three keys added.
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
  -- NEW on 225: the WhatsApp button and the extra link.
  v_show_whatsapp boolean;
  v_link_kind text;
  v_link_url text;
begin
  select owner_id into v_owner_id
  from public.catalog_share_links
  where token = p_token;

  if not found then
    return null;
  end if;

  select business_name, logo_path, whatsapp, country, low_stock_threshold,
         brand_color, catalog_cover_path, catalog_welcome, address, catalog_show_address,
         catalog_show_whatsapp, catalog_link_kind, catalog_link_url
    into v_business, v_logo_path, v_whatsapp, v_country, v_low_stock,
         v_brand_color, v_cover_path, v_welcome, v_address, v_show_address,
         v_show_whatsapp, v_link_kind, v_link_url
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
    'catalog_address', case when coalesce(v_show_address, false) then nullif(btrim(v_address), '') end,
    -- NEW on 225. The link travels only as a pair, so the page never gets a label
    -- without a destination.
    'catalog_show_whatsapp', coalesce(v_show_whatsapp, false),
    'catalog_link_kind', case when v_link_url is not null then v_link_kind end,
    'catalog_link_url', case when v_link_kind is not null then v_link_url end
  );
end;
$$;

revoke execute on function public.get_shared_catalog(text) from public;
grant execute on function public.get_shared_catalog(text) to anon, authenticated;

comment on function public.get_shared_catalog(text) is
  'The public catalogue behind a catalog_share_links token. Since 164 it also returns low_stock_threshold. Since 184 each product carries its category_id and the payload carries «categories». Since 210 (CT-170) it carries the owner''s branding: brand_color, catalog_cover_path, catalog_welcome, and catalog_address only when the owner chose to show it. Since 225 it carries catalog_show_whatsapp and the extra link (catalog_link_kind, catalog_link_url), only as a pair.';

insert into public.schema_migrations (key, description)
values (
  '225_catalog_contact_and_link',
  'Catálogo del cliente: owners.catalog_show_whatsapp (botón «Contactar vía WhatsApp», apagado de salida) y un enlace adicional (catalog_link_kind: website, instagram, facebook o tiktok; catalog_link_url: solo https, hasta 300 caracteres, los dos juntos o ninguno). get_shared_catalog los devuelve.'
)
on conflict (key) do nothing;

commit;
