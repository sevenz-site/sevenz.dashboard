-- ENVIRONMENT: run in DEV first (vzqppwrwnmlbrxizskdh). Production comes later,
-- with its own green light, and BEFORE the code that reads it. Re-runnable:
-- tables and indexes use `if not exists`, every function is dropped by its
-- exact signature and created again, and the ledger row is `on conflict`.
--
-- ===========================================================================
-- 198: KEY ACCOUNT MANAGERS, THEIR COMMISSION, AND THE ACCOUNT'S FEEDBACK
--
-- The owner's request of 2026-11-07, four points: register the KAM of each
-- account, trace the feedback of the businesses and their payments, a
-- «Comisión» section, and a history that shows everything done to the account.
--
-- His decisions that day, asked as straight choices:
--   - A KAM is ONE record with many accounts, and only a record: no login.
--     «Ficha única»: editing it from one account changes it for all of them.
--   - Feedback is a note with a type and an optional attachment. Never edited.
--   - The commission is paid on EVERY charge of the period, 6 months by
--     default, and only on what the business actually paid: «Solo lo que el
--     negocio pagó». A payment generates its share, capped at the total.
--   - With no agreed price the proposal comes from the Pro price of the
--     catalogue, so a Free account in trial does not propose $0.
--   - The agreement is FIXED once saved: if the demo or the price moves, the
--     screen warns and a person decides. This is the rule «UNA CIFRA DEL PASADO
--     NO SE CALCULA CON DATOS DE HOY», and it has a sharper reason here:
--     `admin_registrar_pago` sets `demo_termina_el` to null, so a start date
--     derived from it would vanish with the first payment.
--   - Changing the KAM closes the running agreement that day and the next KAM
--     starts with an agreement of their own. What is pending for the first one
--     is not lost: a closed agreement can still be paid.
--   - What Sevenz pays each KAM is recorded too.
--
-- WHERE THE ARITHMETIC LIVES. Nothing here computes a total. These functions
-- store the agreement and return raw rows; `lib/admin/commission.ts` is the
-- only place that counts charges and shares, so the screen and its tests cannot
-- disagree with a second copy written in SQL. That is the trap of `CT-124`.
--
-- DOLLARS ONLY, because `precio_pactado_usd` is what the base comes from.
--
-- WHO CAN REACH THIS. Row level security on, no policy, nothing granted to
-- `anon` or `authenticated`: a KAM's phone number and what they earn are
-- internal. Every function is `security definer` and executable by
-- `service_role` alone, and /admin calls it after `requireSuperadmin()`.
-- Production gives `service_role` no reads on owner tables, so these functions
-- are also what keeps the panel working there (`qa:service-role`).
--
-- THE HISTORY. Commercial actions go to `account_commercial_events`, and not to
-- `subscription_events`: `admin_ingresos_por_mes` sums `monto_usd` from that
-- table, so a commission written there would be counted as income. Each row is
-- written by the function that makes the change, in the same transaction.

begin;

-- ── 1. Tables ────────────────────────────────────────────────────────────

create table if not exists public.kams (
  id uuid primary key default gen_random_uuid(),
  first_name text not null check (length(trim(first_name)) between 1 and 80),
  last_name text not null check (length(trim(last_name)) between 1 and 80),
  email text not null check (length(email) between 3 and 200),
  city text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One person, one record: two rows with the same address would split that
-- person's accounts in two under the same search.
create unique index if not exists kams_email_unique on public.kams (lower(email));

create table if not exists public.account_kam_assignments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owners (id) on delete cascade,
  kam_id uuid not null references public.kams (id) on delete restrict,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  actor_email text
);

create unique index if not exists account_kam_one_active
  on public.account_kam_assignments (owner_id) where ended_at is null;
create index if not exists account_kam_by_kam
  on public.account_kam_assignments (kam_id) where ended_at is null;

create table if not exists public.kam_commissions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owners (id) on delete cascade,
  kam_id uuid not null references public.kams (id) on delete restrict,
  starts_on date not null,
  ends_on date not null,
  -- Set when the KAM changes or leaves. The agreement stops counting there.
  closed_on date,
  -- What the KAM earns per charge, and the charge it was agreed on. A payment
  -- generates `payment * amount / base`, so a partial or a prepaid payment
  -- generates its share instead of a whole period.
  amount_usd numeric(12, 2) not null check (amount_usd > 0),
  base_price_usd numeric(12, 2) not null check (base_price_usd > 0),
  periodicidad text not null check (periodicidad in ('mensual', 'trimestral', 'anual')),
  -- The end of the demo when the agreement was saved, to warn if it moves.
  source_demo_ends_on date,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint kam_commissions_dates check (ends_on >= starts_on)
);

