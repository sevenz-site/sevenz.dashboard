-- ENVIRONMENT: run in BOTH — dev branch (vzqppwrwnmlbrxizskdh) first, then
-- production (rabmiyqodnvnrwiartuj). Only adds a table and a function; nothing
-- calls it until the code deploy, so the order between them is free.
--
-- Adds a quota limiter for the two endpoints anyone can reach without logging
-- in: submitDocumentId and uploadProfilePicture in app/s/[token]/actions.ts.
-- Both need only a share token — the link an owner sends every client over
-- WhatsApp — so their real audience is "anyone who has ever been forwarded
-- one of those messages".
--
-- Deliberately NOT claim_rate_limit_slot. That one queues: it returns a
-- timestamp and the caller sleeps until its turn, which is right for pacing a
-- shared Gemini quota and exactly wrong here — it would hold a serverless
-- function open on an attacker's behalf, turning a rate limit into a way to
-- exhaust the function budget. This one answers yes or no and returns
-- immediately. The two coexist; neither replaces the other.
begin;

-- Keyed per share token rather than per IP. The token is the thing being
-- abused, and IP is a poor identity in both markets this app serves — carrier
-- NAT puts thousands of Venezuelan and Colombian mobile users behind the same
-- address, so an IP limit would either be too loose to matter or would lock out
-- a whole carrier because of one script.
create table if not exists public.rate_limit_counters (
  key text primary key,
  window_started_at timestamptz not null default now(),
  hits int not null default 0
);

-- No policies, same posture as rate_limiters: nothing queries this directly.
-- Access is through the SECURITY DEFINER function below, which bypasses RLS.
alter table public.rate_limit_counters enable row level security;

-- Returns true when the caller may proceed, false when it has spent its quota.
--
-- One statement, so it is atomic under concurrency: the ON CONFLICT path takes
-- a row lock, and two simultaneous requests for the same token cannot both read
-- the same count and both decide they are under the limit.
create or replace function public.claim_rate_limit_quota(
  p_key text,
  p_limit int,
  p_window_seconds int
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hits int;
begin
  insert into public.rate_limit_counters (key, window_started_at, hits)
  values (p_key, now(), 1)
  on conflict (key) do update
  set
    -- A window that has aged out starts over rather than being topped up, so a
    -- caller who was blocked an hour ago is not still blocked now.
    window_started_at = case
      when rate_limit_counters.window_started_at
             < now() - make_interval(secs => p_window_seconds)
        then now()
      else rate_limit_counters.window_started_at
    end,
    hits = case
      when rate_limit_counters.window_started_at
             < now() - make_interval(secs => p_window_seconds)
        then 1
      else rate_limit_counters.hits + 1
    end
  returning rate_limit_counters.hits into v_hits;

  -- Counting past the limit is intentional: a refused request still increments,
  -- so the row shows how hard something hammered rather than flattening at the
  -- ceiling. It costs one row update per refusal.
  return v_hits <= p_limit;
end;
$$;

-- service_role only. These endpoints are unauthenticated, so the limiter must
-- not be callable by the same anon key the caller already holds — otherwise
-- anyone could burn a token's quota, or call it repeatedly to find out which
-- tokens exist. The server actions invoke it through createServiceClient().
revoke execute on function public.claim_rate_limit_quota(text, int, int)
  from public, anon, authenticated;
grant execute on function public.claim_rate_limit_quota(text, int, int)
  to service_role;

insert into public.schema_migrations (key, description)
values (
  '040_public_endpoint_rate_limits',
  'Adds rate_limit_counters and claim_rate_limit_quota() — a reject-immediately quota limiter, per share token, for the two unauthenticated actions in app/s/[token]/actions.ts.'
)
on conflict (key) do nothing;

commit;
