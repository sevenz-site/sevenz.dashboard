// THE CLOSE OF THE MONTH: `cierre_mensual` (WhatsApp) AND THE «CIERRE DE …» CARD IN REPORTES.
//
// DEV ONLY (vzqppwrwnmlbrxizskdh). NOTHING LEAVES FOR KAPSO: this suite never sends.
//
// Part 1 is pure: `calcularCierre`, the month and Thursday helpers, and `monthlyClosePlan`, fed
// every edge the owner's decisions of 2026-11-16 name -- returns discounted, lines without a
// frozen cost out of the profit, the 80 % rule, a quiet Thursday takes it, the second Thursday
// sends it as a third message, once a month, never after the 14th.
//
// Part 2 builds a throw-away business in dev with sales on both edges of last month, a deleted
// sale and a return, reads its close through the server's function (the Thursday batch, migration
// 213: in production the service key cannot read those tables) AND AS THE OWNER
// (the Reportes card, under RLS): CLAUDE.md asks any suite over tables the owner reads to read
// as him at least once, because the service key sees through a missing grant. Removed at the end.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { PLANTILLAS_ESPERADAS, problemaDelBoton } from "./plantillas-esperadas.mjs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
if (!env.NEXT_PUBLIC_SUPABASE_URL?.includes("vzqppwrwnmlbrxizskdh")) {
  console.error("ME NIEGO A CORRER: .env.local no apunta a la rama dev.");
  process.exit(1);
}
for (const [k, v] of Object.entries(env)) process.env[k] ??= v;

