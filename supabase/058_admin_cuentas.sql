-- 058_admin_cuentas.sql
--
-- ENTORNO: correr en LOS DOS — primero la rama dev (vzqppwrwnmlbrxizskdh) y
-- después producción (rabmiyqodnvnrwiartuj).
--
-- Fase 2 de PLANES-Y-CUENTAS-PLAN.md: las funciones que /admin usa para ver y
-- cambiar planes a mano. Nada de esto cambia el comportamiento de la app para
-- ningún tendero — solo escribe en las tablas de la 057, que nadie lee todavía.
--
-- ─────────────────────────────────────────────────────────────────────────
-- LO QUE **NO** ESTÁ AQUÍ, Y ES DELIBERADO: BLOQUEAR
--
-- El estado 'bloqueada' existe en el esquema desde la 057, pero **todavía no
-- impide escribir nada**. El bloqueo de verdad son dos políticas de INSERT en
-- `movements` y `clients`, y eso es la Fase 3.
--
-- Por eso esta migración NO trae una función para bloquear, y el panel no
-- traerá ese botón. Un botón "Bloquear" que no bloquea es peor que no tenerlo:
-- lo pulsas, el panel dice bloqueada, y el tendero sigue fiando tan tranquilo
-- mientras tú crees que le cortaste el acceso. La Fase 3 trae el botón y la
-- cerradura a la vez.
--
-- ─────────────────────────────────────────────────────────────────────────
-- EL ACTOR
--
-- Cada función recibe p_actor_email y lo guarda en el historial. Sí, es un
-- parámetro y quien llame puede escribir lo que quiera — pero para llamar
-- hace falta la clave service_role, y quien la tenga ya puede hacer cualquier
-- cosa contra la base. Lo que este campo responde no es "¿quién tenía
-- permiso?" sino "¿quién de nosotros pulsó el botón?", y para eso basta.
--
-- ─────────────────────────────────────────────────────────────────────────
-- LA FILA QUE PUEDE FALTAR
--
-- handle_new_user crea el `owners` al registrarse pero NO la suscripción (ver
-- el hueco anotado en la 057). Así que todas las funciones que escriben hacen
-- upsert: si la fila no existe, la crean. Dar por hecho que existe sería
-- fallar justo con las cuentas más nuevas, que son las que más vas a tocar.

begin;

-- ── Ayudante: asegurar la suscripción ───────────────────────────────────
create or replace function public.admin_asegura_suscripcion(p_owner uuid)
returns public.subscriptions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.subscriptions;
begin
  select * into v_sub from public.subscriptions where owner_id = p_owner;
  if found then
    return v_sub;
  end if;

  insert into public.subscriptions (owner_id, plan_code, estado, limites, precio_pactado_usd)
  select o.id, o.plan, 'activa', coalesce(p.limites, '{}'::jsonb), p.precio_usd
  from public.owners o
  join public.plans p on p.code = o.plan
  where o.id = p_owner
  returning * into v_sub;

  if v_sub.owner_id is null then
    raise exception 'No existe ese negocio' using errcode = 'P0002';
  end if;
  return v_sub;
end;
$$;

-- ── La lista ────────────────────────────────────────────────────────────
-- Un jsonb por negocio, como el resto de funciones de /admin (patrón de la
-- 039): así añadir un campo no obliga a tocar la firma ni a cuadrar columnas.
--
-- `dias_restantes` se calcula en America/Caracas y no en UTC. Vercel corre en
-- UTC y allí el día cambia a las 8 de la noche de Caracas: una demo que vence
-- "el 15" tiene que durar hasta el final del 15 ALLÍ. Ya nos mordió con la
-- tasa del BCV.
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
    -- Null cuando aún no tiene suscripción: ese negocio se registró después
    -- de la 057 y todavía nadie lo ha tocado.
    'tiene_suscripcion', s.owner_id is not null,
    'dias_restantes', case
      when s.demo_termina_el is null then null
      else ((s.demo_termina_el at time zone 'America/Caracas')::date
            - (now() at time zone 'America/Caracas')::date)
    end,
    'ultimo_pago_el', (
      select max(e.ocurrido_el) from public.subscription_events e
      where e.owner_id = o.id and e.monto_usd is not null
    ),
    'clientes', (select count(*) from public.clients c where c.owner_id = o.id),
    'creado_el', o.created_at
  )
  from public.owners o
  left join public.subscriptions s on s.owner_id = o.id
  order by o.business_name;
