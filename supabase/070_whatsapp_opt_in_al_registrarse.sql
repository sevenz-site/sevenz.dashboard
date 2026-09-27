-- 070_whatsapp_opt_in_al_registrarse.sql
--
-- ENVIRONMENT: run first on the DEV branch (vzqppwrwnmlbrxizskdh). Do NOT run
-- against production (rabmiyqodnvnrwiartuj) until the code that uses it is
-- ready to deploy and the user has said to launch.
--
-- El dueño nuevo nace con los avisos por WhatsApp encendidos, porque los
-- aceptó al crear la cuenta.
--
-- ─────────────────────────────────────────────────────────────────────────
-- ESTE ES EL ÚNICO "ACTIVADO POR DEFECTO" LEGÍTIMO
--
-- A los dueños que ya existen NO se les enciende por migración: nunca vieron
-- nada, y Meta exige consentimiento afirmativo y demostrable. En Colombia,
-- además, la Ley 1581 pide autorización *previa, expresa e informada*. A esos
-- se les pregunta con el diálogo de `PedirAvisosWhatsappDialog`.
--
-- Aquí es distinto: el formulario de registro enseña la frase encima del botón
-- de crear cuenta, y crear la cuenta es el acto afirmativo. Lo que se guarda no
-- es un booleano sino **la frase exacta que esa persona leyó**, igual que
-- cuando lo enciende a mano desde Mi negocio.
--
-- ─────────────────────────────────────────────────────────────────────────
-- POR QUÉ EN EL TRIGGER Y NO EN LA SERVER ACTION
--
-- Porque la fila de `owners` la crea este trigger, y al terminar `signUp()` no
-- hay sesión con la que actualizarla: con la confirmación de correo activada
-- —que en producción lo está— el usuario todavía no ha iniciado sesión, así
-- que un `update` desde la acción chocaría con la política `id = auth.uid()`.
-- Ponerlo aquí lo hace atómico con el alta: o se crea el dueño con su
-- consentimiento, o no se crea.
--
-- ─────────────────────────────────────────────────────────────────────────
-- CUIDADO SI ALGUNA VEZ SE CREA OTRA RAMA DE SUPABASE
--
-- Está en CLAUDE.md y esta migración lo toca de lleno: al clonar un proyecto,
-- la FUNCIÓN se copia pero **el trigger sobre `auth.users` no**. Ya pasó una
-- vez: `handle_new_user()` existía en la rama nueva y `on_auth_user_created`
-- no, así que los registros creaban usuario y ningún `owners`, en silencio.
-- Por eso el trigger se vuelve a declarar aquí abajo, y por eso la
-- verificación del final comprueba un REGISTRO REAL y no que la función
-- exista.

begin;

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
  return new;
end;
$$;

-- Redeclarado a propósito: un `create or replace function` no recrea el
-- trigger, y si esta migración se corre sobre una rama donde el trigger no se
-- clonó, sin esto los registros seguirían sin crear `owners`.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

insert into public.schema_migrations (key, description)
values (
  '070_whatsapp_opt_in_al_registrarse',
  'handle_new_user() guarda el consentimiento de los avisos por WhatsApp al crear la cuenta, leyendo whatsapp_opt_in_text de raw_user_meta_data. Es el unico "activado por defecto" legitimo: el formulario ensena la frase encima del boton y crear la cuenta es el acto afirmativo, mientras que a los duenos que YA existen no se les enciende por migracion porque nunca vieron nada. Va en el trigger y no en la server action porque al terminar signUp() no hay sesion con la que actualizar owners —con la confirmacion de correo activada el usuario aun no inicio sesion y un update chocaria con la politica id = auth.uid()— y porque asi es atomico con el alta. Sin frase o sin numero, el dueno queda SIN aceptar: nunca se inventa un consentimiento. El trigger se redeclara porque un create or replace function no lo recrea, y al clonar un proyecto de Supabase la funcion se copia pero el trigger sobre auth.users no.'
)
on conflict (key) do nothing;

commit;

-- ── verification, after running the above ───────────────────────────────
--
-- SE COMPRUEBA UN REGISTRO REAL, no que la función exista. Que exista no
-- demuestra que el trigger esté puesto, y esa diferencia ya costó una vez que
-- los registros no crearan ningún `owners` sin que nadie lo notara.
--
-- 1. Los dueños que ya estaban no cambiaron:
--
--   select count(*) filter (where whatsapp_opt_in_at is not null) as aceptaron
--   from public.owners;
--   -- EXPECTED: los mismos de antes de correr esto, ni uno más.
--
-- 2. Un alta con consentimiento lo guarda, y una sin él no:
--    (se prueba desde el formulario o con el script de QA, no aquí)
