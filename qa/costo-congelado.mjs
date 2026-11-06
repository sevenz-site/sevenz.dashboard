// A SALE REMEMBERS WHAT THE PRODUCT COST THAT DAY: migration 194.
//
// Owner's decision of 2026-11-06: *«guardemos el costo al día de la venta, ajústalo también
// en reportes»*. Before it, updating a cost rewrote the profit of every past month, in
// silence: a believable figure, so nothing looked wrong.
//
// Part 1 needs no database: the arithmetic. Part 2 is DEV ONLY (vzqppwrwnmlbrxizskdh) and
// needs `npm run dev` on port 3000, because `registrarVenta` lives in a "use server" file and
// can only be reached over HTTP. It builds two throw-away businesses, one Venezuelan and one
// Colombian, sells through the real action with the owner's session, reads the reports with
// that same session, and removes everything at the end. No client has a number, so nothing
// leaves for WhatsApp.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { costoParaCongelar, cuentasPorProducto } from "../lib/reports/ganancia.ts";
import { cargarDevoluciones, lineasDevueltas } from "../lib/reports/devoluciones.ts";
import { cargarInventario } from "../lib/reports/inventario.ts";
import { cargarProveedores } from "../lib/reports/proveedores.ts";

const filas = [];
const check = (nombre, pasa, detalle = "") => {
  filas.push(pasa);
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${pasa || !detalle ? "" : `  — ${detalle}`}`);
};
const casi = (a, b) => a != null && Math.abs(a - b) < 0.005;

// ── Part 1: the arithmetic ───────────────────────────────────────────────────
const TASAS = { usd: 100, eur: 120, usdt: null };
{
  const costoHoy = new Map([["p", { costo: 1.5, monedaCosto: "USD" }]]);
  const vendida = { productId: "p", currency: "USD", unitPrice: 2, quantity: 100 };

  const conCosto = cuentasPorProducto([{ ...vendida, unitCost: 1 }], costoHoy, TASAS).get("p");
  check("1a. el caso de la harina: gana 100 aunque hoy el costo sea 1,50", casi(conCosto.ganancia.USD, 100), JSON.stringify(conCosto));
  const sinCosto = cuentasPorProducto([{ ...vendida, unitCost: null }], costoHoy, TASAS).get("p");
  check("1b. una línea sin costo guardado sigue con el costo de hoy", casi(sinCosto.ganancia.USD, 50), JSON.stringify(sinCosto));
  const nada = cuentasPorProducto([{ ...vendida, unitCost: null }], new Map([["p", { costo: null, monedaCosto: null }]]), TASAS).get("p");
  check("1d. sin costo guardado ni costo hoy: sin ganancia, nunca cero", nada.ganancia.USD === undefined && nada.lineasSinCosto === 1, JSON.stringify(nada));

  const devuelta = lineasDevueltas([{ productId: "p", currency: "USD", unitPrice: 2, unitCost: 1, quantity: 100 }]);
  const neto = cuentasPorProducto([{ ...vendida, unitCost: 1 }, ...devuelta], costoHoy, TASAS).get("p");
  check("1e. devolver lo vendido deja la ganancia en cero con el mismo costo", casi(neto.ganancia.USD, 0), JSON.stringify(neto));

  check("1f. misma moneda: se guarda tal cual", costoParaCongelar({ costo: 4, monedaCosto: "USD" }, "USD", TASAS) === 4);
  check("1g. moneda distinta: se guarda convertida con la tasa del día", casi(costoParaCongelar({ costo: 12, monedaCosto: "USD" }, "EUR", TASAS), 10));
  check("1h. sin costo no se guarda nada", costoParaCongelar({ costo: null, monedaCosto: null }, "USD", TASAS) === null);
  check("1i. un costo de cero tampoco: desconocido no es gratis", costoParaCongelar({ costo: 0, monedaCosto: "USD" }, "USD", TASAS) === null);
  check("1j. moneda «Otra»: no se inventa la conversión", costoParaCongelar({ costo: 4, monedaCosto: "OTHER" }, "USD", TASAS) === null);
  check("1k. sin tasas y con monedas distintas: no se guarda", costoParaCongelar({ costo: 4, monedaCosto: "USD" }, "EUR", null) === null);
  check("1l. Colombia, sin tasas y en su moneda: sí se guarda", costoParaCongelar({ costo: 4000, monedaCosto: "COP" }, "COP", null) === 4000);
  check("1m. el costo nulo de moneda se lee como dólares, igual que el capital", costoParaCongelar({ costo: 4, monedaCosto: null }, "USD", TASAS) === 4);
}

// ── Part 1b: nothing writes a sale line without its cost ─────────────────────
// CLAUDE.md, «Una cifra del pasado no se calcula con datos de hoy». A second writer that
// forgets the column leaves its lines on today's cost and nothing says so.
{
  const archivos = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const ruta = join(dir, e.name);
    if (e.isDirectory()) return archivos(ruta);
    return /\.tsx?$/.test(e.name) ? [ruta] : [];
  });
  const escrituras = [];
  for (const ruta of [...archivos("app"), ...archivos("lib")]) {
    const texto = readFileSync(ruta, "utf8");
    for (const m of texto.matchAll(/\.from\("sale_lines"\)\s*\.(insert|upsert)\(/g)) {
      escrituras.push({ ruta, trozo: texto.slice(m.index, m.index + 700) });
    }
  }
  check("1n. hay una sola escritura de líneas de venta en el código", escrituras.length === 1, escrituras.map((e) => e.ruta).join(", "));
  check("1o. esa escritura guarda el costo", escrituras.every((e) => e.trozo.includes("unit_cost")), escrituras.map((e) => e.ruta).join(", "));
  const sql = readdirSync("supabase").filter((f) => /^\d/.test(f) && /insert\s+into\s+public\.sale_lines/i.test(readFileSync(join("supabase", f), "utf8")));
  check("1p. ninguna función de la base escribe líneas de venta por su cuenta", sql.length === 0, sql.join(", "));
}

// ── Part 2: DEV ──────────────────────────────────────────────────────────────
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
const REF = "vzqppwrwnmlbrxizskdh";
const BASE = process.env.QA_BASE_URL ?? "http://localhost:3000";
const hayServidor = await fetch(`${BASE}/login`, { method: "HEAD" }).then((r) => r.status < 500).catch(() => false);

if (!env.NEXT_PUBLIC_SUPABASE_URL?.includes(REF)) {
  check("2. .env.local apunta a la rama dev", false, "esta suite solo escribe en dev");
} else if (!hayServidor) {
  check("2. hay servidor en el puerto 3000", false, `corre npm run dev: ${BASE} no responde`);
} else {
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const negocios = [];

  const montar = async (country) => {
    const email = `qa-costo-${country.toLowerCase()}-${Date.now().toString(36)}@sevenz-qa.test`;
    const { data: u, error } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { business_name: `QA Costo ${country}`, country, first_name: "QA", last_name: "Costo" } });
    if (error) throw new Error(`createUser: ${error.message}`);
    const id = u.user.id;
    negocios.push(id);
    await admin.from("owners").update({ onboarding_completed_at: new Date().toISOString(), whatsapp: null }).eq("id", id);
    const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    const { data: s, error: eS } = await anon.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
    if (eS) throw new Error(`sesión: ${eS.message}`);
    const dueno = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${s.session.access_token}` } } });
    const nombre = `sb-${REF}-auth-token`;
    const valor = "base64-" + Buffer.from(JSON.stringify(s.session), "utf8").toString("base64url");
    const MAX = 3180;
    const cookie = (valor.length <= MAX ? [`${nombre}=${valor}`] : Array.from({ length: Math.ceil(valor.length / MAX) }, (_, i) => `${nombre}.${i}=${valor.slice(i * MAX, (i + 1) * MAX)}`)).join("; ");
    return { id, dueno, cookie };
  };

  // The action's id changes with every build, so it is asked of the server under test. The
  // same walk as `qa/venta-accion.mjs`, which explains each step of it.
  const idDeLaAccion = async (cookie) => {
    const res = await fetch(`${BASE}/ventas/nueva`, { headers: { Cookie: cookie } });
    if (!res.ok) throw new Error(`/ventas/nueva respondió HTTP ${res.status}`);
    const html = await res.text();
    const urls = [...new Set([...html.matchAll(/(?:src|href)="(\/_next\/[^"]+\.js)"/g)].map((m) => m[1]))];
    const vistos = new Set(urls);
    const textos = new Map();
    for (const u of [...urls]) {
      const r = await fetch(`${BASE}${u}`);
      if (!r.ok) continue;
      const t = await r.text();
      textos.set(u, t);
      for (const m of t.matchAll(/["'(]((?:\/_next\/)[^"')]+?\.js)["')]/g)) {
        if (!vistos.has(m[1]) && vistos.size < 400) { vistos.add(m[1]); urls.push(m[1]); }
      }
    }
    const re = /"([0-9a-f]{40,})"[^()]{0,200}?"registrarVenta"/;
    for (const u of urls) {
      let t = textos.get(u);
      if (t == null) { const r = await fetch(`${BASE}${u}`); if (!r.ok) continue; t = await r.text(); }
      const m = re.exec(t);
      if (m) return m[1];
    }
    throw new Error("no se encontró el id de registrarVenta");
  };

  const vender = async (accion, cookie, entrada) => {
    const res = await fetch(`${BASE}/ventas/nueva`, { method: "POST", headers: { "Next-Action": accion, "Content-Type": "text/plain;charset=UTF-8", Cookie: cookie }, body: JSON.stringify([entrada]) });
    const texto = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status} llamando a la acción`);
    const i = texto.indexOf('{"ok":');
    if (i < 0) throw new Error(`respuesta sin resultado: ${texto.slice(0, 160)}`);
    let prof = 0, enCadena = false, escapado = false;
    for (let j = i; j < texto.length; j++) {
      const c = texto[j];
      if (escapado) { escapado = false; continue; }
      if (c === "\\") { escapado = true; continue; }
      if (c === '"') { enCadena = !enCadena; continue; }
      if (enCadena) continue;
      if (c === "{") prof++;
      else if (c === "}" && --prof === 0) return JSON.parse(texto.slice(i, j + 1));
    }
    throw new Error("resultado sin cerrar");
  };

  const producto = async (ownerId, nombre, moneda, precio, costo, monedaCosto) => {
    const { data, error } = await admin.from("products").insert({
      owner_id: ownerId, name: nombre, base_currency: moneda, base_currency_retail: moneda, base_currency_wholesale: moneda,
      price_retail: precio, published_retail: true, published_wholesale: false, cost: costo, cost_currency: costo == null ? null : monedaCosto,
      cost_currency_other: monedaCosto === "OTHER" ? "pesos argentinos" : null,
    }).select("id").single();
    if (error) throw new Error(`producto: ${error.message}`);
    return data.id;
  };
  const cliente = async (ownerId) => {
    const { data, error } = await admin.from("clients").insert({ owner_id: ownerId, name: "Cliente QA Costo", whatsapp: null }).select("id").single();
    if (error) throw new Error(`cliente: ${error.message}`);
    return data.id;
  };
  const lineaDe = async (saleId) => (await admin.from("sale_lines").select("unit_cost").eq("sale_id", saleId).single()).data;
  const rango = () => ({ desde: new Date(Date.now() - 86400000), hasta: new Date(Date.now() + 86400000) });
  const gananciaProveedores = async (dueno, ownerId, productId, rates) => {
    const proveedores = await cargarProveedores({ supabase: dueno, ownerId, rango: rango(), rates });
    return proveedores.flatMap((p) => p.lista).find((x) => x.id === productId)?.ganancia ?? null;
  };
  const gananciaInventario = async (dueno, ownerId, productId, rates) => {
    const i = await cargarInventario({ supabase: dueno, ownerId, rango: rango(), rates, productId });
    return [...i.margenLista, ...i.masVendidosLista, ...i.disponiblesLista, ...i.porAgotarseLista, ...i.agotadasLista].find((x) => x.id === productId)?.ganancia ?? null;
  };

  try {
    const ve = await montar("VE");
    const accion = await idDeLaAccion(ve.cookie);
    const cli = await cliente(ve.id);
    // Only the reports use this, and a frozen cost never reaches it: that is the point.
    const rates = TASAS;

    // The flour: sold at 10 with a cost of 4, then the cost goes up to 9.
    const harina = await producto(ve.id, "QA Costo harina", "USD", 10, 4, "USD");
    const v1 = await vender(accion, ve.cookie, { clientId: cli, lineas: [{ productId: harina, quantity: 5, currency: "USD" }], pagos: [{ currency: "USD", amount: 50 }], credito: [] });
    check("2a. la venta real se registra", v1.ok === true, v1.error);
    const l1 = await lineaDe(v1.saleId);
    check("2b. la línea guarda el costo del día", Number(l1?.unit_cost) === 4, JSON.stringify(l1));
    await admin.from("products").update({ cost: 9 }).eq("id", harina);
    const gp = await gananciaProveedores(ve.dueno, ve.id, harina, rates);
    check("2c. Proveedores, como dueño: la ganancia sigue en 30 tras subir el costo", casi(gp?.amount, 30), JSON.stringify(gp));
    const gi = await gananciaInventario(ve.dueno, ve.id, harina, rates);
    check("2d. Inventario, como dueño: la ganancia sigue en 30", casi(gi?.amount, 30), JSON.stringify(gi));
    const v2 = await vender(accion, ve.cookie, { clientId: cli, lineas: [{ productId: harina, quantity: 1, currency: "USD" }], pagos: [{ currency: "USD", amount: 10 }], credito: [] });
    const l2 = await lineaDe(v2.saleId);
    check("2e. la venta siguiente ya lleva el costo nuevo", Number(l2?.unit_cost) === 9, JSON.stringify(l2));

    // Sold in euros, bought in dollars: the conversion has to be frozen too.
    const euros = await producto(ve.id, "QA Costo euros", "EUR", 20, 6, "USD");
    const v3 = await vender(accion, ve.cookie, { clientId: cli, lineas: [{ productId: euros, quantity: 1, currency: "EUR" }], pagos: [{ currency: "EUR", amount: 20 }], credito: [] });
    check("2f. venta en euros de un producto con costo en dólares", v3.ok === true, v3.error);
    const l3 = await lineaDe(v3.saleId);
    check("2g. se guarda convertido, no los 6 dólares", l3?.unit_cost != null && Number(l3.unit_cost) > 0 && Number(l3.unit_cost) !== 6, JSON.stringify(l3));

    // A product with no cost, and one in a free-text currency: nothing is invented.
    const sin = await producto(ve.id, "QA Costo sin costo", "USD", 10, null, null);
    const v4 = await vender(accion, ve.cookie, { clientId: cli, lineas: [{ productId: sin, quantity: 1, currency: "USD" }], pagos: [{ currency: "USD", amount: 10 }], credito: [] });
    check("2h. sin costo la venta se registra igual", v4.ok === true, v4.error);
    check("2i. y la línea queda vacía, no en cero", (await lineaDe(v4.saleId))?.unit_cost === null);
    const g0 = await gananciaProveedores(ve.dueno, ve.id, sin, rates);
    check("2j. sin ganancia, que la pantalla dibuja «—»", g0 === null, JSON.stringify(g0));
    await admin.from("products").update({ cost: 3, cost_currency: "USD" }).eq("id", sin);
    const g1 = await gananciaProveedores(ve.dueno, ve.id, sin, rates);
    check("2k. si después se escribe el costo, esa línea lo usa", casi(g1?.amount, 7), JSON.stringify(g1));
    const otra = await producto(ve.id, "QA Costo otra", "USD", 10, 4, "OTHER");
    const v5 = await vender(accion, ve.cookie, { clientId: cli, lineas: [{ productId: otra, quantity: 1, currency: "USD" }], pagos: [{ currency: "USD", amount: 10 }], credito: [] });
    check("2l. moneda «Otra»: no se guarda nada", v5.ok === true && (await lineaDe(v5.saleId))?.unit_cost === null, v5.error);

    // A sale on credit goes through the same insert, and so must freeze the same way.
    const v6 = await vender(accion, ve.cookie, { clientId: cli, lineas: [{ productId: harina, quantity: 1, currency: "USD" }], pagos: [], credito: [{ currency: "USD", plazoDias: 7 }] });
    check("2m. una venta fiada también lo guarda", v6.ok === true && Number((await lineaDe(v6.saleId))?.unit_cost) === 9, v6.error);

    // The returns query embeds the line: PostgREST rejects a bad embed even with no rows.
    let devoluciones = null;
    try { devoluciones = await cargarDevoluciones(ve.dueno, { ownerId: ve.id, desdeIso: rango().desde.toISOString(), hastaIso: rango().hasta.toISOString() }); } catch (e) { devoluciones = String(e); }
    check("2n. las devoluciones leen el costo de su línea, como dueño", Array.isArray(devoluciones), String(devoluciones));

    // A real return after the cost went up. With today's cost it would take back 1 and leave
    // 29; with the cost of the sale it takes back the 6 that unit left, and 24 remain.
    const devuelto = await producto(ve.id, "QA Costo devuelto", "USD", 10, 4, "USD");
    const v8 = await vender(accion, ve.cookie, { clientId: cli, lineas: [{ productId: devuelto, quantity: 5, currency: "USD" }], pagos: [{ currency: "USD", amount: 50 }], credito: [] });
    const { data: lineaDevuelta } = await admin.from("sale_lines").select("id").eq("sale_id", v8.saleId).single();
    await admin.from("products").update({ cost: 9 }).eq("id", devuelto);
    const { data: retorno, error: eRetorno } = await ve.dueno.rpc("registrar_devolucion_contado", { p_sale_id: v8.saleId, p_line_id: lineaDevuelta.id, p_quantity: 1, p_fiados: [], p_a_favor: 0, p_efectivo: 10 });
    check("2n2. la devolución real se registra", !eRetorno, eRetorno?.message ?? JSON.stringify(retorno));
    const gd = await gananciaProveedores(ve.dueno, ve.id, devuelto, rates);
    check("2n3. resta lo que esa unidad dejó, con el costo de su venta", casi(gd?.amount, 24), JSON.stringify(gd));

    // What a shop paid is not for its client to read.
    const { data: enlace } = await admin.from("share_links").insert({ client_id: cli }).select("token").single();
    const { data: publico, error: ePublico } = await anon.rpc("get_shared_balance", { p_token: enlace.token });
    const textoPublico = JSON.stringify(publico ?? "");
    check("2o. el enlace del cliente trae sus compras y ningún costo", !ePublico && textoPublico.includes("QA Costo harina") && !textoPublico.includes("unit_cost") && !/"cost/.test(textoPublico), ePublico?.message ?? textoPublico.slice(0, 200));

    // Colombia: no rates at all, one book, and `sale_lines` spells it 'COP'.
    const co = await montar("CO");
    const accionCo = await idDeLaAccion(co.cookie);
    const cliCo = await cliente(co.id);
    const arepa = await producto(co.id, "QA Costo arepa", "COP", 5000, 3000, "COP");
    const v7 = await vender(accionCo, co.cookie, { clientId: cliCo, lineas: [{ productId: arepa, quantity: 2, currency: "COP" }], pagos: [{ currency: "COP", amount: 10000 }], credito: [] });
    check("2p. Colombia: la venta se registra", v7.ok === true, v7.error);
    check("2q. Colombia: guarda el costo sin ninguna tasa", Number((await lineaDe(v7.saleId))?.unit_cost) === 3000);
    await admin.from("products").update({ cost: 4500 }).eq("id", arepa);
    const gco = await gananciaProveedores(co.dueno, co.id, arepa, null);
    check("2r. Colombia: la ganancia no se mueve al subir el costo", casi(gco?.amount, 4000), JSON.stringify(gco));

    const { count: envios } = await admin.from("whatsapp_sends").select("id", { count: "exact", head: true }).in("owner_id", negocios);
    check("2s. ningún envío de WhatsApp", envios === 0, String(envios));
  } catch (e) {
    check("2. la suite corrió entera", false, e instanceof Error ? e.message : String(e));
  } finally {
    for (const id of negocios) await admin.auth.admin.deleteUser(id);
    const { count } = await admin.from("owners").select("id", { count: "exact", head: true }).in("id", negocios.length ? negocios : ["00000000-0000-0000-0000-000000000000"]);
    check("3. limpieza: los negocios de prueba ya no existen", count === 0, String(count));
  }
}

const ok = filas.filter(Boolean).length;
console.log(`\n${ok}/${filas.length} pasan.`);
process.exit(ok === filas.length ? 0 : 1);
