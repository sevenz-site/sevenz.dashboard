// THE LEDGER FROM THE BROWSER CONSOLE: what an owner's own session can and
// cannot do writing straight to the tables (migration 180).
//
// Finding 6 of the 2026-11-02 audit, widened by the owner the same day. The
// screens never edit a money row; the console could edit, backdate, move and
// hard-delete anything of the owner's own, and the screen kept showing the
// stored balance as if nothing had happened. Nine such writes went through in
// dev before 180. This suite repeats them -- as the OWNER, with a real session
// through the data API, which is exactly what the console does -- and expects
// every one refused, with the verdict read in the database.
//
// HALF OF THIS SUITE ARE CONTROLS, and they are the half that cannot be cut:
// fiar, cobrar, mandar a la papelera, restaurar, recalcular, Colombia, and
// two payments at once. "Fix" the ledger by refusing everything and the
// attack rows pass; the controls are what keep that fix out.
//
// Writes only to dev (two throwaway owners) and cleans up after itself. Does
// not need the server: the console talks to Supabase, not to Next.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
if (ref !== "vzqppwrwnmlbrxizskdh") { console.error(`Este script ESCRIBE. Solo contra dev; apunta a ${ref}.`); process.exit(1); }

const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const filas = [];
const check = (nombre, pasa, detalle) => { filas.push(pasa); console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${detalle ? `  — ${String(detalle).slice(0, 140)}` : ""}`); };
const stamp = Date.now();
const usuarios = [];

// An owner with a live session: its client talks to the tables as
// `authenticated`, which is what the rules of 180 apply to.
async function dueno(tag, country) {
  const email = `zz-console-${tag}-${stamp}@sevenz-qa.test`;
  const { data, error } = await svc.auth.admin.createUser({ email, email_confirm: true, user_metadata: { business_name: `ZZ Console ${tag}`, country, first_name: tag } });
  if (error) throw new Error(`createUser: ${error.message}`);
  usuarios.push(data.user.id);
  await svc.from("owners").update({ onboarding_completed_at: new Date().toISOString() }).eq("id", data.user.id);
  const { data: lk } = await svc.auth.admin.generateLink({ type: "magiclink", email });
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: e2 } = await db.auth.verifyOtp({ type: "magiclink", token_hash: lk.properties.hashed_token });
  if (e2) throw new Error(`otp: ${e2.message}`);
  return { id: data.user.id, db };
}
const saldo = async (cid, col = "balance_usd") => Number((await svc.from("client_summary_all").select(col).eq("client_id", cid).maybeSingle()).data?.[col] ?? 0);
const suma = async (cid, cur) => { let q = svc.from("movements").select("type,amount").eq("client_id", cid).is("deleted_at", null); q = cur == null ? q.is("currency", null) : q.eq("currency", cur); const { data } = await q; return (data ?? []).reduce((s, m) => s + (m.type === "charge" ? +m.amount : -m.amount), 0); };
const codigo = (r) => r.error?.code ?? (r.error ? r.error.message : "ENTRÓ");

try {
  // ── 0. The switch must be ON in dev, or every "refused" below is a lie ──
  // 180 ships observing (enforce = false) and 181, dev only, turns it on. A
  // dev where it is off would log the attacks and let them through, and a
  // suite that did not check would still... no: it would fail on row 1. This
  // control exists so the failure is named, not puzzled over.
  const { data: interruptor } = await svc.from("ledger_rules").select("enforce").eq("id", true).maybeSingle();
  check("0. las reglas de la 180 están EN VIGOR en dev (ledger_rules.enforce)", interruptor?.enforce === true, interruptor ? `enforce = ${interruptor.enforce}` : "sin fila: ¿corrió la 180?");
  if (interruptor?.enforce !== true) throw new Error("con las reglas en modo observar no hay nada que probar");

  const A = await dueno("ve", "VE");
  const CO = await dueno("co", "CO");

  // Fixtures through the service role (exempt from 180, like every qa/ script):
  // Pedro owes $50 from an hour ago; María owes nothing; the Colombian client
  // owes 8000 in the null-currency ledger; a sale of an hour ago with one line.
  const haceUnaHora = new Date(Date.now() - 3600_000).toISOString();
  const { data: pedro } = await svc.from("clients").insert({ owner_id: A.id, name: "Pedro ZZ" }).select("id").single();
  const { data: maria } = await svc.from("clients").insert({ owner_id: A.id, name: "María ZZ" }).select("id").single();
  const { data: fiado } = await svc.from("movements").insert({ client_id: pedro.id, created_by: A.id, type: "charge", amount: 50, currency: "USD", source: "manual", created_at: haceUnaHora }).select("id").single();
  const { data: venta } = await svc.from("sales").insert({ owner_id: A.id, client_id: pedro.id, created_at: haceUnaHora }).select("id").single();
  const { data: linea } = await svc.from("sale_lines").insert({ sale_id: venta.id, name: "Línea ZZ", quantity: 1, unit_price: 10, currency: "USD" }).select("id").single();
  const { data: cliCo } = await svc.from("clients").insert({ owner_id: CO.id, name: "Cliente CO ZZ" }).select("id").single();
  await svc.from("movements").insert({ client_id: cliCo.id, created_by: CO.id, type: "charge", amount: 8000, currency: null, source: "manual" });

  // ══════════════════════════════════════════════════════════════════════
  // ATTACKS -- every one refused, and the database unchanged
  // ══════════════════════════════════════════════════════════════════════
  let r = await A.db.from("movements").insert({ client_id: pedro.id, type: "payment", amount: 5000, currency: "USD", source: "manual" }).select("id");
  check("1. abono de $5.000 sobre una deuda de $50: rechazado (SZ001)", r.error?.code === "SZ001" && (await saldo(pedro.id)) === 50, `${codigo(r)} · saldo ${await saldo(pedro.id)}`);

  r = await A.db.from("movements").update({ amount: 1 }).eq("id", fiado.id).select("id");
  check("2. cambiar el monto de un fiado ya escrito: rechazado (SZ002)", r.error?.code === "SZ002" && (await suma(pedro.id, "USD")) === 50, codigo(r));

  r = await A.db.from("movements").update({ type: "payment" }).eq("id", fiado.id).select("id");
  check("3. convertir el fiado en abono: rechazado (SZ002)", r.error?.code === "SZ002", codigo(r));

  r = await A.db.from("movements").update({ client_id: maria.id }).eq("id", fiado.id).select("id");
  check("4. pasar la deuda de Pedro a María: rechazado (SZ002)", r.error?.code === "SZ002" && (await suma(maria.id, "USD")) === 0, codigo(r));

  r = await A.db.from("movements").update({ entry_currency: "VES", entry_amount: 1 }).eq("id", fiado.id).select("id");
  check("5. cambiar los bolívares tecleados que ve el cliente: rechazado (SZ002)", r.error?.code === "SZ002", codigo(r));

  r = await A.db.from("movements").insert({ client_id: pedro.id, type: "charge", amount: 30, currency: "USD", source: "manual", created_at: "2025-11-01T12:00:00Z" }).select("id, created_at").single();
  check("6. fiado con fecha de hace un año: rechazado (SZ005), la fecha la pone Sevenz", r.error?.code === "SZ005" && (await suma(pedro.id, "USD")) === 50, codigo(r));
  if (r.data) await svc.from("movements").delete().eq("id", r.data.id);

  r = await A.db.from("movements").delete().eq("id", fiado.id).select("id");
  const sigue = (await svc.from("movements").select("id").eq("id", fiado.id)).data?.length === 1;
  check("7. borrar PARA SIEMPRE un fiado de hace una hora: rechazado (SZ003), sigue ahí", r.error?.code === "SZ003" && sigue, codigo(r));

  r = await A.db.from("sale_payments").insert({ sale_id: venta.id, currency: "USD", amount: 999 }).select("id");
  check("8. apuntar un pago de $999 a una venta de hace una hora: rechazado (SZ004)", r.error?.code === "SZ004", codigo(r));

  r = await A.db.from("sales").delete().eq("id", venta.id).select("id");
  const ventaSigue = (await svc.from("sales").select("id").eq("id", venta.id)).data?.length === 1;
  check("9. borrar PARA SIEMPRE una venta de hace una hora: rechazado (SZ003), sigue ahí", r.error?.code === "SZ003" && ventaSigue, codigo(r));

  r = await A.db.from("sale_lines").update({ unit_price: 1 }).eq("id", linea.id).select("id");
  check("10. cambiar el precio de una línea de venta: rechazado (SZ002)", r.error?.code === "SZ002", codigo(r));

  r = await A.db.from("sales").update({ client_id: maria.id }).eq("id", venta.id).select("id");
  check("11. pasar la venta a otro cliente: rechazado (SZ002)", r.error?.code === "SZ002", codigo(r));

  // Pedro was created seconds ago (inside the 10-minute window) and his fiado
  // is an hour old: the cascade would take it, so the client rule has to
  // refuse on "has movements", not on age.
  r = await A.db.from("clients").delete().eq("id", pedro.id).select("id");
  const pedroSigue = (await svc.from("movements").select("id").eq("id", fiado.id)).data?.length === 1;
  check("12. borrar PARA SIEMPRE un cliente recién creado CON deudas (se llevaría sus movimientos): rechazado (SZ003)", r.error?.code === "SZ003" && pedroSigue, codigo(r));
  if (!pedroSigue) throw new Error("la cascada se llevó el fiado de Pedro: el resto de controles no tiene sentido");

  // ══════════════════════════════════════════════════════════════════════
  // CONTROLS -- the shopkeeper keeps working
  // ══════════════════════════════════════════════════════════════════════
  r = await A.db.from("movements").insert({ client_id: pedro.id, type: "payment", amount: 20, currency: "USD", source: "manual" }).select("id").single();
  check("13. control: cobrar $20 de los $50 entra, y el saldo baja a 30", !r.error && (await saldo(pedro.id)) === 30, `${codigo(r)} · saldo ${await saldo(pedro.id)}`);

  r = await A.db.from("movements").insert({ client_id: pedro.id, type: "payment", amount: 30, currency: "USD", source: "manual" }).select("id").single();
  const abonoTotal = r.data?.id;
  check("14. control: cobrar EXACTAMENTE lo que queda (30) entra, y el saldo queda en 0", !r.error && (await saldo(pedro.id)) === 0, `${codigo(r)} · saldo ${await saldo(pedro.id)}`);

  r = await A.db.from("movements").insert({ client_id: pedro.id, type: "payment", amount: 0.01, currency: "USD", source: "manual" }).select("id");
  check("15. y un céntimo más con deuda cero: rechazado (ya no debe nada)", r.error?.code === "SZ001", codigo(r));

  r = await A.db.from("movements").insert({ client_id: maria.id, type: "charge", amount: 12.5, currency: "EUR", source: "manual" }).select("id, created_at").single();
  check("16. control: fiar €12,50 entra, con fecha de hoy", !r.error && Date.now() - new Date(r.data.created_at).getTime() < 60_000, codigo(r));
  const fiadoMaria = r.data?.id;
  if (!fiadoMaria) throw new Error("sin el fiado de María no hay papelera que probar");

  r = await A.db.from("movements").update({ deleted_at: new Date().toISOString() }).eq("id", fiadoMaria).select("id");
  const r2 = await A.db.from("movements").update({ deleted_at: null }).eq("id", fiadoMaria).select("id");
  check("17. control: mandar a la papelera y restaurar siguen entrando", !r.error && !r2.error && (await saldo(maria.id, "balance_eur")) === 12.5, `${codigo(r)} · ${codigo(r2)} · saldo ${await saldo(maria.id, "balance_eur")}`);

  r = await A.db.from("movements").delete().eq("id", abonoTotal).select("id");
  check("18. control: borrar del todo algo escrito hace segundos entra (la ventana que usa la venta al deshacerse)", !r.error && r.data?.length === 1, codigo(r));
  await svc.rpc("recalc_client_running_balance", { p_client_id: pedro.id });

  r = await A.db.rpc("recalc_client_running_balance", { p_client_id: pedro.id });
  check("19. control: el recálculo del saldo, llamado por el dueño, sigue pudiendo escribir running_balance", !r.error && (await saldo(pedro.id)) === 30, `${codigo(r)} · saldo ${await saldo(pedro.id)}`);

  r = await CO.db.from("movements").insert({ client_id: cliCo.id, type: "payment", amount: 3000, currency: null, source: "manual" }).select("id").single();
  check("20. control: Colombia (libro sin moneda) cobra 3.000 de 8.000 y queda en 5.000", !r.error && (await saldo(cliCo.id, "balance")) === 5000, `${codigo(r)} · saldo ${await saldo(cliCo.id, "balance")}`);

  // Two payments at once, each fitting the $30 left, together overshooting:
  // exactly one may enter. Without the lock both would, and the client would
  // read "A favor $10" the next morning.
  const [p1, p2] = await Promise.all([
    A.db.from("movements").insert({ client_id: pedro.id, type: "payment", amount: 25, currency: "USD", source: "manual" }).select("id"),
    A.db.from("movements").insert({ client_id: pedro.id, type: "payment", amount: 25, currency: "USD", source: "manual" }).select("id"),
  ]);
  const entraron = [p1, p2].filter((x) => !x.error).length;
  const rechazados = [p1, p2].filter((x) => x.error?.code === "SZ001").length;
  check("21. dos abonos de $25 A LA VEZ sobre $30: entra uno solo, el otro SZ001, saldo 5", entraron === 1 && rechazados === 1 && (await saldo(pedro.id)) === 5, `entraron ${entraron} · rechazados ${rechazados} · saldo ${await saldo(pedro.id)}`);

  // Rule 5 must not touch the papelera's own undo: the app hard-deletes a
  // client it created seconds earlier when the first movement fails.
  r = await A.db.from("clients").insert({ owner_id: A.id, name: "Recién creado ZZ" }).select("id").single();
  const r3 = await A.db.from("clients").delete().eq("id", r.data?.id).select("id");
  check("22. control: un cliente recién creado sin movimientos se puede borrar del todo (clients/nuevo lo necesita)", !r.error && !r3.error && r3.data?.length === 1, codigo(r3));
} catch (e) {
  console.error("ERROR", e instanceof Error ? e.message : e);
  filas.push(false);
} finally {
  for (const id of usuarios) {
    const { data: cs } = await svc.from("clients").select("id").eq("owner_id", id);
    for (const c of cs ?? []) { await svc.from("movements").delete().eq("client_id", c.id); await svc.from("sales").delete().eq("client_id", c.id); }
    await svc.from("clients").delete().eq("owner_id", id);
    await svc.auth.admin.deleteUser(id);
  }
  const { count } = await svc.from("owners").select("id", { count: "exact", head: true }).ilike("business_name", "ZZ Console%");
  check("23. limpieza: no queda nada de la prueba en dev", count === 0, `quedan ${count}`);
  const ok = filas.filter(Boolean).length;
  console.log(`\n${ok}/${filas.length} pasan.`);
  process.exit(ok === filas.length ? 0 : 1);
}
