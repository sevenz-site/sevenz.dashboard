-- ═══════════════════════════════════════════════════════════════════════
-- WHO OWNS THIS CATALOGUE LINK — for the analytics of a PUBLIC action
--
-- Asked for by the owner on 2026-10-25, among eight business questions. The
-- first one is *«¿cuántas órdenes recibe un negocio?»*, and an order is
-- placed by a CUSTOMER on `/c/[token]` — somebody with no session, no owner
-- and nothing in Mixpanel to attribute the event to.
--
-- `CLAUDE.md` names this exact problem under «Todo evento de analítica
-- documenta su pregunta de negocio»: *«un evento que nace en una pantalla del
-- cliente no tiene a quién atribuirlo sin resolverlo en el servidor, y esa
-- resolución es parte de la decisión, no un detalle de implementación»*.
-- This function is that resolution.
--
-- ───────────────────────────────────────────────────────────────────────
-- IT IS A COPY OF `share_link_owner`, AND DELIBERATELY SO
--
-- That function does the same job for the balance link (`/s/[token]`) and
-- `app/api/share-contact/route.ts` is the worked example of using it. Two
-- functions instead of one because they read two different tables —
-- `share_links` and `catalog_share_links` — and folding them into one with a
-- branch would make a security-definer function decide which table to read
-- from a value the caller supplies.
--
-- ───────────────────────────────────────────────────────────────────────
-- WHY IT CANNOT JUST BE A SELECT FROM THE SERVER
--
-- `lib/supabase/service.ts` says it plainly: in production SELECT is revoked
-- from `service_role` on the customer tables, so a service-role client cannot
-- read `catalog_share_links` or `owners` no matter what RLS says. The
-- sanctioned path is a SECURITY DEFINER function, which is this one.
--
-- ───────────────────────────────────────────────────────────────────────
-- WHAT IT DOES NOT DO, ON PURPOSE
--
-- It returns the owner's id and email and nothing else. No name, no country,
-- no counts. Everything a public caller can reach is a place to leak from,
-- and analytics needs exactly these two: one to attribute the event, one to
-- keep the profile's email current.
--
-- AND IT IS NOT EXPOSED TO `anon`. Only `service_role` may execute it: the
-- call happens in a server action, never in the customer's browser. A token
-- that reached the wrong hands would otherwise hand back an email.
-- ═══════════════════════════════════════════════════════════════════════

drop function if exists public.catalog_link_owner(text);

create function public.catalog_link_owner(p_token text)
returns jsonb
language sql
security definer
set search_path = public
stable
as $fn$
  select jsonb_build_object(
    'owner_id', l.owner_id,
    'owner_email', u.email
  )
  from public.catalog_share_links l
  join auth.users u on u.id = l.owner_id
  where l.token = p_token
  limit 1;
$fn$;

revoke execute on function public.catalog_link_owner(text) from public, anon, authenticated;
grant execute on function public.catalog_link_owner(text) to service_role;

comment on function public.catalog_link_owner(text) is
  'Devuelve el dueno y su correo a partir del token de un enlace de catalogo. Solo para atribuir eventos de analitica de una accion publica, desde el servidor. Nunca expuesta a anon.';

insert into public.schema_migrations (key, description)
values (
  '159_catalog_link_owner',
  'catalog_link_owner(token): resuelve el dueno de un enlace de catalogo para poder atribuir en Mixpanel los pedidos que entran desde la pantalla publica.'
)
on conflict (key) do nothing;
