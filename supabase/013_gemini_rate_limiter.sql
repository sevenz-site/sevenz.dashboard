-- Additive migration: run once in the SQL editor. Doesn't touch existing data.
--
-- Global rate limiter shared across ALL owners' requests, so the per-batch
-- spacing already in app/api/extract/route.ts can't be defeated just by two
-- different owners importing a libreta at the same moment. Every single call
-- to Gemini — from any owner, any server instance — claims a slot here
-- first; the table is the one shared clock everyone waits on.

create table if not exists public.rate_limiters (
  key text primary key,
  next_available_at timestamptz not null default now()
);

-- No policies: nobody queries this table directly. All access goes through
-- claim_rate_limit_slot(), a SECURITY DEFINER function that bypasses RLS.
alter table public.rate_limiters enable row level security;

insert into public.rate_limiters (key, next_available_at)
values ('gemini_extract', now())
on conflict (key) do nothing;

-- Atomically reserves the next free slot for `p_key`, spaced at least
-- `p_spacing_ms` after the previous slot, and returns the timestamp the
-- caller must wait until before actually making its request. The
-- `on conflict ... do update` is a standard Postgres idiom for taking a row
-- lock on upsert, so concurrent callers queue up correctly instead of racing.
create or replace function public.claim_rate_limit_slot(p_key text, p_spacing_ms int)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wait_until timestamptz;
begin
  insert into public.rate_limiters (key, next_available_at)
  values (p_key, now())
  on conflict (key) do update set next_available_at = rate_limiters.next_available_at
  returning greatest(now(), rate_limiters.next_available_at) into v_wait_until;

  update public.rate_limiters
  set next_available_at = v_wait_until + make_interval(secs => p_spacing_ms / 1000.0)
  where key = p_key;

  return v_wait_until;
end;
$$;

grant execute on function public.claim_rate_limit_slot(text, int) to authenticated;
