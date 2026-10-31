// ESCRIBE EN DEV y se limpia sola. Corre con la clave de servicio, que es con
// la que /admin llama a estas funciones (son `security definer` y solo
// `service_role` puede ejecutarlas, migración 169).
//
// What it pins: the /admin metrics by flow (plan of 2026-10-31, phase A).
// It measures by DIFFERENCE -- reads a business's figures, writes a known set
// of sales, fiados, abonos and orders, reads again, and checks each figure
// moved by exactly what was written. That way the test owns its numbers even
// though the dev branch is full of other data.
//
// The checks that matter most, and why:
//   - every kind, origin and currency, so «contado» / «fiado» / «abono» mean
//     what Reportes means by them;
//   - a split abono counts ONCE, and the abono paid at the sale counts as an
//     abono (the two deliberate differences from Reportes);
//   - the Colombian book: `sale_payments` writes 'COP' and `movements` writes
//     NULL. Joining them raw made every Colombian credit sale look like a
//     contado sale on 2026-10-20 -- the phantom row;
//   - a half-registered order is not counted twice (registered AND pending);
//   - a sale at 23:30 Caracas belongs to ITS day, not the next one (the UTC
//     cut this migration removes);
//   - no figure adds dollars to euros;
//   - PARITY WITH REPORTES for the same business and window: the panel and the
//     owner's own screen must not be able to disagree.
process.env.TZ = "America/Caracas";

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { cargarFacturacion } from "../lib/reports/facturacion.ts";
import { rangoDe } from "../lib/reports/rango.ts";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);
const REF = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
if (REF !== "vzqppwrwnmlbrxizskdh") throw new Error("Esta suite solo corre contra dev (vzqppwrwnmlbrxizskdh).");

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });

