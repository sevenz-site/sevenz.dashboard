-- 055_plan_solo_lo_cambia_sevenz.sql
--
-- ENTORNO: correr en LOS DOS — primero la rama dev (vzqppwrwnmlbrxizskdh) y
-- después producción (rabmiyqodnvnrwiartuj). Solo añade una función y un
-- trigger; ningún código depende de esto, así que el orden con el despliegue
-- es libre.
--
-- EL AGUJERO. Hoy, en producción, un tendero puede ponerse en el plan `pro`
-- él solo:
--
--   grant select, insert, update, delete on public.owners to authenticated;
--
--   create policy "owners update own row" on public.owners
--     for update using (id = auth.uid());
--
-- Permiso de UPDATE sobre la tabla entera, sin lista de columnas. La política
-- solo exige que la fila sea suya: no tiene WITH CHECK y no distingue qué
-- campo se está tocando. La clave `anon` viaja en el navegador por diseño y el
-- token de sesión está en las cookies del dueño, así que un PATCH a
-- /rest/v1/owners?id=eq.<el suyo> con {"plan":"pro"} pasa.
--
-- Hoy el premio es pequeño —el plan solo quita el límite mensual de fotos del
-- importador— y nadie lo ha hecho. Pero todo el sistema de cobros que viene
-- detrás se apoya en esta columna, y mientras siga abierta ese sistema es
-- decorativo: bloqueas una cuenta y se desbloquea sola.
--
-- POR QUÉ UN TRIGGER Y NO UNA POLÍTICA. Una política no puede comparar el
-- valor viejo con el nuevo: WITH CHECK solo ve la fila resultante, así que
-- "no dejes que esta columna cambie" no se puede expresar ahí. Y revocar el
-- UPDATE de la tabla tampoco sirve — el dueño necesita poder editar su nombre,
-- su WhatsApp, su logo y sus datos de pago desde "Mi negocio".
--
-- POR QUÉ **NO** ES SECURITY DEFINER, que es la trampa de este archivo. Dentro
-- de una función SECURITY DEFINER, `current_user` pasa a ser el dueño de la
-- función (postgres), no quien la llamó — o sea que la comprobación de abajo
-- se volvería siempre falsa y el trigger dejaría pasar todo mientras aparenta
-- estar puesto. Esto va SECURITY INVOKER, que es el valor por defecto y aquí
-- es la parte que hace que funcione.
--
-- LO QUE SÍ PUEDE: postgres (las migraciones), service_role (el panel de
-- /admin) y cualquier rol interno de Supabase. Se bloquean nominalmente los
-- dos roles que salen de un navegador, `authenticated` y `anon`, en vez de
-- permitir una lista — si mañana apareciera un rol nuevo, es preferible que
-- pase a que se rompa una migración sin que nadie entienda por qué.

begin;

create or replace function public.owners_bloquea_cambio_de_plan()
returns trigger
language plpgsql
-- SECURITY INVOKER a propósito. Ver la nota larga de arriba.
set search_path = public
as $$
begin
  if new.plan is distinct from old.plan
     and current_user in ('authenticated', 'anon') then
    raise exception
      'El plan de una cuenta solo lo cambia Sevenz, no la sesión del dueño.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists owners_bloquea_cambio_de_plan on public.owners;

create trigger owners_bloquea_cambio_de_plan
  before update on public.owners
  for each row
  execute function public.owners_bloquea_cambio_de_plan();

comment on function public.owners_bloquea_cambio_de_plan() is
  'Impide que un dueño se cambie de plan desde su propia sesión. NO convertir en SECURITY DEFINER: current_user pasaría a ser postgres y el trigger dejaría pasar todo aparentando funcionar.';

insert into public.schema_migrations (key, description)
values (
  '055_plan_solo_lo_cambia_sevenz',
  'Closes a live privilege escalation: owners hold UPDATE on the whole owners table and the policy has no WITH CHECK, so any signed-in shopkeeper could PATCH their own row to plan=pro. A BEFORE UPDATE trigger (SECURITY INVOKER on purpose) rejects the change when current_user is authenticated or anon. Phase 0 of PLANES-Y-CUENTAS-PLAN.md.'
)
on conflict (key) do nothing;

commit;

-- ── verificación, después de correr lo de arriba ────────────────────────
--
-- 1. El trigger está puesto:
--
--   select tgname, tgenabled
--   from pg_trigger
--   where tgrelid = 'public.owners'::regclass
--     and not tgisinternal;
--
--   Debe salir owners_bloquea_cambio_de_plan con tgenabled = 'O'.
--
-- 2. Y de verdad bloquea. Sustituye el uuid por uno real de public.owners.
--    Todo va dentro de una transacción que termina en rollback, así que no
--    cambia nada:
--
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<UUID>","role":"authenticated"}';
--
--   update public.owners set plan = 'pro' where id = '<UUID>';
--   -- ESPERADO: ERROR 42501, 'El plan de una cuenta solo lo cambia Sevenz...'
--
--   rollback;
--
-- 3. Y que Sevenz sí puede (el panel usa service_role):
--
--   begin;
--   update public.owners set plan = plan where id = '<UUID>';
--   -- ESPERADO: UPDATE 1, sin error
--   rollback;
