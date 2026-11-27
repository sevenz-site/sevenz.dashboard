-- ═══════════════════════════════════════════════════════════════════════
-- THE LOGO BEHIND A BALANCE LINK, READ WITHOUT RECORDING A VISIT
--
-- Owner's decision of 2026-11-27, before launching v0.14.0: *«la tarjeta del saldo
-- cuenta como "tu cliente abrió su enlace". corrígelo antes de lanzar»*.
--
-- v0.14.0 put the business's logo on the card WhatsApp draws for `/s/<token>` (owner's
-- request of 2026-11-26). The card needs one thing, the logo's path, and the only
-- function that returned it by token was `get_shared_balance`. That function does a
-- second job on every call: it upserts `link_opens`, which is what tells the shopkeeper
-- «Pedro abrió su enlace» (migrations 005 and 037). So the two new readers,
-- `generateMetadata` in `app/s/[token]/page.tsx` and the image route
-- `app/s/[token]/vista-previa/route.tsx`, each recorded a visit.
--
-- The image route is the one that costs something. It is fetched on its own, by whoever
-- draws the card and with no person looking at the balance (an app that previews links,
-- such as WhatsApp when the message is written). Migration 037 resets `read_at` on every
-- call so that a second look the same day re-alerts the owner; fed by the image, every
-- card drawn is a new «abrió su enlace». The shopkeeper reads that as «he has seen what
-- he owes», and decides whom to chase with it. How often each app fetches the image was
-- not measured; one fetch is already a false notice.
--
-- ───────────────────────────────────────────────────────────────────────
-- WHAT THIS RETURNS, AND WHY IT IS SAFE TO GIVE TO `anon`
--
-- The logo's storage path, or null. Nothing else: no business name, no client, no
-- amount. It is not new information for this caller: `get_shared_balance` already
-- returns `owner_logo_path` to anybody holding the same token, and the `logos` bucket is
-- public. An unknown token gets null, the same answer as a business with no logo, so the
-- function does not tell the two apart.
--
-- The token is matched exactly as `get_shared_balance` matches it (`share_links.token`,
-- nothing more), so the card and the page can never disagree about whether a link exists.
--
-- ───────────────────────────────────────────────────────────────────────
-- WHAT THIS DOES NOT FIX, SAID SO NOBODY REDISCOVERS IT
--
-- The page itself still records a visit when a preview crawler fetches its HTML to read
-- the card's tags, because rendering the page calls `get_shared_balance`. That has been
-- true since migration 005 and is not something v0.14.0 introduced. Telling a crawler
-- from a person is a different change (it means deciding by user agent, or moving the
-- recording out of the read), and it was not part of this decision.
--
-- DEPLOY ORDER (CLAUDE.md): this migration first, the code second. The old code never
-- calls this function. The new code, if it ever ran without it, gets an error from the
-- rpc and both callers fall back to the generic card.
-- ═══════════════════════════════════════════════════════════════════════

drop function if exists public.share_link_logo(text);

create function public.share_link_logo(p_token text)
returns text
language sql
security definer
set search_path = public
stable
as $fn$
  select o.logo_path
  from public.share_links sl
  join public.clients c on c.id = sl.client_id
  join public.owners o on o.id = c.owner_id
  where sl.token = p_token
  limit 1;
$fn$;

revoke execute on function public.share_link_logo(text) from public;
grant execute on function public.share_link_logo(text) to anon, authenticated, service_role;

comment on function public.share_link_logo(text) is
  'Devuelve la ruta del logo del negocio a partir del token de un enlace de saldo, para dibujar la tarjeta de vista previa. Solo lee: no registra una visita en link_opens.';

insert into public.schema_migrations (key, description)
values (
  '226_share_link_logo',
  'share_link_logo(token): lee el logo del negocio para la tarjeta del enlace de saldo sin registrar una visita. La tarjeta dejaba de contar como «tu cliente abrió su enlace».'
)
on conflict (key) do nothing;