-- At most one running agreement per account.
create unique index if not exists kam_commissions_one_open
  on public.kam_commissions (owner_id) where closed_on is null;

create table if not exists public.kam_commission_payments (
  id uuid primary key default gen_random_uuid(),
  commission_id uuid not null references public.kam_commissions (id) on delete cascade,
  paid_on date not null,
  amount_usd numeric(12, 2) not null check (amount_usd > 0),
  method text not null,
  note text,
  actor_email text,
  created_at timestamptz not null default now()
);

create index if not exists kam_commission_payments_by_commission
  on public.kam_commission_payments (commission_id);

-- The value is English because it outlives the code; the screen translates it.
create table if not exists public.account_feedback (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owners (id) on delete cascade,
  kind text not null check (kind in ('complaint', 'suggestion', 'praise', 'question')),
  body text not null check (length(trim(body)) between 1 and 2000),
  -- Path inside the private `comprobantes` bucket, never a URL.
  attachment_path text,
  -- A copy and not a reference: this says who was in charge when it was heard.
  kam_id uuid references public.kams (id) on delete set null,
  actor_email text,
  created_at timestamptz not null default now()
);

create index if not exists account_feedback_by_owner
  on public.account_feedback (owner_id, created_at desc);

create table if not exists public.account_commercial_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owners (id) on delete cascade,
  action text not null,
  actor_email text,
  detail jsonb not null default '{}'::jsonb,
  proof_path text,
  occurred_at timestamptz not null default now()
);

create index if not exists account_commercial_events_by_owner
  on public.account_commercial_events (owner_id, occurred_at desc);

alter table public.kams enable row level security;
alter table public.account_kam_assignments enable row level security;
alter table public.kam_commissions enable row level security;
alter table public.kam_commission_payments enable row level security;
alter table public.account_feedback enable row level security;
alter table public.account_commercial_events enable row level security;

revoke all on table public.kams from public, anon, authenticated;
revoke all on table public.account_kam_assignments from public, anon, authenticated;
revoke all on table public.kam_commissions from public, anon, authenticated;
revoke all on table public.kam_commission_payments from public, anon, authenticated;
revoke all on table public.account_feedback from public, anon, authenticated;
revoke all on table public.account_commercial_events from public, anon, authenticated;

-- ── 2. Writing the history ───────────────────────────────────────────────

drop function if exists public.admin_log_commercial(uuid, text, text, jsonb);
create function public.admin_log_commercial(p_owner uuid, p_action text, p_actor_email text, p_detail jsonb)
returns uuid
language sql
security definer
set search_path = public
as $fn$
  insert into public.account_commercial_events (owner_id, action, actor_email, detail)
  values (p_owner, p_action, p_actor_email, coalesce(p_detail, '{}'::jsonb))
  returning id;
$fn$;

-- ── 3. The KAM record ────────────────────────────────────────────────────

drop function if exists public.admin_kam_list();
create function public.admin_kam_list()
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', k.id,
    'first_name', k.first_name,
    'last_name', k.last_name,
    'email', k.email,
    'city', k.city,
    'phone', k.phone,
    'accounts', (select count(*) from public.account_kam_assignments a
                 where a.kam_id = k.id and a.ended_at is null)
  ) order by lower(k.first_name), lower(k.last_name)), '[]'::jsonb)
  from public.kams k;
$fn$;

drop function if exists public.admin_kam_create(text, text, text, text, text);
create function public.admin_kam_create(
  p_first_name text, p_last_name text, p_email text, p_city text, p_phone text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id uuid;
begin
  insert into public.kams (first_name, last_name, email, city, phone)
  values (trim(p_first_name), trim(p_last_name), lower(trim(p_email)),
          nullif(trim(p_city), ''), nullif(trim(p_phone), ''))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'kam_id', v_id);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'code', 'email_taken');
end;
$fn$;

