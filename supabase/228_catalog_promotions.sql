-- ENVIRONMENT: run in DEV first (vzqppwrwnmlbrxizskdh). Production comes later, with its
-- own green light, and BEFORE the code that reads these tables (CLAUDE.md, deploy step 1).
-- Safe in that order: the tables are new and empty, catalog_order_items only gains nullable
-- columns, and create_catalog_order_core keeps its signature: with no promotion it stores
-- exactly what it stored before, plus three nulls.
-- Re-runnable: `if not exists` everywhere, constraints and policies dropped by name before
-- being created, functions `create or replace` with unchanged signatures (the new ones are
-- new names), `on conflict` on the ledger.
--
-- ===========================================================================
-- 228: PROMOTIONS IN THE CATALOGUE (CT-184, part 1: the promotion and its prices)
--
-- Owner's request of 2026-11-27: «la funcionalidad de catálogo debe permitir a los dueños
-- configurar promociones por ejemplo blackfriday (…) fecha de inicio, fecha de cierre, fecha
-- extendida, porcentaje de descuento (uno o varios porcentajes), selección global de todos
-- los productos a ese porcentaje o selección en lote de varios productos y excluir otros,
-- código de descuento global para la promoción, agregar banner». Frames approved that day
-- (section `2300:21627`). His decisions, all in CT-184 of ../docs/PENDIENTES.md:
--
--   - ONE % PER GROUP of products; a group is «all products» (minus exclusions) or a chosen
--     list, and a product is in one group only.
--   - The EXTENDED DATE is an optional second end: past the close the promotion goes on.
--   - ONLY ONE PROMOTION AT A TIME in a business: dates (extension included) cannot cross.
--   - Below cost: a warning in the owner's screen, never a block.
--   - WHOLESALE: the owner decides per promotion (`includes_wholesale`, off by default).
--   - Prices PINNED BY HAND in bolívares are discounted like the rest.
--   - It discounts ONLY catalogue orders, never the sale the owner registers by hand.
--   - The code (part 2, a later migration) is stored here already so the owner's screen can
--     save it; nothing reads it until part 2 ships with the sale-level discount.
--
-- WHERE THE PRICE IS DECIDED: here, in SQL, never in the browser. create_catalog_order_core
-- already recomputed every price from `products` (PADLOCK 5); it now also applies the active
-- promotion and STORES the price before it (`list_price`) and the % (`promo_percent`) on each
-- line, so the sale can keep them (owner's decisions «El rebajado» and «2 rebajados y 1
-- normal») and Reportes computes profit on what was really charged.
--
-- THE DAY IS THE BUSINESS'S DAY: a promotion «del 28 al 30 nov» starts at 00:00 and ends at
-- 23:59 in Caracas or Bogotá, the same rule as `zonaDelNegocio` in lib/format.ts.
--
-- ---------------------------------------------------------------------------
-- WORST CASES, AND WHERE EACH ONE IS CLOSED
--
--   - The browser sending a discounted price: impossible, the price never travels (as before).
--   - Two promotions on the same day: the trigger refuses it, with an advisory lock per owner
--     so two tabs saving at once cannot both pass the check.
--   - A product of another business slipped into a group: the items trigger refuses it.
--   - The banner deleted by the nightly cleanup: the two cleanup functions learn the column.
--   - A rounding that differs between the cart and the stored order: same rule on both sides
--     (2 decimals, 4 in bolívares), and `qa:promociones` compares them to the cent.
-- ===========================================================================

begin;

-- ── 1. The tables ─────────────────────────────────────────────────────────
create table if not exists public.promotions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owners(id) on delete cascade,
  name text not null,
  banner_path text,
  starts_on date not null,
  ends_on date not null,
  -- The optional extension: past `ends_on` the promotion goes on until this day.
  extended_until date,
  includes_wholesale boolean not null default false,
  -- Part 2. Stored upper-case; matched case-insensitively.
  code text,
  code_percent numeric(5,2),
  code_max_uses integer,
  -- «Terminar ahora»: the promotion stops at this moment, whatever its dates said.
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint promotions_owner_id_id unique (owner_id, id)
);

alter table public.promotions drop constraint if exists promotions_name_shape;
alter table public.promotions
  add constraint promotions_name_shape check (char_length(btrim(name)) between 1 and 60);