$$;

-- ── El historial de un negocio ──────────────────────────────────────────
create or replace function public.admin_cuenta_historial(p_owner uuid)
returns setof jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', e.id,
    'ocurrido_el', e.ocurrido_el,
    'actor_email', e.actor_email,
    'desde_estado', e.desde_estado,
    'hasta_estado', e.hasta_estado,
    'desde_plan', e.desde_plan,
    'hasta_plan', e.hasta_plan,
    'motivo', e.motivo,
    'metodo_pago', e.metodo_pago,
    'monto_usd', e.monto_usd
  )
  from public.subscription_events e
  where e.owner_id = p_owner
  order by e.ocurrido_el desc;
$$;

-- ── Dar una demo ────────────────────────────────────────────────────────
-- Los días los pone quien negocia, no una lista de botones: 2 meses es el
-- defecto, pero el trato real no cabe en cuatro opciones. Mismo razonamiento
-- que "Otro plazo…" en el formulario de fiado.
--
-- Termina al FINAL del día en Caracas, no en el instante en que se pulsa el
-- botón: una demo de 30 días dada a las 11 de la noche no puede durar 29 días
-- y una hora.
create or replace function public.admin_dar_demo(
  p_owner uuid,
  p_dias int,
  p_actor_email text,
  p_notas text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_antes public.subscriptions;
  v_fin timestamptz;
begin
  if p_dias is null or p_dias < 1 or p_dias > 365 then
    raise exception 'La demo tiene que durar entre 1 y 365 días' using errcode = '22023';
  end if;

  v_antes := public.admin_asegura_suscripcion(p_owner);

  v_fin := (((now() at time zone 'America/Caracas')::date + p_dias)::timestamp
            + interval '23 hours 59 minutes 59 seconds')
           at time zone 'America/Caracas';

  update public.subscriptions set
    estado = 'demo',
    demo_termina_el = v_fin,
    periodo_termina_el = null,
    periodicidad = null,
    notas = coalesce(p_notas, notas),
    updated_at = now()
  where owner_id = p_owner;

  insert into public.subscription_events
    (owner_id, actor_email, desde_estado, hasta_estado, desde_plan, hasta_plan, motivo)
  values
    (p_owner, p_actor_email, v_antes.estado, 'demo', v_antes.plan_code, v_antes.plan_code,
     coalesce(p_notas, 'Demo de ' || p_dias || ' días'));

  return jsonb_build_object('ok', true, 'demo_termina_el', v_fin);
end;
$$;

-- ── Cambiar de plan ─────────────────────────────────────────────────────
-- Sirve para las dos cosas: regalar `free` a quien merece trato especial, y
-- poner a alguien en `pro` con su precio y su periodicidad.
--
-- Los límites se COPIAN del catálogo en este momento. A partir de aquí, tocar
-- el catálogo no le cambia las condiciones a este negocio — que es todo el
-- sentido de tener una copia.
create or replace function public.admin_cambiar_plan(
  p_owner uuid,
  p_plan text,
  p_actor_email text,
  p_periodicidad text default null,
  p_precio_usd numeric default null,
  p_notas text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_antes public.subscriptions;
  v_plan public.plans;
begin
  select * into v_plan from public.plans where code = p_plan;
  if not found then
    raise exception 'Ese plan no existe en el catálogo: %', p_plan using errcode = 'P0002';
  end if;

  if p_periodicidad is not null
     and p_periodicidad not in ('mensual', 'trimestral', 'anual') then
    raise exception 'Periodicidad no válida: %', p_periodicidad using errcode = '22023';
  end if;

  v_antes := public.admin_asegura_suscripcion(p_owner);

  update public.subscriptions set
    plan_code = p_plan,
    estado = 'activa',
    demo_termina_el = null,
    periodicidad = p_periodicidad,
    limites = coalesce(v_plan.limites, '{}'::jsonb),
    precio_pactado_usd = coalesce(p_precio_usd, v_plan.precio_usd),
    notas = coalesce(p_notas, notas),
    updated_at = now()
  where owner_id = p_owner;

  insert into public.subscription_events
    (owner_id, actor_email, desde_estado, hasta_estado, desde_plan, hasta_plan, motivo, monto_usd)
  values
    (p_owner, p_actor_email, v_antes.estado, 'activa', v_antes.plan_code, p_plan,
     coalesce(p_notas, 'Cambio de plan'), coalesce(p_precio_usd, v_plan.precio_usd));

  return jsonb_build_object('ok', true, 'plan_code', p_plan);
end;
$$;

-- ── Registrar un pago ───────────────────────────────────────────────────
-- Extiende hasta la fecha que digas. No calcula el periodo solo: el cobro es a
-- mano —Pago Móvil, Zelle, transferencia— y quien sabe hasta cuándo cubre ese
-- pago eres tú, no una fórmula.
create or replace function public.admin_registrar_pago(
  p_owner uuid,
  p_monto_usd numeric,
  p_metodo text,
  p_hasta timestamptz,
  p_actor_email text,
  p_notas text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_antes public.subscriptions;
begin
  if p_monto_usd is null or p_monto_usd <= 0 then
    raise exception 'El monto del pago tiene que ser mayor que cero' using errcode = '22023';
  end if;
  if p_hasta is null then
    raise exception 'Falta hasta cuándo cubre este pago' using errcode = '22023';
  end if;

  v_antes := public.admin_asegura_suscripcion(p_owner);

  update public.subscriptions set
    estado = 'activa',
    demo_termina_el = null,
    periodo_termina_el = p_hasta,
    updated_at = now()
  where owner_id = p_owner;

  insert into public.subscription_events
    (owner_id, actor_email, desde_estado, hasta_estado, desde_plan, hasta_plan,
     motivo, metodo_pago, monto_usd)
  values
    (p_owner, p_actor_email, v_antes.estado, 'activa', v_antes.plan_code, v_antes.plan_code,
     coalesce(p_notas, 'Pago registrado'), p_metodo, p_monto_usd);

  return jsonb_build_object('ok', true, 'periodo_termina_el', p_hasta);
end;
$$;

-- ── Permisos ────────────────────────────────────────────────────────────
-- Solo service_role. Ni authenticated ni anon pueden llamarlas, así que un
-- tendero no puede regalarse una demo aunque descubra los nombres.
--
-- El revoke de `public` es lo que de verdad cierra: EXECUTE se concede a PUBLIC
-- por defecto, y sin esta línea el grant de abajo sería decorativo. Es la
-- trampa que la 041 documentó — un revoke a `anon` que corrió limpio y dejó la
-- función igual de abierta, porque el permiso venía de PUBLIC.
do $$
declare f text;
begin
  foreach f in array array[
    'public.admin_asegura_suscripcion(uuid)',
    'public.admin_cuentas_lista()',
    'public.admin_cuenta_historial(uuid)',
    'public.admin_dar_demo(uuid, int, text, text)',
    'public.admin_cambiar_plan(uuid, text, text, text, numeric, text)',
    'public.admin_registrar_pago(uuid, numeric, text, timestamptz, text, text)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

insert into public.schema_migrations (key, description)
values (
  '058_admin_cuentas',
  'Phase 2 of PLANES-Y-CUENTAS-PLAN.md: the SECURITY DEFINER functions /admin uses to read and change plans by hand — list, history, grant a demo of N negotiated days, change plan, record a payment. Deliberately NO block function: estado=bloqueada does not stop any write until Phase 3 adds the INSERT policies, and a Block button that does not block is worse than none. All writes upsert the subscription, because handle_new_user does not create one. Dates are evaluated in America/Caracas. service_role only, with the PUBLIC execute grant revoked first.'
)
on conflict (key) do nothing;

commit;

-- ── verificación, después de correr lo de arriba ────────────────────────
--
-- 1. La lista responde y trae a todos:
--
--   select count(*) from public.admin_cuentas_lista();
--   -- ESPERADO: el mismo número que select count(*) from public.owners;
--
-- 2. Una demo de 30 días, y deshecha:
--
--   begin;
--   select public.admin_dar_demo(
--     (select id from public.owners order by created_at limit 1),
--     30, 'prueba@sevenz', 'probando');
--   select estado, demo_termina_el from public.subscriptions
--   where owner_id = (select id from public.owners order by created_at limit 1);
--   rollback;
--   -- ESPERADO: estado = 'demo' y una fecha a 30 días, a las 23:59 de Caracas.
--
-- 3. Un tendero NO puede llamarlas:
--
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<UUID>","role":"authenticated"}';
--   select public.admin_dar_demo('<UUID>'::uuid, 365, 'yo@mismo');
--   rollback;
--   -- ESPERADO: ERROR 42501 permission denied for function admin_dar_demo
