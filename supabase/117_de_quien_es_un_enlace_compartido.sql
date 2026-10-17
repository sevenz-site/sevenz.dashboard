-- 117: WHO OWNS A SHARE LINK, so an event raised on the public page can be
-- filed under the right business.
--
-- WHAT IT IS FOR, and this is the whole reason it exists: the owner's business
-- question of 2026-10-16 -- *«¿Con cuál frecuencia los clientes contactan al
-- dueño del negocio a través del botón de WhatsApp?»*. That button lives on
-- `/s/[token]`, which has no session: the person tapping it is the CLIENT, and
-- the page knows them only by a token. Mixpanel files everything under the
-- owner's id, so something has to turn that token into an owner, and the
-- browser cannot be told the answer -- an owner id handed to an
-- unauthenticated page is an owner id anyone can read.
--
-- WHY A FUNCTION OF ITS OWN AND NOT A FIELD ON `get_shared_balance`: that one
-- is called by the public page on every single visit, and changing its
-- signature means `drop` + `create` plus the deploy-order rule. On 2026-09-04
-- adding an argument to it would have 404ed every share link in existence if
-- the code had shipped first. A separate function cannot break the page that
-- works. `client_whatsapp_consent_state` (migration 081) was added for exactly
-- this reason and this file copies its shape deliberately.
--
-- WHY `service_role` ONLY: the anon key reaches the browser, so anything anon
-- may execute is a public API. This returns an owner's id and e-mail from
-- nothing but a token -- fine for our own server, not for the internet. The
-- route that calls it uses the service client, like the consent state does.

begin;

drop function if exists public.share_link_owner(text);

create function public.share_link_owner(p_token text)
returns json
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_owner_id uuid;
  v_owner_email text;
begin
  select o.id, o.email
    into v_owner_id, v_owner_email
  from public.share_links sl
  join public.clients c on c.id = sl.client_id
  join public.owners o on o.id = c.owner_id
  where sl.token = p_token
    and c.trashed_at is null;

  -- Same contract as `get_shared_balance` and `client_whatsapp_consent_state`:
  -- an unknown token is null, never an error. The caller treats null as "do
  -- not record anything", which is the correct outcome -- an event filed under
  -- a guess would be worse than a missing one.
  if not found then
    return null;
  end if;

  return json_build_object('owner_id', v_owner_id, 'owner_email', v_owner_email);
end;
$fn$;

revoke execute on function public.share_link_owner(text) from public, anon;
grant execute on function public.share_link_owner(text) to service_role;

insert into public.schema_migrations (key, description)
values (
  '117_de_quien_es_un_enlace_compartido',
  'share_link_owner(token): devuelve el id y el correo del dueno al que pertenece un enlace compartido. Existe para la pregunta de negocio del dueno del 2026-10-16 -- con que frecuencia los clientes le escriben por el boton de WhatsApp de /s/[token] --, porque esa pantalla no tiene sesion y Mixpanel archiva todo bajo el id del dueno. Funcion aparte y no un campo nuevo en get_shared_balance: esa la llama la pagina publica en cada visita y cambiarle la firma obliga a drop+create con el riesgo de 404ear todos los enlaces, que es justo lo que casi pasa el 2026-09-04. Concedida SOLO a service_role: la clave anonima llega al navegador, y una funcion que devuelve el id y el correo de un dueno a partir de un token no puede ser una API publica.'
)
on conflict (key) do nothing;

commit;