alter table public.promotions drop constraint if exists promotions_dates;
alter table public.promotions
  add constraint promotions_dates check (
    starts_on <= ends_on
    and (extended_until is null or extended_until > ends_on)
    and ends_on - starts_on <= 366
  );
alter table public.promotions drop constraint if exists promotions_code_shape;
alter table public.promotions
  add constraint promotions_code_shape check (
    (code is null and code_percent is null and code_max_uses is null)
    or (code ~ '^[A-Z0-9]{3,20}$' and code_percent > 0 and code_percent <= 90
        and (code_max_uses is null or code_max_uses between 1 and 1000000))
  );

create index if not exists promotions_owner_dates_idx on public.promotions (owner_id, starts_on);

create table if not exists public.promotion_groups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  promotion_id uuid not null,
  percent numeric(5,2) not null,
  -- «Todos los productos»: every product not in another group of this promotion, minus the
  -- ones excluded from this group. At most one such group per promotion.
  all_products boolean not null default false,
  position smallint not null default 0,
  constraint promotion_groups_promotion_fk foreign key (owner_id, promotion_id)
    references public.promotions (owner_id, id) on delete cascade
);
alter table public.promotion_groups drop constraint if exists promotion_groups_percent;
alter table public.promotion_groups
  add constraint promotion_groups_percent check (percent > 0 and percent <= 90);
create unique index if not exists promotion_groups_one_all
  on public.promotion_groups (promotion_id) where all_products;
create index if not exists promotion_groups_promotion_idx on public.promotion_groups (promotion_id);

create table if not exists public.promotion_group_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  promotion_id uuid not null,
  group_id uuid not null references public.promotion_groups(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  -- 'include' for a chosen group; 'exclude' only for the «all products» group.
  kind text not null,
  constraint promotion_group_items_promotion_fk foreign key (owner_id, promotion_id)
    references public.promotions (owner_id, id) on delete cascade
);
alter table public.promotion_group_items drop constraint if exists promotion_group_items_kind;
alter table public.promotion_group_items
  add constraint promotion_group_items_kind check (kind in ('include', 'exclude'));
-- A product is in ONE chosen group of a promotion (owner's decision).
create unique index if not exists promotion_group_items_one_include
  on public.promotion_group_items (promotion_id, product_id) where kind = 'include';
create unique index if not exists promotion_group_items_one_row
  on public.promotion_group_items (group_id, product_id);
create index if not exists promotion_group_items_product_idx on public.promotion_group_items (product_id);

comment on table public.promotions is
  'CT-184. A catalogue promotion: dates (business day), optional extension, a % per group of products, optional code (part 2). One at a time per business. Migration 228.';

-- ── 2. The business day, and a promotion''s real end ───────────────────────
create or replace function public.business_today(p_owner uuid)
returns date
language sql
stable
security definer
set search_path = public
as $$
  select (now() at time zone case when o.country = 'VE' then 'America/Caracas' else 'America/Bogota' end)::date
  from public.owners o where o.id = p_owner;
$$;
revoke execute on function public.business_today(uuid) from public, anon, authenticated;

-- The last day it is on: the extension if any, cut short by «Terminar ahora».
create or replace function public.promotion_last_day(pr public.promotions)
returns date
language sql
stable
security definer
set search_path = public
as $$
  select case
    when pr.ended_at is null then coalesce(pr.extended_until, pr.ends_on)
    else least(
      coalesce(pr.extended_until, pr.ends_on),
      -- Ended on a day = that day no longer counts.
      (pr.ended_at at time zone case when o.country = 'VE' then 'America/Caracas' else 'America/Bogota' end)::date - 1
    )
  end
  from public.owners o where o.id = pr.owner_id;
$$;
revoke execute on function public.promotion_last_day(public.promotions) from public, anon, authenticated;

-- ── 3. One promotion at a time ────────────────────────────────────────────
create or replace function public.promotions_no_overlap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last date;
begin
  -- Two tabs saving at once must not both pass the check.
  perform pg_advisory_xact_lock(hashtext('promotions:' || new.owner_id::text));
  v_last := public.promotion_last_day(new);
  if v_last < new.starts_on then
    return new; -- ended before it started: it occupies no day
  end if;
  if exists (
    select 1 from public.promotions o
    where o.owner_id = new.owner_id
      and o.id <> new.id
      and public.promotion_last_day(o) >= o.starts_on
      and o.starts_on <= v_last
      and public.promotion_last_day(o) >= new.starts_on
  ) then
    raise exception 'promocion_cruzada' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists promotions_no_overlap on public.promotions;
create trigger promotions_no_overlap
  before insert or update on public.promotions
  for each row execute function public.promotions_no_overlap();

-- A product in a group must be the business's own.
create or replace function public.promotion_items_own_product()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.products p where p.id = new.product_id and p.owner_id = new.owner_id) then
    raise exception 'producto_ajeno' using errcode = 'P0001';
  end if;
  if new.kind = 'exclude' and not exists (
    select 1 from public.promotion_groups g where g.id = new.group_id and g.all_products
  ) then
    raise exception 'exclusion_sin_todos' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists promotion_items_own_product on public.promotion_group_items;
