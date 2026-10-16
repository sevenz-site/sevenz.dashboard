-- THE USDT RATE GETS STORED, SO THE SERVER CAN SEE IT TOO.
--
-- ENVIRONMENT: run first on the DEV branch (vzqppwrwnmlbrxizskdh). Do NOT run
-- against production (rabmiyqodnvnrwiartuj) until the user says to launch.
--
-- This is phase 2 of the three `lib/exchange-rate/usdt-p2p.ts` announced on
-- 2026-09-24: *"FASE 1 DE TRES. HOY ESTO NO SE GUARDA NI SE ENSEÑA A NADIE...
-- La fase 2 (guardarlo y enseñarlo) va detrás de esa medición"*. The
-- measurement has been running since then; this is the storing.
--
-- ===========================================================================
-- WHY IT IS NEEDED: THE SCREEN COULD SEE IT AND THE SERVER COULD NOT
--
-- Owner's decision on 2026-10-15: the public catalogue offers USDT using the
-- CriptoYa rate, with a hand-pinned price as the fallback for when it does not
-- answer.
--
-- The blocker that turned that into its own piece of work: the USDT rate was
-- stored NOWHERE. `fetch-and-store.ts` put it in the cron's HTTP response and
-- said so in a comment. Postgres cannot call CriptoYa, so
-- `create_catalog_order` had no way of knowing it -- and switching it on in
-- the screen alone is worse than not switching it on at all: the customer
-- would pick USDT, fill in the entire form, and the function would reject it
-- with `sin_tasa`. Migration 111's header states that trap: both places or
-- neither.
--
-- ===========================================================================
-- WHY IT IS NOT A CRON, AND THIS IS THE PART THAT DECIDED THE DESIGN
--
-- The obvious answer is "refresh it more often than the daily BCV cron". On
-- Vercel's Hobby plan that does not merely cost money -- **it does not
-- deploy**. Hobby allows up to 100 cron jobs per project but every one of them
-- is limited to a DAILY interval; a `*/30 * * * *` fails at deploy time with
-- "Hobby accounts are limited to daily cron jobs". Confirmed against Vercel's
-- own limits documentation on 2026-10-15, and `PL-3` already records that this
-- project stays on Hobby on purpose.
--
-- And a once-a-day USDT price is not acceptable the way a once-a-day BCV price
-- is: the official rate is published daily by the central bank, while the P2P
-- price moves continuously. Showing a Venezuelan customer yesterday's USDT
-- price is showing them a wrong number about money.
--
-- SO THE REFRESH RIDES ON THE PAGE VIEW INSTEAD. `getBolivarRates()` already
-- asks CriptoYa behind a 60-second `unstable_cache`; from now on that same
-- cache miss also writes the price here. The result:
--
--   * no new cron, so no plan limit is involved at all;
--   * the stored price is ~60 seconds old whenever anybody is browsing;
--   * and the staleness is self-correcting where it matters, because the thing
--     that refreshes it -- somebody opening the catalogue -- is precisely what
--     happens immediately before an order.
--
-- If nobody opens the catalogue for a day the value goes stale, but then
-- nobody is ordering either, and the first view refreshes it before the first
-- order can be placed.
--
-- ===========================================================================
-- THE DRIFT THAT REMAINS, STATED
--
-- The screen shows the value `getBolivarRates()` just fetched; the order reads
-- the row written by that same fetch. They can only disagree when a refresh
-- lands between the customer looking and the customer submitting, which is a
-- window of at most the 60-second cache. That is the same class of drift
-- migration 111 already accepted for the BCV rate, and smaller: the BCV window
-- is the daily cron, this one is a minute.
--
-- The alternative -- screen reads live, server reads stored with no
-- write-through -- is the one that must never be built. Those two do not
-- disagree by drift; they disagree ALWAYS and by design.
--
-- ===========================================================================
-- WHY `get_current_bcv_rate()` IS NOT TOUCHED
--
-- The tempting move is to add a `usdt` column to it. It returns
-- `returns table (usd, eur, source, fetched_at, rate_date)`, so adding one is
-- a SIGNATURE CHANGE: CLAUDE.md requires `drop` + `create` of both signatures,
-- and that function is called from the movement paths, the calculator and the
-- catalogue -- code that works today and has nothing to do with USDT.
--
-- A separate function costs one extra call and risks none of that. The two
-- rates also have genuinely different shapes: the BCV one is an append-only
-- audit log with `needs_review` and `rate_date`, and this one is a single row
-- that gets overwritten. Forcing them into one table would mean inserting a
-- USDT row every minute into the table `get_current_bcv_rate()` reads with
-- `order by fetched_at desc limit 1` -- which would break the dollar.

begin;