const filas = [];
const check = (nombre, pasa, detalle = "") => {
  filas.push(pasa);
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${detalle ? `  — ${detalle}` : ""}`);
};

const C = await import("../lib/reports/cierre-del-mes.ts");
const { monthlyClosePlan, thursdayPlan } = await import("../lib/whatsapp/business-weekly-text.ts");

// ── 1. PURE ───────────────────────────────────────────────────────────────
const oct = C.mesAnteriorA(2026, 11, "VE");
check("1a. el mes anterior a noviembre es octubre, de medianoche a medianoche en Caracas",
  oct.monthName === "octubre" && oct.desdeUtc === "2026-10-01T04:00:00.000Z" && oct.hastaExclusivoUtc === "2026-11-01T04:00:00.000Z",
  `${oct.monthName} ${oct.desdeUtc} → ${oct.hastaExclusivoUtc}`);
const dic = C.mesAnteriorA(2026, 1, "CO");
check("1b. enero cierra diciembre del año anterior, en hora de Bogotá",
  dic.monthName === "diciembre" && dic.year === 2025 && dic.desdeUtc === "2025-12-01T05:00:00.000Z", `${dic.year} ${dic.desdeUtc}`);
// 2026-12-01 02:00 UTC is still 30 November at 22:00 in Caracas.
check("1c. a las 22:00 del 30 en Caracas todavía es noviembre: el último cerrado es octubre",
  C.ultimoMesCerrado(new Date("2026-12-01T02:00:00Z"), "VE").monthName === "octubre");
const th = C.juevesDeLaSemana(new Date("2026-12-06T15:00:00Z"), "VE");
check("1d. el jueves de la semana del domingo 6 de diciembre es el 3", th.month === 12 && th.day === 3, `${th.month}/${th.day}`);

const L = (saleId, currency, quantity, unitPrice, unitCost) => ({ saleId, currency, quantity, unitPrice, unitCost });
const R = (currency, quantity, unitPrice, amount, unitCost) => ({ currency, quantity, unitPrice, amount, unitCost });
const dos = C.calcularCierre(oct, "VE",
  [L("s1", "USD", 2, 10, 6), L("s1", "USD", 1, 5, 1), L("s2", "EUR", 3, 4, 1), L("s3", "USD", 1, 100, 60), L("s3", "COP", 1, 999, 1)],
  [R("USD", 1, 10, 10, 6)]);
check("2a. dos monedas, sin sumarse: $ y € cada uno con sus ventas",
  dos.libros.USD.ventas === 2 && dos.libros.EUR.ventas === 1 && dos.libros.COP === undefined,
  JSON.stringify(dos.libros));
check("2b. vendido descuenta lo devuelto: $ 20 + 5 + 100 − 10 = 115", dos.libros.USD.vendido === 115, String(dos.libros.USD.vendido));
check("2c. la ganancia descuenta la del producto devuelto: 8 + 4 + 40 − 4 = 48", dos.libros.USD.ganancia === 48, String(dos.libros.USD.ganancia));
check("2d. una línea en pesos de un negocio venezolano no entra en nada", dos.lineas === 4, String(dos.lineas));

const sinCosto = C.calcularCierre(oct, "VE", [L("a", "USD", 1, 10, 6), L("a", "USD", 1, 10, null), L("b", "USD", 1, 10, 5), L("c", "USD", 1, 10, 5), L("d", "USD", 1, 10, 5)], []);
check("3a. una línea sin costo guardado no entra en la ganancia, aunque el producto tenga costo hoy",
  sinCosto.libros.USD.ganancia === 4 + 5 + 5 + 5 && sinCosto.lineasSinCosto === 1, `${sinCosto.libros.USD.ganancia} · ${sinCosto.lineasSinCosto}`);
check("3b. 4 de 5 con costo es el 80 %: completo", sinCosto.completo === true);
const poco = C.calcularCierre(oct, "VE", [L("a", "USD", 1, 10, 6), L("a", "USD", 1, 10, null), L("b", "USD", 1, 10, null)], []);
check("3c. 1 de 3 con costo: incompleto", poco.completo === false);
check("3d. sin ventas: cero líneas e incompleto", C.calcularCierre(oct, "VE", [], []).completo === false);
const perdida = C.calcularCierre(oct, "VE", [L("a", "USD", 1, 10, 22.5)], []);
check("3e. vender por debajo del costo da ganancia negativa", perdida.libros.USD.ganancia === -12.5, String(perdida.libros.USD.ganancia));
const co = C.calcularCierre(oct, "CO", [L("a", "COP", 2, 5000, 3000)], [R("COP", 1, 5000, 5000, 3000)]);
const soloUsdConCosto = C.calcularCierre(oct, "VE",
  [L("a", "USD", 1, 10, 6), L("b", "USD", 1, 10, 6), L("c", "USD", 1, 10, 6), L("d", "USD", 1, 10, 6), L("e", "EUR", 1, 10, null)], []);
check("3g. un libro sin ninguna línea con costo: ganancia desconocida (conCosto 0), no cero",
  soloUsdConCosto.libros.EUR.conCosto === 0 && soloUsdConCosto.libros.USD.conCosto === 4 && soloUsdConCosto.completo,
  JSON.stringify(soloUsdConCosto.libros));
check("3f. Colombia: pesos, con su devolución", co.libros.COP.vendido === 5000 && co.libros.COP.ganancia === 2000, JSON.stringify(co.libros.COP));

// The plan.
const base = (o = {}) => ({
  owner_id: "x", whatsapp: "584140000000", first_name: "Rosa", business_name: "Bodega QA", country: "VE",
  paused: false, is_test: false, ledgers: {}, overdue_clients: 0, sales: {}, out_of_stock: 0, low_stock: 0,
  open_orders: 0, new_overdue_clients: null, new_attention_items: 0, monday_used: false, thursday_used: false, phone_slots_used: 0, ...o,
});
const libro = (due, oc = 0, oa = 0) => ({ due, overdue_count: oc, overdue_amount: oa, soon_count: 0, soon_amount: 0 });
const listo = C.calcularCierre(oct, "VE", [L("s1", "USD", 2, 170, 110), L("s2", "USD", 3, 0, 0), L("s3", "EUR", 3, 50 / 3, 45 / 9)], []);
const ctx = (o = {}) => ({ thursdayDay: 3, alreadySent: false, cierre: listo, ...o });
const callado = base();
const conDeudores = base({ ledgers: { USD: libro(50, 1, 50) } });

const p1 = monthlyClosePlan(callado, thursdayPlan(callado), ctx());
check("4a. jueves callado, día 3: sale en la cita del jueves, no como tercero",
  p1.template === "cierre_mensual" && p1.extraordinary === false, p1.template ?? p1.skip);
const nombres = p1.params?.map((p) => p.nombre) ?? [];
check("4b. cinco variables en el orden que aprobó Meta, y sin componente de botón",
  JSON.stringify(nombres) === JSON.stringify(PLANTILLAS_ESPERADAS.cierre_mensual.cuerpo) && problemaDelBoton("cierre_mensual", undefined) === null,
  nombres.join(", "));
const val = (plan, n) => plan.params?.find((p) => p.nombre === n)?.texto;
check("4c. textos: mes, ventas y ganancia por moneda, líneas sin costo",
  val(p1, "month_name") === "octubre" && val(p1, "sales_summary") === "2 ventas por $340,00 y 1 venta por €50,00"
    && val(p1, "profit_summary") === "$120,00 y €35,00" && val(p1, "lines_without_cost") === "0",
  `${val(p1, "sales_summary")} · ${val(p1, "profit_summary")}`);
const pierde = monthlyClosePlan(callado, thursdayPlan(callado), ctx({ cierre: perdida }));
const sinEuroDeCosto = monthlyClosePlan(callado, thursdayPlan(callado), ctx({ cierre: soloUsdConCosto }));
check("4e. ese libro sale en ventas pero no en la ganancia: nada de «€0,00»",
  val(sinEuroDeCosto, "sales_summary") === "4 ventas por $40,00 y 1 venta por €10,00" && val(sinEuroDeCosto, "profit_summary") === "$16,00",
  `${val(sinEuroDeCosto, "sales_summary")} · ${val(sinEuroDeCosto, "profit_summary")}`);
check("4d. una pérdida conserva el signo delante del símbolo", val(pierde, "profit_summary") === "-$12,50", val(pierde, "profit_summary"));

const conDeudoresPlan = thursdayPlan(conDeudores);
check("5a. primer jueves (día 3) con deudores: espera al siguiente",
  monthlyClosePlan(conDeudores, conDeudoresPlan, ctx()).skip === "esperando_jueves_callado");
const tercero = monthlyClosePlan(conDeudores, conDeudoresPlan, ctx({ thursdayDay: 10 }));
check("5b. segundo jueves (día 10) con deudores: sale como TERCER mensaje, y el aviso de cobros sigue",
  tercero.template === "cierre_mensual" && tercero.extraordinary === true && conDeudoresPlan.template === "atencion_cobros",
  `${tercero.template} extraordinario=${tercero.extraordinary} · ${conDeudoresPlan.template}`);
check("5c. segundo jueves callado: va en la cita, no como tercero",
  monthlyClosePlan(callado, thursdayPlan(callado), ctx({ thursdayDay: 10 })).extraordinary === false);
check("5d. jueves callado pero el teléfono ya lleva dos: el primero espera",
  monthlyClosePlan(base({ phone_slots_used: 2 }), thursdayPlan(base({ phone_slots_used: 2 })), ctx()).skip === "esperando_jueves_callado");
check("5e. y el segundo lo manda como tercero",
  monthlyClosePlan(base({ phone_slots_used: 2 }), thursdayPlan(base({ phone_slots_used: 2 })), ctx({ thursdayDay: 12 })).extraordinary === true);
check("5f. un jueves del 15 en adelante no lo manda nunca", monthlyClosePlan(callado, thursdayPlan(callado), ctx({ thursdayDay: 15 })).skip === "fuera_de_ventana");
check("5g. una vez al mes", monthlyClosePlan(callado, thursdayPlan(callado), ctx({ alreadySent: true })).skip === "cierre_enviado");
check("5h. menos del 80 % con costo: no sale", monthlyClosePlan(callado, thursdayPlan(callado), ctx({ cierre: poco })).skip === "costos_incompletos");
check("5i. sin ventas en el mes: no sale", monthlyClosePlan(callado, thursdayPlan(callado), ctx({ cierre: C.calcularCierre(oct, "VE", [], []) })).skip === "sin_ventas_mes");
check("5j. pausada o de prueba: no sale",
  monthlyClosePlan(base({ paused: true }), { skip: "pausado" }, ctx()).skip === "pausado"
    && monthlyClosePlan(base({ is_test: true }), { skip: "cuenta_de_prueba" }, ctx()).skip === "cuenta_de_prueba");

// ── 2. AGAINST THE DATABASE ───────────────────────────────────────────────
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const tag = Math.random().toString(36).slice(2, 8);
let owner = null;
let client = null;
const ventas = [];
const devoluciones = [];

async function comoDueno(ownerId) {
  const { data: u, error: eU } = await admin.auth.admin.getUserById(ownerId);
  if (eU) throw new Error(`getUserById: ${eU.message}`);
  const { data: link, error: eL } = await admin.auth.admin.generateLink({ type: "magiclink", email: u.user.email });
  if (eL) throw new Error(`generateLink: ${eL.message}`);
  const { data: s, error: eV } = await anon.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  if (eV) throw new Error(`verifyOtp: ${eV.message}`);
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${s.session.access_token}` } },
  });
}
async function venta(createdAt, lineas, borrada = false) {
  const { data: s, error } = await admin.from("sales").insert({
    owner_id: owner, client_id: client, created_at: createdAt, deleted_at: borrada ? new Date().toISOString() : null,
  }).select("id").single();
  if (error) throw new Error(`sales: ${error.message}`);
  ventas.push(s.id);
  const ids = [];
  for (const [q, p, c, cost] of lineas) {
    const { data: l, error: e } = await admin.from("sale_lines")
      .insert({ sale_id: s.id, name: "ZZ QA cierre", quantity: q, unit_price: p, currency: c, unit_cost: cost }).select("id").single();
    if (e) throw new Error(`sale_lines: ${e.message}`);
    ids.push(l.id);
  }
  return { saleId: s.id, lineIds: ids };
}

