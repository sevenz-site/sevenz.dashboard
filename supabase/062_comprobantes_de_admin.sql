-- 062_comprobantes_de_admin.sql
--
-- ENTORNO: correr primero en la rama DEV (vzqppwrwnmlbrxizskdh) y después en
-- producción (rabmiyqodnvnrwiartuj).
--
-- ⚠ DEPENDE DE LA 061. Modifica admin_bloquear, que la 061 crea. En producción
-- solo puede correr DESPUÉS de la 061; antes de eso fallaría a mitad.
--
-- Adjuntar el comprobante a lo que se hace desde /admin: la captura del Zelle
-- al registrar un pago, el PDF de la transferencia, las capturas de WhatsApp
-- que respaldan un bloqueo.
--
-- ─────────────────────────────────────────────────────────────────────────
-- POR QUÉ UN BUCKET NUEVO Y NO `attachments`
--
-- `attachments` es del tendero: sus políticas dejan leer al dueño de la
-- carpeta. Un pantallazo que respalda "no paga desde julio, avisado dos veces"
-- guardado ahí sería legible por la persona de la que habla. No es una
-- preferencia de orden: es una fuga.
--
-- `comprobantes` va SIN POLÍTICAS, igual que subscriptions y
-- subscription_events. Nadie llega con una sesión normal. Solo service_role,
-- que se salta RLS, y solo desde acciones detrás de requireSuperadmin().
--
-- Y no puede ser de otra forma: quién es superadmin lo dice SUPERADMIN_EMAILS,
-- una variable de entorno. La base no lo sabe, así que ninguna política de
-- storage puede comprobarlo. Es el mismo diseño de todo /admin — que nada en
-- la base conceda admin es lo que hace que ningún error en una política pueda
-- convertir a nadie en superadmin.
--
-- ─────────────────────────────────────────────────────────────────────────
-- POR QUÉ LAS FUNCIONES DEVUELVEN AHORA EL ID DEL ASIENTO
--
-- El archivo se sube DESPUÉS de que la función haya escrito su asiento, así
-- que hay que saber a cuál pegarlo. La alternativa —"el asiento más reciente
-- de este negocio"— es una suposición disfrazada, y el día que falle pega el
-- recibo de un pago al asiento de un bloqueo.
--
-- Añadir una clave al jsonb que ya devolvían NO cambia su firma, así que aquí
-- no hace falta el drop + create de la 059. Los argumentos y el tipo de
-- retorno son los mismos.

begin;

-- ── 1. Dónde se guarda la ruta ──────────────────────────────────────────
alter table public.subscription_events
  add column if not exists comprobante_path text;

-- ── 2. El bucket ────────────────────────────────────────────────────────
-- public = false. Un bucket público sirve cualquier archivo a quien adivine
-- la URL, sin sesión: lo contrario de lo que hace falta aquí.
--
-- 5 MB y lista de tipos cerrada. Las imágenes llegan ya reducidas desde el
-- navegador; el tope es para los PDF y para que un fallo del reductor no
-- suba una foto de 12 MB.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'comprobantes',
  'comprobantes',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- CERO políticas sobre storage.objects para este bucket, a propósito. Ver la
-- cabecera. Si alguien añade una aquí, que sea leyendo antes por qué no hay.

-- ── 3. Pegar el comprobante a su asiento ────────────────────────────────
-- `comprobante_path is null` en el where: un asiento no cambia de comprobante.
-- Los asientos son inmutables —es lo que hace que subir un precio no reescriba
-- el pasado, ver la 060— y un comprobante que se puede sustituir después deja
-- de ser prueba de nada.
create or replace function public.admin_guarda_comprobante(
  p_evento uuid,
  p_path text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tocadas int;
begin
  if p_path is null or length(trim(p_path)) = 0 then
    raise exception 'Falta la ruta del comprobante' using errcode = '22023';
  end if;

  update public.subscription_events
  set comprobante_path = trim(p_path)
  where id = p_evento and comprobante_path is null;

  get diagnostics v_tocadas = row_count;
  if v_tocadas = 0 then
    raise exception 'Ese asiento no existe o ya tiene comprobante' using errcode = 'P0002';
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

-- ── 4. El historial lo enseña ───────────────────────────────────────────
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
    'monto_usd', e.monto_usd,
    'comprobante_path', e.comprobante_path
  )
  from public.subscription_events e
  where e.owner_id = p_owner
  order by e.ocurrido_el desc;
$$;

-- ── 5. Las cuatro acciones devuelven el id de su asiento ────────────────

