-- ENVIRONMENT: run in DEV first (vzqppwrwnmlbrxizskdh). Production comes later,
-- with its own green light. Order with the code does not matter: if this runs
-- first, /api/extract's old call with the owner's session is refused and the
-- route falls back to its flat 4 s pause (libretas keep being read); if the
-- code ships first, the server key can already call it. Re-runnable: one
-- `create or replace` with the same signature, and revoke/grant pairs.
--
-- ===========================================================================
-- 178: THREE INTERNAL FUNCTIONS CLOSED -- findings 7, 8 and 9
--
-- Found by `qa:attack` on 2026-11-02, while turning the offensive audit into a
-- suite, and fixed the same day at the owner's request («sí, arréglalo así en
-- dev»), after he asked what it would break. Answer, checked caller by caller:
-- nothing a shopkeeper uses.
--
-- THE TRAP BEHIND ALL THREE: on Supabase a new function is granted EXECUTE to
-- anon, authenticated and service_role explicitly, besides PUBLIC. A revoke
-- that names only `public, anon` -- or none at all -- leaves the door open.
-- Every revoke below names all three roles.
--
-- 7. claim_rate_limit_slot -- the shared queue for reading libreta photos.
--    Never closed, and it adds the CALLER's spacing to the next turn: one
--    anonymous request pushed the turn 24.9 days ahead in dev, and every
--    owner's upload would have waited until it timed out. Now server-only
--    (/api/extract calls it with the server key) and the spacing is clamped
--    to 60 s per call as a second line.
--
-- 8. generar_codigo_transaccion -- anyone could call it, and every call stores
--    a row in transaction_codes. Its only callers are the two triggers that
--    stamp sales and movements, and both are SECURITY DEFINER, so they keep
--    working with it server-only.
--
-- 9. share_link_owner, get_shared_catalog_preview -- meant to be server-only;
--    their migrations (117, 123) revoked `public, anon` and left
--    `authenticated`. Every caller in the app uses the server key.

begin;

-- 7 ─────────────────────────────────────────────────────────────────────
create or replace function public.claim_rate_limit_slot(p_key text, p_spacing_ms int)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wait_until timestamptz;
  -- Clamped: the caller never decides how far the next turn moves.
  v_spacing int := least(greatest(coalesce(p_spacing_ms, 0), 0), 60000);
begin
  insert into public.rate_limiters (key, next_available_at)
  values (p_key, now())
  on conflict (key) do update set next_available_at = rate_limiters.next_available_at
  returning greatest(now(), rate_limiters.next_available_at) into v_wait_until;

  update public.rate_limiters
  set next_available_at = v_wait_until + make_interval(secs => v_spacing / 1000.0)
  where key = p_key;

  return v_wait_until;
end;
$$;

revoke execute on function public.claim_rate_limit_slot(text, int) from public, anon, authenticated;
grant execute on function public.claim_rate_limit_slot(text, int) to service_role;

-- 8 ─────────────────────────────────────────────────────────────────────
revoke execute on function public.generar_codigo_transaccion() from public, anon, authenticated;
grant execute on function public.generar_codigo_transaccion() to service_role;

-- 9 ─────────────────────────────────────────────────────────────────────
revoke execute on function public.share_link_owner(text) from public, anon, authenticated;
grant execute on function public.share_link_owner(text) to service_role;
revoke execute on function public.get_shared_catalog_preview(text) from public, anon, authenticated;
grant execute on function public.get_shared_catalog_preview(text) to service_role;

insert into public.schema_migrations (key, description)
values (
  '178_funciones_internas_cerradas',
  'Hallazgos 7, 8 y 9 de qa:attack (2026-11-02). claim_rate_limit_slot (el turno de lectura de libretas) pasa a solo servidor y con tope de 60 s por llamada: un anónimo lo había congelado 24,9 días en dev. generar_codigo_transaccion pasa a solo servidor (la usan disparadores security definer). share_link_owner y get_shared_catalog_preview dejan de poder llamarlas los dueños con sesión. Supabase concede execute a anon y authenticated en cada función nueva: todo revoke nombra los tres roles.'
)
on conflict (key) do nothing;

commit;
