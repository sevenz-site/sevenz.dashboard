// SOLO LA RAMA DEV (vzqppwrwnmlbrxizskdh) — lee .env.local.
//
// SÍ ESCRIBE en dev, y el `finally` lo borra todo aunque el script se caiga.
//
// REQUIRES `npm run dev` STARTED WITH `ANALYTICS_QA_LOG`, set in
// `.env.development.local` (git-ignored). With it the server writes each event to
// that file instead of sending it to Mixpanel, so this suite reads exactly what
// would have left.
//
// WHY IT EXISTS. On 2026-10-24 `Movement Added` went out with its dialog and every
// sale and payment stopped reaching Mixpanel. Nothing failed, because a missing
// event fails nothing. This suite calls the real server actions over HTTP, as the
// browser does, and asserts each one left its event with the right figures.
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync, statSync } from "node:fs";
import { cookieDeDueno, idDeLaAccion, llamarAccion } from "./server-action.mjs";

const leerEnv = (archivo) =>
  Object.fromEntries(
    readFileSync(archivo, "utf8")
      .split(/\r?\n/)
      .filter((l) => l.includes("=") && !l.startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
      }),
  );

const env = leerEnv(".env.local");
const DEV_REF = "vzqppwrwnmlbrxizskdh";
if (new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0] !== DEV_REF) {
  console.error(`ME NIEGO A CORRER. .env.local no apunta a la rama dev (${DEV_REF}).`);
  process.exit(1);
}
if (!existsSync(".env.development.local")) {
  console.error("Falta .env.development.local con ANALYTICS_QA_LOG. Sin eso no hay eventos que leer.");
  process.exit(1);
}
const LOG = leerEnv(".env.development.local").ANALYTICS_QA_LOG;
const BASE = process.env.QA_BASE_URL ?? "http://localhost:3000";
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const filas = [];
const check = (nombre, pasa, detalle) => {
  filas.push(Boolean(pasa));
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${!pasa && detalle ? ` — ${detalle}` : ""}`);
};

const MARCA = "QA EVENTOS";
const inicio = existsSync(LOG) ? statSync(LOG).size : 0;
const eventos = () =>
  existsSync(LOG)
    ? readFileSync(LOG, "utf8").slice(inicio).split("\n").filter(Boolean).map((l) => JSON.parse(l))
    : [];

// `after()` writes once the response has gone, so an event can land a moment
// later than the action's answer. Waits for it rather than guessing a delay.
async function esperar(nombre, condicion = () => true) {
  for (let i = 0; i < 40; i++) {
    const e = eventos().find((x) => x.event === nombre && condicion(x.properties));
    if (e) return e.properties;
    await new Promise((r) => setTimeout(r, 150));
  }
  return null;
}

const creados = { clientes: [], productos: [] };
const FLUJO = { flowId: "qa-eventos-0001", entryPoint: "register" };

async function nuevoCliente(ownerId, sufijo) {
  const { data, error } = await admin.from("clients").insert({ owner_id: ownerId, name: `${MARCA} ${sufijo}` }).select("id").single();
  if (error) throw new Error(`cliente: ${error.message}`);
  creados.clientes.push(data.id);
  return data.id;
}

try {
  const { data: ve } = await admin.from("owners").select("id").eq("country", "VE").order("id").limit(1).single();
  const { data: prod } = await admin.from("products").insert({
    owner_id: ve.id, name: `${MARCA} producto`, base_currency: "USD", base_currency_retail: "USD", base_currency_wholesale: "USD",
    price_retail: 10, published_retail: true, published_wholesale: false,
  }).select("id").single();
  creados.productos.push(prod.id);
  await admin.from("product_currencies").insert([{ product_id: prod.id, tier: "retail", currency: "EUR" }]);
  await admin.from("product_price_overrides").insert([{ product_id: prod.id, tier: "retail", currency: "EUR", price: 9 }]);

  const cookie = await cookieDeDueno(env, ve.id);
  const id = async (pagina, nombre) => {
    const a = await idDeLaAccion(BASE, pagina, nombre, cookie);
    if (!a) throw new Error(`no se encontró ${nombre} en ${pagina}`);
    return a;
  };
  const usd = { productId: prod.id, quantity: 1, currency: "USD" };
  const eur = { productId: prod.id, quantity: 1, currency: "EUR" };
  const plazo = (currency) => ({ currency, plazoDias: 15, cuotas: null });

  const aVenta = await id("/ventas/nueva", "registrarVenta");
  const vender = (entrada) => llamarAccion(BASE, "/ventas/nueva", aVenta, cookie, [entrada]);

  // ── La venta ─────────────────────────────────────────────────────────
  const c1 = await nuevoCliente(ve.id, "contado");
  const v1 = await vender({ clientId: c1, lineas: [usd], pagos: [{ currency: "USD", amount: 10 }], credito: [], analitica: FLUJO });
  const e1 = await esperar("Sale Completed", (p) => p.sale_id === v1.saleId);
  check("1a. contado: la venta se guarda", v1.ok === true, v1.error);
  check("1b. contado: manda Sale Completed con payment_form cash", e1?.payment_form === "cash", JSON.stringify(e1));
  check("1c. lleva total y cobrado, y no deja nada fiado", e1?.total_usd === 10 && e1?.collected_usd === 10 && e1?.owed_usd === 0, JSON.stringify(e1));
  check("1d. lleva client_id, owner_id, flow_id y entry_point", e1?.client_id === c1 && e1?.owner_id === ve.id && e1?.flow_id === FLUJO.flowId && e1?.entry_point === "register", JSON.stringify(e1));
  check("1e. origin es wizard, sale de servidor", e1?.origin === "wizard" && e1?.sent_from === "server", JSON.stringify(e1));

  const c2 = await nuevoCliente(ve.id, "fiado");
  const v2 = await vender({ clientId: c2, lineas: [usd], pagos: [], credito: [plazo("USD")] });
  const e2 = await esperar("Sale Completed", (p) => p.sale_id === v2.saleId);
  check("2. fiado: payment_form fiado, owed_usd 10, has_term", e2?.payment_form === "fiado" && e2?.owed_usd === 10 && e2?.charges_count === 1 && e2?.has_term === true, JSON.stringify(e2));

  const c3 = await nuevoCliente(ve.id, "parcial");
  const v3 = await vender({ clientId: c3, lineas: [usd], pagos: [{ currency: "USD", amount: 4 }], credito: [plazo("USD")] });
  const e3 = await esperar("Sale Completed", (p) => p.sale_id === v3.saleId);
  check("3. abono inicial: partial, cobrado 4 y debe 6", e3?.payment_form === "partial" && e3?.collected_usd === 4 && e3?.owed_usd === 6, JSON.stringify(e3));

  const c4 = await nuevoCliente(ve.id, "mixta");
  const v4 = await vender({ clientId: c4, lineas: [usd, eur], pagos: [{ currency: "USD", amount: 10 }], credito: [plazo("EUR")] });
  const e4 = await esperar("Sale Completed", (p) => p.sale_id === v4.saleId);
  check("4. dos monedas: mixed, sin sumar dólares con euros", e4?.payment_form === "mixed" && e4?.total_usd === 10 && e4?.total_eur > 0 && e4?.owed_eur === e4?.total_eur && e4?.currencies_count === 2, JSON.stringify(e4));

  const r5 = await vender({ clientId: c1, lineas: [usd], pagos: [{ currency: "USD", amount: 99 }], credito: [], analitica: FLUJO });
  const e5 = await esperar("Sale Rejected", (p) => p.reason === "overpayment");
  check("5. cobrar de más: se rechaza y manda Sale Rejected", r5.ok === false && e5?.origin === "wizard" && e5?.flow_id === FLUJO.flowId, JSON.stringify(e5));

  const r6 = await vender({ clientId: c1, lineas: [], pagos: [], credito: [] });
  check("6. venta vacía: reason empty_sale", r6.ok === false && (await esperar("Sale Rejected", (p) => p.reason === "empty_sale")));

  // ── El abono ─────────────────────────────────────────────────────────
  const pAbono = `/abonos/nuevo?cliente=${c2}`;
  const aRepartido = await id(pAbono, "registrarAbonoRepartido");
  const a7 = await llamarAccion(BASE, pAbono, aRepartido, cookie, [{ clienteId: c2, libro: "USD", montoTecleado: 4, monedaTecleada: "USD", analitica: FLUJO }]);
  const e7 = await esperar("Payment Recorded", (p) => p.client_id === c2 && p.mode === "split");
  check("7a. abono repartido: manda Payment Recorded", a7.ok === true && e7?.amount_usd === 4 && e7?.lines === 1, a7.error ?? JSON.stringify(e7));
  check("7b. lleva group_id y no salda la deuda", Boolean(e7?.group_id) && e7?.settles_debt === false && e7?.flow_id === FLUJO.flowId, JSON.stringify(e7));

  const { data: f3 } = await admin.from("movements").select("id").eq("client_id", c3).eq("type", "charge").single();
  const pMonto = `/abonos/nuevo/${f3.id}/monto?desde=detalle`;
  const aDirigido = await id(pMonto, "registrarAbonoDirigido");
  const a8 = await llamarAccion(BASE, pMonto, aDirigido, cookie, [{ fiadoId: f3.id, monto: 99, monedaTecleada: "USD" }]);
  const e8 = await esperar("Payment Rejected", (p) => p.reason === "exceeds_fiado" && p.mode === "directed");
  check("8. abono de más: se rechaza y manda Payment Rejected", a8.ok === false && e8, JSON.stringify(a8));
  const a9 = await llamarAccion(BASE, pMonto, aDirigido, cookie, [{ fiadoId: f3.id, monto: 6, monedaTecleada: "USD" }]);
  const e9 = await esperar("Payment Recorded", (p) => p.client_id === c3 && p.mode === "directed");
  check("9. abono dirigido por lo que debe: amount_usd 6 y salda la deuda", a9.ok === true && e9?.amount_usd === 6 && e9?.settles_debt === true, a9.error ?? JSON.stringify(e9));

  const a10 = await llamarAccion(BASE, pAbono, aRepartido, cookie, [{ clienteId: c2, libro: "EUR", montoTecleado: 4, monedaTecleada: "EUR" }]);
  check("10. sin fiados en esa moneda: reason no_open_fiados", a10.ok === false && (await esperar("Payment Rejected", (p) => p.reason === "no_open_fiados")));

  // ── La devolución ────────────────────────────────────────────────────
  const c11 = await nuevoCliente(ve.id, "devolucion");
  const v11 = await vender({ clientId: c11, lineas: [usd], pagos: [], credito: [plazo("USD")] });
  const { data: linea11 } = await admin.from("sale_lines").select("id").eq("sale_id", v11.saleId).single();
  const movimiento11 = v11.fiado[0].movementId;
  const pFicha = `/transacciones/${movimiento11}`;
  const aDevolver = await id(pFicha, "registrarDevolucion");
  const d11 = await llamarAccion(BASE, pFicha, aDevolver, cookie, [{ movementId: movimiento11, lineId: linea11.id, quantity: 9, fiados: [], aFavor: 0, efectivo: 0 }]);
  check("11. devolver de más: reason quantity_exceeded", d11.ok === false && (await esperar("Return Rejected", (p) => p.reason === "quantity_exceeded" && p.sale_kind === "fiado")), JSON.stringify(d11));
  const d12 = await llamarAccion(BASE, pFicha, aDevolver, cookie, [{ movementId: movimiento11, lineId: linea11.id, quantity: 1, fiados: [], aFavor: 0, efectivo: 0 }]);
  const e12 = await esperar("Return Recorded", (p) => p.client_id === c11);
  check("12. devolución de fiado: value_usd 10, todo a su fiado", d12.ok === true && e12?.value_usd === 10 && e12?.to_own_usd === 10 && e12?.sale_kind === "fiado" && Boolean(e12?.return_id), d12.error ?? JSON.stringify(e12));

  const pVenta = `/transacciones/venta/${v1.saleId}/usd`;
  const aContado = await id(pVenta, "registrarDevolucionDeContado");
  const { data: linea1 } = await admin.from("sale_lines").select("id").eq("sale_id", v1.saleId).single();
  const d13 = await llamarAccion(BASE, pVenta, aContado, cookie, [{ saleId: v1.saleId, lineId: linea1.id, quantity: 1, fiados: [], aFavor: 0, efectivo: 10 }]);
  const e13 = await esperar("Return Recorded", (p) => p.client_id === c1);
  check("13. devolución de contado en efectivo: to_cash_usd 10", d13.ok === true && e13?.to_cash_usd === 10 && e13?.sale_kind === "cash", d13.error ?? JSON.stringify(e13));

  // ── Borrar y restaurar ───────────────────────────────────────────────
  const aEliminarVenta = await id(pVenta, "eliminarVenta");
  const b14 = await llamarAccion(BASE, pVenta, aEliminarVenta, cookie, [v1.saleId]);
  check("14. venta con devolución viva: reason has_returns", b14.ok === false && (await esperar("Transaction Delete Rejected", (p) => p.target === "sale" && p.reason === "has_returns")), JSON.stringify(b14));

  const aBorrar = await id(pFicha, "deleteMovement");
  const b15 = await llamarAccion(BASE, pFicha, aBorrar, cookie, [movimiento11, {}], '{"error":');
  check("15. fiado con devolución: reason has_returns", b15.error && (await esperar("Transaction Delete Rejected", (p) => p.target === "movement" && p.reason === "has_returns")), JSON.stringify(b15));

  const c16 = await nuevoCliente(ve.id, "borrar");
  const v16 = await vender({ clientId: c16, lineas: [usd], pagos: [], credito: [plazo("USD")] });
  const m16 = v16.fiado[0].movementId;
  const b16 = await llamarAccion(BASE, pFicha, aBorrar, cookie, [m16, {}], '{"error":');
  const e16 = await esperar("Transaction Deleted", (p) => p.movement_id === m16);
  check("16. borrar un fiado: transaction_type fiado", b16.error === null && e16?.transaction_type === "fiado" && e16?.client_id === c16, JSON.stringify(e16));

  const aRestaurar = await id("/notificaciones", "restoreMovement");
  const r17 = await llamarAccion(BASE, "/notificaciones", aRestaurar, cookie, [m16], '{"error":');
  const e17 = await esperar("Transaction Restored", (p) => p.movement_id === m16);
  check("17. restaurarlo: Transaction Restored, con su venta", r17.error === null && e17?.source === "notification" && e17?.revived_sale === true, JSON.stringify(e17));

  await admin.from("clients").update({ trashed_at: new Date().toISOString() }).eq("id", c16);
  await llamarAccion(BASE, pFicha, aBorrar, cookie, [m16, {}], '{"error":');
  const r18 = await llamarAccion(BASE, "/notificaciones", aRestaurar, cookie, [m16], '{"error":');
  check("18. cliente en la papelera: reason client_trashed", r18.error && (await esperar("Transaction Restore Rejected", (p) => p.reason === "client_trashed")), JSON.stringify(r18));
  await admin.from("clients").update({ trashed_at: null }).eq("id", c16);

  const c19 = await nuevoCliente(ve.id, "eliminar");
  const v19 = await vender({ clientId: c19, lineas: [usd], pagos: [{ currency: "USD", amount: 10 }], credito: [] });
  const b19 = await llamarAccion(BASE, pVenta, aEliminarVenta, cookie, [v19.saleId]);
  const e19 = await esperar("Sale Deleted", (p) => p.sale_id === v19.saleId);
  check("19. eliminar una venta de contado: restorable false", b19.ok === true && e19?.restorable === false && e19?.charges_deleted === 0, JSON.stringify(e19));

  // ── La deuda antigua: `registrarCliente` recibe un FormData ──────────
  const aCliente = await id("/clients/nuevo", "registrarCliente");
  const nombre20 = `${MARCA} deuda`;
  const fd = new FormData();
  // The root part goes LAST, as the browser sends it: the server reads the form's
  // fields the moment it meets `$K1`, and at that point only earlier parts exist.
  for (const [k, v] of Object.entries({ name: nombre20, document_id: String(Date.now()).slice(-8), document_type: "V", deuda_monto: "45,50", deuda_moneda: "USD", plazo_dias: "30" })) fd.append(`_1_${k}`, v);
  fd.append("0", '["$K1"]');
  const res = await fetch(`${BASE}/clients/nuevo`, { method: "POST", headers: { "Next-Action": aCliente, Cookie: cookie }, body: fd });
  const texto = await res.text();
  const e20 = await esperar("Old Debt Recorded", (p) => p.amount_usd === 45.5);
  check("20. deuda antigua: Old Debt Recorded con su importe", e20?.has_term === true, `${res.status} ${texto.slice(0, 200)}`);
  if (e20?.client_id) creados.clientes.push(e20.client_id);

  // ── Colombia: el libro se escribe de dos formas ──────────────────────
  const { data: co } = await admin.from("owners").select("id").eq("country", "CO").order("id").limit(1).maybeSingle();
  if (co) {
    const { data: prodCo } = await admin.from("products").insert({
      owner_id: co.id, name: `${MARCA} producto co`, base_currency: "COP", base_currency_retail: "COP", base_currency_wholesale: "COP",
      price_retail: 10000, published_retail: true, published_wholesale: false,
    }).select("id").single();
    creados.productos.push(prodCo.id);
    const c21 = await nuevoCliente(co.id, "colombia");
    const cookieCo = await cookieDeDueno(env, co.id);
    const r21 = await llamarAccion(BASE, "/ventas/nueva", aVenta, cookieCo, [{
      clientId: c21, lineas: [{ productId: prodCo.id, quantity: 1, currency: "COP" }], pagos: [{ currency: "COP", amount: 4000 }], credito: [plazo("COP")],
    }]);
    const e21 = await esperar("Sale Completed", (p) => p.sale_id === r21.saleId);
    check("21a. Colombia: total_cop y owed_cop en la misma propiedad", r21.ok === true && e21?.total_cop === 10000 && e21?.owed_cop === 6000 && e21?.payment_form === "partial", r21.error ?? JSON.stringify(e21));
    const { data: f21 } = await admin.from("movements").select("id").eq("client_id", c21).eq("type", "charge").single();
    const cookiePago = `/abonos/nuevo?cliente=${c21}`;
    const a21 = await llamarAccion(BASE, cookiePago, aRepartido, cookieCo, [{ clienteId: c21, libro: null, montoTecleado: 6000, monedaTecleada: "COP" }]);
    const p21 = await esperar("Payment Recorded", (p) => p.client_id === c21);
    check("21b. Colombia: el abono con libro null llega como amount_cop y salda", a21.ok === true && p21?.amount_cop === 6000 && p21?.settles_debt === true, a21.error ?? JSON.stringify(p21));
    check("21c. el fiado colombiano existe", Boolean(f21));
  } else {
    check("21. Colombia: no hay dueño colombiano en dev", false, "no probado");
  }

  // ── Lo que nunca viaja ───────────────────────────────────────────────
  const todos = eventos();
  const prohibidas = /^(name|nombre|phone|telefono|whatsapp|document|documento|email|correo|token|note|nota|description|descripcion)$/i;
  // `token` here is Mixpanel's project token, which every event carries.
  const claves = todos.flatMap((e) => Object.keys(e.properties)).filter((k) => k !== "token" && prohibidas.test(k));
  const conNombre = todos.filter((e) => JSON.stringify(e.properties).includes(MARCA));
  check(`22a. ninguna de las ${todos.length} notas lleva una propiedad personal`, claves.length === 0, claves.join(", "));
  check("22b. ningún nombre de cliente ni de producto viajó", conNombre.length === 0, conNombre.map((e) => e.event).join(", "));

  // ── La ruta pública: lo que acepta y lo que no ───────────────────────
  const cPub = await nuevoCliente(ve.id, "enlace");
  const token = `qa-eventos-${Date.now()}`;
  const { error: eLink } = await admin.from("share_links").insert({ client_id: cPub, token });
  if (eLink) throw new Error(`share_links: ${eLink.message}`);
  const publico = (cuerpo, cabeceras = { Origin: BASE }) =>
    fetch(`${BASE}/api/public-event`, { method: "POST", headers: { "Content-Type": "application/json", ...cabeceras }, body: JSON.stringify(cuerpo), redirect: "manual" });

  const p1 = await publico({ token, code: "balance_opened" });
  const ep1 = await esperar("Balance Link Opened", (p) => p.distinct_id === ve.id);
  check("24a. un enlace válido: 204 y Balance Link Opened bajo el dueño", p1.status === 204 && ep1?.viewer_signed_in === false, `HTTP ${p1.status} ${JSON.stringify(ep1)}`);
  check("24b. lleva client_id (migración 190)", ep1?.client_id === cPub, JSON.stringify(ep1));

  await publico({ token, code: "client_transaction_opened", props: { transaction_type: "fiado", nombre: "Pedro", phone: "0414" } });
  const ep2 = await esperar("Client Transaction Opened");
  check("24c. una propiedad no declarada se tira", ep2?.transaction_type === "fiado" && !("nombre" in (ep2 ?? {})) && !("phone" in (ep2 ?? {})), JSON.stringify(ep2));

  const antes = eventos().length;
  const q1 = await publico({ token, code: "Sale Completed" });
  const q2 = await publico({ token: "no-existe", code: "balance_opened" });
  const q3 = await publico({ token, code: "balance_opened" }, {});
  const q4 = await publico({ token, code: "balance_opened" }, { Origin: "https://otro.example" });
  const q5 = await fetch(`${BASE}/api/public-event`, { method: "POST", headers: { Origin: BASE }, body: "x".repeat(3000) });
  await new Promise((r) => setTimeout(r, 1200));
  check("24d. evento inventado, token falso, sin origen, otro origen y cuerpo gigante: 204 y nada escrito", [q1, q2, q3, q4, q5].every((r) => r.status === 204) && eventos().length === antes, `${eventos().length - antes} eventos de más`);

  // ── H2: el catálogo desde el saldo ───────────────────────────────────
  const anon = await fetch(`${BASE}/api/share-catalog`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", redirect: "manual" });
  check("23. /api/share-catalog sin sesión responde 204, no 307", anon.status === 204, `HTTP ${anon.status}`);
} catch (e) {
  console.error("ERROR", e instanceof Error ? e.message : e);
  filas.push(false);
} finally {
  for (const c of creados.clientes) {
    const { data: ventas } = await admin.from("sales").select("id").eq("client_id", c);
    await admin.from("sale_returns").delete().eq("client_id", c);
    await admin.from("movements").delete().eq("client_id", c);
    for (const v of ventas ?? []) await admin.from("sales").delete().eq("id", v.id);
  }
  if (creados.clientes.length) await admin.from("clients").delete().in("id", creados.clientes);
  if (creados.productos.length) await admin.from("products").delete().in("id", creados.productos);
  const { count } = await admin.from("clients").select("id", { count: "exact", head: true }).ilike("name", `${MARCA}%`);
  check("25. limpieza: no queda nada de la prueba en dev", count === 0, `quedan ${count}`);
  const ok = filas.filter(Boolean).length;
  console.log(`\n${ok}/${filas.length} pasan.`);
  process.exit(ok === filas.length ? 0 : 1);
}
