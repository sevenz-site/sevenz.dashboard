-- ENVIRONMENT: run in DEV first (vzqppwrwnmlbrxizskdh). Production comes later,
-- with its own green light -- and NOT before reading the list of accounts this
-- blocks on its first day (see «THE FIRST DAY» below). Needs 169 (admin_zona)
-- and 170. Re-runnable: columns and triggers are created «if not exists» or
-- dropped first, functions keep their signatures, and the backfill only
-- touches owners that still have no row.
--
-- ===========================================================================
-- 171: THREE MONTHS FREE ON SIGNUP, AND THE BLOCK THAT ARRIVES BY ITSELF --
-- phase C of the plan of 2026-10-31
--
-- The owner's request of 2026-10-31 and his answers the same day:
--   - «Al crear una nueva cuenta (…) se le deben setear en automático los 3
--     meses gratis» -- every signup is born in a 3-month trial;
--   - the account is blocked BY ITSELF when the trial ends;
--   - an unpaid Pro is blocked by itself too, 5 DAYS after its paid period
--     ends («automático con 5 días de gracia»);
--   - the accounts that signed up with no subscription row (since 057, because
--     handle_new_user never created one) get their 3 months COUNTED FROM THEIR
--     SIGNUP -- so the oldest of them are blocked on the day this runs. He
--     chose that knowing it; the list is read before production;
--   - test businesses are marked and left out of the metrics by default.
--
-- WHAT THIS DISPLACES, and the old reason stays written: on 2026-09-15 the
-- owner decided «las demos no bajan solas, al vencer tú decides», to avoid
-- giving months away without noticing, and /admin was built around a list of
-- «vencidas y sigue trabajando». The risk he accepts now is the opposite one:
-- blocking someone who paid and whose payment was not registered. What
-- softens it is that unblocking is one click and the history says it was
-- automatic.
--
-- ---------------------------------------------------------------------------
-- ONE RULE, IN ONE PLACE
--
-- `motivo_de_bloqueo_de(owner)` says WHY an account cannot write, or null.
-- `owner_puede_escribir` becomes «has no reason», so every policy of 061 and
-- 170 inherits the automatic block without being touched.
--
-- IT IS EXACT, NOT CRON-DEPENDENT: it compares the end date with now(). The
-- daily cron (`bloquear_vencidas`) only turns the state into 'bloqueada' and
-- writes the history row, so /admin and the history tell the truth. If the
-- cron never ran, nobody would write past their end date anyway.
--
-- `now()` against a stored end-of-day instant: no zone can move it. The end
-- date itself is the END of the day, in the zone of the business (Caracas /
-- Bogotá), so nobody loses their last day at 8 p.m.
--
-- ---------------------------------------------------------------------------
-- THE FIRST DAY
--
-- Running this blocks, immediately: demos already past their end, active
-- accounts more than 5 days past their paid period, and backfilled accounts
-- that signed up more than 3 months ago. Measured in dev on 2026-10-31: one
-- business (a stale paid period on a fixture). Production must be measured
-- with the read-only query of the launch checklist before this runs there.
--
-- And with it, WhatsApp: `whatsapp_destinatarios_*` read
-- `not owner_puede_escribir` as «paused», so every account this blocks starts
-- receiving `cartera_pausada` -- which has never been sent (MS-20).

begin;

-- ── 1. Columns ───────────────────────────────────────────────────────────

alter table public.subscriptions
  add column if not exists bloqueo_motivo text,
  add column if not exists is_test_account boolean not null default false;

alter table public.subscriptions drop constraint if exists subscriptions_bloqueo_motivo_check;
alter table public.subscriptions add constraint subscriptions_bloqueo_motivo_check
  check (bloqueo_motivo is null or bloqueo_motivo in ('prueba_vencida', 'pago_vencido'));

comment on column public.subscriptions.bloqueo_motivo is
  'Why the account was blocked BY ITSELF (bloquear_vencidas): prueba_vencida or pago_vencido. Null for a manual block. Cleared by trigger when the account leaves ''bloqueada''.';
comment on column public.subscriptions.is_test_account is
  'A test or demo business, set from /admin. The metrics leave it out by default. It does NOT exempt the account from the block.';

-- The reason belongs to ONE block. Leaving 'bloqueada' clears it, so a later
-- manual block does not inherit «tu prueba terminó».
create or replace function public.subscriptions_limpia_bloqueo_motivo()
returns trigger
language plpgsql
as $$
begin
  if new.estado is distinct from 'bloqueada' then
    new.bloqueo_motivo := null;
  end if;
  return new;
