-- Run once in the SQL editor, BOTH the dev branch and production Supabase
-- project — same dual-environment discipline as every migration before it.
--
-- Tracks every schema change against a database (not just one-time data
-- conversions, which stay in applied_data_migrations for their own narrower
-- purpose) so a pre-launch check can compare dev's and production's own
-- copies of this table and catch anything dev has that production doesn't
-- — including a one-off manual fix run directly in the SQL editor, not just
-- a numbered migration file. See CLAUDE.md: any SQL run against dev must
-- end with a row here, no exceptions for "it's just a small fix."

create table if not exists public.schema_migrations (
  key text primary key,
  description text,
  applied_at timestamptz not null default now()
);

-- Internal bookkeeping, checked directly via the SQL editor when comparing
-- dev vs. production — same deny-by-default pattern as
-- applied_data_migrations. No app code ever reads or writes this table.
alter table public.schema_migrations enable row level security;

insert into public.schema_migrations (key, description)
values ('028_schema_migrations_ledger', 'Creates the schema_migrations ledger itself')
on conflict (key) do nothing;
