-- ENVIRONMENT: run in BOTH — dev branch (vzqppwrwnmlbrxizskdh) first, then
-- production (rabmiyqodnvnrwiartuj).
--
-- Closes the public client-profile surface until clients can authenticate.
--
-- get_shared_client_profile() returns a client's document, WhatsApp number and
-- address to anyone who presents a share token. A share link is not a secret in
-- practice: it travels through forwarded chats and WhatsApp groups, so its real
-- audience is much wider than the one client it was sent to. Name plus cédula
-- plus phone is most of what someone needs to sound convincing while
-- impersonating the shop to that client, or the client to the shop.
--
-- The route at /s/[token]/perfil now returns 404, but a route guard alone would
-- be theatre: this function is granted to anon, so it stays callable straight
-- from the browser with the project's public key long after the page is gone.
-- Revoking the grant is what actually closes it.
--
-- The function is not dropped. It comes back — unchanged — the day a client can
-- prove the page is theirs, and re-granting is one statement. Dropping it would
-- mean rebuilding it from memory later, which is how the careful bits get lost.
begin;

-- `public` first, and it is the whole point. Postgres grants EXECUTE to PUBLIC
-- automatically when a function is created, and anon executes through that
-- default — so revoking from anon alone changes nothing at all. The first
-- version of this migration omitted `public`, ran without error, and left the
-- function fully callable with the project's anon key; the revoke only appeared
-- to work. Every other function closed this way today (038, 039, 040) revokes
-- from all three for this reason.
revoke execute on function public.get_shared_client_profile(text)
  from public, anon, authenticated;

-- get_shared_balance() is deliberately untouched. It still returns payment_info
-- and document_id, and it still must: the balance page is a Server Component,
-- so those values stay in server memory and never enter the HTML or the RSC
-- payload — the page simply stopped rendering them. Revoking here would break
-- the balance link itself, which is the one thing on this surface that has to
-- keep working.

insert into public.schema_migrations (key, description)
values (
  '041_close_public_client_profile',
  'Revokes anon/authenticated execute on get_shared_client_profile() — the /s/[token]/perfil surface is closed until clients can authenticate. Function kept, not dropped.'
)
on conflict (key) do nothing;

commit;