create trigger promotion_items_own_product
  before insert or update on public.promotion_group_items
  for each row execute function public.promotion_items_own_product();

-- ── 4. RLS: the owner reads and writes his own; the customer never reads these tables ──
alter table public.promotions enable row level security;
alter table public.promotion_groups enable row level security;
alter table public.promotion_group_items enable row level security;

do $$
declare t text;
begin
  foreach t in array array['promotions', 'promotion_groups', 'promotion_group_items'] loop
    execute format('drop policy if exists "owners read own %1$s" on public.%1$s', t);
    execute format('drop policy if exists "owners insert own %1$s" on public.%1$s', t);
    execute format('drop policy if exists "owners update own %1$s" on public.%1$s', t);
    execute format('drop policy if exists "owners delete own %1$s" on public.%1$s', t);
    execute format('create policy "owners read own %1$s" on public.%1$s for select using (owner_id = auth.uid())', t);
    execute format('create policy "owners insert own %1$s" on public.%1$s for insert with check (owner_id = auth.uid() and public.owner_puede_escribir(auth.uid()))', t);
    execute format('create policy "owners update own %1$s" on public.%1$s for update using (owner_id = auth.uid() and public.owner_puede_escribir(auth.uid())) with check (owner_id = auth.uid() and public.owner_puede_escribir(auth.uid()))', t);
    execute format('create policy "owners delete own %1$s" on public.%1$s for delete using (owner_id = auth.uid() and public.owner_puede_escribir(auth.uid()))', t);
    execute format('revoke all on public.%1$s from anon', t);
    execute format('grant select, insert, update, delete on public.%1$s to authenticated', t);
  end loop;
end $$;

-- ── 5. The active promotion, and a product's % in it ──────────────────────
create or replace function public.active_promotion(p_owner uuid)
returns public.promotions
language sql
stable
security definer
set search_path = public
as $$
  select pr.* from public.promotions pr
  where pr.owner_id = p_owner
    and pr.starts_on <= public.business_today(p_owner)
    and public.promotion_last_day(pr) >= public.business_today(p_owner)
  order by pr.starts_on desc
  limit 1;
$$;
revoke execute on function public.active_promotion(uuid) from public, anon, authenticated;

-- The % for a product in a promotion and tier, or null. A chosen group wins over «all».
create or replace function public.promotion_percent(p_promotion uuid, p_product uuid, p_tier text)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select g.percent from public.promotion_group_items i
       join public.promotion_groups g on g.id = i.group_id
      where i.promotion_id = p_promotion and i.product_id = p_product and i.kind = 'include'
      limit 1),
    (select g.percent from public.promotion_groups g
      where g.promotion_id = p_promotion and g.all_products
        and not exists (select 1 from public.promotion_group_items x
                         where x.group_id = g.id and x.product_id = p_product and x.kind = 'exclude'))
  )
  from public.promotions pr
  where pr.id = p_promotion
    and (p_tier = 'retail' or pr.includes_wholesale);
$$;
revoke execute on function public.promotion_percent(uuid, uuid, text) from public, anon, authenticated;

-- ── 6. What the customer reads: the active promotion behind a catalogue link ──
-- Its own function so the three catalogue readers (get_shared_catalog, _product, _products)
-- did not have to be rewritten. Only what the screen needs: no code, no counts.
create or replace function public.get_shared_promotion(p_token text)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  pr public.promotions;
  v_today date;
  v_percents json;
