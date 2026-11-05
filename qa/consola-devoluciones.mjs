// Migration 188: returns against the console, and the cases that were stuck.
//
// DEV ONLY, writes and cleans up after itself. Every attack runs with an owner's
// own session, the way the browser console can.
//
// TWICE, ONCE PER MODE OF MIGRATION 180. Production has those rules observing
// (`PL-21`), so a suite that only ran with them on would pass with production
// open, which is exactly how this was missed. The switch is put back no matter
// what, and the script refuses to run against anything but the dev branch.
//
//   npm run qa:consola-devoluciones
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
  process.exit(1);
}

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = () => createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

async function comoDueno(email) {
  const login = anon();
  const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw new Error(`generateLink: ${error.message}`);
  const { data: s, error: e2 } = await login.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  if (e2) throw new Error(`verifyOtp: ${e2.message}`);
  return {
    id: s.user.id,
    db: createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${s.session.access_token}` } },
    }),
  };
}

const filas = [];
function check(nombre, pasa, detalle) {
  filas.push({ nombre, pasa });
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${detalle !== undefined ? `  — ${detalle}` : ""}`);
}
const igual = (a, b) => Math.abs(Number(a) - Number(b)) < 0.006;
const rechazado = (r) => !!r.error;
const motivo = (r) => (r.error ? `${r.error.code} ${r.error.message.slice(0, 50)}` : "PASÓ");

const MARCA = `ZZ cons ${Date.now() % 100000}`;
const clientes = [];
const productos = [];
let A;

async function cliente() {
  const { data, error } = await admin.from("clients").insert({ owner_id: A.id, name: `${MARCA} ${clientes.length}` }).select("id").single();
  if (error) throw new Error(`cliente: ${error.message}`);
  clientes.push(data.id);
  return data.id;
}
async function producto(stock) {
  const { data } = await admin.from("products").insert({ owner_id: A.id, name: `${MARCA} p${productos.length}`, base_currency: "USD", base_currency_retail: "USD", price_retail: 10, published_retail: false, stock_opening: stock }).select("id").single();
  productos.push(data.id);
  return data.id;
}
async function contado(c, { qty = 3, price = 10, cobrado = null, product = null } = {}) {
  const { data: v } = await admin.from("sales").insert({ owner_id: A.id, client_id: c, created_by: A.id }).select("id").single();
  const { data: ln } = await admin.from("sale_lines").insert({ sale_id: v.id, product_id: product, name: `${MARCA} l`, quantity: qty, unit_price: price, currency: "USD", tier: "retail" }).select("id").single();
  const pago = cobrado ?? Math.round(qty * price * 100) / 100;
  await admin.from("sale_payments").insert({ sale_id: v.id, currency: "USD", amount: pago, entry_currency: "USD", entry_amount: pago });
  return { saleId: v.id, lineId: ln.id };
}
async function fiado(c, { qty = 3, price = 10, cargo = null } = {}) {
  const { data: v } = await admin.from("sales").insert({ owner_id: A.id, client_id: c, created_by: A.id }).select("id").single();
  const { data: ln } = await admin.from("sale_lines").insert({ sale_id: v.id, name: `${MARCA} l`, quantity: qty, unit_price: price, currency: "USD", tier: "retail" }).select("id").single();
  const { data: m } = await A.db.from("movements").insert({ client_id: c, created_by: A.id, type: "charge", amount: cargo ?? qty * price, currency: "USD", sale_id: v.id, source: "manual" }).select("id").single();
  return { saleId: v.id, lineId: ln.id, chargeId: m.id };
}
const devC = (v, q, r = {}) => A.db.rpc("registrar_devolucion_contado", { p_sale_id: v.saleId, p_line_id: v.lineId, p_quantity: q, p_fiados: r.fiados ?? [], p_a_favor: r.aFavor ?? 0, p_efectivo: r.efectivo ?? 0 });
const devF = (f, q, r = {}) => A.db.rpc("registrar_devolucion", { p_movement_id: f.chargeId, p_line_id: f.lineId, p_quantity: q, p_fiados: r.fiados ?? [], p_a_favor: r.aFavor ?? 0, p_efectivo: r.efectivo ?? 0 });
const libro = async (c) => Number((await admin.from("client_summary_all").select("balance_usd").eq("client_id", c).maybeSingle()).data?.balance_usd ?? 0);
const credito = async (c) => Number(((await A.db.rpc("get_client_credit", { p_client_id: c })).data ?? []).find((x) => x.currency === "USD")?.credit ?? 0);
const estante = async (p) => Number((await admin.from("products").select("stock_opening").eq("id", p).single()).data.stock_opening);

