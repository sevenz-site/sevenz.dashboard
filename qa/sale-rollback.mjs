// A SALE THAT FAILS HALFWAY UNDOES ITSELF -- and still does under rule 5.
//
// Asked for by the owner on 2026-11-02 with emphasis: «no olvides construir
// la prueba para provocar el fallo a mitad de la venta». `registrarVenta`
// writes a sale in four steps (sale, lines, payments, one fiado per currency)
// and when a later step fails it hard-deletes what it already wrote. That
// path had never been exercised by any suite (`CT-123`), and migration 180
// now refuses hard deletes of money rows older than 10 minutes -- so an undo
// that silently stopped working would leave the client owing a sale the
// screen said had failed, and the shopkeeper would register it again.
//
// The failure is provoked by migration 181 (DEV ONLY): a trigger that raises
// when a payment or a fiado carries the description 'QA PROVOCAR FALLO'. This
// suite sends that marker in the step it wants to break, through the real
// action over HTTP with the owner's cookie, and then reads the database.
//
// Needs `npm run dev` running. Writes only to dev and cleans up after itself.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { cookieDeDueno, idDeLaAccion, llamarAccion } from "./server-action.mjs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
if (ref !== "vzqppwrwnmlbrxizskdh") {
  console.error(`Este script ESCRIBE y provoca fallos. Solo contra dev; apunta a ${ref}.`);
  process.exit(1);
}
const BASE = process.env.QA_BASE_URL ?? "http://localhost:3000";
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const filas = [];
const check = (nombre, pasa, detalle) => { filas.push(pasa); console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${detalle ? `  — ${detalle}` : ""}`); };
const MARCA = "QA ROLLBACK";
const FALLO = "QA PROVOCAR FALLO";
const creados = { clientes: [], productos: [] };

try {
  const { data: ve } = await admin.from("owners").select("id").eq("country", "VE").order("id").limit(1).single();

  // ── 0. Migration 181 must be installed, or nothing below means anything ──
  // Probed by doing the thing it forbids, as the service role (exempt from
  // 180's rules, so only 181 can refuse this).
  const { data: sonda } = await admin.from("clients").insert({ owner_id: ve.id, name: `${MARCA} sonda` }).select("id").single();
  creados.clientes.push(sonda.id);
  const probe = await admin.from("movements").insert({ client_id: sonda.id, created_by: ve.id, type: "charge", amount: 1, currency: "USD", source: "manual", description: FALLO });
  check("0. la migración 181 (fallo provocado) está instalada en dev", probe.error?.code === "SZ999", probe.error?.code ?? "la fila ENTRÓ: 181 no está, y todo lo de abajo sería un verde falso");
  if (probe.error?.code !== "SZ999") throw new Error("sin la 181 no hay fallo que provocar");

  // ── Fixture: a product priced in USD and EUR, a client, the session ──
  const { data: prod } = await admin.from("products").insert({
    owner_id: ve.id, name: `${MARCA} producto`, base_currency: "USD", base_currency_retail: "USD", base_currency_wholesale: "USD",
    price_retail: 10, published_retail: true, published_wholesale: false,
  }).select("id").single();
  creados.productos.push(prod.id);
  await admin.from("product_currencies").insert([{ product_id: prod.id, tier: "retail", currency: "EUR" }]);
  await admin.from("product_price_overrides").insert([{ product_id: prod.id, tier: "retail", currency: "EUR", amount: 8 }]);
  const { data: cliente } = await admin.from("clients").insert({ owner_id: ve.id, name: `${MARCA} cliente` }).select("id").single();
  creados.clientes.push(cliente.id);

  const cookie = await cookieDeDueno(env, ve.id);
  const accion = await idDeLaAccion(BASE, "/ventas/nueva", "registrarVenta", cookie);
  if (!accion) throw new Error("no se encontró el id de registrarVenta en los chunks que sirve el servidor");
  const vender = (entrada) => llamarAccion(BASE, "/ventas/nueva", accion, cookie, [entrada]);

  const foto = async () => {
    const [{ data: s }, { data: m }, { data: b }] = await Promise.all([
      admin.from("sales").select("id").eq("client_id", cliente.id),
      admin.from("movements").select("id, currency, amount").eq("client_id", cliente.id).is("deleted_at", null),
      admin.from("client_summary_all").select("balance_usd, balance_eur").eq("client_id", cliente.id).maybeSingle(),
    ]);
    return { ventas: s?.length ?? 0, movimientos: m?.length ?? 0, usd: Number(b?.balance_usd ?? 0), eur: Number(b?.balance_eur ?? 0) };
  };
  const limpiarVentas = async () => {
    const { data: s } = await admin.from("sales").select("id").eq("client_id", cliente.id);
    await admin.from("movements").delete().eq("client_id", cliente.id);
    for (const v of s ?? []) await admin.from("sales").delete().eq("id", v.id);
    await admin.rpc("recalc_client_running_balance", { p_client_id: cliente.id });
  };

  const usd = { productId: prod.id, quantity: 1, currency: "USD" };
  const eur = { productId: prod.id, quantity: 1, currency: "EUR" };
  const credito = (currency, extra = {}) => ({ currency, plazoDias: 15, cuotas: null, ...extra });

  // ── 1. Control: the same mixed sale, with no marker, goes through ──
  const c1 = await vender({ clientId: cliente.id, lineas: [usd, eur], pagos: [], credito: [credito("USD"), credito("EUR")] });
  let f = await foto();
  check("1a. control: la venta mixta (USD + EUR fiados) se guarda", c1.ok === true, c1.ok ? c1.saleId : c1.error);
  check("1b. y deja una venta y dos fiados, uno por moneda", f.ventas === 1 && f.movimientos === 2 && f.usd === 10 && f.eur === 8, JSON.stringify(f));
  await limpiarVentas();
  const antes = await foto();

  // ── 2. The payment step fails: sale and lines are undone ──
  const r2 = await vender({ clientId: cliente.id, lineas: [usd], pagos: [{ currency: "USD", amount: 5, description: FALLO }], credito: [credito("USD")] });
  f = await foto();
  check("2a. falla al guardar el PAGO: la acción devuelve error", r2.ok === false, r2.ok ? "se guardó" : r2.error);
  check("2b. y el error es el escrito para el tendero, no el de la base", r2.ok === false && /No pudimos guardar el pago/.test(r2.error), r2.ok ? "" : r2.error);
  check("2c. en la base NO queda la venta ni sus líneas (se deshizo bajo la regla de los 10 min)", f.ventas === antes.ventas, `ventas ${f.ventas}`);
  check("2d. y ningún fiado, ni cambio de saldo", f.movimientos === antes.movimientos && f.usd === antes.usd, JSON.stringify(f));

  // ── 3. The SECOND fiado fails: the first fiado AND the sale are undone ──
  const r3 = await vender({ clientId: cliente.id, lineas: [usd, eur], pagos: [], credito: [credito("USD"), credito("EUR", { description: FALLO })] });
  f = await foto();
  check("3a. falla el segundo fiado (EUR) después de escribir el primero (USD): error", r3.ok === false, r3.ok ? "se guardó" : r3.error);
  check("3b. el fiado en USD que ya estaba escrito se borró", f.movimientos === antes.movimientos, `movimientos vivos ${f.movimientos}`);
  check("3c. la venta se borró con sus líneas", f.ventas === antes.ventas, `ventas ${f.ventas}`);
  check("3d. y el cliente no debe nada que no debiera antes", f.usd === antes.usd && f.eur === antes.eur, `USD ${f.usd} · EUR ${f.eur}`);

  // ── 4. After the undo the shopkeeper can still sell to that client ──
  const c4 = await vender({ clientId: cliente.id, lineas: [usd], pagos: [{ currency: "USD", amount: 10 }], credito: [] });
  f = await foto();
  check("4. después de los dos fallos, una venta de contado al mismo cliente se guarda", c4.ok === true && f.ventas === antes.ventas + 1 && f.movimientos === antes.movimientos, c4.ok ? JSON.stringify(f) : c4.error);
  await limpiarVentas();
} catch (e) {
  console.error("ERROR", e instanceof Error ? e.message : e);
  filas.push(false);
} finally {
  for (const c of creados.clientes) { await admin.from("movements").delete().eq("client_id", c); await admin.from("sales").delete().eq("client_id", c); }
  if (creados.clientes.length) await admin.from("clients").delete().in("id", creados.clientes);
  if (creados.productos.length) await admin.from("products").delete().in("id", creados.productos);
  const { count } = await admin.from("clients").select("id", { count: "exact", head: true }).ilike("name", `${MARCA}%`);
  check("5. limpieza: no queda nada de la prueba en dev", count === 0, `quedan ${count}`);
  const ok = filas.filter(Boolean).length;
  console.log(`\n${ok}/${filas.length} pasan.`);
  process.exit(ok === filas.length ? 0 : 1);
}