-- Writes one line in the history of every account the KAM serves: the edit
-- changed what all of them show.
drop function if exists public.admin_kam_update(uuid, text, text, text, text, text, text);
create function public.admin_kam_update(
  p_kam uuid, p_first_name text, p_last_name text, p_email text, p_city text, p_phone text, p_actor_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_before public.kams;
  v_fields text[] := '{}';
begin
  select * into v_before from public.kams where id = p_kam for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'no_kam');
  end if;

  if v_before.first_name is distinct from trim(p_first_name) then v_fields := array_append(v_fields, 'nombre'); end if;
  if v_before.last_name is distinct from trim(p_last_name) then v_fields := array_append(v_fields, 'apellido'); end if;
  if v_before.email is distinct from lower(trim(p_email)) then v_fields := array_append(v_fields, 'correo'); end if;
  if v_before.city is distinct from nullif(trim(p_city), '') then v_fields := array_append(v_fields, 'ciudad'); end if;
  if v_before.phone is distinct from nullif(trim(p_phone), '') then v_fields := array_append(v_fields, 'teléfono'); end if;

  if array_length(v_fields, 1) is null then
    return jsonb_build_object('ok', true, 'changed', 0);
  end if;

  update public.kams
  set first_name = trim(p_first_name), last_name = trim(p_last_name), email = lower(trim(p_email)),
      city = nullif(trim(p_city), ''), phone = nullif(trim(p_phone), ''), updated_at = now()
  where id = p_kam;

  insert into public.account_commercial_events (owner_id, action, actor_email, detail)
  select a.owner_id, 'kam_updated', p_actor_email,
         jsonb_build_object('kam_name', trim(p_first_name) || ' ' || trim(p_last_name), 'fields', to_jsonb(v_fields))
  from public.account_kam_assignments a
  where a.kam_id = p_kam and a.ended_at is null;

  return jsonb_build_object('ok', true, 'changed', array_length(v_fields, 1));
exception when unique_violation then
  return jsonb_build_object('ok', false, 'code', 'email_taken');
end;
$fn$;

-- ── 4. Assigning, changing and removing ──────────────────────────────────

-- `p_kam` null leaves the account without a KAM. Both a change and a removal
-- close the running agreement on the business's own calendar day.
drop function if exists public.admin_kam_assign(uuid, uuid, text);
create function public.admin_kam_assign(p_owner uuid, p_kam uuid, p_actor_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_country text;
  v_today date;
  v_current_id uuid;
  v_current_kam uuid;
  v_old_name text;
  v_new_name text;
  v_open public.kam_commissions;
  v_action text;
begin
  -- The row lock makes two simultaneous changes of the same account take turns.
  select country into v_country from public.owners where id = p_owner for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'no_account');
  end if;
  v_today := (now() at time zone public.admin_zona(v_country))::date;

  select a.id, a.kam_id, k.first_name || ' ' || k.last_name
    into v_current_id, v_current_kam, v_old_name
  from public.account_kam_assignments a
  join public.kams k on k.id = a.kam_id
  where a.owner_id = p_owner and a.ended_at is null;

  if p_kam is not null then
    select first_name || ' ' || last_name into v_new_name from public.kams where id = p_kam;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'no_kam');
    end if;
  end if;

  if v_current_kam is not distinct from p_kam then
    return jsonb_build_object('ok', false, 'code', 'same_kam');
  end if;

  if v_current_id is not null then
    update public.account_kam_assignments set ended_at = now() where id = v_current_id;
  end if;

  select * into v_open from public.kam_commissions where owner_id = p_owner and closed_on is null;
  if found then
    update public.kam_commissions set closed_on = v_today, updated_at = now() where id = v_open.id;
    perform public.admin_log_commercial(p_owner, 'commission_closed', p_actor_email,
      jsonb_build_object('kam_name', v_old_name, 'closed_on', v_today));
  end if;

  if p_kam is not null then
    insert into public.account_kam_assignments (owner_id, kam_id, actor_email)
    values (p_owner, p_kam, p_actor_email);
  end if;

  v_action := case when p_kam is null then 'kam_removed' when v_current_id is null then 'kam_assigned' else 'kam_changed' end;
  perform public.admin_log_commercial(p_owner, v_action, p_actor_email,
    jsonb_build_object('from', v_old_name, 'to', v_new_name));

  return jsonb_build_object('ok', true, 'action', v_action);
