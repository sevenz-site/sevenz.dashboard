-- 230 · CT-184: the promotion discounts the wholesale price too, with its own % per group.
--
-- ===========================================================================
-- WHY
--
-- 228 let the owner choose, per promotion, whether the wholesale price was discounted
-- (`includes_wholesale`, off by default). The browser QA of 2026-11-28 showed what that did:
-- rice at $65 retail / $57,50 wholesale from 6, at 30% off retail only, cost $227,50 for 5
-- and $345,00 for 6 -- one more sack, $117,50 more. The owner then decided, on 2026-11-28:
--
--   «el descuento tanto de la promo como del código aplica para ambos precios, si al detal
--    cuesta 30$ y el mayor 25$ el descuento debe aplicar a ambos»
--
-- and, asked about the switch, that a group may carry a different % for the wholesale price:
-- «al mayor puede ir un porcentaje y al detal otro», empty meaning «el mismo que al detal»,
-- behind a checkbox «Aplicar descuento diferente a precios al mayor». When the discounted
-- wholesale ends up dearer than the discounted retail, the wizard only warns («Solo avisa»).
--
-- WHAT IT DISPLACES: 228's `includes_wholesale` switch. The column stays (dropping it buys
-- nothing and would break a rollback of the code), but nothing reads it any more and every
-- save writes true. The old «off» is still expressible: a wholesale % of 0.
--
-- ===========================================================================
-- WHAT CHANGES
--
--   1. `promotion_groups.wholesale_percent`: null = the group's own %, 0 = no discount on the
--      wholesale price, 0.01..90 = that %.
--   2. `promotion_percent(promo, product, tier)`: the wholesale tier reads that column.
--   3. `get_shared_promotion`: also returns `wholesale_percents` {product: %}.
--   4. `save_promotion`: stores `wholesale_percent` from each group of `p_groups`.
--
-- `create_catalog_order_core` is NOT redefined: since 228 it asks `promotion_percent` for the
-- line's own tier, so the order picks the new rule up by itself.
--
-- Re-runnable: `add column if not exists`, constraints dropped before being added, and every
-- function keeps its signature, so `create or replace` replaces it in place.

-- ── 1. The column ─────────────────────────────────────────────────────────
alter table public.promotion_groups add column if not exists wholesale_percent numeric(5,2);
alter table public.promotion_groups drop constraint if exists promotion_groups_wholesale_percent;
alter table public.promotion_groups
  add constraint promotion_groups_wholesale_percent check (
    wholesale_percent is null or (wholesale_percent >= 0 and wholesale_percent <= 90)
  );
comment on column public.promotion_groups.wholesale_percent is
  'CT-184. The % for the wholesale price: null = the group''s own percent, 0 = not discounted. Owner''s decision of 2026-11-28. Migration 230.';

alter table public.promotions alter column includes_wholesale set default true;
comment on column public.promotions.includes_wholesale is
  'CT-184. Unused since migration 230: the wholesale price is always discounted, by promotion_groups.wholesale_percent. Kept so older code still reads a column.';

-- ── 2. A product's % in a promotion and tier ──────────────────────────────
-- A chosen group wins over «all» (as in 228): the `order by` puts chosen groups first. A 0%
-- comes back as null, which is what every caller reads as «no promotion on this line» -- and
-- what `catalog_order_items_promo_shape` requires (promo_percent > 0 or null).
create or replace function public.promotion_percent(p_promotion uuid, p_product uuid, p_tier text)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select nullif(
           case when p_tier = 'wholesale' then coalesce(g.wholesale_percent, g.percent) else g.percent end,
           0)
  from public.promotion_groups g
  where g.promotion_id = p_promotion
    and (
      exists (select 1 from public.promotion_group_items i
               where i.group_id = g.id and i.product_id = p_product and i.kind = 'include')
      or (g.all_products
          and not exists (select 1 from public.promotion_group_items x
                           where x.group_id = g.id and x.product_id = p_product and x.kind = 'exclude'))
    )
  order by g.all_products
  limit 1;
$$;
revoke execute on function public.promotion_percent(uuid, uuid, text) from public, anon, authenticated;

-- ── 3. What the customer reads ────────────────────────────────────────────
-- 228's body plus `wholesale_percents`. `includes_wholesale` is still sent, always true, so a
-- page deployed before this migration keeps discounting the wholesale price with the retail %.
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
  v_wholesale json;
begin
  select owner_id into v_owner from public.catalog_share_links where token = p_token;
  if v_owner is null then return null; end if;
  pr := public.active_promotion(v_owner);
  if pr.id is null then return null; end if;
  v_today := public.business_today(v_owner);

  select json_object_agg(x.id, x.pct) filter (where x.pct is not null),
         json_object_agg(x.id, x.wpct) filter (where x.wpct is not null)
    into v_percents, v_wholesale
  from (
    select p.id,
           public.promotion_percent(pr.id, p.id, 'retail') as pct,
           public.promotion_percent(pr.id, p.id, 'wholesale') as wpct
    from public.products p
    where p.owner_id = v_owner and p.trashed_at is null
      and (p.published_retail or p.published_wholesale)
  ) x;

  return json_build_object(
    'id', pr.id,
    'name', pr.name,
    'banner_path', pr.banner_path,
    'ends_on', pr.ends_on,
    'last_day', public.promotion_last_day(pr),
    'extended', pr.extended_until is not null and v_today > pr.ends_on,
    'includes_wholesale', true,
    'has_code', false, -- part 2
    'percents', coalesce(v_percents, '{}'::json),
    'wholesale_percents', coalesce(v_wholesale, '{}'::json)
  );
end;
$$;
revoke execute on function public.get_shared_promotion(text) from public;
grant execute on function public.get_shared_promotion(text) to anon, authenticated;

-- ── 4. Saving: 228's body, with each group's wholesale % ──────────────────
-- `p_includes_wholesale` stays in the signature (changing it would need drop + create and a
-- second overload in between) and is ignored: the column is written true.
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
  -- [{ "percent": number, "wholesale_percent": number|null, "all_products": bool,
  --    "include": [uuid], "exclude": [uuid] }]
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
            true, p_code, p_code_percent, p_code_max_uses)
    returning id into v_id;
  else
    update public.promotions
       set name = btrim(p_name), banner_path = p_banner_path, starts_on = p_starts_on,
           ends_on = p_ends_on, extended_until = p_extended_until,
           includes_wholesale = true,
           code = p_code, code_percent = p_code_percent, code_max_uses = p_code_max_uses
     where id = v_id and owner_id = v_owner;
    if not found then
      raise exception 'promocion_ajena' using errcode = 'P0001';
    end if;
    delete from public.promotion_groups where promotion_id = v_id and owner_id = v_owner;
  end if;

  for g in select * from jsonb_array_elements(p_groups) loop
    insert into public.promotion_groups (owner_id, promotion_id, percent, wholesale_percent, all_products, position)
    values (v_owner, v_id, (g ->> 'percent')::numeric,
            nullif(g ->> 'wholesale_percent', '')::numeric,
            coalesce((g ->> 'all_products')::boolean, false), v_pos)
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

insert into public.schema_migrations (key, description)
values ('230_promotion_wholesale_percent', 'CT-184: la promoción rebaja también el precio al mayor, con un % propio por grupo (vacío = el del detal, 0 = sin rebaja); la casilla «Rebajar también el precio al mayor» deja de usarse')
on conflict (key) do nothing;