async function ataques(modo) {
  const t = (n) => `[${modo}] ${n}`;

  // A2: the row itself.
  {
    const c = await cliente();
    const v = await contado(c, { qty: 1 });
    const { data: r } = await devC(v, 1, { aFavor: 10 });
    check(t("inflar el monto de la línea"), rechazado(await A.db.from("movements").update({ amount: 5000 }).eq("id", r.movement_id).select("id")));
    check(t("el saldo sigue en $10"), igual(await credito(c), 10), await credito(c));
    check(t("convertirla en abono"), rechazado(await A.db.from("movements").update({ type: "payment" }).eq("id", r.movement_id).select("id")));
    check(t("moverla a otro fiado"), rechazado(await A.db.from("movements").update({ applies_to_movement_id: r.movement_id }).eq("id", r.movement_id).select("id")));
    check(t("cambiarle la fecha"), rechazado(await A.db.from("movements").update({ created_at: "2020-01-01" }).eq("id", r.movement_id).select("id")));
    check(t("borrado blando directo"), rechazado(await A.db.from("movements").update({ deleted_at: new Date().toISOString() }).eq("id", r.movement_id).select("id")));

    const f = await fiado(c);
    await admin.rpc("recalc_client_running_balance", { p_client_id: c });
    const { data: ab } = await A.db.from("movements").insert({ client_id: c, created_by: A.id, type: "payment", amount: 1, currency: "USD", source: "manual", applies_to_movement_id: f.chargeId }).select("id").single();
    check(t("convertir un abono en devolución"), rechazado(await A.db.from("movements").update({ type: "return" }).eq("id", ab.id).select("id")));
    check(t("marcar a mano un cargo como pagado con saldo"), rechazado(await A.db.from("movements").update({ paid_with_credit: true }).eq("id", f.chargeId).select("id")));
  }

  // A3: hard deletes, inside migration 180's ten minutes.
  {
    const c = await cliente();
    const p = await producto(5);
    const v = await contado(c, { qty: 1, product: p });
    const { data: r } = await devC(v, 1, { aFavor: 10 });
    check(t("borrar del todo la línea de la devolución"), rechazado(await A.db.from("movements").delete().eq("id", r.movement_id).select("id")));
    check(t("borrar del todo la venta"), rechazado(await A.db.from("sales").delete().eq("id", v.saleId).select("id")));
    check(t("borrar del todo la línea de venta"), rechazado(await A.db.from("sale_lines").delete().eq("id", v.lineId).select("id")));
    check(t("borrar del todo el pago"), rechazado(await A.db.from("sale_payments").delete().eq("sale_id", v.saleId).select("id")));
    check(t("añadir un pago a la venta devuelta"), rechazado(await A.db.from("sale_payments").insert({ sale_id: v.saleId, currency: "USD", amount: 500, entry_currency: "USD", entry_amount: 500 }).select("id")));
    check(t("añadir una línea a la venta devuelta"), rechazado(await A.db.from("sale_lines").insert({ sale_id: v.saleId, name: "x", quantity: 1, unit_price: 500, currency: "USD", tier: "retail" }).select("id")));
    const ev = (await admin.from("sale_returns").select("id").eq("id", r.return_id)).data;
    check(t("el evento sigue vivo"), ev?.length === 1, ev?.length);

    const c2 = await cliente();
    const f = await fiado(c2);
    await devF(f, 1);
    check(t("borrar del todo el fiado con devolución"), rechazado(await A.db.from("movements").delete().eq("id", f.chargeId).select("id")));
    check(t("su saldo no se volvió gastable"), igual(await credito(c2), 0), await credito(c2));
  }

  // A5: paid with saldo, by hand.
  {
    const c = await cliente();
    const forjado = await A.db.from("movements").insert({ client_id: c, created_by: A.id, type: "charge", amount: 5000, currency: "USD", source: "manual", paid_with_credit: true }).select("id");
    check(t("cargo falso pagado con saldo"), rechazado(forjado), motivo(forjado));
    const v = await contado(c, { qty: 1 });
    await devC(v, 1, { aFavor: 10 });
    const justo = await A.db.from("movements").insert({ client_id: c, created_by: A.id, type: "charge", amount: 10, currency: "USD", source: "manual", paid_with_credit: true }).select("id");
    check(t("el cargo que SÍ cubre el saldo pasa"), !justo.error, motivo(justo));
    const otra = await A.db.from("movements").insert({ client_id: c, created_by: A.id, type: "charge", amount: 1, currency: "USD", source: "manual", paid_with_credit: true }).select("id");
    check(t("y gastado ya no alcanza"), rechazado(otra), motivo(otra));

    const c2 = await cliente();
    const v2 = await contado(c2, { qty: 1 });
    await devC(v2, 1, { aFavor: 10 });
    const par = await Promise.all(Array.from({ length: 4 }, () => A.db.from("movements").insert({ client_id: c2, created_by: A.id, type: "charge", amount: 10, currency: "USD", source: "manual", paid_with_credit: true }).select("id")));
    const pasaron = par.filter((r) => !r.error).length;
    check(t("cuatro ventas a la vez no gastan dos veces"), pasaron === 1, `pasaron ${pasaron}`);
  }
}

