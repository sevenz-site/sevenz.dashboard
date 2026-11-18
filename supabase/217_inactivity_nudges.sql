-- 217 · INACTIVITY NUDGES: who gets one, when, and how the owner turns them off
--
-- Owner's request of 2026-11-17 (MS-53): send the four reactivation templates approved by Meta
-- on 2026-11-16 (`inactive_nudge_credit`, `_catalog`, `_inventory`, `_cash_sales`, all
-- MARKETING) to accounts that stopped registering, by WhatsApp and by email. Decisions that
-- day, each asked as a straight choice:
--
--   «Las 4, sin SENIAT»  `inactive_nudge_tax_invoice` is approved but never sent from here.
--   cadence              one every 3 weeks to an account 15 days without registering, until
--                        its 3-month trial ends. Displaces 2026-11-16 (every 15 days, 14 days).
--   «También correo»     an email with every nudge, with one-click unsubscribe.
--   «Switch nuevo»       «Consejos de Sevenz» in Mi negocio turns these off on both channels
--                        and leaves the Monday summary and the Thursday notice alone.
--   «Subdominio aparte»  the emails leave from their own subdomain, never the one that sends
--                        login codes (the sender lives in code, `RESEND_TIPS_FROM`).
--   «Esperar al lunes libre»  a nudge goes on a Monday whose WhatsApp slot stayed silent, email
--                        and WhatsApp together; a busy Monday pushes both to the next free one.
--
-- WHAT THIS FILE HOLDS, and what it does not. The Monday slot is decided in TypeScript
-- (`mondayPlan`, lib/whatsapp/business-weekly-text.ts), so «is this Monday free» is answered
-- there, in the same run, from the plan that just came out. This file answers everything the
-- database knows: real account, in trial, not paused, email confirmed, 15 days quiet, not
-- opted out, and at least 21 days since the last nudge.
--
-- Run in DEV (`vzqppwrwnmlbrxizskdh`) first, then PRODUCTION (`rabmiyqodnvnrwiartuj`) in the
-- release window, BEFORE the code: the code calls these functions and stops sending (it does
-- not fail the cron) when they are missing.
--
-- RE-RUNNABLE: `if not exists` on the column and the table, `create or replace` on functions
-- whose signatures never change.

begin;

-- ── 1. THE SWITCH ──────────────────────────────────────────────────────────────────────────
-- Null = he gets them. A date = he turned them off then. The same shape as
-- `whatsapp_opt_out_at`: the date is the evidence, and turning them back on clears it.
alter table public.owners
  add column if not exists product_tips_opt_out_at timestamptz;

comment on column public.owners.product_tips_opt_out_at is
  'Cuándo el dueño apagó «Consejos de Sevenz» (avisos de inactividad por WhatsApp y correo). Null = los recibe. Lo escribe el interruptor de Mi negocio o el enlace de baja del correo.';

-- ── 2. THE LOG ─────────────────────────────────────────────────────────────────────────────
-- One row per owner per nudge Monday. It is what the 21-day cadence and the rotation read,
-- and it holds both channels so «he got the email but not the WhatsApp» stays visible.
-- `whatsapp_sends` still logs the WhatsApp side as it logs every template.
create table if not exists public.inactivity_nudges (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owners (id) on delete cascade,
  cycle_on date not null,
  template text not null,
  -- 'sent' | 'failed' | 'skipped' (no consent, no number, or the gate said no).
  whatsapp_status text not null,
  -- 'sent' | 'failed' | 'skipped' (no sender configured yet, or no address).
  email_status text not null,
  created_at timestamptz not null default now(),
  unique (owner_id, cycle_on)
);

-- Server only. No policy for `authenticated`: the owner never reads this table, and the
-- service role reaches it through the two functions below (production does not grant the
-- service role SELECT on new tables by default; see migration 213).
alter table public.inactivity_nudges enable row level security;