begin
  select owner_id into v_owner from public.catalog_share_links where token = p_token;
  if v_owner is null then return null; end if;
  pr := public.active_promotion(v_owner);
  if pr.id is null then return null; end if;
  v_today := public.business_today(v_owner);

  select json_object_agg(p.id, pct) into v_percents
  from (
    select p.id, public.promotion_percent(pr.id, p.id, 'retail') as pct
    from public.products p
    where p.owner_id = v_owner and p.trashed_at is null
      and (p.published_retail or p.published_wholesale)
  ) p
  where p.pct is not null;

  return json_build_object(
    'id', pr.id,
    'name', pr.name,
    'banner_path', pr.banner_path,
    'ends_on', pr.ends_on,
    'last_day', public.promotion_last_day(pr),
    -- Past the close and inside the extension: «¡Extendida hasta el …!».
    'extended', pr.extended_until is not null and v_today > pr.ends_on,
    'includes_wholesale', pr.includes_wholesale,
    'has_code', false, -- part 2
    'percents', coalesce(v_percents, '{}'::json)
  );
end;
$$;
revoke execute on function public.get_shared_promotion(text) from public;
grant execute on function public.get_shared_promotion(text) to anon, authenticated;

-- ── 7. The order keeps what the promotion did ─────────────────────────────
alter table public.catalog_order_items add column if not exists list_price numeric(14,4);
alter table public.catalog_order_items add column if not exists promo_percent numeric(5,2);
alter table public.catalog_order_items add column if not exists promotion_id uuid references public.promotions(id) on delete set null;
alter table public.catalog_orders add column if not exists promotion_id uuid references public.promotions(id) on delete set null;
alter table public.catalog_order_items drop constraint if exists catalog_order_items_promo_shape;
alter table public.catalog_order_items
  add constraint catalog_order_items_promo_shape check (
    (promo_percent is null and list_price is null)
    or (promo_percent > 0 and promo_percent <= 90 and list_price > 0 and list_price >= unit_price)
  );
comment on column public.catalog_order_items.list_price is
  'CT-184. The unit price before the promotion, when one applied; unit_price is after it. Migration 228.';