try {
  if (!env.QA_OWNER_EMAIL) throw new Error("falta QA_OWNER_EMAIL en .env.local");
  A = await comoDueno(env.QA_OWNER_EMAIL);

  const { data: regla } = await admin.from("ledger_rules").select("*").limit(1).single();
  try {
    await admin.from("ledger_rules").update({ enforce: true }).eq("id", regla.id);
    await ataques("reglas encendidas");
    await admin.from("ledger_rules").update({ enforce: false }).eq("id", regla.id);
    await ataques("reglas observando");
  } finally {
    await admin.from("ledger_rules").update({ enforce: regla.enforce }).eq("id", regla.id);
  }
  const { data: vuelta } = await admin.from("ledger_rules").select("enforce").limit(1).single();
  check("el interruptor queda como estaba", vuelta.enforce === regla.enforce, vuelta.enforce);

  // ── B1: THE LAST UNIT ────────────────────────────────────────────────────
  {
    const c = await cliente();
    const f = await fiado(c, { qty: 3, price: 4.5, cargo: 13 });
    await admin.rpc("recalc_client_running_balance", { p_client_id: c });
    const a = (await devF(f, 1)).data;
    const b = (await devF(f, 1)).data;
    const u = (await devF(f, 1)).data;
    check("fiado 3 × $4,50 cobrado $13: la tercera vale $4,00", a?.ok && b?.ok && u?.ok === true && igual(u?.amount, 4), JSON.stringify(u));
    check("y el fiado queda en cero", igual(await libro(c), 0), await libro(c));

    const c2 = await cliente();
    const v2 = await contado(c2, { qty: 2, price: 10, cobrado: 15 });
    const x = (await devC(v2, 1, { efectivo: 10 })).data;
    const y = (await devC(v2, 1, { efectivo: 5 })).data;
    check("contado 2 × $10 cobrado $15: la segunda vale $5", x?.ok && y?.ok === true && igual(y?.amount, 5), JSON.stringify(y));
    const z = await contado(c2, { qty: 2, price: 10, cobrado: 10 });
    await devC(z, 1, { efectivo: 10 });
    const fin = (await devC(z, 1, { efectivo: 0 })).data;
    check("sin nada que devolver se dice, no se inventa", fin?.code === "excede_la_venta", fin?.code);

    const c3 = await cliente();
    const v3 = await contado(c3, { qty: 3, price: 3.335, cobrado: 10.01 });
    const r = [(await devC(v3, 1, { efectivo: 3.34 })).data, (await devC(v3, 1, { efectivo: 3.33 })).data, (await devC(v3, 1, { efectivo: 3.34 })).data];
    check("3 × $3,335: suman los $10,01 de la línea", r.every((o) => o?.ok) && igual(r.reduce((s, o) => s + Number(o.amount), 0), 10.01), r.map((o) => o?.amount ?? o?.code).join(" + "));

    const c4 = await cliente();
    const v4 = await contado(c4, { qty: 1, price: 1 });
    const m = [(await devC(v4, 0.005, { efectivo: 0.01 })).data, (await devC(v4, 0.005, { efectivo: 0.01 })).data];
    check("el redondeo ya no regala: 0,005 + 0,005 de $1 no valen $0,02", m[1]?.code === "sin_valor" || igual(m[1]?.amount, 0), m.map((o) => o?.amount ?? o?.code).join(" + "));
  }

  // ── B2: A FIADO THAT RECEIVED MONEY ──────────────────────────────────────
  {
    const c = await cliente();
    const v = await contado(c, { qty: 1 });
    const f = await fiado(c, { qty: 1, price: 25 });
    await admin.rpc("recalc_client_running_balance", { p_client_id: c });
    const { data: r } = await devC(v, 1, { fiados: [{ fiado_id: f.chargeId, amount: 10 }] });
    const borrar = await A.db.from("movements").update({ deleted_at: new Date().toISOString() }).eq("id", f.chargeId).select("id");
    check("el fiado que recibió dinero no se borra", rechazado(borrar), motivo(borrar));
    await A.db.rpc("eliminar_devolucion", { p_movement_id: r.movement_id });
    const ahora = await A.db.from("movements").update({ deleted_at: new Date().toISOString() }).eq("id", f.chargeId).select("id");
    check("eliminada la devolución, sí se borra", !ahora.error, motivo(ahora));
  }

  // ── B3: A SALDO ALREADY SPENT (migration 189) ────────────────────────────
  {
    const borrar = (id) => A.db.rpc("eliminar_devolucion", { p_movement_id: id });
    const gastar = async (c, amount) =>
      (await A.db.from("movements").insert({ client_id: c, created_by: A.id, type: "charge", amount, currency: "USD", source: "manual", paid_with_credit: true }).select("id").single()).data.id;

    const c = await cliente();
    const v = await contado(c, { qty: 1 });
    const { data: r } = await devC(v, 1, { aFavor: 10 });
    const cargo = await gastar(c, 10);
    const { data: b1 } = await borrar(r.movement_id);
    check("el saldo gastado bloquea, y nombra quién lo gastó", b1?.code === "saldo_usado" && b1?.charge_id === cargo, JSON.stringify(b1));
    check("y el cliente no queda debiendo nada", igual(await libro(c), 0), await libro(c));
    const { data: dice } = await A.db.rpc("return_credit_spent_on", { p_return_id: r.return_id });
    check("la pantalla lee lo mismo", dice === cargo, dice);
    await A.db.from("movements").update({ deleted_at: new Date().toISOString() }).eq("id", cargo);
    const { data: b2 } = await borrar(r.movement_id);
    check("borrada esa venta, ya se elimina", b2?.ok === true, JSON.stringify(b2));

    const c2 = await cliente();
    const v2 = await contado(c2, { qty: 1 });
    const { data: r2 } = await devC(v2, 1, { aFavor: 10 });
    const { data: b3 } = await borrar(r2.movement_id);
    check("sin gastar, se elimina como siempre", b3?.ok === true, JSON.stringify(b3));

    const c3 = await cliente();
    const u = await contado(c3, { qty: 1 });
    const d = await contado(c3, { qty: 1 });
    const { data: r3 } = await devC(u, 1, { aFavor: 10 });
    await devC(d, 1, { aFavor: 10 });
    await gastar(c3, 10);
    const { data: b4 } = await borrar(r3.movement_id);
    check("con dos saldos y uno gastado, el otro lo sigue cubriendo", b4?.ok === true, JSON.stringify(b4));

    const c4 = await cliente();
    const v4 = await contado(c4, { qty: 1 });
    const { data: r4 } = await devC(v4, 1, { aFavor: 10 });
    await gastar(c4, 4);
    const { data: b5 } = await borrar(r4.movement_id);
    check("gastado a medias también bloquea", b5?.code === "saldo_usado", JSON.stringify(b5));

    const c5 = await cliente();
    const v5 = await contado(c5, { qty: 1 });
    const { data: r5 } = await devC(v5, 1, { aFavor: 10 });
    const { data: fiadoNuevo } = await A.db.from("movements").insert({ client_id: c5, created_by: A.id, type: "charge", amount: 25, currency: "USD", source: "manual" }).select("id").single();
    await admin.rpc("recalc_client_running_balance", { p_client_id: c5 });
    const { data: b6 } = await borrar(r5.movement_id);
    check("un fiado que se comió el saldo también lo gasta", b6?.code === "saldo_usado" && b6?.charge_id === fiadoNuevo.id, JSON.stringify(b6));

    const { data: ajena } = await anon().rpc("return_credit_spent_on", { p_return_id: r.return_id }).then((x) => x, (e) => ({ data: null, error: e }));
    check("sin sesión no contesta", ajena == null, ajena);
  }

  // ── B4: THE SHELF ────────────────────────────────────────────────────────
  {
    const c = await cliente();
    const p = await producto(5);
    const v = await contado(c, { qty: 3, product: p });
    const { data: r } = await devC(v, 2, { efectivo: 20 });
    await admin.from("products").update({ stock_opening: 1 }).eq("id", p);
    await A.db.rpc("eliminar_devolucion", { p_movement_id: r.movement_id });
    const tras = await estante(p);
    await A.db.rpc("restaurar_devolucion", { p_movement_id: r.movement_id });
    check("eliminar y restaurar deja el estante donde estaba", tras === 0 && (await estante(p)) === 1, `${tras} → ${await estante(p)}`);

    const c2 = await cliente();
    const p2 = await producto(10);
    const v2 = await contado(c2, { qty: 1, product: p2 });
    const { data: r2 } = await devC(v2, 1, { efectivo: 10 });
    await A.db.rpc("eliminar_devolucion", { p_movement_id: r2.movement_id });
    await A.db.rpc("restaurar_devolucion", { p_movement_id: r2.movement_id });
    check("con estante de sobra repone todo", (await estante(p2)) === 10, await estante(p2));
    await A.db.rpc("eliminar_devolucion", { p_movement_id: r2.movement_id });
    await A.db.rpc("restaurar_devolucion", { p_movement_id: r2.movement_id });
    check("y dos vueltas no acumulan nada", (await estante(p2)) === 10, await estante(p2));
  }
} catch (e) {
  check("ejecución", false, e.message);
} finally {
  for (const c of clientes) {
    await admin.from("sale_returns").delete().eq("client_id", c);
    await admin.from("movement_deletions").delete().eq("client_id", c);
    await admin.from("movements").update({ applies_to_movement_id: null }).eq("client_id", c);
    await admin.from("movements").delete().eq("client_id", c);
    await admin.from("sales").delete().eq("client_id", c);
    await admin.from("clients").delete().eq("id", c);
  }
  if (productos.length) await admin.from("products").delete().in("id", productos);
}

const fallos = filas.filter((f) => !f.pasa).length;
console.log(`\n${filas.length - fallos}/${filas.length} pasan.`);
if (fallos) process.exitCode = 1;
