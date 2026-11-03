-- ENVIRONMENT: run in DEV first (vzqppwrwnmlbrxizskdh). Production comes later,
-- with its own green light, and BEFORE the code: the nightly route calls the
-- two functions below and would fail every night without them. Re-runnable:
-- tables are `if not exists`, functions `create or replace` with unchanged
-- signatures, grants are idempotent.
--
-- ===========================================================================
-- 182: FILES NOBODY USES ANY MORE ARE DELETED -- AFTER A WEEK OF WATCHING
--
-- `DM-12`, built at the owner's request on 2026-11-02. Every «Cambiar logo»
-- that is never saved, every replaced product photo and every abandoned
-- upload leaves a file in `logos` or `product-photos` that no row names, in
-- buckets anyone can read with the link. Measured in dev that day: 1 of 2
-- logos and 7 of 30 product photos unused.
--
-- THE WORST CASE DECIDES THE SHAPE. Deleting a file that IS in use breaks the
-- image in the app, the catalogue and the receipts, and Storage is not in the
-- database backups: a deleted file does not come back. So a file is deleted
-- only when ALL of these hold:
--   · it is in `logos` or `product-photos` -- never `attachments`,
--     `comprobantes` or `client-profile-pictures`, which are evidence or
--     belong to a client;
--   · its name is `<uuid>/<file>`, a business's own folder -- anything shaped
--     otherwise (old paths, dashboard uploads) is never touched;
--   · no `owners.logo_path` and no `products.photo_path` names it, in EITHER
--     column whatever the bucket (a path is bucket-relative, so this costs
--     nothing and closes a collision nobody would think of). Products in the
--     papelera, hidden or unpublished still name their photo and keep it;
--   · it is older than `min_age` (7 days), counted from the upload. The
--     product wizard keeps its draft in the browser, so a photo uploaded and
--     not yet saved is unreferenced by design for as long as the draft lives;
--     7 days covers the ordinary draft, and the save itself refuses a path
--     whose file is gone (`lib/storage-file-exists.ts`) for the rest.
--
-- AND IT SHIPS WATCHING, like 180. `enforce = false` makes the nightly run
-- record what it WOULD delete in `storage_cleanup_log` and delete nothing.
-- After a week of that list looking right, `enforce = true` -- with the
-- privacy policy updated in the same step, because its sentence «no borra ese
-- archivo» stops being true that day and not before.
--
-- Every deletion is re-checked against the two columns a moment before it
-- happens (`storage_orphan_recheck`), so a draft saved between the nightly
-- query and the delete keeps its photo. And at most `max_per_run` files go in
-- one night, so a wrong rule costs a bounded number of images, logged by name.
--
-- WHO CAN CALL IT: only `service_role`, i.e. the cron route behind
-- CRON_SECRET. Production revokes the service role's reads on customer
-- tables, so the decision lives in SECURITY DEFINER functions, the pattern of
-- migration 039; the deletion itself goes through the Storage API, never by
-- deleting rows of `storage.objects`, which would leave the bytes behind.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. The switch and the log
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.storage_cleanup_settings (
  -- A single row, pinned by a boolean primary key that can only be true.
  id boolean primary key default true check (id),
  enforce boolean not null default false,
  min_age interval not null default interval '7 days',
  max_per_run integer not null default 200 check (max_per_run between 1 and 1000),
  -- Dev and QA only: restricts a run to one business's folder, so
  -- `qa:storage-cleanup` can exercise real deletions without touching the
  -- rest of dev. Null in production.
  scope_owner uuid,
  updated_at timestamptz not null default now()
);
insert into public.storage_cleanup_settings (id) values (true) on conflict (id) do nothing;

-- One row per file ever found orphaned. Observing refreshes `last_seen_at`
-- every night instead of piling up a row per night, so the list the owner
-- reviews before switching on is exactly "what would go".
create table if not exists public.storage_cleanup_log (
  bucket_id text not null,
  name text not null,
  size_bytes bigint,
  file_created_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (bucket_id, name)
);

-- Neither table is for a session. Supabase grants every new table to anon and
-- authenticated by default, so both are revoked by name.
alter table public.storage_cleanup_settings enable row level security;
alter table public.storage_cleanup_log enable row level security;
revoke all on public.storage_cleanup_settings from public, anon, authenticated;
revoke all on public.storage_cleanup_log from public, anon, authenticated;
grant select, update on public.storage_cleanup_settings to service_role;
-- `delete` is for `qa:storage-cleanup`, which removes the rows its own test
-- files left; the cron route never deletes from the log.
grant select, insert, update, delete on public.storage_cleanup_log to service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. The decision
-- ───────────────────────────────────────────────────────────────────────────
-- The one place the rule is written. `storage_orphan_recheck` below repeats
-- the reference test on purpose rather than calling this: it must answer for
-- exactly the names it is given, whatever their age or the limit.
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
  order by o.created_at
  limit greatest(1, least(coalesce(p_limit, 200), 1000));
$$;
revoke execute on function public.storage_orphan_candidates(interval, integer, uuid) from public, anon, authenticated;
grant execute on function public.storage_orphan_candidates(interval, integer, uuid) to service_role;

-- Of the names given, the ones that are STILL unreferenced right now. Called
-- a moment before each deletion.
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
    and not exists (select 1 from public.products p where p.photo_path = n);
$$;
revoke execute on function public.storage_orphan_recheck(text, text[]) from public, anon, authenticated;
grant execute on function public.storage_orphan_recheck(text, text[]) to service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- Ledger
-- ───────────────────────────────────────────────────────────────────────────
insert into public.schema_migrations (key, description)
values (
  '182_limpieza_de_archivos_abandonados',
  'DM-12 (2026-11-02): cada noche se buscan los logos y fotos de producto que ninguna fila usa (contando productos en la papelera u ocultos), de más de 7 días y dentro de la carpeta de un negocio. Nace OBSERVANDO (storage_cleanup_settings.enforce = false): apunta en storage_cleanup_log lo que borraría y no borra nada. Con enforce = true borra por la API de Storage, como mucho 200 por noche, comprobando de nuevo cada archivo justo antes. Solo service_role llama a las funciones. Al encenderla hay que cambiar la frase «no borra ese archivo» de la Política de privacidad.'
)
on conflict (key) do nothing;

-- Verification (read-only), to run right after:
--   select
--     (select enforce from public.storage_cleanup_settings) as borra,
--     (select min_age from public.storage_cleanup_settings) as antiguedad,
--     has_table_privilege('authenticated', 'public.storage_cleanup_settings', 'update') as dueno_toca_interruptor,
--     has_function_privilege('authenticated', 'public.storage_orphan_candidates(interval, integer, uuid)', 'execute') as dueno_llama,
--     has_table_privilege('service_role', 'public.storage_cleanup_log', 'insert')
--       and has_table_privilege('service_role', 'public.storage_cleanup_settings', 'select') as servidor_escribe,
--     exists (select 1 from public.schema_migrations where key = '182_limpieza_de_archivos_abandonados') as apuntada;
--   -- borra = false, antiguedad = 7 days, dueno_toca_interruptor = false,
--   -- dueno_llama = false, servidor_escribe = true, apuntada = true
--   -- (`servidor_escribe` matters most in PRODUCTION, which revokes the service
--   -- role's reads on customer tables: the cron needs these two grants.)