const filas = [];
function check(nombre, pasa, detalle) {
  filas.push({ nombre, pasa });
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${detalle ? `  — ${detalle}` : ""}`);
}
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const diaEn = (d, tz) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const menosUnDia = (ymd) => {
  const d = new Date(ymd + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

async function rpc(fn, args) {
  const { data, error } = await admin.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data ?? [];
}
const args = (owner, from, to, currency = null, country = null) => ({
  p_country: country,
  p_currency: currency,
  p_owners: [owner],
  p_from: from,
  p_to: to,
});
// kind|origin|currency → { n, monto }
async function transacciones(a) {
  const m = new Map();
  for (const r of await rpc("admin_metrics_transactions", a))
    m.set(`${r.kind}|${r.origin}|${r.currency}`, { n: Number(r.tx_count), monto: r2(r.amount) });
  return m;
}
// status|kind|currency → { n, monto }
async function pedidos(a) {
  const m = new Map();
  for (const r of await rpc("admin_metrics_orders", a))
    m.set(`${r.status}|${r.kind ?? "-"}|${r.currency}`, { n: Number(r.orders), monto: r2(r.amount) });
  return m;
}
const delta = (antes, despues, clave) => {
  const a = antes.get(clave) ?? { n: 0, monto: 0 };
  const d = despues.get(clave) ?? { n: 0, monto: 0 };
  return { n: d.n - a.n, monto: r2(d.monto - a.monto) };
};
const igual = (x, n, monto) => x.n === n && x.monto === monto;

// ── Fixtures ──────────────────────────────────────────────────────────────
const M = JSON.parse(readFileSync(new URL("../../Illustrations/Web-v2/demo-manifest.json", import.meta.url), "utf8"));
const VE = M.ownerId;
const { data: coOwner } = await admin.from("owners").select("id, country").eq("country", "CO").limit(1).single();
const CO = coOwner.id;
const { data: veOwner } = await admin.from("owners").select("country").eq("id", VE).single();
if (veOwner.country !== "VE") throw new Error("El dueño del manifiesto no es venezolano");

const PREFIJO = "QA Metricas ";
const creados = { clientes: [], ventas: [], pedidos: [] };

async function cliente(owner, nombre) {
  const { data, error } = await admin.from("clients").insert({ owner_id: owner, name: PREFIJO + nombre }).select("id").single();
  if (error) throw new Error(`cliente: ${error.message}`);
  creados.clientes.push(data.id);
  return data.id;
}
async function venta(owner, clientId, { lineas, pagos = [], cargos = [], pedido = null, cuando = null, borrada = false }) {
  const fila = { owner_id: owner, client_id: clientId, catalog_order_id: pedido };
  if (cuando) fila.created_at = cuando;
  if (borrada) fila.deleted_at = new Date().toISOString();
  const { data: s, error } = await admin.from("sales").insert(fila).select("id").single();
  if (error) throw new Error(`venta: ${error.message}`);
  creados.ventas.push(s.id);
  for (const [cantidad, precio, moneda] of lineas) {
    const { error: e } = await admin.from("sale_lines").insert({ sale_id: s.id, name: "QA", quantity: cantidad, unit_price: precio, currency: moneda });
    if (e) throw new Error(`línea: ${e.message}`);
  }
  for (const [monto, moneda] of pagos) {
    const p = { sale_id: s.id, amount: monto, currency: moneda };
    if (cuando) p.created_at = cuando;
    const { error: e } = await admin.from("sale_payments").insert(p);
    if (e) throw new Error(`pago: ${e.message}`);
  }
  for (const [monto, moneda] of cargos) {
    await mov(owner, clientId, { type: "charge", amount: monto, currency: moneda, sale_id: s.id });
  }
  return s.id;
}
async function mov(owner, clientId, extra) {
  const { error } = await admin.from("movements").insert({ client_id: clientId, created_by: owner, source: "manual", ...extra });
  if (error) throw new Error(`movimiento: ${error.message}`);
}
async function pedido(owner, status, items) {
  const { data, error } = await admin
    .from("catalog_orders")
    .insert({
      owner_id: owner,
      customer_name: PREFIJO + "pedido",
      customer_document: "12345678",
      customer_whatsapp: "584120000000",
      customer_whatsapp_raw: "0412-0000000",
      status,
    })
    .select("id")
    .single();
  if (error) throw new Error(`pedido: ${error.message}`);
  creados.pedidos.push(data.id);
  for (const [cantidad, precio, moneda] of items) {
    const { error: e } = await admin.from("catalog_order_items").insert({
      order_id: data.id, product_name: "QA", quantity: cantidad, unit_price: precio, currency: moneda, tier: "retail",
    });
    if (e) throw new Error(`línea de pedido: ${e.message}`);
  }
  return data.id;
}

const hoyVE = diaEn(new Date(), "America/Caracas");
const ayerVE = menosUnDia(hoyVE);
const hoyCO = diaEn(new Date(), "America/Bogota");

try {
  const antesVE = await transacciones(args(VE, hoyVE, hoyVE));
  const antesAyerVE = await transacciones(args(VE, ayerVE, ayerVE));
  const antesPedVE = await pedidos(args(VE, hoyVE, hoyVE));
  const antesCO = await transacciones(args(CO, hoyCO, hoyCO));
  const antesDineroVE = await rpc("admin_metrics_by_owner_money", args(VE, hoyVE, hoyVE));

  // ── Venezuela ──
  const c = await cliente(VE, "VE");
  await venta(VE, c, { lineas: [[2, 5, "USD"]], pagos: [[10, "USD"]] });                          // 1 contado $10
  await venta(VE, c, { lineas: [[1, 6, "USD"], [1, 8, "EUR"]], pagos: [[6, "USD"]], cargos: [[8, "EUR"]] }); // 2 mixta
  await venta(VE, c, { lineas: [[1, 20, "USD"]], pagos: [[5, "USD"]], cargos: [[15, "USD"]] });    // 3 fiado con abono al vender
  const grupo = crypto.randomUUID();
  await mov(VE, c, { type: "payment", amount: 3, currency: "USD", payment_group_id: grupo });      // 4 reparto, una transacción
  await mov(VE, c, { type: "payment", amount: 2, currency: "USD", payment_group_id: grupo });
  await mov(VE, c, { type: "payment", amount: 4, currency: "EUR" });                                // 5 abono €4
  await mov(VE, c, { type: "charge", amount: 30, currency: "USD", is_old_debt: true });             // 6 deuda antigua
  await mov(VE, c, { type: "charge", amount: 7, currency: "USD", source: "photo_import" });         // 7 libreta
  await mov(VE, c, { type: "charge", amount: 9, currency: "EUR" });                                 // 8 manual antiguo
  const p9 = await pedido(VE, "registered", [[1, 12, "USD"]]);                                      // 9 pedido de contado
  await venta(VE, c, { lineas: [[1, 12, "USD"]], pagos: [[12, "USD"]], pedido: p9 });
  const p10 = await pedido(VE, "registered", [[1, 10, "EUR"]]);                                     // 10 pedido fiado
  await venta(VE, c, { lineas: [[1, 10, "EUR"]], cargos: [[10, "EUR"]], pedido: p10 });
  await pedido(VE, "new", [[2, 4, "USD"], [1, 3, "USDT"]]);                                         // 11 pendiente
  const p12 = await pedido(VE, "seen", [[1, 5, "USD"], [1, 7, "EUR"]]);                             // 12 medio registrado
  await venta(VE, c, { lineas: [[1, 5, "USD"]], pagos: [[5, "USD"]], pedido: p12 });
  await venta(VE, c, { lineas: [[1, 99, "USD"]], pagos: [[99, "USD"]], borrada: true });            // 13 borrada
  // 14: 23:30 de AYER en Caracas = 03:30 UTC de hoy.
  await venta(VE, c, { lineas: [[1, 1, "USD"]], pagos: [[1, "USD"]], cuando: `${hoyVE}T03:30:00Z` });

  const despuesVE = await transacciones(args(VE, hoyVE, hoyVE));
  const d = (k) => delta(antesVE, despuesVE, k);

  check("1. contado USD: 4 ventas, $33 (la borrada y la de anoche no entran)",
    igual(d("contado|venta|USD"), 4, 33), JSON.stringify(d("contado|venta|USD")));
  check("2. la venta mixta: la parte pagada es contado y la fiada es fiado en su moneda",
    igual(d("fiado|venta|EUR"), 2, 18), JSON.stringify(d("fiado|venta|EUR")));
  check("3. fiado de venta USD: lo que QUEDÓ debiendo, $15, no el total de $20",
    igual(d("fiado|venta|USD"), 1, 15), JSON.stringify(d("fiado|venta|USD")));
  check("4. lo pagado al vender a fiado es ABONO, y cuenta una vez",
    igual(d("abono|al_vender|USD"), 1, 5), JSON.stringify(d("abono|al_vender|USD")));
  check("5. un abono repartido en dos líneas cuenta UNA transacción ($5)",
    igual(d("abono|abono|USD"), 1, 5), JSON.stringify(d("abono|abono|USD")));
  check("6. abono en euros, en su moneda",
    igual(d("abono|abono|EUR"), 1, 4), JSON.stringify(d("abono|abono|EUR")));
  check("7. fiado por origen: deuda antigua, libreta y manual, cada uno en su fila",
    igual(d("fiado|deuda_antigua|USD"), 1, 30) && igual(d("fiado|libreta|USD"), 1, 7) && igual(d("fiado|manual|EUR"), 1, 9),
    `${JSON.stringify(d("fiado|deuda_antigua|USD"))} ${JSON.stringify(d("fiado|libreta|USD"))} ${JSON.stringify(d("fiado|manual|EUR"))}`);

  const despuesAyerVE = await transacciones(args(VE, ayerVE, ayerVE));
  check("8. una venta a las 23:30 de Caracas cae en SU día, no en el siguiente",
    igual(delta(antesAyerVE, despuesAyerVE, "contado|venta|USD"), 1, 1),
    `ayer ${JSON.stringify(delta(antesAyerVE, despuesAyerVE, "contado|venta|USD"))}`);

  const soloEUR = await rpc("admin_metrics_transactions", args(VE, hoyVE, hoyVE, "EUR"));
  check("9. el filtro de moneda deja solo esa moneda",
    soloEUR.length > 0 && soloEUR.every((r) => r.currency === "EUR"), `${soloEUR.length} filas`);
  const otroPais = await rpc("admin_metrics_transactions", args(VE, hoyVE, hoyVE, null, "CO"));
  check("10. el filtro de país excluye a un negocio de otro país", otroPais.length === 0, `${otroPais.length} filas`);

  const despuesPedVE = await pedidos(args(VE, hoyVE, hoyVE));
  const dp = (k) => delta(antesPedVE, despuesPedVE, k);
  check("11. pedidos registrados de contado: 2 pedidos, $17",
    igual(dp("registrado|contado|USD"), 2, 17), JSON.stringify(dp("registrado|contado|USD")));
  check("12. pedido registrado a fiado: €10, lo vendido",
    igual(dp("registrado|fiado|EUR"), 1, 10), JSON.stringify(dp("registrado|fiado|EUR")));
  check("13. pendientes: el USD del pedido medio registrado NO se cuenta otra vez",
    igual(dp("pendiente|-|USD"), 1, 8) && igual(dp("pendiente|-|EUR"), 1, 7),
    `USD ${JSON.stringify(dp("pendiente|-|USD"))} · EUR ${JSON.stringify(dp("pendiente|-|EUR"))}`);
  check("14. un pendiente en USDT se enseña en USDT, sin convertir",
    igual(dp("pendiente|-|USDT"), 1, 3), JSON.stringify(dp("pendiente|-|USDT")));

  const despuesDineroVE = await rpc("admin_metrics_by_owner_money", args(VE, hoyVE, hoyVE));
  const fiadoDe = (rows, m) => r2(rows.filter((r) => r.currency === m).reduce((s, r) => s + Number(r.charge_total), 0));
  const monedasPorFila = despuesDineroVE.map((r) => r.currency);
  check("15. «Por negocio» da una fila por moneda: dólares y euros nunca se suman",
    new Set(monedasPorFila).size === monedasPorFila.length &&
      r2(fiadoDe(despuesDineroVE, "USD") - fiadoDe(antesDineroVE, "USD")) === 52 &&
      r2(fiadoDe(despuesDineroVE, "EUR") - fiadoDe(antesDineroVE, "EUR")) === 27,
    `USD +${r2(fiadoDe(despuesDineroVE, "USD") - fiadoDe(antesDineroVE, "USD"))} · EUR +${r2(fiadoDe(despuesDineroVE, "EUR") - fiadoDe(antesDineroVE, "EUR"))}`);

  // ── Colombia: 'COP' en las ventas, NULL en los movimientos ──
  const cc = await cliente(CO, "CO");
  await venta(CO, cc, { lineas: [[1, 50000, "COP"]], pagos: [[50000, "COP"]] });
  await venta(CO, cc, { lineas: [[1, 80000, "COP"]], pagos: [[20000, "COP"]], cargos: [[60000, null]] });
  const despuesCO = await transacciones(args(CO, hoyCO, hoyCO));
  const dc = (k) => delta(antesCO, despuesCO, k);
  check("16. Colombia: la venta fiada NO sale como contado (la fila fantasma del 2026-10-20)",
    igual(dc("contado|venta|COP"), 1, 50000) && igual(dc("fiado|venta|COP"), 1, 60000) && igual(dc("abono|al_vender|COP"), 1, 20000),
    `contado ${JSON.stringify(dc("contado|venta|COP"))} · fiado ${JSON.stringify(dc("fiado|venta|COP"))} · al vender ${JSON.stringify(dc("abono|al_vender|COP"))}`);

  // ── Paridad con Reportes, como el dueño, misma ventana ──
  const u = await admin.auth.admin.getUserById(VE);
  const { data: lk } = await admin.auth.admin.generateLink({ type: "magiclink", email: u.data.user.email });
  const { data: ses } = await anon.auth.verifyOtp({ type: "magiclink", token_hash: lk.properties.hashed_token });
  const comoDueno = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${ses.session.access_token}` } },
  });
  const fac = await cargarFacturacion({
    supabase: comoDueno, ownerId: VE, rango: rangoDe({ desde: hoyVE, hasta: hoyVE }), dosLibros: true,
  });
  const total = (m, kind, cur) =>
    r2([...m.entries()].filter(([k]) => k.startsWith(`${kind}|`) && k.endsWith(`|${cur}`)).reduce((s, [, v]) => s + v.monto, 0));
  const pares = ["USD", "EUR"].map((cur) => ({
    cur,
    ventas: [r2(fac.ventas[cur] ?? 0), total(despuesVE, "contado", cur)],
    abonos: [r2(fac.abonos[cur] ?? 0), total(despuesVE, "abono", cur)],
    fiados: [r2(fac.fiados[cur] ?? 0), total(despuesVE, "fiado", cur)],
  }));
  check("17. PARIDAD con Reportes: contado, abonos y fiados del día, por moneda",
    pares.every((p) => p.ventas[0] === p.ventas[1] && p.abonos[0] === p.abonos[1] && p.fiados[0] === p.fiados[1]),
    pares.map((p) => `${p.cur} ventas ${p.ventas.join("=")} abonos ${p.abonos.join("=")} fiados ${p.fiados.join("=")}`).join(" · "));
} catch (e) {
  check("ERROR", false, e instanceof Error ? e.message : String(e));
} finally {
  if (creados.ventas.length) await admin.from("sales").delete().in("id", creados.ventas);
  if (creados.clientes.length) {
    await admin.from("movements").delete().in("client_id", creados.clientes);
    await admin.from("clients").delete().in("id", creados.clientes);
  }
  if (creados.pedidos.length) await admin.from("catalog_orders").delete().in("id", creados.pedidos);
  const { count } = await admin.from("clients").select("id", { count: "exact", head: true }).like("name", `${PREFIJO}%`);
  check("18. limpieza: no queda nada de la prueba en dev", count === 0, `quedan ${count}`);
  const fallos = filas.filter((f) => !f.pasa).length;
  console.log(`\n${filas.length - fallos}/${filas.length} pasan.`);
  process.exit(fallos === 0 ? 0 : 1);
}