end;
$fn$;

-- ── 5. The agreement ─────────────────────────────────────────────────────

-- `p_commission` null creates; otherwise it edits, and only a running agreement
-- of this same account. The base, the period and the demo date come from the
-- server action, which derives them from the account: never from the browser.
drop function if exists public.admin_commission_save(uuid, uuid, date, date, numeric, numeric, text, date, text);
create function public.admin_commission_save(
  p_owner uuid,
  p_commission uuid,
  p_starts_on date,
  p_ends_on date,
  p_amount_usd numeric,
  p_base_price_usd numeric,
  p_periodicidad text,
  p_source_demo_ends_on date,
  p_actor_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_before public.kam_commissions;
  v_kam uuid;
  v_kam_name text;
  v_last_end date;
  v_id uuid;
begin
  if p_starts_on is null or p_ends_on is null or p_ends_on < p_starts_on then
    return jsonb_build_object('ok', false, 'code', 'bad_dates');
  end if;
  if p_amount_usd is null or p_amount_usd <= 0 or p_base_price_usd is null or p_base_price_usd <= 0 then
    return jsonb_build_object('ok', false, 'code', 'bad_amount');
  end if;

  -- Before the overlap check, so editing a closed agreement says what is wrong.
  if p_commission is not null then
    select * into v_before from public.kam_commissions
    where id = p_commission and owner_id = p_owner and closed_on is null
    for update;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'no_commission');
    end if;
  end if;

  -- A payment on a day two agreements share would generate commission twice.
  select max(least(closed_on, ends_on)) into v_last_end
  from public.kam_commissions
  where owner_id = p_owner
    and closed_on is not null
    and starts_on <= least(closed_on, ends_on);
  if v_last_end is not null and p_starts_on <= v_last_end then
    return jsonb_build_object('ok', false, 'code', 'overlaps', 'last_end_on', v_last_end);
  end if;

  if p_commission is null then
    select a.kam_id, k.first_name || ' ' || k.last_name into v_kam, v_kam_name
    from public.account_kam_assignments a
    join public.kams k on k.id = a.kam_id
    where a.owner_id = p_owner and a.ended_at is null;
    if v_kam is null then
      return jsonb_build_object('ok', false, 'code', 'no_kam');
    end if;
    if exists (select 1 from public.kam_commissions where owner_id = p_owner and closed_on is null) then
      return jsonb_build_object('ok', false, 'code', 'already_open');
    end if;

    insert into public.kam_commissions
      (owner_id, kam_id, starts_on, ends_on, amount_usd, base_price_usd, periodicidad, source_demo_ends_on, created_by)
    values
      (p_owner, v_kam, p_starts_on, p_ends_on, round(p_amount_usd, 2), round(p_base_price_usd, 2),
       p_periodicidad, p_source_demo_ends_on, p_actor_email)
    returning id into v_id;

    perform public.admin_log_commercial(p_owner, 'commission_created', p_actor_email, jsonb_build_object(
      'kam_name', v_kam_name, 'amount_usd', round(p_amount_usd, 2), 'periodicidad', p_periodicidad,
      'starts_on', p_starts_on, 'ends_on', p_ends_on));
    return jsonb_build_object('ok', true, 'commission_id', v_id);
  end if;

  select first_name || ' ' || last_name into v_kam_name from public.kams where id = v_before.kam_id;

  update public.kam_commissions
  set starts_on = p_starts_on, ends_on = p_ends_on, amount_usd = round(p_amount_usd, 2),
      base_price_usd = round(p_base_price_usd, 2), periodicidad = p_periodicidad,
      source_demo_ends_on = p_source_demo_ends_on, updated_at = now()
  where id = p_commission;

  perform public.admin_log_commercial(p_owner, 'commission_updated', p_actor_email, jsonb_build_object(
    'kam_name', v_kam_name, 'amount_usd', round(p_amount_usd, 2), 'periodicidad', p_periodicidad,
    'starts_on', p_starts_on, 'ends_on', p_ends_on,
    'before', jsonb_build_object('amount_usd', v_before.amount_usd, 'starts_on', v_before.starts_on, 'ends_on', v_before.ends_on)));
  return jsonb_build_object('ok', true, 'commission_id', p_commission);