end;
$$;

drop trigger if exists subscriptions_limpia_bloqueo_motivo on public.subscriptions;
create trigger subscriptions_limpia_bloqueo_motivo
  before insert or update of estado, bloqueo_motivo on public.subscriptions
  for each row execute function public.subscriptions_limpia_bloqueo_motivo();

-- ── 2. When a trial ends: the last second of the day, 3 calendar months on ─
-- In the zone of the business, the same rule as `zonaDelNegocio`. Calendar
-- months and not 90 days: «3 meses» signed up on 31 July ends on 31 October.
create or replace function public.fin_de_prueba(p_desde timestamptz, p_country text)
returns timestamptz
language sql
stable
as $$
  select (((p_desde at time zone public.admin_zona(p_country))::date + interval '3 months')::date::timestamp
          + interval '23 hours 59 minutes 59 seconds')
         at time zone public.admin_zona(p_country);
$$;

-- ── 3. The rule ──────────────────────────────────────────────────────────
-- 'bloqueada'       manual block, or one the cron already materialised
-- 'prueba_vencida'  the trial ended
-- 'pago_vencido'    the paid period ended more than 5 days ago
-- null              can write
--
-- NO ROW STILL WRITES. A row is created on signup now and the backfill below
-- gives one to everybody, so this only covers a signup whose row failed to be
-- created -- and failing closed there would leave a new shop unable to register
-- anything on its first day. 061's reason, unchanged.
create or replace function public.motivo_de_bloqueo_de(p_owner uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when s.owner_id is null then null
    when s.estado = 'bloqueada' then coalesce(s.bloqueo_motivo, 'bloqueada')
    when s.estado = 'demo' and s.demo_termina_el is not null and s.demo_termina_el < now() then 'prueba_vencida'
    when s.estado = 'activa' and s.periodo_termina_el is not null
         and s.periodo_termina_el + interval '5 days' < now() then 'pago_vencido'
    else null
  end
  from (select 1) uno
  left join public.subscriptions s on s.owner_id = p_owner;
$$;

revoke execute on function public.motivo_de_bloqueo_de(uuid) from public, anon, authenticated;
grant execute on function public.motivo_de_bloqueo_de(uuid) to service_role;

-- Same signature as 061, so every policy that calls it keeps working and now
-- reads the dates too. STABLE, so Postgres evaluates it once per statement.
create or replace function public.owner_puede_escribir(p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.motivo_de_bloqueo_de(p_owner) is null;
$$;

-- For the owner's own screen: why is MY account blocked. No parameter on
-- purpose, so nobody can ask about another business.
create or replace function public.mi_motivo_de_bloqueo()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select public.motivo_de_bloqueo_de(auth.uid());
$$;

revoke execute on function public.mi_motivo_de_bloqueo() from public, anon;
grant execute on function public.mi_motivo_de_bloqueo() to authenticated;

-- ── 4. The accounts with no row: 3 months from their signup ──────────────
with nuevas as (
  insert into public.subscriptions (owner_id, plan_code, estado, demo_termina_el, limites, precio_pactado_usd)
  select o.id, o.plan, 'demo', public.fin_de_prueba(o.created_at, o.country),
         coalesce(p.limites, '{}'::jsonb), p.precio_usd
  from public.owners o
  join public.plans p on p.code = o.plan
  where not exists (select 1 from public.subscriptions s where s.owner_id = o.id)
  returning owner_id, plan_code
)
insert into public.subscription_events (owner_id, actor_email, desde_estado, hasta_estado, desde_plan, hasta_plan, motivo)
select owner_id, 'sistema', null, 'demo', plan_code, plan_code,
       'Prueba de 3 meses contada desde el registro (migración 171: la cuenta no tenía suscripción)'
from nuevas;

-- ── 5. Every signup from now on is born in a 3-month trial ───────────────
-- 070's definition, verbatim, plus the block at the end. THE TRIAL CAN NEVER
-- STOP A SIGNUP: it runs in its own sub-block, and a failure there is a
-- warning in the logs and a shop with no row -- which still writes (see 3) --
-- instead of nobody being able to register.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- La frase que el dueño leyó en el formulario. Llega desde el cliente y se
  -- guarda sin transformar — su valor es ser una copia literal de lo que se
  -- mostró, no una paráfrasis nuestra. Es el mismo criterio que en
  -- guardarAvisosWhatsapp().
  --
  -- Si no viene (un usuario creado desde el panel de admin, una versión vieja
  -- del formulario), el dueño queda SIN aceptar. Nunca se inventa un
  -- consentimiento: sin frase no hubo pantalla, y sin pantalla no hubo
  -- permiso.
  v_texto text := new.raw_user_meta_data ->> 'whatsapp_opt_in_text';
  v_tiene_whatsapp boolean := coalesce(new.raw_user_meta_data ->> 'whatsapp', '') <> '';
begin
  insert into public.owners (
    id, email, business_name, first_name, last_name, whatsapp, country,
    whatsapp_opt_in_at, whatsapp_opt_in_text
  )
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'business_name', ''),
    new.raw_user_meta_data ->> 'first_name',
    new.raw_user_meta_data ->> 'last_name',
    new.raw_user_meta_data ->> 'whatsapp',
    -- Signup is the only place an owner picks their country — 'Mi negocio'
    -- renders it disabled afterward. Anything other than the two valid
    -- codes (a missing field, an admin-created user, ...) falls back to
    -- the column's own default rather than failing the whole signup.
    case
      when new.raw_user_meta_data ->> 'country' in ('CO', 'VE') then new.raw_user_meta_data ->> 'country'
      else 'CO'
    end,
    -- Y sin número tampoco se acepta: un consentimiento que no se puede
    -- ejecutar no sirve de nada, y es la misma regla que aplica el
    -- interruptor de Mi negocio. Hoy el WhatsApp es obligatorio al
    -- registrarse, así que esto solo protege de un alta hecha por otra vía.
    case when v_texto is not null and v_texto <> '' and v_tiene_whatsapp then now() else null end,
    case when v_texto is not null and v_texto <> '' and v_tiene_whatsapp then v_texto else null end
  );

  -- THE 3-MONTH TRIAL (migration 171).
  begin
    insert into public.subscriptions (owner_id, plan_code, estado, demo_termina_el, limites, precio_pactado_usd)
    select o.id, o.plan, 'demo', public.fin_de_prueba(now(), o.country),
           coalesce(p.limites, '{}'::jsonb), p.precio_usd
    from public.owners o
    join public.plans p on p.code = o.plan
    where o.id = new.id
    on conflict (owner_id) do nothing;

    insert into public.subscription_events (owner_id, actor_email, desde_estado, hasta_estado, desde_plan, hasta_plan, motivo)
    select o.id, 'sistema', null, 'demo', o.plan, o.plan, 'Prueba de 3 meses al registrarse'
    from public.owners o
    where o.id = new.id;
  exception when others then
    raise warning 'handle_new_user: no se pudo abrir la prueba de %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

