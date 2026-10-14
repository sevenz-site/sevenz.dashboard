-- ENVIRONMENT: run in DEV FIRST — dev branch (vzqppwrwnmlbrxizskdh).
-- Then in production (rabmiyqodnvnrwiartuj), BEFORE deploying the code, like
-- every other migration in this release.
--
-- WHAT THIS FIXES, and it would only have broken in production.
--
-- Both client senders need a share token for the template's button, and 43 of
-- 214 clients never got a link (CT-1), so both create one when it is missing.
-- They did it with a direct `insert into share_links` through the SERVICE-ROLE
-- client — and that is the exact shape of the 2026-09-05 outage:
--
--   * In the dev branch service_role keeps Supabase's wide table grants, so
--     the insert works and both suites pass (qa:recibo 13/13,
--     qa:recordatorio 15/15).
--   * In production service_role has NO grant on `share_links` (see
--     045_dev_grant_parity.sql, which deliberately left dev loose and says so:
--     "dev cannot validate production's permissions"). The insert would fail
--     with `permission denied for table share_links`.
--
-- So the receipt and the reminder would have gone out fine for every client
-- who already had a link, and silently failed for exactly the ones who never
-- had one — the clients CT-1 is about. Caught by `npm run qa:service-role`
-- during the launch checklist on 2026-10-14, not by any test against dev:
-- no test against dev CAN catch it, which is why that lint exists.
--
-- WHY A FUNCTION AND NOT A GRANT. A SECURITY DEFINER function needs no table
-- grant at all (039_admin_reads_without_table_grants.sql is the worked
-- example). Granting service_role a write on `share_links` in production
-- would widen production to match dev, which is backwards: production being
-- stricter is the intended state.
--
-- WHY IT IS NOT `movement_notice_target`'s JOB. That function is `stable` —
-- it cannot write — and it is called from the gate as well, where creating a
-- row as a side effect of asking a question would be wrong. The token gets
-- created at the one moment it is really needed: just before composing a
-- message that carries it.
--
-- OWNERSHIP, deliberately NOT a parameter. The function takes a client id
-- that comes from the server, never from a browser, and it is granted only to
-- service_role — the key only the senders hold. There is no `p_owner_id` to
-- check against because there is no untrusted caller to check: adding one
-- would be a predicate that always passes, which reads like a defence and is
-- not. The surfaces where a client id DOES arrive from a browser
-- (getOrCreateShareLink, setClientWhatsappNotices) keep their explicit
-- `.eq("owner_id", user.id)` and do not go through here.

begin;

-- Re-runnable: drops the signature that exists before this file and the one
-- it creates. They are the same here because the function is new, but the
-- line stays so that changing the argument list later cannot produce the
-- "works exactly once" file CLAUDE.md warns about.
drop function if exists public.whatsapp_share_token_for_client(uuid);

create function public.whatsapp_share_token_for_client(p_client_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
begin
  if p_client_id is null then
    return null;
  end if;

  select token into v_token
  from public.share_links
  where client_id = p_client_id;

  if v_token is not null then
    return v_token;
  end if;

  -- `client_id` is unique, so two senders racing on the same client cannot
  -- create two links: the loser's insert conflicts and reads the winner's
  -- row. `do nothing` plus the follow-up select is what makes that a return
  -- value instead of an error. It is a real race: a reminder batch and a
  -- receipt can touch the same client in the same second.
  insert into public.share_links (client_id)
  values (p_client_id)
  on conflict (client_id) do nothing;

  select token into v_token
  from public.share_links
  where client_id = p_client_id;

  return v_token;
end;
$$;

comment on function public.whatsapp_share_token_for_client(uuid) is
  'Devuelve el token de /s/[token] de un cliente, creandolo si nunca tuvo uno (CT-1). Existe para que los dos envios a cliente --el recibo y el recordatorio de plazo-- no escriban en share_links con la clave de service_role: eso funciona en el branch dev, que conserva los grants anchos, y NO funciona en produccion, que no le da ninguno (045_dev_grant_parity). O sea que los dos mensajes habrian salido bien para quien ya tenia enlace y habrian fallado en silencio justo para los 43 de 214 que nunca lo tuvieron. Lo caza npm run qa:service-role, no una prueba contra dev: ninguna prueba contra dev puede cazarlo. Security definer, sin grant de tabla. No lleva p_owner_id a proposito: el client_id lo pone el servidor, nunca el navegador, y el EXECUTE es solo de service_role; un predicado que siempre pasa parece una defensa y no lo es. Idempotente por el unique de client_id, con on conflict do nothing porque una tanda de recordatorios y un recibo pueden tocar al mismo cliente en el mismo segundo.';

-- EXECUTE solo para service_role. `authenticated` ya tiene su propio camino
-- --getOrCreateShareLink, con su comprobacion de propiedad-- y `anon` no tiene
-- por que fabricar enlaces de nadie.
revoke all on function public.whatsapp_share_token_for_client(uuid) from public;
revoke all on function public.whatsapp_share_token_for_client(uuid) from anon;
revoke all on function public.whatsapp_share_token_for_client(uuid) from authenticated;
grant execute on function public.whatsapp_share_token_for_client(uuid) to service_role;

insert into public.schema_migrations (key, description)
values (
  '102_share_token_sin_grant_de_tabla',
  'Los dos envios a cliente creaban el enlace de /s/[token] con un insert directo en share_links usando la clave de service_role, que es la forma exacta de la caida del 2026-09-05: funciona en el branch dev, que conserva los grants anchos de Supabase, y no funciona en produccion, que no le da ninguno sobre esa tabla (045_dev_grant_parity lo dejo asi a proposito y lo dice: "dev cannot validate production permissions"). El recibo y el recordatorio habrian salido bien para todo cliente con enlace y habrian fallado en silencio para los 43 de 214 que nunca tuvieron uno --los de CT-1, justo los que necesitan que se les cree. Lo caza npm run qa:service-role durante el checklist del 2026-10-14; ninguna prueba contra dev podia cazarlo. Entra whatsapp_share_token_for_client(client_id): security definer, sin grant de tabla, devuelve el token existente o lo crea con on conflict do nothing por el unique de client_id. EXECUTE solo para service_role; sin p_owner_id porque el id lo pone el servidor y no hay llamante no confiable que comprobar.'
)
on conflict (key) do nothing;

commit;