end;
$fn$;

-- A closed agreement can still be paid: closing it does not cancel what it owes.
drop function if exists public.admin_commission_pay(uuid, uuid, date, numeric, text, text, text);
create function public.admin_commission_pay(
  p_owner uuid, p_commission uuid, p_paid_on date, p_amount_usd numeric, p_method text, p_note text, p_actor_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_kam_name text;
  v_event uuid;
begin
  if p_amount_usd is null or p_amount_usd <= 0 then
    return jsonb_build_object('ok', false, 'code', 'bad_amount');
  end if;
  if p_paid_on is null or coalesce(trim(p_method), '') = '' then
    return jsonb_build_object('ok', false, 'code', 'bad_payment');
  end if;

  select k.first_name || ' ' || k.last_name into v_kam_name
  from public.kam_commissions c
  join public.kams k on k.id = c.kam_id
  where c.id = p_commission and c.owner_id = p_owner;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'no_commission');
  end if;

  insert into public.kam_commission_payments (commission_id, paid_on, amount_usd, method, note, actor_email)
  values (p_commission, p_paid_on, round(p_amount_usd, 2), trim(p_method), nullif(trim(p_note), ''), p_actor_email);

  v_event := public.admin_log_commercial(p_owner, 'commission_paid', p_actor_email, jsonb_build_object(
    'kam_name', v_kam_name, 'amount_usd', round(p_amount_usd, 2), 'method', trim(p_method),
    'paid_on', p_paid_on, 'note', nullif(trim(p_note), '')));
  return jsonb_build_object('ok', true, 'evento_id', v_event);
end;
$fn$;

-- ── 6. Feedback ──────────────────────────────────────────────────────────

