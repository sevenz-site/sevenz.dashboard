-- Additive migration: run once in the SQL editor. Doesn't touch existing data.
alter table public.owners add column if not exists onboarding_completed_at timestamptz;
