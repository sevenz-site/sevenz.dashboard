// SOLO LA RAMA DEV (vzqppwrwnmlbrxizskdh) — lee .env.local.
//
// «Eliminar mi cuenta», la parte de la base (PL-48, step 1.3; migration 227). Creates a
// throwaway owner, walks the request as the server action and the owner's own session would,
// and removes everything it created at the end, in `finally`.
//
// Per the CLAUDE.md rule for `qa/`: the reads and the cancel run AS THE OWNER (magic link,
// no password), because `my_account_deletion` and `cancel_my_account_deletion` are what the
// shopkeeper's session calls, and a suite on the service key alone would pass with a grant
// missing. The request itself runs with the service key, because that is the only role the
// app uses for it (after the code), and the suite checks that the owner CANNOT call it.
//
// Usage, from dashboard/:  node qa/eliminar-cuenta.mjs

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const DEV_REF = "vzqppwrwnmlbrxizskdh";
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
if (ref !== DEV_REF) {
  console.error(`ME NIEGO A CORRER. .env.local apunta a "${ref}", no a la rama dev (${DEV_REF}).`);
  console.error("Este script ESCRIBE. Nunca contra producción.");
  process.exit(1);
}

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
// A SECOND anon client that never signs in. `anon` above gets the owner's session from
// `verifyOtp` in asOwner(), so «sin sesión» checks run on this one. Found on 2026-11-28: with
// `anon`, check 17 «cancelled» as the owner and the suite reported a hole that was not there.
const bare = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });

async function asOwner(email) {
  const { data: link, error: eL } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (eL) throw new Error(`generateLink: ${eL.message}`);
  const { data: s, error: eV } = await anon.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  if (eV) throw new Error(`verifyOtp: ${eV.message}`);
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${s.session.access_token}` } },
  });
}

const rows = [];
function check(name, ok, detail) {
  rows.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

const email = `qa-eliminar-${Date.now()}@example.com`;
let ownerId = null;

try {
  const { data: created, error: eC } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { business_name: "QA eliminar cuenta", country: "VE", first_name: "QA" },
  });
  if (eC) throw new Error(`createUser: ${eC.message}`);
  ownerId = created.user.id;
  const { data: ownerRow } = await admin.from("owners").select("id").eq("id", ownerId).maybeSingle();
  check("0. el dueño de prueba existe (handle_new_user)", Boolean(ownerRow), ownerId);
  if (!ownerRow) throw new Error("Sin fila en owners no hay nada que probar.");

  const owner = await asOwner(email);

  // 1. The code purpose: migration 227 widened the check constraint.
  const { data: code } = await admin.rpc("create_login_code", {
    p_owner_id: ownerId, p_purpose: "delete_account", p_channel: "email", p_target: email,
    p_code_hash: "a".repeat(64), p_ticket_hash: null, p_ttl_minutes: 10,
  });
  check("1. un código con propósito delete_account se acepta", code?.ok === true, JSON.stringify(code));

  // 2. Nothing pending at first, seen by the owner.
  const before = await owner.rpc("my_account_deletion");
  check("2. sin pedido, el dueño lee null", !before.error && before.data === null, JSON.stringify(before.error ?? before.data));

  // 3. The owner cannot record a request by himself: that would skip the code.
  const self = await owner.rpc("request_account_deletion", { p_owner_id: ownerId, p_source: "app", p_days: 30 });
  check("3. el dueño NO puede pedirlo saltándose el código", Boolean(self.error), self.error?.code ?? JSON.stringify(self.data));
  const stranger = await bare.rpc("request_account_deletion", { p_owner_id: ownerId, p_source: "app", p_days: 30 });
  check("4. sin sesión tampoco", Boolean(stranger.error), stranger.error?.code ?? JSON.stringify(stranger.data));

  // 5. The server records it, 30 days ahead.
  const first = await admin.rpc("request_account_deletion", { p_owner_id: ownerId, p_source: "app", p_days: 30 });
  const days = first.data?.scheduled_for ? (new Date(first.data.scheduled_for) - Date.now()) / 86_400_000 : NaN;
  check("5. el servidor lo registra a 30 días", first.data?.ok === true && first.data.already === false && days > 29.9 && days < 30.1, `${days.toFixed(3)} días`);

  // 6. Asking again does not move the date.
  const second = await admin.rpc("request_account_deletion", { p_owner_id: ownerId, p_source: "app", p_days: 30 });
  check("6. pedirlo otra vez no mueve la fecha", second.data?.already === true && second.data.scheduled_for === first.data.scheduled_for, JSON.stringify(second.data));

  // 7. The owner reads the same date; the senders see him.
  const mine = await owner.rpc("my_account_deletion");
  check("7. el dueño lee su fecha", !mine.error && mine.data && new Date(mine.data).getTime() === new Date(first.data.scheduled_for).getTime(), JSON.stringify(mine.data));
  const pending = await admin.rpc("owners_pending_deletion");
  const pendingIds = (pending.data ?? []).map((v) => (v && typeof v === "object" ? Object.values(v)[0] : v));
  check("8. los envíos lo ven como pendiente", pendingIds.includes(ownerId), `${pendingIds.length} pendientes; forma: ${typeof (pending.data ?? [])[0]}`);
  const notOwner = await owner.rpc("owners_pending_deletion");
  check("9. el dueño no puede leer la lista de los que se van", Boolean(notOwner.error), notOwner.error?.code ?? "sin error");

  // 10. The table itself is closed to the owner.
  const direct = await owner.from("account_deletion_requests").select("id");
  check("10. el dueño no lee la tabla directo", Boolean(direct.error) || (direct.data ?? []).length === 0, direct.error?.code ?? `${(direct.data ?? []).length} filas`);

  // 11. Cancel, as the owner, with no code.
  const cancel = await owner.rpc("cancel_my_account_deletion");
  check("11. el dueño cancela", cancel.data === true, JSON.stringify(cancel.error ?? cancel.data));
  const after = await owner.rpc("my_account_deletion");
  check("12. ya no hay pedido abierto", after.data === null, JSON.stringify(after.data));
  const again = await owner.rpc("cancel_my_account_deletion");
  check("13. cancelar sin pedido dice false", again.data === false, JSON.stringify(again.data));
  const pending2 = await admin.rpc("owners_pending_deletion");
  const ids2 = (pending2.data ?? []).map((v) => (v && typeof v === "object" ? Object.values(v)[0] : v));
  check("14. los envíos ya no lo saltan", !ids2.includes(ownerId));

  // 15. A new request after cancelling starts a new 30 days.
  const third = await admin.rpc("request_account_deletion", { p_owner_id: ownerId, p_source: "web", p_days: 30 });
  check("15. tras cancelar se puede pedir de nuevo", third.data?.ok === true && third.data.already === false, JSON.stringify(third.data));

  // 16. Nothing was deleted: the owner row is still there.
  const { data: still } = await admin.from("owners").select("id").eq("id", ownerId).maybeSingle();
  check("16. no se borró nada", Boolean(still));

  // 17. Without a session nobody cancels anything.
  const anonCancel = await bare.rpc("cancel_my_account_deletion");
  check("17. sin sesión no se cancela nada", Boolean(anonCancel.error), anonCancel.error?.code ?? JSON.stringify(anonCancel.data));

  // 18-19. The web door's code (app/eliminar-cuenta): it carries a ticket, so a code asked
  // from one browser cannot be typed from another. The cookie that holds the ticket is
  // signed like the sign-in one; this checks the half that lives in the database.
  const sha = (s) => createHash("sha256").update(s).digest("hex");
  const webCode = "482913";
  const webCodeRow = await admin.rpc("create_login_code", {
    p_owner_id: ownerId, p_purpose: "delete_account", p_channel: "email", p_target: email,
    p_code_hash: sha(`${webCode}:${ownerId}`), p_ticket_hash: sha("ticket:ticket-del-navegador"), p_ttl_minutes: 10,
  });
  await admin.rpc("mark_login_code_delivered", { p_id: webCodeRow.data?.id });
  const wrongTicket = await admin.rpc("verify_login_code", {
    p_owner_id: ownerId, p_purpose: "delete_account", p_code_hash: sha(`${webCode}:${ownerId}`), p_ticket_hash: sha("ticket:otro-navegador"),
  });
  check("18. el código de la web con el ticket de otro navegador no sirve", wrongTicket.data?.ok !== true, JSON.stringify(wrongTicket.data));
  const rightTicket = await admin.rpc("verify_login_code", {
    p_owner_id: ownerId, p_purpose: "delete_account", p_code_hash: sha(`${webCode}:${ownerId}`), p_ticket_hash: sha("ticket:ticket-del-navegador"),
  });
  check("19. con su propio ticket sí", rightTicket.data?.ok === true, JSON.stringify(rightTicket.data));
} catch (e) {
  check("sin excepciones", false, e instanceof Error ? e.message : String(e));
} finally {
  if (ownerId) {
    // The requests have no foreign key on purpose (they outlive the owner), so they go by hand.
    await admin.from("account_deletion_requests").delete().eq("owner_id", ownerId);
    const { error } = await admin.auth.admin.deleteUser(ownerId);
    console.log(error ? `Limpieza: no se pudo borrar el usuario de prueba ${ownerId}: ${error.message}` : "Limpieza: usuario de prueba borrado.");
  }
}

const failed = rows.filter((ok) => !ok).length;
console.log(`\n${rows.length - failed} de ${rows.length} pasan.`);
process.exit(failed ? 1 : 0);