-- Redeclared on purpose: `create or replace function` does not recreate the
-- trigger, and on a branch where it was not cloned (the CLAUDE.md trap of
-- 2026-08-27) signups would create no owner at all.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── 6. The daily cron: make the state say what the rule already does ─────
create or replace function public.bloquear_vencidas()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fila record;
  v_n integer := 0;
  v_motivo text;
begin
  for v_fila in
    select s.owner_id, s.estado, s.plan_code
    from public.subscriptions s
    where (s.estado = 'demo' and s.demo_termina_el is not null and s.demo_termina_el < now())
       or (s.estado = 'activa' and s.periodo_termina_el is not null and s.periodo_termina_el + interval '5 days' < now())
    for update
  loop
    v_motivo := case when v_fila.estado = 'demo' then 'prueba_vencida' else 'pago_vencido' end;

    update public.subscriptions
    set estado = 'bloqueada', bloqueo_motivo = v_motivo, updated_at = now()
    where owner_id = v_fila.owner_id;

    insert into public.subscription_events (owner_id, actor_email, desde_estado, hasta_estado, desde_plan, hasta_plan, motivo)
    values (
      v_fila.owner_id, 'sistema', v_fila.estado, 'bloqueada', v_fila.plan_code, v_fila.plan_code,
      case v_motivo
        when 'prueba_vencida' then 'Bloqueo automático: terminó la prueba'
        else 'Bloqueo automático: venció el periodo pagado hace más de 5 días'
      end
    );
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

revoke execute on function public.bloquear_vencidas() from public, anon, authenticated;
grant execute on function public.bloquear_vencidas() to service_role;

