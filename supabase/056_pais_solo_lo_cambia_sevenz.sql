-- 056_pais_solo_lo_cambia_sevenz.sql
--
-- ENTORNO: correr en LOS DOS — primero la rama dev (vzqppwrwnmlbrxizskdh) y
-- después producción (rabmiyqodnvnrwiartuj).
--
-- Cierra el mismo agujero que la 055, en la otra columna que importa.
--
-- EL AGUJERO. `owners.country` decide QUÉ LIBRO lleva un negocio: 'VE' lleva
-- dólares y euros por separado, 'CO' lleva pesos. Y el dueño tiene UPDATE
-- sobre toda la tabla con una política sin WITH CHECK, igual que con `plan`.
--
-- El servidor además hace `String(formData.get("country") ?? "CO")`, así que
-- para volver colombiano a un negocio venezolano no hace falta ni saber qué
-- valor poner: basta con OMITIR el campo.
--
-- LO QUE PASARÍA. Sus movimientos existentes se quedan en USD y EUR, mientras
-- los nuevos entrarían con currency = null, o sea en el libro de pesos. Y
-- recalc_client_running_balance agrupa por (cliente, moneda), así que ese
-- cliente acabaría con dos saldos paralelos que no se hablan. No es un fallo
-- de pantalla: es la libreta partida en dos.
--
-- Nadie gana nada haciéndolo —a diferencia de `plan`, aquí no hay premio— así
-- que es menos probable y más caro de deshacer.
--
-- ─────────────────────────────────────────────────────────────────────────
-- POR QUÉ UNA FUNCIÓN NUEVA Y NO AÑADIR UNA LÍNEA A LA DE LA 055
--
-- Porque la 055 hace `create or replace function
-- owners_bloquea_cambio_de_plan()`. Si la comprobación del país viviera en esa
-- misma función y alguien volviera a correr la 055 —reconstruyendo un entorno,
-- clonando una rama, copiando y pegando de más— la protección del país
-- desaparecería EN SILENCIO. El trigger seguiría existiendo, con tgenabled =
-- 'O', protegiendo la mitad de lo que dice proteger.
--
-- Con una función nueva, volver a correr la 055 después de esto solo añade
-- otra vez un trigger redundante que comprueba el plan. Inofensivo en vez de
-- destructivo. Los dos triggers pueden convivir: ninguno modifica la fila, los
-- dos solo lanzan excepciones, así que el orden entre ellos da igual.
--
-- ─────────────────────────────────────────────────────────────────────────
-- SECURITY INVOKER, y esto NO es un descuido
--
-- Dentro de una función SECURITY DEFINER, `current_user` pasa a ser el dueño
-- de la función —postgres—, no quien la llamó. La condición sería siempre
-- falsa y el trigger dejaría pasar todo APARENTANDO estar puesto, que es la
-- peor forma de fallar que existe en algo de seguridad.
--
-- ─────────────────────────────────────────────────────────────────────────
-- ⚠ ESTO NO ARREGLA EL PROBLEMA DE FONDO, SOLO QUIÉN PUEDE CAUSARLO
--
-- CAMBIAR EL PAÍS DE UN NEGOCIO QUE YA TIENE MOVIMIENTOS NO ES UN UPDATE:
-- ES UNA MIGRACIÓN DE DATOS. Sus movimientos viejos se quedan en la moneda
-- que tenían y los nuevos entran en otro libro.
--
-- No se bloquea para service_role a propósito: el caso legítimo —"me equivoqué
-- al registrarme"— ocurre el primer día, cuando todavía no hay movimientos, y
-- bloquearlo dejaría a soporte sin poder arreglarlo un sábado.
--
-- ANTES de cambiar el país de alguien, mira si tiene movimientos:
--
--   select count(*) from public.movements m
--   join public.clients c on c.id = m.client_id
--   where c.owner_id = '<UUID>' and m.deleted_at is null;
--
-- Si eso no es 0, para y piensa qué pasa con esos movimientos.

begin;

create or replace function public.owners_bloquea_columnas_de_sevenz()
returns trigger
language plpgsql
-- SECURITY INVOKER a propósito. Ver la nota de arriba.
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if new.plan is distinct from old.plan then
    raise exception
      'El plan de una cuenta solo lo cambia Sevenz, no la sesión del dueño.'
      using errcode = '42501';
  end if;

  if new.country is distinct from old.country then
    raise exception
      'El país de un negocio solo lo cambia Sevenz, no la sesión del dueño.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists owners_bloquea_columnas_de_sevenz on public.owners;

create trigger owners_bloquea_columnas_de_sevenz
  before update on public.owners
  for each row
  execute function public.owners_bloquea_columnas_de_sevenz();

-- La de la 055 se retira: esta la reemplaza y hace las dos comprobaciones.
-- Se deja la función sin borrar por si alguien reejecuta la 055 — si lo hace,
-- recrea su propio trigger y no rompe nada.
drop trigger if exists owners_bloquea_cambio_de_plan on public.owners;

comment on function public.owners_bloquea_columnas_de_sevenz() is
  'Impide que un dueño se cambie de plan o de país desde su propia sesión. NO convertir en SECURITY DEFINER: current_user pasaría a ser postgres y el trigger dejaría pasar todo aparentando funcionar. Cambiar el país de un negocio CON MOVIMIENTOS es una migración de datos, no un update.';

insert into public.schema_migrations (key, description)
values (
  '056_pais_solo_lo_cambia_sevenz',
  'Extends 055 to owners.country, the column that decides which ledger a business keeps (VE = USD/EUR, CO = COP). Same hole: owners hold UPDATE on the whole table with no WITH CHECK, and the server defaults a missing country to CO, so omitting the field would turn a Venezuelan business Colombian and split its clients into two parallel balances. New function name on purpose, so re-running 055 later cannot silently drop the country check.'
)
on conflict (key) do nothing;

commit;

-- ── verificación, después de correr lo de arriba ────────────────────────
--
-- 1. Queda UN trigger, el nuevo:
--
--   select tgname from pg_trigger
--   where tgrelid = 'public.owners'::regclass and not tgisinternal;
--
-- 2. El dueño no puede cambiarse el país (sustituye el uuid):
--
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<UUID>","role":"authenticated"}';
--   update public.owners set country = 'CO' where id = '<UUID>';
--   rollback;
--   -- ESPERADO: ERROR 42501. Usa un negocio 'VE' o no cambiará nada.
--
-- 3. Ni el plan (lo que hacía la 055 sigue vivo):
--
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<UUID>","role":"authenticated"}';
--   update public.owners set plan = 'pro' where id = '<UUID>';
--   rollback;
--   -- ESPERADO: ERROR 42501
--
-- 4. Y "MI NEGOCIO" SIGUE GUARDANDO — con la forma REAL, los doce campos que
--    manda el formulario, no uno solo. Esta es la comprobación que de verdad
--    importa, y la que la 055 no hizo bien:
--
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<UUID>","role":"authenticated"}';
--   update public.owners set
--     business_name = business_name, first_name = first_name,
--     last_name = last_name, whatsapp = whatsapp, address = address,
--     tax_id = tax_id, logo_path = logo_path, payment_info = payment_info,
--     country = country
--   where id = '<UUID>';
--   rollback;
--   -- ESPERADO: Success. Si esto falla, quita el trigger y avisa.