-- ── 3. WHO IS DUE ──────────────────────────────────────────────────────────────────────────
create or replace function public.inactivity_nudge_targets()
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  select jsonb_build_object(
           'owner_id', o.id,
           'email', u.email,
           'whatsapp', o.whatsapp,
           -- Same consent rule as every owner message (119).
           'whatsapp_ok', (
             o.whatsapp is not null and btrim(o.whatsapp) <> ''
             and o.whatsapp_opt_in_at is not null
             and (o.whatsapp_opt_out_at is null or o.whatsapp_opt_in_at > o.whatsapp_opt_out_at)
           ),
           'first_name', o.first_name,
           'business_name', o.business_name,
           'country', o.country,
           -- How many nudges he already got: the rotation's index.
           'nudges_sent', (select count(*) from public.inactivity_nudges n where n.owner_id = o.id)
         )
    from public.owners o
    join public.subscriptions s on s.owner_id = o.id
    join auth.users u on u.id = o.id
   where s.estado = 'demo'
     and not coalesce(s.is_test_account, false)
     -- «Hasta que termine su prueba»: a trial with no end date is not one this can reason
     -- about, so it gets nothing.
     and s.demo_termina_el is not null
     and s.demo_termina_el > now()
     and public.owner_puede_escribir(o.id)
     and u.email_confirmed_at is not null
     and o.product_tips_opt_out_at is null
     -- 15 days old at least: a brand-new account has registered nothing yet and is not
     -- «inactive», it is starting.
     and o.created_at <= now() - interval '15 days'
     -- «15 días sin registrar»: no sale, fiado or abono written in the last 15 days.
     and not exists (
       select 1 from public.sales sa
        where sa.owner_id = o.id and sa.created_at > now() - interval '15 days')
     and not exists (
       select 1 from public.movements m
         join public.clients c on c.id = m.client_id
        where c.owner_id = o.id and m.created_at > now() - interval '15 days')
     -- One every 3 weeks: 21 days since the last nudge Monday.
     and not exists (
       select 1 from public.inactivity_nudges n
        where n.owner_id = o.id and n.cycle_on > (now() at time zone 'America/Bogota')::date - 21);
$fn$;

revoke execute on function public.inactivity_nudge_targets() from public, anon, authenticated;
grant execute on function public.inactivity_nudge_targets() to service_role;

-- ── 4. WRITING THE LOG ─────────────────────────────────────────────────────────────────────
-- `on conflict do nothing`: a second run the same Monday cannot log, or send, twice; the
-- caller reserves the row BEFORE sending and updates it after (the order `send.ts` uses).
create or replace function public.inactivity_nudge_reserve(p_owner_id uuid, p_cycle_on date, p_template text)
returns uuid
language sql
security definer
set search_path = public
as $fn$
  insert into public.inactivity_nudges (owner_id, cycle_on, template, whatsapp_status, email_status)
  values (p_owner_id, p_cycle_on, p_template, 'pending', 'pending')
  on conflict (owner_id, cycle_on) do nothing
  returning id;
$fn$;

create or replace function public.inactivity_nudge_finish(p_id uuid, p_whatsapp_status text, p_email_status text)
returns void
language sql
security definer
set search_path = public
as $fn$
  update public.inactivity_nudges
     set whatsapp_status = p_whatsapp_status, email_status = p_email_status
   where id = p_id;
$fn$;

revoke execute on function public.inactivity_nudge_reserve(uuid, date, text) from public, anon, authenticated;
grant execute on function public.inactivity_nudge_reserve(uuid, date, text) to service_role;
revoke execute on function public.inactivity_nudge_finish(uuid, text, text) from public, anon, authenticated;
grant execute on function public.inactivity_nudge_finish(uuid, text, text) to service_role;

-- Who already got a nudge since a date: the Monday batch treats them as «Monday used», so a
-- Tuesday retry of that batch cannot put a second message in the same Monday slot.
create or replace function public.inactivity_nudged_owners(p_since date)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $fn$
  select n.owner_id from public.inactivity_nudges n
   where n.cycle_on >= p_since and n.whatsapp_status in ('pending', 'sent');
$fn$;

revoke execute on function public.inactivity_nudged_owners(date) from public, anon, authenticated;
grant execute on function public.inactivity_nudged_owners(date) to service_role;

-- ── 5. THE EMAIL'S ONE-CLICK UNSUBSCRIBE ───────────────────────────────────────────────────
-- Called by the public route with an owner id it has already verified with an HMAC. It only
-- ever turns the nudges OFF, never on, so a forged call could at worst stop a marketing email.
create or replace function public.product_tips_unsubscribe(p_owner_id uuid)
returns void
language sql
security definer
set search_path = public
as $fn$
  update public.owners
     set product_tips_opt_out_at = coalesce(product_tips_opt_out_at, now())
   where id = p_owner_id;
$fn$;

revoke execute on function public.product_tips_unsubscribe(uuid) from public, anon, authenticated;
grant execute on function public.product_tips_unsubscribe(uuid) to service_role;

insert into public.schema_migrations (key, description)
values (
  '217_inactivity_nudges',
  'Avisos de inactividad (MS-53): owners.product_tips_opt_out_at para el interruptor «Consejos de Sevenz», la tabla inactivity_nudges (un aviso por dueño y lunes, con su estado por WhatsApp y por correo), a quién le toca (cuenta real en prueba, no pausada, correo confirmado, 15 días sin ventas, fiados ni abonos, 21 días desde el último aviso) y la baja del correo. Decisiones del dueño del 2026-11-17.'
)
on conflict (key) do nothing;

commit;
