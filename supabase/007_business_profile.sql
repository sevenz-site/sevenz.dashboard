-- Additive migration: run once in the SQL editor. Doesn't touch existing data.
alter table public.owners add column if not exists address text;
alter table public.owners add column if not exists tax_id text;
alter table public.owners add column if not exists logo_path text;
