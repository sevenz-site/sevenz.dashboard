-- ENVIRONMENT: run in DEV first (vzqppwrwnmlbrxizskdh). Production comes later, with its
-- own green light, and BEFORE the code that writes extra photos (CLAUDE.md, deploy step 1).
-- Re-runnable: `if not exists` on the table and index, policies dropped and recreated,
-- functions `create or replace` with unchanged signatures, `on conflict` on the ledger.
--
-- ===========================================================================
-- 204: UP TO FIVE PHOTOS PER PRODUCT (CT-171, v0.6.0)
--
-- Owner's request of 2026-11-12: «Poder subir hasta 5 fotos del producto en el catálogo»,
-- and «Sí, la primera foto es la portada». Frames `2119:21556`, `2119:21629`, `2119:21783`,
-- `2119:21828` and `2119:21879`, approved that day.
--
-- THE COVER STAYS IN `products.photo_path`. More than twenty places read that column --
-- the catalogue card, the cart, orders, receipts, the WhatsApp preview, sale lines -- and
-- the cover is what all of them should keep showing. So only photos 2 to 5 live here, at
-- positions 1 to 4. A design with all five in a new table would have had to move every
-- one of those readers at once, and any reader missed would show no photo, silently.
--
-- THE WORST CASE, AND WHY THIS FILE ALSO TOUCHES 182. The nightly cleanup deletes any
-- product photo that no row names, looking only at `owners.logo_path` and
-- `products.photo_path`. Without teaching it this table it would delete photos 2 to 5 of
-- every product a week after upload -- the moment `enforce` is on -- and Storage is not in
-- the backups. Both of its functions are redefined below with one more `not exists`.
--
-- THE OWNER READS AND WRITES THIS TABLE DIRECTLY, so it gets RLS through the product AND
-- the grants. Migration 108 created `catalog_orders` with a correct policy and no grant,
-- and every read died with 42501 while the service-role suite passed (CLAUDE.md, «A qa/
-- script runs as the service role»). `qa:fotos` checks this as the owner.
--
-- THE CUSTOMER NEVER READS IT. `get_shared_product_photos` below hands out the paths of a
-- product only when `get_shared_product` -- the existing door of the public product page
-- -- would show that product. It CALLS that function rather than repeating its rules, so a
-- product the customer cannot see can never leak its photos through this one.
-- ===========================================================================

begin;

create table if not exists public.product_photos (
  product_id uuid not null references public.products (id) on delete cascade,
  -- 1 to 4: the cover is position 0, and it lives in `products.photo_path`.
  position smallint not null check (position between 1 and 4),
  path text not null check (btrim(path) <> ''),
  created_at timestamptz not null default now(),
  primary key (product_id, position)
);

-- The cleanup looks photos up by path, every night, across every product.
create index if not exists product_photos_path_idx on public.product_photos (path);

alter table public.product_photos enable row level security;

drop policy if exists "owners manage own product photos" on public.product_photos;
create policy "owners manage own product photos" on public.product_photos
  for all using (
    exists (select 1 from public.products p where p.id = product_id and p.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.products p where p.id = product_id and p.owner_id = auth.uid())
  );

revoke all on public.product_photos from anon;
-- No `update`: like `product_currencies`, the save rewrites the rows (delete, insert).
grant select, insert, delete on public.product_photos to authenticated;

comment on table public.product_photos is
  'Photos 2 to 5 of a product (positions 1-4). The cover stays in products.photo_path. CT-171, v0.6.0.';

-- ───────────────────────────────────────────────────────────────────────────
-- The customer's gallery: the extra photos of a product the public page would show.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.get_shared_product_photos(p_token text, p_product_id uuid)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- Same door as the product page, so the same visibility: wrong token, another
  -- business's product, trashed or unpublished -> nothing.
  if public.get_shared_product(p_token, p_product_id) is null then
    return '[]'::json;
  end if;
  return coalesce(
    (select json_agg(pp.path order by pp.position)
       from public.product_photos pp
      where pp.product_id = p_product_id),
    '[]'::json
  );
end;
$$;
revoke execute on function public.get_shared_product_photos(text, uuid) from public;
grant execute on function public.get_shared_product_photos(text, uuid) to anon, authenticated;

comment on function public.get_shared_product_photos(text, uuid) is
  'Extra photos (2 to 5) of a product in the public catalogue, in order. Empty unless get_shared_product would show the product. CT-171.';

-- ───────────────────────────────────────────────────────────────────────────
-- The nightly cleanup (182), now aware of this table. Same bodies plus one line each.
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
  where o.bucket_id in ('logos', 'product-photos')
    -- A negative interval would make every fresh upload "old enough".
    and o.created_at < now() - greatest(p_min_age, interval '0 seconds')
    and o.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$'
    and o.name not like '%/.emptyFolderPlaceholder'
    and (p_scope_owner is null or split_part(o.name, '/', 1) = p_scope_owner::text)
    and not exists (select 1 from public.owners w where w.logo_path = o.name)
    and not exists (select 1 from public.products p where p.photo_path = o.name)
    -- 204: photos 2 to 5. Without this line they would be deleted a week after upload.
    and not exists (select 1 from public.product_photos pp where pp.path = o.name)
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
  where p_bucket in ('logos', 'product-photos')
    and not exists (select 1 from public.owners w where w.logo_path = n)
    and not exists (select 1 from public.products p where p.photo_path = n)
    and not exists (select 1 from public.product_photos pp where pp.path = n);
$$;
revoke execute on function public.storage_orphan_recheck(text, text[]) from public, anon, authenticated;
grant execute on function public.storage_orphan_recheck(text, text[]) to service_role;

insert into public.schema_migrations (key, description)
values (
  '204_product_photos',
  'Hasta 5 fotos por producto (CT-171, v0.6.0): la portada sigue en products.photo_path y las fotos 2 a 5 van en product_photos (el dueño lee y escribe con RLS y permisos). get_shared_product_photos da al cliente las de un producto que get_shared_product enseñaría. La limpieza nocturna (182) aprende la tabla nueva, para no borrar esas fotos.'
)
on conflict (key) do nothing;

commit;