-- ── 8. create_catalog_order_core: 216's body, with the promotion applied ──
create or replace function public.create_catalog_order_core(
  p_token text,
  p_customer_name text,
  p_customer_document text,
  p_customer_document_type text,
  p_customer_whatsapp text,
  p_wants_notices boolean,
  p_consent_text text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  -- The caps, as in 216: 50 lines, 20 orders per minute per link (CT-68).
  c_max_lineas constant int := 50;
  c_max_por_minuto constant int := 20;

  v_owner_id uuid;
  v_link_id uuid;
  v_recientes int;
  v_phone text;
  v_nombre text;
  v_documento text;
  v_tipo_documento text;
  v_order_id uuid;
  v_item jsonb;
  v_n_items int;

  p public.products%rowtype;
  v_cantidad numeric;
  v_moneda text;
  v_tier text;
  v_base text;
  v_precio numeric;
  v_fijado numeric;
  v_min numeric;

  v_monedas json;
  v_country text;
  v_settings public.owner_exchange_settings%rowtype;
  v_rate_usd numeric;
  v_rate_eur numeric;
  v_rate_usdt numeric;
  v_bs_base numeric;
  v_bs_destino numeric;

  -- NEW IN 228 (CT-184): the promotion, read ONCE for the whole order, like the rate, so
  -- an order sent at 23:59:59 cannot hold half its lines discounted.
  v_promo public.promotions;
  v_pct numeric;
  v_lista numeric;
begin
  select owner_id, id into v_owner_id, v_link_id
  from public.catalog_share_links
  where token = p_token;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'enlace_invalido');
  end if;

  select count(*) into v_recientes
  from public.catalog_orders
  where catalog_link_id = v_link_id
    and created_at > now() - interval '1 minute';
  if v_recientes >= c_max_por_minuto then
    return jsonb_build_object('ok', false, 'reason', 'demasiadas_ordenes');
  end if;

  v_nombre := btrim(coalesce(p_customer_name, ''));
  v_documento := btrim(coalesce(p_customer_document, ''));
  if v_nombre = '' or length(v_nombre) > 120 then
    return jsonb_build_object('ok', false, 'reason', 'nombre_invalido');
  end if;
  if v_documento = '' or length(v_documento) > 40 then
    return jsonb_build_object('ok', false, 'reason', 'documento_invalido');
  end if;

  v_phone := public.normalize_whatsapp_phone(p_customer_whatsapp);
  if v_phone is null then
    return jsonb_build_object('ok', false, 'reason', 'whatsapp_invalido');
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    return jsonb_build_object('ok', false, 'reason', 'sin_productos');
  end if;
  v_n_items := jsonb_array_length(p_items);
  if v_n_items = 0 then
    return jsonb_build_object('ok', false, 'reason', 'sin_productos');
  end if;
  if v_n_items > c_max_lineas then
    return jsonb_build_object('ok', false, 'reason', 'demasiados_productos');
  end if;

  select country into v_country from public.owners where id = v_owner_id;

  -- The document letter, validated against the country (155/216, unchanged).
  v_tipo_documento := nullif(btrim(coalesce(p_customer_document_type, '')), '');
  if v_tipo_documento is not null then
    if v_country = 'VE' and v_tipo_documento not in ('V', 'E', 'J') then
      v_tipo_documento := null;
    elsif v_country = 'CO' and v_tipo_documento not in ('CC', 'CE', 'NIT') then
      v_tipo_documento := null;
    elsif v_country is null then
      v_tipo_documento := null;
    end if;
  end if;
  if v_country = 'VE' then
    select * into v_settings from public.owner_exchange_settings where owner_id = v_owner_id;
    if v_settings.rate_mode = 'CUSTOM'
       and v_settings.custom_rate_usd is not null and v_settings.custom_rate_usd > 0
       and v_settings.custom_rate_eur is not null and v_settings.custom_rate_eur > 0 then
      v_rate_usd := v_settings.custom_rate_usd;
      v_rate_eur := v_settings.custom_rate_eur;
    else
      select r.usd, r.eur into v_rate_usd, v_rate_eur from public.get_current_bcv_rate() r;
    end if;
    v_rate_usdt := public.get_current_usdt_rate();
  end if;

  v_promo := public.active_promotion(v_owner_id);

  insert into public.catalog_orders (
    owner_id, catalog_link_id,
    customer_name, customer_document, customer_document_type,
    customer_whatsapp, customer_whatsapp_raw,
    wants_whatsapp_notices, promotion_id
  )
  values (
    v_owner_id, v_link_id,
    v_nombre, v_documento, v_tipo_documento,
    v_phone, btrim(coalesce(p_customer_whatsapp, '')),
    coalesce(p_wants_notices, false), v_promo.id
  )
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    select * into p
    from public.products
    where id = (v_item ->> 'product_id')::uuid
      and owner_id = v_owner_id
      and trashed_at is null
      and (published_retail or published_wholesale);
    if not found then
      raise exception 'producto_invalido' using errcode = 'P0001';
    end if;

    v_cantidad := (v_item ->> 'quantity')::numeric;
    if v_cantidad is null or v_cantidad <= 0 or v_cantidad > 99999999999 then
      raise exception 'cantidad_invalida' using errcode = 'P0001';
    end if;

    v_min := p.wholesale_min_quantity;
    if not (p.published_retail and p.price_retail is not null) then
      v_tier := 'wholesale';
    elsif not (p.published_wholesale and p.price_wholesale is not null) then
      v_tier := 'retail';
    elsif v_min is null then
      v_tier := 'retail';
    elsif v_cantidad >= v_min then
      v_tier := 'wholesale';
    else
      v_tier := 'retail';
    end if;

    if v_tier = 'wholesale'
       and not (p.published_retail and p.price_retail is not null)
       and v_min is not null and v_cantidad < v_min then
      raise exception 'cantidad_bajo_el_minimo' using errcode = 'P0001';
    end if;

    v_precio := case when v_tier = 'wholesale' then p.price_wholesale else p.price_retail end;
    if v_precio is null then
      raise exception 'sin_precio' using errcode = 'P0001';
    end if;

    v_base := case when v_tier = 'wholesale'
                   then p.base_currency_wholesale
                   else p.base_currency_retail end;
    if v_base is null then
      raise exception 'sin_precio' using errcode = 'P0001';
    end if;

    v_moneda := upper(btrim(coalesce(v_item ->> 'currency', '')));
    v_monedas := public.product_catalog_currencies(p.id, v_tier, v_base);
    if v_moneda <> v_base
       and not exists (
         select 1 from json_array_elements_text(v_monedas) m where m.value = v_moneda
       )
       and not exists (
         select 1 from public.product_price_overrides o
         where o.product_id = p.id and o.tier = v_tier and o.currency = v_moneda
       )
    then
      raise exception 'moneda_invalida' using errcode = 'P0001';
    end if;

    select amount into v_fijado
    from public.product_price_overrides
    where product_id = p.id and tier = v_tier and currency = v_moneda;

    if found and v_fijado is not null and v_fijado > 0 then
      v_precio := v_fijado;
    elsif v_moneda <> v_base then
      v_bs_base := case v_base
        when 'VES' then 1
        when 'USD' then nullif(v_rate_usd, 0)
        when 'EUR' then nullif(v_rate_eur, 0)
        when 'USDT' then nullif(v_rate_usdt, 0)
        else null end;
      v_bs_destino := case v_moneda
        when 'VES' then 1
        when 'USD' then nullif(v_rate_usd, 0)
        when 'EUR' then nullif(v_rate_eur, 0)
        when 'USDT' then nullif(v_rate_usdt, 0)
        else null end;
      if v_bs_base is null or v_bs_destino is null then
        raise exception 'sin_tasa' using errcode = 'P0001';
      end if;
      v_precio := round(
        (v_precio * v_bs_base) / v_bs_destino,
        case when v_moneda = 'VES' then 4 else 2 end
      );
      if v_precio <= 0 then
        raise exception 'sin_precio' using errcode = 'P0001';
      end if;
    end if;

    -- NEW IN 228: THE PROMOTION, applied to the price already resolved -- pinned ones too
    -- (owner's decision: the bolívares pinned by hand are discounted like the rest), with
    -- the same rounding as the price itself and as `aplicarPromocion` in TypeScript.
    v_pct := null;
    v_lista := null;
    if v_promo.id is not null then
      v_pct := public.promotion_percent(v_promo.id, p.id, v_tier);
      if v_pct is not null then
        v_lista := v_precio;
        v_precio := round(v_precio * (100 - v_pct) / 100, case when v_moneda = 'VES' then 4 else 2 end);
        if v_precio <= 0 then
          raise exception 'sin_precio' using errcode = 'P0001';
        end if;
      end if;
    end if;

    insert into public.catalog_order_items (
      order_id, product_id, product_name,
      quantity, unit_price, currency, tier, comment,
      list_price, promo_percent, promotion_id
    )
    values (
      v_order_id, p.id, p.name,
      v_cantidad, v_precio, v_moneda, v_tier,
      nullif(btrim(coalesce(left(v_item ->> 'comment', 500), '')), ''),
      v_lista, v_pct, case when v_pct is not null then v_promo.id end
    );
  end loop;

  if coalesce(p_wants_notices, false) and btrim(coalesce(p_consent_text, '')) <> '' then
    insert into public.client_whatsapp_consents (phone, event, consent_text, source)
    values (v_phone, 'granted', btrim(p_consent_text), 'client_order');
  end if;

  return jsonb_build_object('ok', true, 'order_id', v_order_id);

exception
  when sqlstate 'P0001' then
    return jsonb_build_object('ok', false, 'reason', sqlerrm);
  when others then
    raise warning 'create_catalog_order fallo inesperado: % (%)', sqlerrm, sqlstate;
    return jsonb_build_object('ok', false, 'reason', 'error');
end;
$fn$;

revoke execute on function public.create_catalog_order_core(text, text, text, text, text, boolean, text, jsonb) from public, anon, authenticated;

-- ── 8b. Saving a promotion: the header, its groups and their products, in ONE transaction ──
-- SECURITY INVOKER on purpose: it runs as the owner, so RLS (owner_id = auth.uid() and
-- owner_puede_escribir) still decides every row. Its only job is atomicity: written from the
-- app in three calls, a failure halfway would leave a promotion on sale with no discounts.
-- Replacing the groups on every save is deliberate: a promotion has a handful of them.
create or replace function public.save_promotion(
  p_id uuid,
  p_name text,
  p_banner_path text,
  p_starts_on date,
  p_ends_on date,
  p_extended_until date,
  p_includes_wholesale boolean,
  p_code text,
  p_code_percent numeric,
  p_code_max_uses integer,
  -- [{ "percent": number, "all_products": bool, "include": [uuid], "exclude": [uuid] }]
  p_groups jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_owner uuid := auth.uid();
  v_id uuid := p_id;
  g jsonb;
  v_group uuid;
  v_pos smallint := 0;
begin
  if v_owner is null then
    raise exception 'sin_sesion' using errcode = 'P0001';
  end if;
  if p_groups is null or jsonb_typeof(p_groups) <> 'array' or jsonb_array_length(p_groups) = 0 then
    raise exception 'sin_grupos' using errcode = 'P0001';
  end if;

  if v_id is null then
    insert into public.promotions (owner_id, name, banner_path, starts_on, ends_on, extended_until,
                                   includes_wholesale, code, code_percent, code_max_uses)
    values (v_owner, btrim(p_name), p_banner_path, p_starts_on, p_ends_on, p_extended_until,
            coalesce(p_includes_wholesale, false), p_code, p_code_percent, p_code_max_uses)
    returning id into v_id;
  else
    update public.promotions
       set name = btrim(p_name), banner_path = p_banner_path, starts_on = p_starts_on,
           ends_on = p_ends_on, extended_until = p_extended_until,
           includes_wholesale = coalesce(p_includes_wholesale, false),
           code = p_code, code_percent = p_code_percent, code_max_uses = p_code_max_uses
     where id = v_id and owner_id = v_owner;
    if not found then
      raise exception 'promocion_ajena' using errcode = 'P0001';
    end if;
    delete from public.promotion_groups where promotion_id = v_id and owner_id = v_owner;
  end if;

  for g in select * from jsonb_array_elements(p_groups) loop
    insert into public.promotion_groups (owner_id, promotion_id, percent, all_products, position)
    values (v_owner, v_id, (g ->> 'percent')::numeric, coalesce((g ->> 'all_products')::boolean, false), v_pos)
    returning id into v_group;
    v_pos := v_pos + 1;

    insert into public.promotion_group_items (owner_id, promotion_id, group_id, product_id, kind)
    select v_owner, v_id, v_group, x::uuid, 'include'
    from jsonb_array_elements_text(coalesce(g -> 'include', '[]'::jsonb)) x;

    insert into public.promotion_group_items (owner_id, promotion_id, group_id, product_id, kind)
    select v_owner, v_id, v_group, x::uuid, 'exclude'
    from jsonb_array_elements_text(coalesce(g -> 'exclude', '[]'::jsonb)) x;
  end loop;

  return v_id;
end;
$$;
revoke execute on function public.save_promotion(uuid, text, text, date, date, date, boolean, text, numeric, integer, jsonb) from public, anon;
grant execute on function public.save_promotion(uuid, text, text, date, date, date, boolean, text, numeric, integer, jsonb) to authenticated;

-- ── 9. The nightly cleanup: 210's bodies, with the promotion banner kept ──
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
  cross join lateral (select regexp_replace(o.name, '\.thumb\.jpg$', '') as photo) t
  where o.bucket_id in ('logos', 'product-photos')
    and o.created_at < now() - greatest(p_min_age, interval '0 seconds')
    and o.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$'
    and o.name not like '%/.emptyFolderPlaceholder'
    and (p_scope_owner is null or split_part(o.name, '/', 1) = p_scope_owner::text)
    and not exists (select 1 from public.owners w where w.logo_path in (o.name, t.photo))
    and not exists (select 1 from public.owners w where w.catalog_cover_path in (o.name, t.photo))
    -- 228: the promotion banner lives in `logos` too.
    and not exists (select 1 from public.promotions pr where pr.banner_path in (o.name, t.photo))
    and not exists (select 1 from public.products p where p.photo_path in (o.name, t.photo))
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
    and not exists (select 1 from public.promotions pr where pr.banner_path in (n, t.photo))
    and not exists (select 1 from public.products p where p.photo_path in (n, t.photo))
    and not exists (select 1 from public.product_photos pp where pp.path in (n, t.photo));
$$;
revoke execute on function public.storage_orphan_recheck(text, text[]) from public, anon, authenticated;
grant execute on function public.storage_orphan_recheck(text, text[]) to service_role;

insert into public.schema_migrations (key, description)
values (
  '228_catalog_promotions',
  'CT-184, parte 1: promociones del catálogo. Tablas promotions, promotion_groups y promotion_group_items (un % por grupo, todos o elegidos, con excluidos), una sola promoción a la vez (disparador), get_shared_promotion para el cliente, y create_catalog_order_core aplica la rebaja y guarda list_price, promo_percent y promotion_id en cada línea. La limpieza nocturna conoce el banner.'
)
on conflict (key) do nothing;

commit;