-- ── 7. Test businesses ───────────────────────────────────────────────────
create or replace function public.admin_marcar_prueba(p_owner uuid, p_es_prueba boolean, p_actor_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_antes public.subscriptions;
begin
  v_antes := public.admin_asegura_suscripcion(p_owner);
  update public.subscriptions set is_test_account = p_es_prueba, updated_at = now() where owner_id = p_owner;
  insert into public.subscription_events (owner_id, actor_email, desde_estado, hasta_estado, desde_plan, hasta_plan, motivo)
  values (p_owner, p_actor_email, v_antes.estado, v_antes.estado, v_antes.plan_code, v_antes.plan_code,
          case when p_es_prueba then 'Marcado como negocio de prueba' else 'Desmarcado como negocio de prueba' end);
  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.admin_marcar_prueba(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.admin_marcar_prueba(uuid, boolean, text) to service_role;

-- 058's list, with what the panel needs now: the reason and the date the
-- block arrives, and the test mark.
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
    'ultimo_pago_el', (
      select max(e.ocurrido_el) from public.subscription_events e
      where e.owner_id = o.id and e.monto_usd is not null
    ),
    'clientes', (select count(*) from public.clients c where c.owner_id = o.id),
    'creado_el', o.created_at,
    'motivo_de_bloqueo', public.motivo_de_bloqueo_de(o.id),
    'se_bloquea_el', case
      when s.estado = 'demo' then s.demo_termina_el
      when s.estado = 'activa' and s.periodo_termina_el is not null then s.periodo_termina_el + interval '5 days'
      else null
    end,
    'es_prueba', coalesce(s.is_test_account, false)
  )
  from public.owners o
  left join public.subscriptions s on s.owner_id = o.id
  order by o.business_name;
$$;

-- 039's options, with the test mark: the metrics page builds its default
-- owner list from it, leaving test businesses out without touching the
-- signature of any metric function.
create or replace function public.admin_owner_options()
returns setof jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'id', o.id,
           'business_name', o.business_name,
           'country', o.country,
           'es_prueba', coalesce(s.is_test_account, false)
         )
  from public.owners o
  left join public.subscriptions s on s.owner_id = o.id
  order by o.business_name;
$$;

-- ── 8. «Reactivar» has to survive the new rule ───────────────────────────
-- 061's definition plus one line. Without it, reactivating a Pro blocked for
-- an overdue period left it 'activa' WITH that same expired date -- and the rule
-- above blocked it again on the spot: «Reactivar» would have done nothing.
-- An expired period is cleared, so the account stays active until the next
-- payment is registered (which sets a new one). A period still running, or
-- within its 5 days of grace, is kept.
create or replace function public.admin_desbloquear(
  p_owner uuid,
  p_actor_email text,
  p_motivo text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_antes public.subscriptions;
begin
  v_antes := public.admin_asegura_suscripcion(p_owner);

  update public.subscriptions
  set estado = 'activa',
      periodo_termina_el = case
        when periodo_termina_el is not null and periodo_termina_el + interval '5 days' < now() then null
        else periodo_termina_el
      end,
      updated_at = now()
  where owner_id = p_owner;

  insert into public.subscription_events
    (owner_id, actor_email, desde_estado, hasta_estado, desde_plan, hasta_plan, motivo)
  values
    (p_owner, p_actor_email, v_antes.estado, 'activa',
     v_antes.plan_code, v_antes.plan_code, coalesce(p_motivo, 'Cuenta reactivada'));

  return jsonb_build_object('ok', true);
end;
$$;

insert into public.schema_migrations (key, description)
values (
  '171_prueba_de_tres_meses_y_vencimientos',
  'Fase C del plan del 2026-10-31. Todo registro nace en prueba de 3 meses (handle_new_user crea la suscripción, sin poder tumbar el registro). La cuenta se bloquea sola al terminar la prueba, y un Pro 5 días después de vencer su periodo pagado: owner_puede_escribir pasa a leer las fechas, así que todas las políticas lo heredan. Las cuentas sin suscripción reciben 3 meses contados desde su registro. bloquear_vencidas() lo deja escrito cada día. Nueva marca is_test_account para sacar los negocios de prueba de las métricas. Desplaza la decisión del 2026-09-15 de que las demos no bajan solas.'
)
on conflict (key) do nothing;

commit;
