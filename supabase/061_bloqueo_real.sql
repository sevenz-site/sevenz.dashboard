-- 061_bloqueo_real.sql
--
-- ENTORNO: correr en LOS DOS — primero la rama dev (vzqppwrwnmlbrxizskdh) y
-- después producción (rabmiyqodnvnrwiartuj).
--
-- Fase 3 de PLANES-Y-CUENTAS-PLAN.md: el bloqueo que de verdad bloquea. Hasta
-- ahora `estado = 'bloqueada'` era una etiqueta sin efecto.
--
-- ⚠ ESTA ES LA MIGRACIÓN MÁS DELICADA DE TODA LA SERIE. Toca las políticas de
-- `clients` y `movements`, o sea la ruta del dinero. Si sale mal, los tenderos
-- no pueden LEER su cartera, no solo no escribir.
--
-- ─────────────────────────────────────────────────────────────────────────
-- POR QUÉ HAY QUE PARTIR LAS POLÍTICAS
--
-- Hoy cada tabla tiene UNA sola política `for all`, que cubre select, insert,
-- update y delete con la misma condición. Añadirle el bloqueo dejaría a la
-- cuenta bloqueada sin poder LEER su propia cartera — lo contrario de lo
-- decidido: "ve su cartera, pero no registra nada".
--
-- Así que se parte: una para leer, con EXACTAMENTE la condición de hoy, y las
-- de escribir con el bloqueo añadido. La de leer se crea primero y no se toca
-- su lógica: es el camino que usan los 24 negocios a diario.
--
-- ─────────────────────────────────────────────────────────────────────────
-- QUÉ SE BLOQUEA Y QUÉ NO
--
--   Leer cartera, clientes e historial ....... sigue
--   El enlace de sus clientes ................ sigue (ver abajo)
--   Fiar, abonar, crear clientes, importar ... bloqueado
--   Borrar o restaurar movimientos ........... bloqueado (cambia saldos)
--   Editar su perfil o su logo ............... sigue, no es dinero
--
-- EL ENLACE DEL CLIENTE NO SE TOCA NUNCA. get_shared_balance es SECURITY
-- DEFINER y no pasa por estas políticas, así que sale gratis — pero queda
-- escrito para que nadie lo "arregle" después. Bloquear a un tendero que no
-- paga es razonable; dejar a su cliente sin poder consultar lo que debe es
-- castigar a quien no tiene nada que ver.
--
-- ─────────────────────────────────────────────────────────────────────────
-- CÓMO REVERTIR, si algo va mal. Guárdalo antes de correr esto:
--
--   begin;
--   drop policy if exists "owners read own clients" on public.clients;
--   drop policy if exists "owners insert own clients" on public.clients;
--   drop policy if exists "owners update own clients" on public.clients;
--   drop policy if exists "owners delete own clients" on public.clients;
--   create policy "owners manage own clients" on public.clients
--     for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
--
--   drop policy if exists "owners read own movements" on public.movements;
--   drop policy if exists "owners insert own movements" on public.movements;
--   drop policy if exists "owners update own movements" on public.movements;
--   drop policy if exists "owners delete own movements" on public.movements;
--   create policy "owners manage own movements" on public.movements
--     for all using (
--       exists (select 1 from public.clients c where c.id = client_id and c.owner_id = auth.uid())
--     ) with check (
--       exists (select 1 from public.clients c where c.id = client_id and c.owner_id = auth.uid())
--     );
--   commit;

begin;

-- ── ¿Puede escribir este negocio? ───────────────────────────────────────
-- STABLE para que Postgres la evalúe una vez por sentencia y no una por fila.
-- Sin eso, insertar 40 movimientos desde el importador la llamaría 40 veces.
--
-- SECURITY DEFINER porque `subscriptions` no tiene ni políticas ni grants: un
-- dueño no puede leerla, y aquí hay que consultarla en su nombre.
--
-- coalesce(..., true) — SIN FILA, ESCRIBE. Es la línea que evita dejar fuera a
-- quien se registró después de la 057, porque handle_new_user no crea la
-- suscripción. Fallar abierto aquí es correcto: el precio de equivocarse es
-- que alguien siga usando la app gratis un rato, y el de fallar cerrado es que
-- un tendero no pueda anotar un fiado que ya hizo.
create or replace function public.owner_puede_escribir(p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select estado <> 'bloqueada' from public.subscriptions where owner_id = p_owner),
    true
  );
$$;

grant execute on function public.owner_puede_escribir(uuid) to authenticated;

-- ── clients ─────────────────────────────────────────────────────────────
drop policy if exists "owners manage own clients" on public.clients;

-- Leer: la condición de hoy, sin tocar. Primero, a propósito.
create policy "owners read own clients" on public.clients
  for select using (owner_id = auth.uid());

create policy "owners insert own clients" on public.clients
  for insert with check (
    owner_id = auth.uid() and public.owner_puede_escribir(auth.uid())
  );