create or replace function public.admin_dar_demo(
  p_owner uuid,
  p_dias int,
  p_actor_email text,
  p_notas text default null,
  p_precio_usd numeric default null,
  p_periodicidad text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_antes public.subscriptions;
  v_fin timestamptz;
  v_evento uuid;
begin
  if p_dias is null or p_dias < 1 or p_dias > 365 then
    raise exception 'La demo tiene que durar entre 1 y 365 días' using errcode = '22023';
  end if;

  if p_periodicidad is not null
     and p_periodicidad not in ('mensual', 'trimestral', 'anual') then
    raise exception 'Periodicidad no válida: %', p_periodicidad using errcode = '22023';
  end if;

  if p_precio_usd is not null and p_precio_usd < 0 then
    raise exception 'El precio no puede ser negativo' using errcode = '22023';
  end if;

  v_antes := public.admin_asegura_suscripcion(p_owner);

  v_fin := (((now() at time zone 'America/Caracas')::date + p_dias)::timestamp
            + interval '23 hours 59 minutes 59 seconds')
           at time zone 'America/Caracas';

  update public.subscriptions set
    estado = 'demo',
    demo_termina_el = v_fin,
    periodo_termina_el = null,
    periodicidad = coalesce(p_periodicidad, periodicidad),
    precio_pactado_usd = coalesce(p_precio_usd, precio_pactado_usd),
    notas = coalesce(p_notas, notas),
    updated_at = now()
  where owner_id = p_owner;

  insert into public.subscription_events
    (owner_id, actor_email, desde_estado, hasta_estado, desde_plan, hasta_plan, motivo, monto_usd)
  values
    (p_owner, p_actor_email, v_antes.estado, 'demo', v_antes.plan_code, v_antes.plan_code,
     coalesce(p_notas, 'Demo de ' || p_dias || ' días'),
     p_precio_usd)
  returning id into v_evento;

  return jsonb_build_object(
    'ok', true,
    'evento_id', v_evento,
    'demo_termina_el', v_fin,
    'cobro_empieza_el', (v_fin + interval '1 second')
  );
end;
$$;

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
  v_evento uuid;
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
     coalesce(p_notas, 'Cambio de plan'), coalesce(p_precio_usd, v_plan.precio_usd))
  returning id into v_evento;

  return jsonb_build_object('ok', true, 'evento_id', v_evento, 'plan_code', p_plan);
end;
$$;

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
  v_evento uuid;
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
     coalesce(p_notas, 'Pago registrado'), p_metodo, p_monto_usd)
  returning id into v_evento;

  return jsonb_build_object('ok', true, 'evento_id', v_evento, 'periodo_termina_el', p_hasta);
end;
$$;

create or replace function public.admin_bloquear(
  p_owner uuid,
  p_motivo text,
  p_actor_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_antes public.subscriptions;
  v_evento uuid;
begin
  if p_motivo is null or length(trim(p_motivo)) < 3 then
    raise exception 'Hay que decir por qué se bloquea' using errcode = '22023';
  end if;

  v_antes := public.admin_asegura_suscripcion(p_owner);

  update public.subscriptions
  set estado = 'bloqueada', updated_at = now()
  where owner_id = p_owner;

  insert into public.subscription_events
    (owner_id, actor_email, desde_estado, hasta_estado, desde_plan, hasta_plan, motivo)
  values
    (p_owner, p_actor_email, v_antes.estado, 'bloqueada',
     v_antes.plan_code, v_antes.plan_code, trim(p_motivo))
  returning id into v_evento;

  return jsonb_build_object('ok', true, 'evento_id', v_evento);
end;
$$;

-- ── 6. Permisos ─────────────────────────────────────────────────────────
-- El revoke PRIMERO. `execute` se concede a PUBLIC por defecto, así que un
-- grant a service_role sin revocar antes es decorativo — la trampa que ya
-- quedó documentada en la 041.
do $$
declare f text;
begin
  foreach f in array array[
    'public.admin_guarda_comprobante(uuid, text)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

insert into public.schema_migrations (key, description)
values (
  '062_comprobantes_de_admin',
  'Proof-of-payment attachments for the four /admin actions. New PRIVATE bucket `comprobantes` with zero policies — never the shopkeeper''s `attachments` bucket, whose policies let the owner read their own folder, which would hand the person being blocked the screenshots backing the block. Storage policies cannot gate on superadmin anyway: SUPERADMIN_EMAILS is an env var and nothing in the database grants admin. The four action functions now return evento_id so the upload attaches to the exact ledger entry instead of guessing at the most recent one, and a new entry cannot have its attachment replaced — events are immutable. Adding a key to an existing jsonb return is not a signature change, so no drop/create was needed. DEPENDS ON 061: it modifies admin_bloquear.'
)
on conflict (key) do nothing;

commit;

-- ── verificación, después de correr lo de arriba ────────────────────────
--
-- 1. El bucket existe y es PRIVADO:
--
--   select id, public, file_size_limit, allowed_mime_types
--   from storage.buckets where id = 'comprobantes';
--   -- ESPERADO: public = false. Si sale true, para y avisa.
--
-- 2. Nadie tiene políticas sobre él:
--
--   select policyname from pg_policies
--   where schemaname = 'storage' and tablename = 'objects'
--     and qual like '%comprobantes%';
--   -- ESPERADO: cero filas.
--
-- 3. La columna está y el historial la devuelve:
--
--   select jsonb_object_keys(h) from public.admin_cuenta_historial(
--     (select owner_id from public.subscriptions limit 1)
--   ) h limit 20;
--   -- ESPERADO: entre las claves, comprobante_path.
