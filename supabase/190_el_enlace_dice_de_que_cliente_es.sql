-- ENVIRONMENT: run in DEV first (vzqppwrwnmlbrxizskdh). Production comes later,
-- with its own green light, and BEFORE the code (CLAUDE.md, deploy step 1). The old
-- code keeps working against this file: it reads two keys and ignores the third.
-- Re-runnable: `create or replace` with the same signature and the same return type.
--
-- ===========================================================================
-- 190: A SHARED LINK SAYS WHICH CLIENT IT BELONGS TO
--
-- Owner's decision of 2026-11-04: *«en las propiedades de los eventos sí podríamos
-- incluir el id del cliente, así como el id del dueño»*. Events on `/s/[token]` were
-- filed under the business with no way to tell one client from another, so «opened
-- 30 times» could be thirty people or one person thirty times.
--
-- Only the id. Never the name, the phone or the document.
--
-- THIS MAKES A PUBLISHED SENTENCE FALSE. The Política de privacidad says these events
-- carry «ningún identificador del Cliente Final». It has to change in the same release.
--
-- The body is 117's, with `client_id` added. Grants are restated because 178 closed
-- this function to `authenticated`, and `create or replace` keeps them anyway.
-- ===========================================================================

begin;

create or replace function public.share_link_owner(p_token text)
returns json
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_owner_id uuid;
  v_owner_email text;
  v_client_id uuid;
begin
  select o.id, o.email, c.id
    into v_owner_id, v_owner_email, v_client_id
  from public.share_links sl
  join public.clients c on c.id = sl.client_id
  join public.owners o on o.id = c.owner_id
  where sl.token = p_token
    and c.trashed_at is null;

  -- An unknown token is null, never an error: the caller records nothing, because
  -- an event filed under a guess is worse than a missing one.
  if not found then
    return null;
  end if;

  return json_build_object('owner_id', v_owner_id, 'owner_email', v_owner_email, 'client_id', v_client_id);
end;
$fn$;

revoke execute on function public.share_link_owner(text) from public, anon, authenticated;
grant execute on function public.share_link_owner(text) to service_role;

insert into public.schema_migrations (key, description)
values (
  '190_el_enlace_dice_de_que_cliente_es',
  'share_link_owner devuelve también client_id, para atribuir al cliente los eventos de la vista pública. Solo el id, nunca datos personales.'
)
on conflict (key) do nothing;

commit;
