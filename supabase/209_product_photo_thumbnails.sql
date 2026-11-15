-- ENVIRONMENT: run in DEV first (vzqppwrwnmlbrxizskdh). Production comes later, with its
-- own green light, and BEFORE the code that uploads thumbnails (CLAUDE.md, deploy step 1).
-- Safe in that order: nothing here changes what the code already live reads or writes.
-- Re-runnable: `add column if not exists`, functions `create or replace` with unchanged
-- signatures (the new one is new, so it has no older signature to drop), `on conflict` on
-- the ledger.
--
-- ===========================================================================
-- 209: A PRODUCT PHOTO HAS A STORED THUMBNAIL, AND THE CLEANUP KNOWS IT
--
-- Owner's decision of 2026-11-15: «Aprobado B con las soluciones para peores
-- escenarios». B is "save the thumbnail when the photo is uploaded and serve it as it
-- is", instead of asking Supabase to resize it on every view: v0.7.0 did that, each
-- distinct photo served that way is billed once per billing cycle with 100 included, and
-- the counter went from 37 to 121 within hours of the release.
--
-- The thumbnail is an object of its own in `product-photos`, named after its photo:
--
--     <owner>/<uuid>.jpg            the photo
--     <owner>/<uuid>.jpg.thumb.jpg  its thumbnail, 400px wide
--
-- The suffix `.thumb.jpg` is appended to the WHOLE name, so the photo is always the
-- thumbnail's name minus the suffix. `lib/supabase/storage.ts` holds the same suffix; the
-- two must change together.
--
-- ---------------------------------------------------------------------------
-- 1. THE WORST CASE, AND WHY THIS FILE HAS TO RUN BEFORE ANY THUMBNAIL EXISTS
--
-- The nightly cleanup (182, last redefined in 204) deletes any file in `logos` or
-- `product-photos` that no row names. No row ever names a thumbnail: products name the
-- photo. So without this file every thumbnail would be an orphan from the moment it is
-- uploaded and would be deleted a week later -- with no error, because the screens fall
-- back to the photo. The grids would quietly go back to 3-4 MB a page, which is the
-- thing the thumbnails exist to prevent.
--
-- The rule now: A FILE IS IN USE IF A ROW NAMES IT, OR NAMES THE PHOTO IT IS THE
-- THUMBNAIL OF. Both names are checked on purpose. Checking only the photo's name would
-- make a file that is literally called `something.thumb.jpg` AND named by a row look
-- unused -- nothing uploads such a name today, but the cleanup is the one place where a
-- wrong guess deletes a file that Storage's backups do not hold. This rule can only keep
-- more than the old one, never less.
--
-- A thumbnail whose photo stops being used becomes an orphan together with it, and goes
-- the same way, after the same `min_age`.
--
-- ---------------------------------------------------------------------------
-- 2. THE PHOTOS THAT HAVE NO THUMBNAIL
--
-- Every photo uploaded before this (305 in use in production on 2026-11-15, the owner's
-- own count), and any whose thumbnail failed to upload from a weak phone. The nightly
-- route asks `product_photos_missing_thumbnail` for a batch and makes them on the server
-- (`lib/product-thumbnails.ts`). Only photos a product actually uses: an abandoned upload
-- needs no thumbnail.
--
-- RANDOM ORDER, NOT OLDEST FIRST. A photo that can never be resized -- a truncated file
-- -- would sit at the head of an ordered queue and be retried every night ahead of
-- everything behind it. In random order it costs one slot now and then.
--
-- `thumbnails_per_run` is the switch: how many the nightly run may make, 0 to turn it
-- off. It is independent of `enforce`: making thumbnails deletes nothing.
-- ===========================================================================

begin;

alter table public.storage_cleanup_settings
  add column if not exists thumbnails_per_run integer not null default 120
    check (thumbnails_per_run between 0 and 500);

comment on column public.storage_cleanup_settings.thumbnails_per_run is
  'How many missing product-photo thumbnails the nightly run may make. 0 turns it off. Independent of enforce. Migration 209.';

-- ───────────────────────────────────────────────────────────────────────────
-- The nightly cleanup: same bodies as 204, with the thumbnail's photo checked too.
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
    and not exists (select 1 from public.products p where p.photo_path in (n, t.photo))
    and not exists (select 1 from public.product_photos pp where pp.path in (n, t.photo));
$$;
revoke execute on function public.storage_orphan_recheck(text, text[]) from public, anon, authenticated;
grant execute on function public.storage_orphan_recheck(text, text[]) to service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- The photos in use that have no thumbnail yet.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.product_photos_missing_thumbnail(
  p_limit integer,
  p_scope_owner uuid default null
)
returns setof text
language sql
stable
security definer
set search_path = public, storage
as $$
  select o.name
  from storage.objects o
  where o.bucket_id = 'product-photos'
    and o.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$'
    and o.name not like '%.thumb.jpg'
    and o.name not like '%/.emptyFolderPlaceholder'
    and (p_scope_owner is null or split_part(o.name, '/', 1) = p_scope_owner::text)
    and (
      exists (select 1 from public.products p where p.photo_path = o.name)
      or exists (select 1 from public.product_photos pp where pp.path = o.name)
    )
    and not exists (
      select 1 from storage.objects th
      where th.bucket_id = 'product-photos' and th.name = o.name || '.thumb.jpg'
    )
  order by random()
  limit greatest(0, least(coalesce(p_limit, 0), 500));
$$;
revoke execute on function public.product_photos_missing_thumbnail(integer, uuid) from public, anon, authenticated;
grant execute on function public.product_photos_missing_thumbnail(integer, uuid) to service_role;

comment on function public.product_photos_missing_thumbnail(integer, uuid) is
  'Product photos in use that have no stored thumbnail (<name>.thumb.jpg), in random order. Only the nightly route calls it. Migration 209.';

insert into public.schema_migrations (key, description)
values (
  '209_product_photo_thumbnails',
  'La miniatura de cada foto de producto es un archivo guardado (<foto>.thumb.jpg), no una transformación de Supabase (decisión del dueño del 2026-11-15, opción B). La limpieza nocturna aprende que una miniatura pertenece a su foto, para no borrarla a los 7 días; product_photos_missing_thumbnail da a la tarea nocturna las fotos en uso que todavía no tienen miniatura, y storage_cleanup_settings.thumbnails_per_run dice cuántas hace por noche (0 la apaga).'
)
on conflict (key) do nothing;

commit;