try {
  const { data: u, error: eU } = await admin.auth.admin.createUser({
    email: `zz-cierre-mensual-${tag}@example.com`, email_confirm: true,
    user_metadata: { business_name: "ZZ QA cierre", first_name: "Rosa", last_name: "QA", country: "VE", whatsapp: "584140000001" },
  });
  if (eU) throw new Error(`createUser: ${eU.message}`);
  owner = u.user.id;
  await admin.from("owners").update({ country: "VE" }).eq("id", owner);
  const { data: c, error: eC } = await admin.from("clients").insert({ owner_id: owner, name: "ZZ QA cierre cliente" }).select("id").single();
  if (eC) throw new Error(`clients: ${eC.message}`);
  client = c.id;

  const mes = C.ultimoMesCerrado(new Date(), "VE");
  const dentro = new Date(new Date(mes.desdeUtc).getTime() + 10 * 86400000).toISOString();
  // On the edges: the first instant of the month counts; the first of the next does not.
  const a = await venta(mes.desdeUtc, [[2, 10, "USD", 6], [1, 5, "USD", null]]);
  await venta(dentro, [[3, 4, "EUR", 1]]);
  await venta(mes.hastaExclusivoUtc, [[1, 1000, "USD", 1]]);
  await venta(dentro, [[1, 1000, "USD", 1]], true);
  await venta(new Date(new Date(mes.desdeUtc).getTime() - 1000).toISOString(), [[1, 1000, "USD", 1]]);
  // One unit of the $10 line comes back, in the month, money back at the till.
  const { data: dv, error: eD } = await admin.from("sale_returns").insert({
    owner_id: owner, client_id: client, sale_id: a.saleId, sale_line_id: a.lineIds[0], product_name: "ZZ QA cierre",
    quantity: 1, unit_price: 10, amount: 10, currency: "USD", to_cash: 10, created_at: dentro,
  }).select("id").single();
  if (eD) throw new Error(`sale_returns: ${eD.message}`);
  devoluciones.push(dv.id);

  // THE SERVER'S PATH, the one the Thursday batch runs: `whatsapp_monthly_close_rows`. Before
  // migration 213 this line read the tables with the service key, which passes in dev and is
  // refused in production; the suite was green while the send could not have worked there.
  const servicio = await C.cargarCierreDelMesServidor(admin, owner, "VE", mes);
  check("6a. por la función del servidor (213): 1 venta en $ y 1 en € (la borrada y las de fuera del mes no cuentan)",
    servicio.libros.USD?.ventas === 1 && servicio.libros.EUR?.ventas === 1, JSON.stringify(servicio.libros));
  check("6b. $ vendido 20 + 5 − 10 = 15; ganancia 8 − 4 = 4", servicio.libros.USD?.vendido === 15 && servicio.libros.USD?.ganancia === 4,
    `${servicio.libros.USD?.vendido} · ${servicio.libros.USD?.ganancia}`);
  check("6c. 3 líneas, 1 sin costo: 67 %, incompleto", servicio.lineas === 3 && servicio.lineasSinCosto === 1 && !servicio.completo,
    `${servicio.lineas} · ${servicio.lineasSinCosto} · ${servicio.completo}`);

  const dueno = await comoDueno(owner);
  const comoEl = await C.cargarCierreDelMes(dueno, owner, "VE", mes);
  check("6d. COMO EL DUEÑO (la tarjeta de Reportes): lo mismo que el servidor, nada filtrado por RLS",
    JSON.stringify(comoEl) === JSON.stringify(servicio), JSON.stringify(comoEl.libros));

  const otro = await C.cargarCierreDelMes(dueno, "00000000-0000-0000-0000-000000000000", "VE", mes);
  check("6e. y como el dueño, el negocio de otro no le devuelve nada", otro.lineas === 0 && Object.keys(otro.libros).length === 0);

  // 213 IS FOR THE SERVER ONLY. An owner calling it could read any business's sales by id.
  const robo = await dueno.rpc("whatsapp_monthly_close_rows", { p_owner_id: owner, p_from: mes.desdeUtc, p_to: mes.hastaExclusivoUtc });
  check("6f. el dueño NO puede llamar a la función del servidor", robo.error != null && robo.data == null, robo.error?.code ?? "sin error");
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const sinSesion = await anon.rpc("whatsapp_monthly_closes_sent", { p_since: mes.desdeUtc });
  check("6g. ni un visitante sin cuenta, la de cierres enviados", sinSesion.error != null && sinSesion.data == null, sinSesion.error?.code ?? "sin error");

  // THE «ALREADY SENT» READ, same function the batch uses: a send on its way counts, a failed
  // one does not (the next run retries it).
  const { data: envio, error: eW } = await admin.from("whatsapp_sends")
    .insert({ owner_id: owner, template: "cierre_mensual", period_key: "qa-213", ok: null }).select("id").single();
  if (eW) throw new Error(`whatsapp_sends: ${eW.message}`);
  const haceUnaHora = new Date(Date.now() - 3600_000).toISOString();
  const enviados = await admin.rpc("whatsapp_monthly_closes_sent", { p_since: haceUnaHora });
  check("6h. un cierre en camino cuenta como enviado",
    !enviados.error && (enviados.data ?? []).some((r) => r.owner_id === owner), enviados.error?.message ?? "");
  await admin.from("whatsapp_sends").update({ ok: false }).eq("id", envio.id);
  const trasFallar = await admin.rpc("whatsapp_monthly_closes_sent", { p_since: haceUnaHora });
  check("6i. uno fallido no cuenta: el siguiente jueves lo reintenta",
    !trasFallar.error && !(trasFallar.data ?? []).some((r) => r.owner_id === owner), trasFallar.error?.message ?? "");
} catch (e) {
  check("la prueba corrió entera", false, e instanceof Error ? e.message : String(e));
} finally {
  if (devoluciones.length) await admin.from("sale_returns").delete().in("id", devoluciones);
  if (ventas.length) {
    await admin.from("sale_lines").delete().in("sale_id", ventas);
    await admin.from("sales").delete().in("id", ventas);
  }
  if (client) await admin.from("clients").delete().eq("id", client);
  if (owner) await admin.auth.admin.deleteUser(owner);
  const { count } = owner ? await admin.from("sales").select("id", { count: "exact", head: true }).eq("owner_id", owner) : { count: 0 };
  check("7. limpieza: no queda nada de la prueba en dev", (count ?? 0) === 0, String(count));
}

const fallos = filas.filter((x) => !x).length;
console.log(`\n${fallos} FALLO(S) de ${filas.length}`);
process.exit(fallos ? 1 : 0);