-- ===========================================================================
-- 1. ONE ROW, OVERWRITTEN
--
-- NOT AN APPEND-ONLY LOG, unlike `bcv_exchange_rate_fetches`, and the reason
-- is the refresh cadence: a row per minute of browsing would be millions of
-- rows a year to answer a question only ever asked about the latest one. The
-- audit value that justifies the BCV log -- proving which rate was applied to
-- a movement -- is already covered here by `catalog_order_items.unit_price`,
-- which freezes the converted amount at insert time.
--
-- The `id boolean primary key check (id)` is the single-row trick: the only
-- value the primary key accepts is `true`, so a second row cannot exist even
-- by mistake.
-- ===========================================================================

create table if not exists public.usdt_p2p_rate (
  id boolean primary key default true check (id),
  bs_per_usdt numeric not null check (bs_per_usdt > 0),
  source text not null default 'binancep2p',
  updated_at timestamptz not null default now()
);

-- RLS ON WITH ZERO POLICIES, which is this project's pattern for a table no
-- client may touch: both doors are SECURITY DEFINER functions. The grants are
-- revoked explicitly rather than assumed, for the reason migration 067
-- documents -- Supabase hands them out by default.
alter table public.usdt_p2p_rate enable row level security;
revoke all on public.usdt_p2p_rate from anon;
revoke all on public.usdt_p2p_rate from authenticated;

-- ===========================================================================
-- 2. THE WRITE DOOR
--
-- NOT CALLABLE BY `anon`, AND THAT IS THE WHOLE SECURITY OF THIS FILE. The
-- anon key is public -- it ships in the browser bundle -- so granting execute
-- here would let anybody set the USDT rate to any number they liked, and the
-- catalogue would then quote and store prices derived from it. That is exactly
-- the class of hole padlock 5 exists to prevent: a money input arriving from
-- the client.
--
-- Only `service_role` can call it, which means only server-side code holding
-- `SUPABASE_SERVICE_ROLE_KEY`.
--
-- IT IS IDEMPOTENT BY TIME, so calling it on every render is harmless: a write
-- that arrives within 60 seconds of the stored one does nothing. That is what
-- lets the caller be careless -- `getBolivarRates()` can call it every time
-- without thinking about how often it runs.
-- ===========================================================================

drop function if exists public.set_usdt_p2p_rate(numeric);
drop function if exists public.set_usdt_p2p_rate(numeric, text);

create function public.set_usdt_p2p_rate(p_amount numeric, p_source text default 'binancep2p')
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- A bad number is ignored instead of raising: this is called from a page
  -- render, and a rate refresh must never be able to take down a catalogue.
  if p_amount is null or p_amount <= 0 then
    return;
  end if;

  insert into public.usdt_p2p_rate (id, bs_per_usdt, source, updated_at)
  values (true, p_amount, coalesce(nullif(btrim(p_source), ''), 'binancep2p'), now())
  on conflict (id) do update
    set bs_per_usdt = excluded.bs_per_usdt,
        source = excluded.source,
        updated_at = now()
    -- THE 60 SECONDS LIVE HERE AND NOT IN THE CALLER, so every present and
    -- future caller gets the same cadence. It matches the `unstable_cache`
    -- window in `lib/products/catalog.ts` on purpose: two different windows
    -- for the same price would show one figure in the catalogue and another
    -- in the shopkeeper's product form, which is the kind of difference
    -- nobody can explain afterwards.
    where public.usdt_p2p_rate.updated_at < now() - interval '60 seconds';
end;
$$;

revoke execute on function public.set_usdt_p2p_rate(numeric, text) from public;
revoke execute on function public.set_usdt_p2p_rate(numeric, text) from anon;
revoke execute on function public.set_usdt_p2p_rate(numeric, text) from authenticated;
grant execute on function public.set_usdt_p2p_rate(numeric, text) to service_role;

comment on function public.set_usdt_p2p_rate(numeric, text) is
  'Stores the USDT/VES P2P price so SQL can read it. Called server-side only, with the service role: granting it to anon would let anybody set the rate the catalogue quotes and stores. Idempotent by time -- a write within 60 seconds of the stored one does nothing -- so callers need not think about how often they run.';

-- ===========================================================================
-- 3. THE READ DOOR
--
-- STALE MEANS ABSENT. Past the cap it returns null, and every caller already
-- treats a null USDT rate as "do not offer this currency" -- which is what the
-- screen and `create_catalog_order` both did before this migration existed.
-- So the failure mode of a long-unvisited catalogue is the old behaviour, not
-- a wrong price.
--
-- 24 HOURS, which looks generous next to a 60-second refresh and is chosen on
-- purpose: it is the cadence the BCV rate itself already runs at, so the USDT
-- price can never be staler than the dollar price already shown beside it.
-- Tightening it would only turn a browsing lull into "USDT disappeared", with
-- nothing on screen explaining why.
--
-- Not granted to anyone: the catalogue's SECURITY DEFINER functions call it as
-- their definer, and the screen gets its figure from `getBolivarRates()`.
-- ===========================================================================

drop function if exists public.get_current_usdt_rate();

