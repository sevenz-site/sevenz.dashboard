// SOLO LA RAMA DEV (vzqppwrwnmlbrxizskdh) — lee .env.local.
//
// «Borrar ahora» de /admin/eliminaciones, de punta a punta, contra la base (PL-48 step 1.3;
// migrations 227 and 229). Builds a throwaway business with data in several tables, a product
// photo and a payment receipt in Storage, asks for the deletion, and runs the SAME four steps
// as lib/admin/account-deletions.ts (check, close the access, files, data). Then checks what
// went and what stayed, against the owner's decisions of 2026-11-28 written in migration 229.
//
// The steps are re-written here because that module is server-only; if they drift apart, this
// suite stops describing the screen, so keep them in step.
//
// Usage, from dashboard/:  node qa/eliminar-cuenta-borrado.mjs

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

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
  console.error("Este script BORRA. Nunca contra producción.");
  process.exit(1);
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const rows = [];
function check(name, ok, detail) {
  rows.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}
const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c50000000049454e44ae426082", "hex");

const email = `qa-borrado-${Date.now()}@example.com`;
const name = "QA Borrado Completo";
let ownerId = null;
let secondUserId = null;
let requestId = null;

try {
  const { data: created, error: eC } = await admin.auth.admin.createUser({
    email, email_confirm: true, user_metadata: { business_name: name, country: "VE", first_name: "QA" },
  });
  if (eC) throw new Error(`createUser: ${eC.message}`);
  ownerId = created.user.id;
  await admin.from("owners").update({ business_name: name }).eq("id", ownerId);

  // ── Business data that must go ─────────────────────────────────────────────
  const made = {};
  const ins = async (table, row) => {
    const { error } = await admin.from(table).insert(row);
    made[table] = error ? `error: ${error.message}` : "ok";
  };
  // A client with a sale and a charge: the money tables carry the ledger guards (180), and the
  // purge must go through them (they only stop `authenticated` sessions).
  const { data: client, error: eCl } = await admin.from("clients").insert({ owner_id: ownerId, name: "Cliente QA borrado" }).select("id").single();
  made.clients = eCl ? `error: ${eCl.message}` : "ok";
  if (client) {
    const { data: sale, error: eS } = await admin.from("sales").insert({ owner_id: ownerId, client_id: client.id }).select("id").single();
    made.sales = eS ? `error: ${eS.message}` : "ok";
    await ins("movements", { client_id: client.id, type: "charge", amount: 10, currency: "USD", description: "Fiado QA borrado", sale_id: sale?.id ?? null });
  }
  await ins("products", { owner_id: ownerId, name: "Producto QA borrado", base_currency: "USD", price_retail: 1 });
  await ins("owner_payment_methods", { owner_id: ownerId, body: "Pago móvil QA" });
  await ins("owner_devices", { owner_id: ownerId, device_hash: "qa-borrado-device" });
  const photo = `${ownerId}/qa-borrado.jpg`;
  const up = await admin.storage.from("product-photos").upload(photo, PNG, { contentType: "image/jpeg", upsert: true });
  made.photo = up.error ? `error: ${up.error.message}` : "ok";
  // ── Account data that must stay ────────────────────────────────────────────
  const receipt = `${ownerId}/qa-borrado-comprobante.png`;
  const upR = await admin.storage.from("comprobantes").upload(receipt, PNG, { contentType: "image/png", upsert: true });
  made.receipt = upR.error ? `error: ${upR.error.message}` : "ok";
  await admin.rpc("log_security_audit", { p_owner_id: ownerId, p_action: "qa_marker", p_actor: "qa", p_detail: {} });
  console.log("Datos de prueba:", JSON.stringify(made));

  const before = (await admin.rpc("admin_account_leftovers", { p_owner_id: ownerId })).data ?? {};
  check("0. antes del borrado hay datos del negocio (clientes, ventas, productos…)", ["clients", "sales", "products"].every((t) => before[t] >= 1), JSON.stringify(before));

  // ── The request, and the two refusals ──────────────────────────────────────
  const req = await admin.rpc("request_account_deletion", { p_owner_id: ownerId, p_source: "app", p_days: 30 });
  const { data: list } = await admin.rpc("admin_account_deletions");
  requestId = (list ?? []).find((r) => r.owner_id === ownerId && !r.cancelled_at && !r.deleted_at)?.request_id ?? null;
  check("1. el pedido sale en la lista de /admin", Boolean(requestId) && req.data?.ok === true);

  const early = await admin.rpc("admin_purge_account", { p_request_id: requestId, p_admin: "qa" });
  check("2. sin vencer, el borrado se niega", early.data?.code === "not_due", JSON.stringify(early.data));
  const earlyCheck = await admin.rpc("admin_account_deletion_check", { p_request_id: requestId });
  check("3. sin vencer, la comprobación también", earlyCheck.data?.code === "not_due", JSON.stringify(earlyCheck.data));

  // Make it due (the 30 days, without waiting them).
  const { error: eDue } = await admin.from("account_deletion_requests").update({ scheduled_for: new Date(Date.now() - 60_000).toISOString() }).eq("id", requestId);
  check("4. el pedido pasa a vencido (solo en la prueba)", !eDue, eDue?.message);

  // ── The four steps of «Borrar ahora» ───────────────────────────────────────
  const c = (await admin.rpc("admin_account_deletion_check", { p_request_id: requestId })).data;
  check("5. la comprobación da el nombre que hay que escribir", c?.ok === true && c.business_name === name, JSON.stringify(c));

  const { error: eBan } = await admin.auth.admin.updateUserById(ownerId, {
    email: `eliminada-${ownerId}@cuentas-eliminadas.sevenz.invalid`, email_confirm: true, ban_duration: "876000h",
  });
  check("6. el acceso se cierra", !eBan, eBan?.message);

  let removed = 0;
  for (const bucket of ["logos", "attachments", "client-profile-pictures", "product-photos"]) {
    const { data: files } = await admin.storage.from(bucket).list(ownerId, { limit: 1000 });
    const paths = (files ?? []).filter((f) => f.id !== null).map((f) => `${ownerId}/${f.name}`);
    if (paths.length) {
      const { error } = await admin.storage.from(bucket).remove(paths);
      if (!error) removed += paths.length;
    }
  }
  check("7. los archivos del negocio se borran", removed >= 1, `${removed} archivos`);

  const purge = await admin.rpc("admin_purge_account", { p_request_id: requestId, p_admin: "qa@sevenz" });
  check("8. los datos se borran", purge.data?.ok === true, JSON.stringify(purge.error ?? purge.data));

  // ── What went ──────────────────────────────────────────────────────────────
  const after = (await admin.rpc("admin_account_leftovers", { p_owner_id: ownerId })).data;
  check("9. no queda ni una fila del negocio fuera de las que se quedan", after && Object.keys(after).length === 0, JSON.stringify(after));
  const { data: photoLeft } = await admin.storage.from("product-photos").list(ownerId);
  check("10. la foto del producto ya no está", (photoLeft ?? []).filter((f) => f.id !== null).length === 0);
  const { data: user } = await admin.auth.admin.getUserById(ownerId);
  check("11. el acceso queda bloqueado y con otro correo", Boolean(user?.user?.banned_until) && user.user.email !== email, `${user?.user?.email} · ${user?.user?.banned_until}`);

  // ── What stayed ────────────────────────────────────────────────────────────
  const { data: ownerRow } = await admin.from("owners").select("business_name, email, account_deleted_at").eq("id", ownerId).maybeSingle();
  check("12. la ficha sigue, con su nombre y su correo, marcada «Eliminada»", ownerRow?.business_name === name && ownerRow.email === email && Boolean(ownerRow.account_deleted_at), JSON.stringify(ownerRow));
  const { data: receiptLeft } = await admin.storage.from("comprobantes").list(ownerId);
  check("13. el comprobante de pago sigue", (receiptLeft ?? []).some((f) => f.name === "qa-borrado-comprobante.png"));
  const { data: audit } = await admin.from("owner_security_audit").select("action").eq("owner_id", ownerId);
  const actions = (audit ?? []).map((a) => a.action);
  check("14. el registro de seguridad sigue, con el borrado anotado", actions.includes("qa_marker") && actions.includes("account_deleted"), actions.join(", "));
  const { data: after2 } = await admin.rpc("admin_account_deletions");
  const done = (after2 ?? []).find((r) => r.request_id === requestId);
  check("15. el pedido queda «Eliminada» con quién lo hizo", Boolean(done?.deleted_at) && done.deleted_by === "qa@sevenz", JSON.stringify(done?.deleted_by));

  // ── Afterwards ─────────────────────────────────────────────────────────────
  const again = await admin.rpc("admin_purge_account", { p_request_id: requestId, p_admin: "qa" });
  check("16. una cuenta borrada no se vuelve a borrar", again.data?.code === "already_deleted", JSON.stringify(again.data));
  const { data: reborn, error: eR } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { business_name: "QA renacido", country: "VE", first_name: "QA" } });
  secondUserId = reborn?.user?.id ?? null;
  const { data: newOwner } = secondUserId ? await admin.from("owners").select("id, account_deleted_at").eq("id", secondUserId).maybeSingle() : { data: null };
  check("17. el mismo correo puede registrarse otra vez, como negocio nuevo y vacío", !eR && Boolean(newOwner) && !newOwner.account_deleted_at, eR?.message ?? secondUserId);
} catch (e) {
  check("sin excepciones", false, e instanceof Error ? e.message : String(e));
} finally {
  // Clean up everything this suite made. Deleting the auth user now takes the kept rows too
  // (owners cascades from it), which is right for a test account and is exactly what
  // «Borrar ahora» deliberately does NOT do.
  if (ownerId) {
    await admin.storage.from("comprobantes").remove([`${ownerId}/qa-borrado-comprobante.png`]);
    await admin.storage.from("product-photos").remove([`${ownerId}/qa-borrado.jpg`]);
    await admin.from("account_deletion_requests").delete().eq("owner_id", ownerId);
    const { error } = await admin.auth.admin.deleteUser(ownerId);
    console.log(error ? `Limpieza: no se pudo borrar ${ownerId}: ${error.message}` : "Limpieza: dueño de prueba borrado.");
  }
  if (secondUserId) {
    const { error } = await admin.auth.admin.deleteUser(secondUserId);
    console.log(error ? `Limpieza: no se pudo borrar ${secondUserId}: ${error.message}` : "Limpieza: segundo usuario borrado.");
  }
}
const failed = rows.filter((ok) => !ok).length;
console.log(`\n${rows.length - failed} de ${rows.length} pasan.`);
process.exit(failed ? 1 : 0);
