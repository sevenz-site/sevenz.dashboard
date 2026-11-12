-- ENVIRONMENT: run in DEV first (vzqppwrwnmlbrxizskdh). Production comes later, with its
-- own green light, and BEFORE the code that calls it (CLAUDE.md, deploy step 1). Nothing in
-- production calls these functions today.
-- Re-runnable: drop + create on both functions, `on conflict` on the ledger row.
--
-- ===========================================================================
-- 200: WHO GETS `account_ready`, THE «YOUR ACCOUNT IS ACTIVE» WHATSAPP
--
-- Template approved by Meta as Utility, reported by the owner on 2026-11-12:
--
--   Hola {{owner_name}}, confirmaste tu correo y la cuenta de {{business_name}} en Sevenz
--   quedó activa.
--   • Tu periodo de prueba termina el {{trial_end_date}}.
--   • Puedes desactivar estos avisos en Mi negocio.
--
-- Once in an account's life, «al confirmar el correo». The app has no moment of its own
-- for that: Supabase confirms the address on its side. So the message goes out at the
-- account's FIRST sign-in (`recordLoginDevice`, first device ever) and, as a catch-up, from
-- the daily WhatsApp cron. Owner's decision of 2026-11-12: «Implementemos tu plan
-- considerando los casos donde se rompe».
--
-- WHERE IT BREAKS, AND WHAT THIS FUNCTION DOES ABOUT EACH. Every guard lives here, in one
-- place, so the sign-in and the cron cannot disagree about who qualifies:
--
--   1. OLD ACCOUNTS. With v0.5.1 about twenty owners record their first device the first
--      time they open the app, months after confirming. Without a guard every one of them
--      would read «confirmaste tu correo y la cuenta quedó activa». So the address must have
--      been confirmed in the last 3 days (`p_max_age`). Silent if it failed, and that is why
--      it is the first check.
--   2. NOT IN TRIAL. The body says «Tu periodo de prueba termina el …». An account on a paid
--      plan, blocked, or whose trial already ended would get a false date. Only `demo` with
--      a `demo_termina_el` still ahead qualifies.
--   3. TEST ACCOUNTS (`is_test_account`) never get it.
--   4. NO NUMBER, OR NO CONSENT. Same rule as every owner message (`whatsapp_destinatarios_
--      resumen`, 119): a number, an opt-in, and no later opt-out.
--   5. ALREADY SENT. One `ok` row of `account_ready` ends it for good. A FAILED row does
--      not: the send gate (067) frees the turn, so the cron can retry within the window.
--
-- The window is 3 days because «confirmaste tu correo» read a week later sounds like a
-- mistake. Past it the message is simply not sent: it is a welcome, not something the
-- owner can lose money by not knowing.
--
-- NOTHING HERE IS GRANTED TO A SESSION. Server only, like the rest of the send path.
-- ===========================================================================

begin;

-- ── 1. One owner: does this account qualify, and with what? ─────────────────

drop function if exists public.account_ready_target(uuid);
drop function if exists public.account_ready_target(uuid, interval);
create function public.account_ready_target(
  p_owner_id uuid,
  p_max_age interval default interval '3 days'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_owner record;
  v_sub record;
  v_confirmed timestamptz;
begin
  select o.id, o.first_name, o.business_name, o.country, o.whatsapp,
         o.whatsapp_opt_in_at, o.whatsapp_opt_out_at
    into v_owner
    from public.owners o
   where o.id = p_owner_id;
  if not found then
    return jsonb_build_object('eligible', false, 'reason', 'no_owner');
  end if;

  select u.email_confirmed_at into v_confirmed from auth.users u where u.id = p_owner_id;
  if v_confirmed is null then
    return jsonb_build_object('eligible', false, 'reason', 'not_confirmed');
  end if;
  if v_confirmed < now() - p_max_age then
    return jsonb_build_object('eligible', false, 'reason', 'confirmed_long_ago');
  end if;

  select s.estado, s.demo_termina_el, s.is_test_account
    into v_sub
    from public.subscriptions s
   where s.owner_id = p_owner_id;
  if not found then
    return jsonb_build_object('eligible', false, 'reason', 'no_subscription');
  end if;
  if v_sub.is_test_account then
    return jsonb_build_object('eligible', false, 'reason', 'test_account');
  end if;
  if v_sub.estado <> 'demo' or v_sub.demo_termina_el is null or v_sub.demo_termina_el <= now() then
    return jsonb_build_object('eligible', false, 'reason', 'not_in_trial');
  end if;

  if v_owner.whatsapp is null or btrim(v_owner.whatsapp) = '' then
    return jsonb_build_object('eligible', false, 'reason', 'no_whatsapp');
  end if;
  if v_owner.whatsapp_opt_in_at is null
     or (v_owner.whatsapp_opt_out_at is not null and v_owner.whatsapp_opt_in_at <= v_owner.whatsapp_opt_out_at) then
    return jsonb_build_object('eligible', false, 'reason', 'no_consent');
  end if;

  if exists (
    select 1 from public.whatsapp_sends w
     where w.owner_id = p_owner_id and w.template = 'account_ready' and w.ok is true
  ) then
    return jsonb_build_object('eligible', false, 'reason', 'already_sent');
  end if;

  return jsonb_build_object(
    'eligible', true,
    'whatsapp', v_owner.whatsapp,
    'first_name', v_owner.first_name,
    'business_name', v_owner.business_name,
    'country', v_owner.country,
    'trial_ends_at', v_sub.demo_termina_el
  );
end;
$fn$;

-- ── 2. The cron's catch-up list ─────────────────────────────────────────────
--
-- Accounts confirmed inside the window with no successful `account_ready` yet. Only a
-- shortlist: the function above still decides each one, so the two cannot drift.

drop function if exists public.account_ready_pending();
drop function if exists public.account_ready_pending(interval);
create function public.account_ready_pending(p_max_age interval default interval '3 days')
returns setof uuid
language sql
stable
security definer
set search_path = public
as $fn$
  select o.id
    from public.owners o
    join auth.users u on u.id = o.id
   where u.email_confirmed_at is not null
     and u.email_confirmed_at >= now() - p_max_age
     and not exists (
       select 1 from public.whatsapp_sends w
        where w.owner_id = o.id and w.template = 'account_ready' and w.ok is true
     );
$fn$;

revoke execute on function public.account_ready_target(uuid, interval) from public, anon, authenticated;
revoke execute on function public.account_ready_pending(interval) from public, anon, authenticated;
grant execute on function public.account_ready_target(uuid, interval) to service_role;
grant execute on function public.account_ready_pending(interval) to service_role;

insert into public.schema_migrations (key, description)
values (
  '200_account_ready',
  'account_ready: quién recibe «confirmaste tu correo y tu cuenta quedó activa». Correo confirmado hace menos de 3 días, en prueba con fecha de fin por delante, sin cuenta de prueba, con número y permiso, y una sola vez en la vida. Dos funciones, solo del servidor.'
)
on conflict (key) do nothing;

commit;
