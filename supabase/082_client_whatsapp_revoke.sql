-- 082_client_whatsapp_revoke.sql
--
-- ENVIRONMENT: run first on the DEV branch (vzqppwrwnmlbrxizskdh). Do NOT run
-- against production (rabmiyqodnvnrwiartuj) until the screen that calls it is
-- ready to deploy and the user has said to launch.
--
-- THE WAY OUT. Ticket MS-31.
--
-- 081 built the ledger with a 'revoked' event in its check constraint and then
-- shipped nothing that writes one. That was not an oversight to leave standing:
-- Meta requires an opt-out, and the practical reason is sharper than the rule.
-- Someone who wants the messages to stop and cannot make them stop blocks the
-- number instead — and quality rating is measured per NUMBER, of which Sevenz
-- has exactly one, so one person's dead end costs every owner on the platform
-- their weekly summary.
--
-- ===========================================================================
-- REVOKING IS A ROW, NOT A DELETION
--
-- Same reason the grant was a row. Deleting the 'granted' row would destroy the
-- evidence that the person DID consent on that day — which is precisely the
-- evidence that covers the messages already sent to them. The ledger has to be
-- able to answer "were we allowed to send that one, last Tuesday?" long after
-- the answer to "may we send one today?" has become no.
--
-- So the pair reads as a history: granted on the 9th, revoked on the 20th.
-- `client_accepts_whatsapp()` already resolves that by taking the latest row,
-- and needs no change.
--
-- ===========================================================================
-- IT REVOKES FOR EVERY SHOP, AND THAT IS NOT A SIDE EFFECT
--
-- The key is the phone number, so turning it off through one shop's link turns
-- it off everywhere — exactly as accepting through one shop's link accepted
-- everywhere (081). The symmetry is forced by the schema and it is also the
-- only defensible behaviour: a person tapping "stop writing to me" means the
-- messages, not one sender they cannot distinguish anyway, because every one of
-- them arrives from the same Sevenz number.

begin;

drop function if exists public.revoke_client_whatsapp_consent(text);

create function public.revoke_client_whatsapp_consent(p_token text)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_client_id uuid;
  v_phone text;
  v_latest public.client_whatsapp_consents%rowtype;
begin
  select c.id, public.normalize_whatsapp_phone(c.whatsapp)
    into v_client_id, v_phone
  from public.share_links sl
  join public.clients c on c.id = sl.client_id
  where sl.token = p_token
    and c.trashed_at is null;

  if not found or v_phone is null then
    return false;
  end if;

  select * into v_latest
  from public.client_whatsapp_consents
  where phone = v_phone
  order by occurred_at desc, id desc
  limit 1;

  -- Nothing to switch off: never granted, or already revoked. Returns true
  -- because the caller asked for a state, not for an action, and that state
  -- holds. A double tap, or a retry after a dropped connection, must not write
  -- a second row — the ledger is read as a history and a duplicate would read
  -- as two separate decisions.
  if not found or v_latest.event = 'revoked' then
    return true;
  end if;

  -- consent_text stays null: there is no sentence to evidence here. The check
  -- constraint in 081 only requires one for 'granted', for this reason.
  insert into public.client_whatsapp_consents (phone, event, via_client_id)
  values (v_phone, 'revoked', v_client_id);

  return true;
end;
$fn$;

comment on function public.revoke_client_whatsapp_consent(text) is
  'Records that the number behind this share token withdrew permission. Appends a row, never deletes the grant: that grant is the evidence covering the messages already sent. Idempotent. Revokes for every shop, because the key is the phone. service_role only.';

revoke execute on function public.revoke_client_whatsapp_consent(text) from public, anon, authenticated;
grant execute on function public.revoke_client_whatsapp_consent(text) to service_role;

insert into public.schema_migrations (key, description)
values (
  '082_client_whatsapp_revoke',
  'MS-31: la salida. La 081 dejo el evento revoked en el check constraint y nada que lo escribiera. Meta exige un opt-out, y la razon practica es mas afilada que la regla: quien quiere que paren los mensajes y no puede, bloquea el numero, y la calidad se mide por NUMERO — Sevenz tiene uno, asi que el callejon sin salida de una persona le cuesta el resumen semanal a los 24 duenos. Darse de baja es una FILA, no un borrado, por lo mismo que lo era el alta: borrar el granted destruiria la evidencia que ampara los mensajes ya enviados, que es justo la que haria falta si alguien pregunta por uno de ellos. El par se lee como historia y client_accepts_whatsapp() ya resuelve tomando la ultima fila, asi que no cambia. Apaga para TODOS los negocios, simetrico con el alta y forzado por la clave: quien pide que no le escriban se refiere a los mensajes, no a un remitente que de todas formas no puede distinguir, porque todos llegan del mismo numero de Sevenz. Idempotente: un doble toque no escribe dos filas. SECURITY DEFINER, solo service_role.'
)
on conflict (key) do nothing;

commit;

-- ===========================================================================
-- VERIFICACION, despues de correr lo de arriba
-- ===========================================================================
--
-- Correr esto en la rama DEV (vzqppwrwnmlbrxizskdh). `npm run qa:consent` la
-- cubre entera; esto es por si se quiere comprobar a mano.
--
--   select has_function_privilege('anon', 'public.revoke_client_whatsapp_consent(text)', 'execute') as anon_puede,
--          has_function_privilege('service_role', 'public.revoke_client_whatsapp_consent(text)', 'execute') as servidor_puede;
--   -- EXPECTED: false, true.