drop function if exists public.admin_feedback_add(uuid, text, text, text);
create function public.admin_feedback_add(p_owner uuid, p_kind text, p_body text, p_actor_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_kam uuid;
  v_id uuid;
  v_event uuid;
begin
  if not exists (select 1 from public.owners where id = p_owner) then
    return jsonb_build_object('ok', false, 'code', 'no_account');
  end if;
  if p_kind not in ('complaint', 'suggestion', 'praise', 'question') then
    return jsonb_build_object('ok', false, 'code', 'bad_kind');
  end if;
  if coalesce(length(trim(p_body)), 0) not between 1 and 2000 then
    return jsonb_build_object('ok', false, 'code', 'bad_body');
  end if;

  select kam_id into v_kam from public.account_kam_assignments where owner_id = p_owner and ended_at is null;

  insert into public.account_feedback (owner_id, kind, body, kam_id, actor_email)
  values (p_owner, p_kind, trim(p_body), v_kam, p_actor_email)
  returning id into v_id;

  v_event := public.admin_log_commercial(p_owner, 'feedback_logged', p_actor_email,
    jsonb_build_object('kind', p_kind, 'feedback_id', v_id));
  return jsonb_build_object('ok', true, 'evento_id', v_event);
end;
$fn$;

-- Sticks a file to the line that was just written. Only a path inside this
-- account's own folder, and only once: an attachment is evidence, and a second
-- call must not be able to replace it.
drop function if exists public.admin_commercial_attach(uuid, text);
create function public.admin_commercial_attach(p_event uuid, p_path text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_event public.account_commercial_events;
begin
  select * into v_event from public.account_commercial_events where id = p_event for update;
  if not found or v_event.proof_path is not null then
    return jsonb_build_object('ok', false, 'code', 'no_event');
  end if;
  if p_path is null or p_path not like v_event.owner_id::text || '/%' then
    return jsonb_build_object('ok', false, 'code', 'bad_path');
  end if;

  update public.account_commercial_events set proof_path = p_path where id = p_event;
  if v_event.action = 'feedback_logged' then
    update public.account_feedback set attachment_path = p_path
    where id = (v_event.detail ->> 'feedback_id')::uuid and owner_id = v_event.owner_id;
  end if;
  return jsonb_build_object('ok', true);
end;
$fn$;

-- ── 7. Reading ───────────────────────────────────────────────────────────

-- Raw rows for the account's page. Dates come out on the business's calendar,
-- so `lib/admin/commission.ts` never has to think about time zones.
drop function if exists public.admin_account_commercial(uuid);
create function public.admin_account_commercial(p_owner uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  select jsonb_build_object(
    'today', (now() at time zone public.admin_zona(o.country))::date,
    'demo_ends_on', (s.demo_termina_el at time zone public.admin_zona(o.country))::date,
    'paid_until_on', (s.periodo_termina_el at time zone public.admin_zona(o.country))::date,
    'price_usd', s.precio_pactado_usd,
    'periodicidad', s.periodicidad,
    'catalog_pro_usd', (select p.precio_usd from public.plans p where p.code = 'pro'),
    'kam', (
      select jsonb_build_object(
        'id', k.id, 'first_name', k.first_name, 'last_name', k.last_name, 'email', k.email,
        'city', k.city, 'phone', k.phone,
        'accounts', (select count(*) from public.account_kam_assignments x
                     where x.kam_id = k.id and x.ended_at is null))
      from public.account_kam_assignments a
      join public.kams k on k.id = a.kam_id
      where a.owner_id = o.id and a.ended_at is null
    ),
    'commissions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'kam_id', c.kam_id,
        'kam_name', k.first_name || ' ' || k.last_name,
        'starts_on', c.starts_on,
        'ends_on', c.ends_on,
        'closed_on', c.closed_on,
        'amount_usd', c.amount_usd,
        'base_price_usd', c.base_price_usd,
        'periodicidad', c.periodicidad,
        'source_demo_ends_on', c.source_demo_ends_on,
        'paid_usd', coalesce((select sum(p.amount_usd) from public.kam_commission_payments p
                              where p.commission_id = c.id), 0)
      ) order by c.closed_on is not null, c.starts_on desc)
      from public.kam_commissions c
      join public.kams k on k.id = c.kam_id
      where c.owner_id = o.id
    ), '[]'::jsonb),
    'account_payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'on', (e.ocurrido_el at time zone public.admin_zona(o.country))::date,
        'amount_usd', e.monto_usd
      ) order by e.ocurrido_el)
      from public.subscription_events e
      -- `metodo_pago` too: «Dar demo» and «Cambiar plan» store the agreed price in
      -- `monto_usd` with no method, and that is not a payment. Without this a demo
      -- would generate commission. Same filter as `admin_ingresos_por_mes`.
      where e.owner_id = o.id and e.monto_usd is not null and e.metodo_pago is not null
    ), '[]'::jsonb),
    'feedback', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id, 'kind', f.kind, 'body', f.body, 'attachment_path', f.attachment_path,
        'actor_email', f.actor_email, 'at', f.created_at
      ) order by f.created_at desc)
      from public.account_feedback f
      where f.owner_id = o.id
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'action', e.action, 'actor_email', e.actor_email, 'detail', e.detail,
        'proof_path', e.proof_path, 'at', e.occurred_at
      ) order by e.occurred_at desc)
      from public.account_commercial_events e
      where e.owner_id = o.id
    ), '[]'::jsonb)
  )
  from public.owners o
  left join public.subscriptions s on s.owner_id = o.id
  where o.id = p_owner;
$fn$;

-- The whole security log for the history. `admin_cuenta_seguridad` keeps its
-- last 10 for the «Seguridad» card, as the owner decided on 2026-11-07.
drop function if exists public.admin_account_security_log(uuid);
create function public.admin_account_security_log(p_owner uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'action', a.action, 'actor', a.actor, 'at', a.created_at, 'detail', a.detail
  ) order by a.created_at desc), '[]'::jsonb)
  from public.owner_security_audit a
  where a.owner_id = p_owner;
$fn$;