create function public.get_current_usdt_rate()
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select r.bs_per_usdt
  from public.usdt_p2p_rate r
  where r.id = true
    and r.updated_at > now() - interval '24 hours'
$$;

revoke execute on function public.get_current_usdt_rate() from public;
revoke execute on function public.get_current_usdt_rate() from anon;
revoke execute on function public.get_current_usdt_rate() from authenticated;

comment on function public.get_current_usdt_rate() is
  'The stored USDT/VES P2P price, or null when it is older than 24 hours. Stale means absent on purpose: every caller already treats a null USDT rate as "do not offer that currency", so a long-unvisited catalogue falls back to the pre-111 behaviour instead of quoting a wrong price. Internal: the catalogue SECURITY DEFINER functions call it as their definer.';

insert into public.schema_migrations (key, description)
values (
  '112_la_tasa_del_usdt_se_guarda',
  'Guarda el precio P2P del USDT para que SQL lo pueda leer. Es la fase 2 que usdt-p2p.ts anuncio el 2026-09-24. Hacia falta porque el dueno decidio el 2026-10-15 ofrecer USDT en el catalogo, y la tasa no estaba guardada en ningun sitio: el cron la devolvia en su respuesta HTTP y nunca la escribia, asi que create_catalog_order no podia convertirla y encenderla solo en la pantalla habria dejado al cliente eligiendo algo que la funcion rechaza con sin_tasa. NO ES UN CRON, y no por gusto: en el plan Hobby de Vercel todo cron esta limitado a intervalo DIARIO -- un */30 falla en el despliegue con "Hobby accounts are limited to daily cron jobs" -- y un precio P2P de hace 24 horas es un numero equivocado sobre dinero. El refresco viaja en la carga de pagina: getBolivarRates ya pregunta a CriptoYa detras de una cache de 60 segundos y ahora ese mismo fallo de cache escribe aqui, asi que el valor tiene ~60 segundos mientras alguien navega y se refresca justo antes de que haya una orden. Una sola fila que se sobrescribe, no un log: la auditoria que justifica el log del BCV ya la cubre catalog_order_items.unit_price, que congela el importe. set_usdt_p2p_rate NO se concede a anon -- la clave anonima viaja en el navegador y concederla dejaria a cualquiera fijar la tasa que el catalogo cotiza y guarda, que es el agujero del candado 5. Es idempotente por tiempo, 60 segundos, para que el que llama no tenga que pensar. get_current_usdt_rate devuelve null pasadas 24 horas, y rancio significa ausente: todos los que llaman ya tratan un null como "no ofrecer esa moneda", asi que un catalogo sin visitas vuelve al comportamiento anterior en vez de cotizar mal. get_current_bcv_rate NO se toca: anadirle una columna seria cambio de firma de una funcion que usan los movimientos, la calculadora y el catalogo.'
)
on conflict (key) do nothing;

commit;

-- ── verification, after running the above ───────────────────────────────
--
-- 1. The table exists, has RLS on and zero policies:
--
-- select t.rowsecurity, count(p.policyname) as policies
-- from pg_tables t
-- left join pg_policies p on p.schemaname = t.schemaname and p.tablename = t.tablename
-- where t.schemaname = 'public' and t.tablename = 'usdt_p2p_rate'
-- group by t.rowsecurity;
--
-- EXPECTED: rowsecurity = true, policies = 0.
--
-- 2. `anon` can touch NEITHER the table NOR either function:
--
-- select
--   (select count(*) from information_schema.role_table_grants
--     where table_schema = 'public' and table_name = 'usdt_p2p_rate'
--       and grantee in ('anon', 'authenticated')) as grants_de_cliente,
--   has_function_privilege('anon', 'public.set_usdt_p2p_rate(numeric, text)', 'execute') as anon_escribe,
--   has_function_privilege('anon', 'public.get_current_usdt_rate()', 'execute') as anon_lee,
--   has_function_privilege('service_role', 'public.set_usdt_p2p_rate(numeric, text)', 'execute') as servidor_escribe;
--
-- EXPECTED: 0, false, false, true.
--
-- 3. The write works and is idempotent by time -- the second call must NOT
--    move the number, because it lands inside the same 60 seconds:
--
-- select public.set_usdt_p2p_rate(250.5);
-- select public.set_usdt_p2p_rate(999.9);
-- select bs_per_usdt, source, updated_at from public.usdt_p2p_rate;
--
-- EXPECTED: bs_per_usdt = 250.5. If it says 999.9 the 60-second guard is not
-- working, and the catalogue would hit CriptoYa on every single page view.
--
-- 4. And it reads back through its own door:
--
-- select public.get_current_usdt_rate() as tasa;
--
-- EXPECTED: 250.5 -- the row was just written, so it is inside the 24 hours.
--
-- 5. Clean up the test value, so dev does not keep a made-up rate:
--
-- delete from public.usdt_p2p_rate;