create policy "owners update own clients" on public.clients
  for update using (
    owner_id = auth.uid() and public.owner_puede_escribir(auth.uid())
  ) with check (
    owner_id = auth.uid() and public.owner_puede_escribir(auth.uid())
  );

create policy "owners delete own clients" on public.clients
  for delete using (
    owner_id = auth.uid() and public.owner_puede_escribir(auth.uid())
  );

-- ── movements ───────────────────────────────────────────────────────────
drop policy if exists "owners manage own movements" on public.movements;

create policy "owners read own movements" on public.movements
  for select using (
    exists (select 1 from public.clients c where c.id = client_id and c.owner_id = auth.uid())
  );

create policy "owners insert own movements" on public.movements
  for insert with check (
    exists (select 1 from public.clients c where c.id = client_id and c.owner_id = auth.uid())
    and public.owner_puede_escribir(auth.uid())
  );

-- UPDATE lleva el bloqueo porque borrar un movimiento es un update: el borrado
-- es blando, escribe deleted_at. Sin esto, una cuenta bloqueada podría seguir
-- borrando movimientos y cambiando saldos.
create policy "owners update own movements" on public.movements
  for update using (
    exists (select 1 from public.clients c where c.id = client_id and c.owner_id = auth.uid())
    and public.owner_puede_escribir(auth.uid())
  ) with check (
    exists (select 1 from public.clients c where c.id = client_id and c.owner_id = auth.uid())
    and public.owner_puede_escribir(auth.uid())
  );

create policy "owners delete own movements" on public.movements
  for delete using (
    exists (select 1 from public.clients c where c.id = client_id and c.owner_id = auth.uid())
    and public.owner_puede_escribir(auth.uid())
  );

-- ── Bloquear y desbloquear desde /admin ─────────────────────────────────
-- EL MOTIVO ES OBLIGATORIO al bloquear. No por burocracia: el día que alguien
-- diga "me bloqueaste y yo había pagado", la respuesta tiene que estar
-- escrita. Un historial con "bloqueada" y nada más no responde nada.
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
     v_antes.plan_code, v_antes.plan_code, trim(p_motivo));

  return jsonb_build_object('ok', true);
end;
$$;

-- Desbloquear devuelve a 'activa'. No a 'demo' aunque viniera de ahí: una demo
-- que se bloqueó y se reactiva ya no tiene sentido como prueba — si hay que
-- darle más días, se le da una demo nueva y queda dicho en el historial.
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
  set estado = 'activa', updated_at = now()
  where owner_id = p_owner;

  insert into public.subscription_events
    (owner_id, actor_email, desde_estado, hasta_estado, desde_plan, hasta_plan, motivo)
  values
    (p_owner, p_actor_email, v_antes.estado, 'activa',
     v_antes.plan_code, v_antes.plan_code, coalesce(p_motivo, 'Cuenta reactivada'));

  return jsonb_build_object('ok', true);
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.admin_bloquear(uuid, text, text)',
    'public.admin_desbloquear(uuid, text, text)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

insert into public.schema_migrations (key, description)
values (
  '061_bloqueo_real',
  'Phase 3: blocking that actually blocks. The single FOR ALL policy on clients and movements is split into read / insert / update / delete, because adding the check to the existing one would have stopped a blocked owner from READING their own ledger — the opposite of the decision. Reading keeps exactly today''s condition. UPDATE carries the block too, since deleting a movement is a soft delete. owner_puede_escribir is STABLE (once per statement, not per row) and coalesces a missing subscription to true, so accounts created after 057 are never locked out. The client share link is untouched: get_shared_balance is SECURITY DEFINER and never sees these policies.'
)
on conflict (key) do nothing;

commit;

-- ── verificación, después de correr lo de arriba ────────────────────────
--
-- 1. Ocho políticas donde antes había dos:
--
--   select tablename, policyname, cmd from pg_policies
--   where schemaname = 'public' and tablename in ('clients','movements')
--   order by tablename, cmd;
--
-- 2. UN NEGOCIO NORMAL SIGUE PUDIENDO TODO. Sustituye el uuid:
--
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<UUID>","role":"authenticated"}';
--   select count(*) as clientes from public.clients;
--   select count(*) as movimientos from public.movements;
--   rollback;
--   -- ESPERADO: sus números de siempre. Si sale 0, la lectura se rompió.
--
-- 3. UNO BLOQUEADO LEE PERO NO ESCRIBE:
--
--   begin;
--   update public.subscriptions set estado = 'bloqueada' where owner_id = '<UUID>';
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<UUID>","role":"authenticated"}';
--
--   select count(*) as sigue_leyendo from public.clients;   -- ESPERADO: sus clientes
--
--   insert into public.clients (owner_id, name) values ('<UUID>', 'Prueba bloqueo');
--   -- ESPERADO: ERROR 42501 new row violates row-level security policy
--
--   rollback;