-- 171's list, with the KAM's name and email for the table and its filter, and with
-- «Último pago» counting real payments only. Same signature, so `create or replace`
-- keeps its grants.
create or replace function public.admin_cuentas_lista()
returns setof jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'owner_id', o.id,
    'business_name', o.business_name,
    'email', o.email,
    'whatsapp', o.whatsapp,
    'country', o.country,
    'plan_code', coalesce(s.plan_code, o.plan),
    'estado', coalesce(s.estado, 'activa'),
    'demo_termina_el', s.demo_termina_el,
    'periodo_termina_el', s.periodo_termina_el,
    'periodicidad', s.periodicidad,
    'precio_pactado_usd', s.precio_pactado_usd,
    'notas', s.notas,
    'tiene_suscripcion', s.owner_id is not null,
    'dias_restantes', case
      when s.demo_termina_el is null then null
      else ((s.demo_termina_el at time zone public.admin_zona(o.country))::date
            - (now() at time zone public.admin_zona(o.country))::date)
    end,
    -- `metodo_pago` too, `PL-38`: «Dar demo» and «Cambiar plan» store the agreed price
    -- in `monto_usd` with no method, so an account in demo read as having just paid.
    'ultimo_pago_el', (
      select max(e.ocurrido_el) from public.subscription_events e
      where e.owner_id = o.id and e.monto_usd is not null and e.metodo_pago is not null
    ),
    'clientes', (select count(*) from public.clients c where c.owner_id = o.id),
    'creado_el', o.created_at,
    'motivo_de_bloqueo', public.motivo_de_bloqueo_de(o.id),
    'se_bloquea_el', case
      when s.estado = 'demo' then s.demo_termina_el
      when s.estado = 'activa' and s.periodo_termina_el is not null then s.periodo_termina_el + interval '5 days'
      else null
    end,
    'es_prueba', coalesce(s.is_test_account, false),
    'kam_name', (
      select k.first_name || ' ' || k.last_name
      from public.account_kam_assignments a
      join public.kams k on k.id = a.kam_id
      where a.owner_id = o.id and a.ended_at is null
    ),
    'kam_email', (
      select k.email
      from public.account_kam_assignments a
      join public.kams k on k.id = a.kam_id
      where a.owner_id = o.id and a.ended_at is null
    )
  )
  from public.owners o
  left join public.subscriptions s on s.owner_id = o.id
  order by o.business_name;
$$;

-- ── 8. Who can execute ───────────────────────────────────────────────────

revoke execute on function public.admin_log_commercial(uuid, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.admin_kam_list() from public, anon, authenticated;
revoke execute on function public.admin_kam_create(text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.admin_kam_update(uuid, text, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.admin_kam_assign(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.admin_commission_save(uuid, uuid, date, date, numeric, numeric, text, date, text) from public, anon, authenticated;
revoke execute on function public.admin_commission_pay(uuid, uuid, date, numeric, text, text, text) from public, anon, authenticated;
revoke execute on function public.admin_feedback_add(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.admin_commercial_attach(uuid, text) from public, anon, authenticated;
revoke execute on function public.admin_account_commercial(uuid) from public, anon, authenticated;
revoke execute on function public.admin_account_security_log(uuid) from public, anon, authenticated;

grant execute on function public.admin_log_commercial(uuid, text, text, jsonb) to service_role;
grant execute on function public.admin_kam_list() to service_role;
grant execute on function public.admin_kam_create(text, text, text, text, text) to service_role;
grant execute on function public.admin_kam_update(uuid, text, text, text, text, text, text) to service_role;
grant execute on function public.admin_kam_assign(uuid, uuid, text) to service_role;
grant execute on function public.admin_commission_save(uuid, uuid, date, date, numeric, numeric, text, date, text) to service_role;
grant execute on function public.admin_commission_pay(uuid, uuid, date, numeric, text, text, text) to service_role;
grant execute on function public.admin_feedback_add(uuid, text, text, text) to service_role;
grant execute on function public.admin_commercial_attach(uuid, text) to service_role;
grant execute on function public.admin_account_commercial(uuid) to service_role;
grant execute on function public.admin_account_security_log(uuid) to service_role;

insert into public.schema_migrations (key, description)
values (
  '198_kam_and_commission',
  'KAM por cuenta, acuerdo de comisión, pagos al KAM, feedback de la cuenta y su historial comercial. Solo /admin; ninguna sesión lee estas tablas.'
)
on conflict (key) do nothing;

commit;

-- ── verification, after running the above ──────────────────────────────────
--   select relname, relrowsecurity from pg_class
--    where relname in ('kams','account_kam_assignments','kam_commissions',
--                      'kam_commission_payments','account_feedback','account_commercial_events');  -- six rows, all t
--   select has_table_privilege('authenticated', 'public.kams', 'select');                          -- false
--   select has_function_privilege('authenticated', 'public.admin_account_commercial(uuid)', 'execute'); -- false
--   select key from public.schema_migrations where key = '198_kam_and_commission';                 -- one row
