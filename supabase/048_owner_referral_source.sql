-- Run once in the SQL editor, BOTH the dev branch (vzqppwrwnmlbrxizskdh) and
-- production (rabmiyqodnvnrwiartuj) — same dual-environment discipline as every
-- migration before it.
--
-- WHY. Signup now asks "¿Cómo conociste Sevenz?" and it is required. It exists
-- for one measurable question: how many of the accounts created during the 1:1
-- pilot actually came from a rep knocking on a door. Without it, a spike in
-- signups during the pilot weeks is unattributable — it could be the visits, or
-- it could be a post that did well.
--
-- WHY THE COLUMN IS NULLABLE even though the field is required. The 23 owners
-- who already exist never answered. NOT NULL would need a backfill value, and
-- every candidate for it is a lie: 'otro' would claim they told us something,
-- and any real channel would invent an answer. Null means "never asked", which
-- is the truth and is distinguishable from every real answer when reading the
-- data. The requirement is enforced where it belongs — in the form, and again
-- in signup/actions.ts so a raw POST cannot skip it.
--
-- WHY A CHECK CONSTRAINT rather than a lookup table. The list is closed, short
-- and product-owned, exactly like owners.country. A table would add a join to
-- every read for values that change about once a year.
--
-- THE LIST IS THE SCHEMA. Editing a value later splits the data in two — old
-- rows keep the old string and no query sees both. Adding a value is safe;
-- renaming or removing one is not, and needs its own migration with a backfill.
begin;

alter table public.owners add column if not exists referral_source text;

-- Dropped first so re-running this file after editing the list converges
-- instead of failing on a constraint that already exists with the old values.
alter table public.owners drop constraint if exists owners_referral_source_check;
alter table public.owners add constraint owners_referral_source_check
  check (
    referral_source is null
    or referral_source in (
      'visita_vendedor',    -- Un vendedor me visitó  ← la que mide el piloto 1:1
      'recomendacion',      -- Me lo recomendó otro comerciante
      'redes_sociales',     -- Redes sociales
      'busqueda_internet',  -- Buscando en internet
      'otro'                -- Otro
    )
  );

-- handle_new_user() is the only writer of this row: signup passes the answer as
-- auth user metadata and this trigger copies it across. Recreated in full
-- (create or replace, same as 029) because the insert's column list changes.
--
-- Unlike country, an unrecognised value falls back to NULL rather than to a
-- default member of the list. Country has a right answer to guess at — a
-- referral source does not, and inventing one would quietly corrupt the only
-- number this column exists to produce.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.owners (
    id, email, business_name, first_name, last_name, whatsapp, country,
    accepted_terms_at, referral_source
  )
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'business_name', ''),
    new.raw_user_meta_data ->> 'first_name',
    new.raw_user_meta_data ->> 'last_name',
    new.raw_user_meta_data ->> 'whatsapp',
    case
      when new.raw_user_meta_data ->> 'country' in ('CO', 'VE') then new.raw_user_meta_data ->> 'country'
      else 'CO'
    end,
    now(),
    case
      when new.raw_user_meta_data ->> 'referral_source' in (
        'visita_vendedor', 'recomendacion', 'redes_sociales', 'busqueda_internet', 'otro'
      ) then new.raw_user_meta_data ->> 'referral_source'
      else null
    end
  );
  return new;
end;
$$;

insert into public.schema_migrations (key, description)
values (
  '048_owner_referral_source',
  'Adds owners.referral_source (nullable, checked against a closed list) and has handle_new_user() copy it from signup metadata, so pilot-driven signups can be told apart from the rest.'
)
on conflict (key) do nothing;

commit;

-- ── verification, after running the above ───────────────────────────────
--   select column_name, is_nullable
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'owners'
--     and column_name = 'referral_source';
--
--   select conname, pg_get_constraintdef(oid)
--   from pg_constraint
--   where conrelid = 'public.owners'::regclass
--     and conname = 'owners_referral_source_check';
--
-- And confirm the trigger really carries the new column:
--   select pg_get_functiondef('public.handle_new_user()'::regprocedure)
--     like '%referral_source%' as trigger_updated;
