// THE BUSINESS FAMILY ON MONDAY AND THURSDAY: WHAT EACH MESSAGE SAYS, AND TO WHOM.
//
// DEV ONLY (vzqppwrwnmlbrxizskdh). Needs migration 205 in dev. NOTHING LEAVES FOR KAPSO: this
// suite never sends; the whole batch, with Kapso intercepted, is `qa:whatsapp-plantillas`.
//
// Part 1 is pure: `mondayPlan` and `thursdayPlan` fed every edge the owner's rules name --
// both currencies, one currency, zero, singular, paused, test account, slot taken, phone cap,
// «clientes nuevos». Part 2 builds two throw-away businesses sharing one phone, reads
// `whatsapp_business_weekly_targets` and checks every figure against what was written, AND
// against the judge the client chips use (`getClientStatus` on `client_summary`), so the
// message cannot say «vencido» about a book the owner's screen calls «dentro del plazo».
// Everything it writes is removed at the end.
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

const { mondayPlan, thursdayPlan, PHONE_WEEKLY_CAP } = await import("../lib/whatsapp/business-weekly-text.ts");
const { claveSemanal } = await import("../lib/whatsapp/send.ts");
const { getClientStatus } = await import("../lib/types.ts");

const param = (plan, nombre) => plan.params?.find((p) => p.nombre === nombre)?.texto;

// A template's parameters, by name and in order, against what Meta approved.
function nombresEnOrden(plan) {
  const esperado = PLANTILLAS_ESPERADAS[plan.template]?.cuerpo ?? [];
  const visto = plan.params.map((p) => p.nombre);
  return esperado.length === visto.length && esperado.every((n, i) => n === visto[i]);
}

// ── 1. PURE ───────────────────────────────────────────────────────────────
const base = (o = {}) => ({
  owner_id: "x", whatsapp: "584140000000", first_name: "Rosa", business_name: "Bodega QA", country: "VE",
  paused: false, is_test: false, ledgers: {}, overdue_clients: 0, sales: {}, out_of_stock: 0, low_stock: 0,
  open_orders: 0, new_overdue_clients: null, new_attention_items: 0, monday_used: false, thursday_used: false, phone_slots_used: 0, ...o,
});
const libro = (due, oc = 0, oa = 0, sc = 0, sa = 0) =>
  ({ due, overdue_count: oc, overdue_amount: oa, soon_count: sc, soon_amount: sa });

{
  const t = base({
    ledgers: { USD: libro(1000, 3, 120, 1, 50), EUR: libro(200, 1, 30) },
    overdue_clients: 3,
    sales: { USD: { count: 5, amount: 340 }, EUR: { count: 3, amount: 50 } },
  });
  const p = mondayPlan(t);
  check("1a. lunes con deuda: negocio_resumen", p.template === "negocio_resumen", p.template ?? p.skip);
  check("1b. sus cuatro parámetros, con sus nombres y en orden", nombresEnOrden(p));
  check("1c. por cobrar, cada libro por su lado", param(p, "amount_due") === "$1.000,00 y €200,00", param(p, "amount_due"));
  check("1d. vencidos, cada cantidad pegada a su moneda (el ejemplo de CLAUDE.md)",
    param(p, "overdue_summary") === "3 clientes por $120,00 y 1 cliente por €30,00", param(p, "overdue_summary"));
  check("1e. ventas por moneda (el ejemplo de CLAUDE.md)",
    param(p, "sales_summary") === "5 ventas por $340,00 y 3 ventas por €50,00", param(p, "sales_summary"));
  check("1f. el lunes nunca dice «clientes nuevos»",
    !param(mondayPlan({ ...t, new_overdue_clients: 4 }), "overdue_summary").includes("nuevo"));
  check("1g. ningún parámetro vacío ni con salto de línea",
    p.params.every((x) => x.texto && !/[\r\n\t]/.test(x.texto)));
  check("1h. no se manda componente de botón, y su plantilla declara uno fijo",
    problemaDelBoton("negocio_resumen", undefined) === null);
}
{
  const p = mondayPlan(base({ ledgers: { USD: libro(120, 1, 120) }, overdue_clients: 1, sales: { USD: { count: 1, amount: 9.5 } } }));
  check("2a. una moneda en cero no se escribe", param(p, "amount_due") === "$120,00", param(p, "amount_due"));
  check("2b. singular bien escrito", param(p, "overdue_summary") === "1 cliente por $120,00" && param(p, "sales_summary") === "1 venta por $9,50",
    `${param(p, "overdue_summary")} · ${param(p, "sales_summary")}`);
  const q = mondayPlan(base({ ledgers: { EUR: libro(80) } }));
  check("2c. sin vencidos ni ventas: «0 clientes» y «0 ventas»",
    param(q, "overdue_summary") === "0 clientes" && param(q, "sales_summary") === "0 ventas" && param(q, "amount_due") === "€80,00",
    `${param(q, "overdue_summary")} · ${param(q, "sales_summary")} · ${param(q, "amount_due")}`);
}
{
  const co = mondayPlan(base({ country: "CO", ledgers: { COP: libro(150000, 2, 90000) }, overdue_clients: 2 }));
  check("3a. un negocio colombiano escribe pesos", co.template === "negocio_resumen" && /150\.000/.test(param(co, "amount_due")) && /^2 clientes por .*90\.000/.test(param(co, "overdue_summary")),
    `${param(co, "amount_due")} · ${param(co, "overdue_summary")}`);
  const ve = mondayPlan(base({ ledgers: { COP: libro(500, 1, 500) } }));
  check("3b. un libro de pesos en un negocio venezolano no se cuenta", ve.template === "cartera_summary_v2", ve.template);
}
{
  const pausado = mondayPlan(base({ paused: true, ledgers: { USD: libro(50, 1, 50) }, overdue_clients: 1 }));
  check("4a. el pausado recibe cartera_pausada, con owner_name", pausado.template === "cartera_pausada" && nombresEnOrden(pausado), pausado.template);
  check("4b. y el jueves nada", thursdayPlan(base({ paused: true, ledgers: { USD: libro(50, 1, 50) } })).skip === "pausado");
  const vacio = mondayPlan(base());
  check("4c. sin nada por cobrar, el lunes de antes: cartera_summary_v2 con customer_name y $0,00",
    vacio.template === "cartera_summary_v2" && nombresEnOrden(vacio) && param(vacio, "amount_due") === "$0,00", vacio.template);
  const prueba = mondayPlan(base({ is_test: true, ledgers: { USD: libro(50) } }));
  check("4d. una cuenta de prueba no recibe la familia", prueba.template === "cartera_summary_v2", prueba.template);
  check("4e. ni el jueves", thursdayPlan(base({ is_test: true, ledgers: { USD: libro(50, 1, 50) } })).skip === "cuenta_de_prueba");
  const sinNombre = mondayPlan(base({ first_name: null, business_name: null, ledgers: { USD: libro(5) } }));
  check("4f. sin nombre ni negocio, «hola» y no un saludo vacío", param(sinNombre, "owner_name") === "hola", param(sinNombre, "owner_name"));
}
{
  const t = base({ ledgers: { USD: libro(100, 1, 100) } });
  check("5a. cita del lunes ya usada: no sale otra plantilla", mondayPlan({ ...t, monday_used: true }).skip === "cita_usada");
  check("5b. cita del jueves ya usada", thursdayPlan({ ...t, thursday_used: true }).skip === "cita_usada");
  check(`5c. el tope es ${PHONE_WEEKLY_CAP} por teléfono: con dos ya enviados no sale el lunes`, mondayPlan({ ...t, phone_slots_used: 2 }).skip === "tope_telefono");
  check("5d. y cuenta lo que esta misma tanda ya mandó a ese número", thursdayPlan({ ...t, phone_slots_used: 1 }, 1).skip === "tope_telefono");
  check("5e. con uno, el segundo sí sale", thursdayPlan({ ...t, phone_slots_used: 1 }).template === "atencion_cobros");
}
{
  const cobros = thursdayPlan(base({ ledgers: { USD: libro(170, 2, 120, 1, 50), EUR: libro(30, 1, 30) } }));
  check("6a. jueves con deudores y sin inventario ni pedidos: atencion_cobros", cobros.template === "atencion_cobros" && nombresEnOrden(cobros), cobros.template);
  check("6b. por vencer, por moneda", param(cobros, "due_summary") === "1 cliente por $50,00", param(cobros, "due_summary"));
  const negocio = thursdayPlan(base({ ledgers: { USD: libro(50, 0, 0, 1, 50) }, out_of_stock: 2, low_stock: 0, open_orders: 1, new_attention_items: 1 }));
  check("6c. con productos o pedidos: atencion_negocio, seis parámetros en orden", negocio.template === "atencion_negocio" && nombresEnOrden(negocio), negocio.template);
  check("6d. solo por vencer, sin vencidos: sale igual, con «0 clientes» en vencidos",
    param(negocio, "overdue_summary") === "0 clientes" && param(negocio, "out_of_stock") === "2" && param(negocio, "low_stock") === "0",
    `${param(negocio, "overdue_summary")} · ${param(negocio, "out_of_stock")} · ${param(negocio, "low_stock")}`);
  check("6e. sin deudores pero con productos: no sale (atencion_productos no está aprobada)",
    thursdayPlan(base({ ledgers: { USD: libro(50) }, out_of_stock: 3 })).skip === "sin_cobros");
  check("6f. un saldo a favor o cero no es un deudor", thursdayPlan(base()).skip === "sin_cobros");
  // Migration 206, owner's decision of 2026-11-14: products and orders only when something is new.
  const sinNada = thursdayPlan(base({ ledgers: { USD: libro(50, 1, 50) }, out_of_stock: 3, low_stock: 1, open_orders: 2, new_attention_items: 0 }));
  check("6g. hay agotados y pedidos pero nada nuevo desde el jueves: atencion_cobros, sin esas líneas",
    sinNada.template === "atencion_cobros" && param(sinNada, "out_of_stock") === undefined, sinNada.template);
  const conUno = thursdayPlan(base({ ledgers: { USD: libro(50, 1, 50) }, out_of_stock: 4, low_stock: 1, open_orders: 2, new_attention_items: 1 }));
  check("6h. con UNA cosa nueva salen las líneas, con los totales de hoy y no solo lo nuevo",
    conUno.template === "atencion_negocio" && param(conUno, "out_of_stock") === "4" && param(conUno, "open_orders") === "2",
    `${conUno.template} · ${param(conUno, "out_of_stock")} · ${param(conUno, "open_orders")}`);
}
{
  const t = base({ ledgers: { USD: libro(100, 2, 100) } });
  check("7a. «(2 clientes nuevos esta semana)»", param(thursdayPlan({ ...t, new_overdue_clients: 2 }), "overdue_summary") === "2 clientes por $100,00 (2 clientes nuevos esta semana)",
    param(thursdayPlan({ ...t, new_overdue_clients: 2 }), "overdue_summary"));
  check("7b. singular: «(1 cliente nuevo esta semana)»", param(thursdayPlan({ ...t, new_overdue_clients: 1 }), "overdue_summary").endsWith("(1 cliente nuevo esta semana)"));
  check("7c. cero nuevos: nada", param(thursdayPlan({ ...t, new_overdue_clients: 0 }), "overdue_summary") === "2 clientes por $100,00");
  check("7d. sin jueves anterior (null): nada", param(thursdayPlan(t), "overdue_summary") === "2 clientes por $100,00");
}

// ── 2. AGAINST THE DATABASE ───────────────────────────────────────────────
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });

const tag = Math.random().toString(36).slice(2, 8);
const telefono = `58414${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
const usuarios = [];
const clientes = [];
const ventas = [];
const productos = [];
const pedidos = [];
const dias = (n) => new Date(Date.now() - n * 86400000).toISOString();
const periodo = claveSemanal();
const siguiente = claveSemanal(new Date(Date.now() + 7 * 86400000));

async function negocio(nombre) {
  const { data, error } = await admin.auth.admin.createUser({
    email: `zz-negocio-semanal-${tag}-${nombre}@example.com`, email_confirm: true,
    user_metadata: { business_name: `ZZ QA semanal ${nombre}`, first_name: "Rosa", last_name: "QA", country: "VE", whatsapp: telefono },
  });
  if (error) throw new Error(`createUser: ${error.message}`);
  usuarios.push(data.user.id);
  await admin.from("owners").update({ country: "VE", whatsapp: telefono, whatsapp_opt_in_at: new Date().toISOString(), whatsapp_opt_out_at: null }).eq("id", data.user.id);
  return data.user.id;
}
async function cliente(owner, nombre) {
  const { data, error } = await admin.from("clients").insert({ owner_id: owner, name: `ZZ QA semanal ${nombre}` }).select("id").single();
  if (error) throw new Error(`clients: ${error.message}`);
  clientes.push(data.id);
  return data.id;
}
async function mov(client, o) {
  const { error } = await admin.from("movements").insert({ client_id: client, source: "manual", description: "ZZ QA semanal", ...o });
  if (error) throw new Error(`movements: ${error.message}`);
  await admin.rpc("recalc_client_running_balance", { p_client_id: client });
}
async function filaDe(owner, p = periodo, prev = claveSemanal(new Date(Date.now() - 7 * 86400000))) {
  const { data, error } = await admin.rpc("whatsapp_business_weekly_targets", { p_period: p, p_prev_period: prev });
  if (error) throw new Error(`targets: ${error.message}`);
  return data.find((r) => r.owner_id === owner);
}

try {
  const A = await negocio("a");
  const B = await negocio("b");

  // Five clients, each one edge:
  //   ana   overdue in BOTH books (USD 100, EUR 30)    → counts once in each
  //   beto  USD 50 due in 3 days                        → por vencer
  //   caro  USD 40 due in 29 days                       → neither
  //   dani  USD 20 with no plazo                        → neither: no plazo, no «plazo vencido»
  //   eva   USD 60 overdue, paid 10                     → overdue, whole book balance 50
  const ana = await cliente(A, "ana");
  await mov(ana, { type: "charge", amount: 100, currency: "USD", plazo_dias: 10, created_at: dias(20) });
  await mov(ana, { type: "charge", amount: 30, currency: "EUR", plazo_dias: 5, created_at: dias(10) });
  const beto = await cliente(A, "beto");
  await mov(beto, { type: "charge", amount: 50, currency: "USD", plazo_dias: 10, created_at: dias(7) });
  const caro = await cliente(A, "caro");
  await mov(caro, { type: "charge", amount: 40, currency: "USD", plazo_dias: 30, created_at: dias(1) });
  const dani = await cliente(A, "dani");
  await mov(dani, { type: "charge", amount: 20, currency: "USD", created_at: dias(3) });
  const eva = await cliente(A, "eva");
  await mov(eva, { type: "charge", amount: 60, currency: "USD", plazo_dias: 10, created_at: dias(20) });
  await mov(eva, { type: "payment", amount: 10, currency: "USD", created_at: dias(5) });

  // Sales: one in two currencies inside the 7 days, one outside, one deleted.
  for (const [creada, lineas, borrada] of [
    [dias(2), [[2, 5, "USD"], [1, 3.5, "USD"], [1, 4, "EUR"]], false],
    [dias(9), [[1, 99, "USD"]], false],
    [dias(1), [[1, 77, "USD"]], true],
  ]) {
    const { data: s, error } = await admin.from("sales").insert({ owner_id: A, client_id: caro, created_at: creada, deleted_at: borrada ? new Date().toISOString() : null }).select("id").single();
    if (error) throw new Error(`sales: ${error.message}`);
    ventas.push(s.id);
    for (const [q, p, c] of lineas) {
      const { error: e } = await admin.from("sale_lines").insert({ sale_id: s.id, name: "ZZ QA", quantity: q, unit_price: p, currency: c });
      if (e) throw new Error(`sale_lines: ${e.message}`);
    }
  }

  // Products with the default threshold of 5: out, low, fine, uncounted, and an out one in the bin.
  for (const [stock, papelera] of [[0, false], [2, false], [50, false], [null, false], [0, true]]) {
    const { data: p, error } = await admin.from("products").insert({
      owner_id: A, name: `ZZ QA ${stock}`, base_currency: "USD", price_retail: 1, stock_opening: stock,
      trashed_at: papelera ? new Date().toISOString() : null,
    }).select("id").single();
    if (error) throw new Error(`products: ${error.message}`);
    productos.push(p.id);
  }
  // Orders: one open, one registered, one discarded.
  for (const status of ["new", "registered", "discarded"]) {
    const { data: o, error } = await admin.from("catalog_orders").insert({
      owner_id: A, customer_name: "ZZ QA", customer_document: "1234567", customer_whatsapp: "584121112233", customer_whatsapp_raw: "04121112233", status,
    }).select("id").single();
    if (error) throw new Error(`catalog_orders: ${error.message}`);
    pedidos.push(o.id);
  }

  const r = await filaDe(A);
  check("10. el negocio desechable está en la lista", Boolean(r));
  const usd = r.ledgers.USD ?? {};
  const eur = r.ledgers.EUR ?? {};
  check("11a. por cobrar en dólares: 100+50+40+20+50", Number(usd.due) === 260, String(usd.due));
  check("11b. y en euros, por su lado", Number(eur.due) === 30, String(eur.due));
  check("11c. vencidos en dólares: ana y eva, con TODO lo que deben (100 + 50)", Number(usd.overdue_count) === 2 && Number(usd.overdue_amount) === 150,
    `${usd.overdue_count} por ${usd.overdue_amount}`);
  check("11d. ana cuenta también en euros («En las dos monedas»)", Number(eur.overdue_count) === 1 && Number(eur.overdue_amount) === 30,
    `${eur.overdue_count} por ${eur.overdue_amount}`);
  check("11e. por vencer en 7 días: solo beto (caro vence en 29, dani no tiene plazo)", Number(usd.soon_count) === 1 && Number(usd.soon_amount) === 50,
    `${usd.soon_count} por ${usd.soon_amount}`);
  check("11f. clientes vencidos distintos, para las plantillas de antes: 2, no 3", Number(r.overdue_clients) === 2, String(r.overdue_clients));
  check("12. ventas de 7 días: la de dos monedas cuenta en las dos; la vieja y la borrada no",
    Number(r.sales.USD?.count) === 1 && Number(r.sales.USD?.amount) === 13.5 && Number(r.sales.EUR?.count) === 1 && Number(r.sales.EUR?.amount) === 4,
    JSON.stringify(r.sales));
  check("13. agotados 1, por agotarse 1 (sin contar ni papelera)", Number(r.out_of_stock) === 1 && Number(r.low_stock) === 1, `${r.out_of_stock} · ${r.low_stock}`);
  check("14. pedidos sin atender: solo el nuevo", Number(r.open_orders) === 1, String(r.open_orders));
  check("15. sin jueves anterior, «nuevos» es null y no cero", r.new_overdue_clients === null, String(r.new_overdue_clients));

  // THE SAME JUDGE AS THE CLIENT CHIPS: every book the message calls overdue, the screen
  // calls «Plazo vencido» or «Crítico» with a plazo, and every due-soon book «Dentro del plazo».
  const { data: resumenes } = await admin.from("client_summary").select("*").eq("owner_id", A);
  let coinciden = true;
  const detalle = [];
  for (const c of resumenes ?? []) {
    for (const [l, saldo, at, plazo, due] of [
      ["USD", c.balance_usd, c.worst_unpaid_charge_at_usd, c.worst_unpaid_charge_plazo_dias_usd, c.worst_unpaid_charge_due_at_usd],
      ["EUR", c.balance_eur, c.worst_unpaid_charge_at_eur, c.worst_unpaid_charge_plazo_dias_eur, c.worst_unpaid_charge_due_at_eur],
    ]) {
      if (!(Number(saldo) > 0.005)) continue;
      const chip = getClientStatus({ balance: Number(saldo), daysSincePayment: c.days_since_payment, worstChargeAt: at, worstChargePlazoDias: plazo, worstChargeDueAt: due });
      const vencidoEnPantalla = plazo != null && (chip === "plazo_vencido" || chip === "critico");
      const vencidoEnMensaje = plazo != null && due != null && new Date(due) < new Date();
      if (vencidoEnPantalla !== vencidoEnMensaje) { coinciden = false; detalle.push(`${c.name} ${l}: chip ${chip}`); }
    }
  }
  check("16. lo que el mensaje llama vencido es lo que el chip del cliente llama vencido", coinciden, detalle.join(", "));

  // Texts built from the database row.
  const lunes = mondayPlan(r);
  check("17a. lunes: negocio_resumen con «2 clientes por $150,00 y 1 cliente por €30,00»",
    lunes.template === "negocio_resumen" && param(lunes, "overdue_summary") === "2 clientes por $150,00 y 1 cliente por €30,00",
    `${lunes.template} · ${param(lunes, "overdue_summary")}`);
  check("15b. sin jueves anterior, todo lo de hoy cuenta como nuevo: 1 agotado + 1 por agotarse + 1 pedido",
    Number(r.new_attention_items) === 3, String(r.new_attention_items));
  const jueves = thursdayPlan(r);
  check("17b. jueves: atencion_negocio (hay agotados y un pedido), por vencer «1 cliente por $50,00»",
    jueves.template === "atencion_negocio" && param(jueves, "due_summary") === "1 cliente por $50,00" && param(jueves, "open_orders") === "1",
    `${jueves.template} · ${param(jueves, "due_summary")}`);

  // SLOTS AND THE PHONE CAP. A and B share one number.
  await admin.from("whatsapp_sends").insert({ owner_id: A, template: "negocio_resumen", period_key: periodo, ok: false });
  const tras_fallo = await filaDe(A);
  check("18a. un envío FALLIDO no ocupa la cita", tras_fallo.monday_used === false && Number(tras_fallo.phone_slots_used) === 0,
    `${tras_fallo.monday_used} · ${tras_fallo.phone_slots_used}`);
  await admin.from("whatsapp_sends").insert({ owner_id: A, template: "negocio_resumen", period_key: periodo, ok: true });
  const ra = await filaDe(A);
  const rb = await filaDe(B);
  check("18b. con el lunes enviado, la cita está usada aunque cambie la plantilla", ra.monday_used === true && mondayPlan(ra).skip === "cita_usada");
  check("18c. el teléfono compartido cuenta 1 para los dos negocios", Number(ra.phone_slots_used) === 1 && Number(rb.phone_slots_used) === 1,
    `${ra.phone_slots_used} · ${rb.phone_slots_used}`);
  await admin.from("whatsapp_sends").insert({ owner_id: B, template: "cartera_attention", period_key: periodo, ok: null });
  const ra2 = await filaDe(A);
  check("18d. con dos en ese número (uno en curso), el jueves de A no sale", Number(ra2.phone_slots_used) === 2 && thursdayPlan(ra2).skip === "tope_telefono",
    `${ra2.phone_slots_used} · ${thursdayPlan(ra2).skip ?? thursdayPlan(ra2).template}`);
  check("18e. y la plantilla vieja del jueves también ocupa la cita de B", (await filaDe(B)).thursday_used === true);

  // THE THURSDAY MEMORY.
  const { data: n1, error: eRem } = await admin.rpc("whatsapp_attention_remember", { p_owner_id: A, p_period: periodo });
  const { data: n2 } = await admin.rpc("whatsapp_attention_remember", { p_owner_id: A, p_period: periodo });
  const { count: filasMemoria } = await admin.from("whatsapp_attention_memory").select("client_id", { count: "exact", head: true }).eq("owner_id", A);
  check("19a. recuerda a los dos vencidos, y repetirlo no duplica", !eRem && n1 === 2 && n2 === 2 && filasMemoria === 2, `${n1} · ${n2} · ${filasMemoria} ${eRem?.message ?? ""}`);
  await admin.from("whatsapp_sends").insert({ owner_id: A, template: "atencion_cobros", period_key: periodo, ok: true });
  const proxima = await filaDe(A, siguiente, periodo);
  check("19b. el jueves siguiente, con los mismos vencidos: 0 nuevos", proxima.new_overdue_clients === 0, String(proxima.new_overdue_clients));
  await mov(caro, { type: "charge", amount: 5, currency: "EUR", plazo_dias: 1, created_at: dias(4) });
  const conNuevo = await filaDe(A, siguiente, periodo);
  check("19c. caro vence en euros: 1 nuevo, y el mensaje lo dice",
    conNuevo.new_overdue_clients === 1 && param(thursdayPlan(conNuevo), "overdue_summary").endsWith("(1 cliente nuevo esta semana)"),
    `${conNuevo.new_overdue_clients} · ${param(thursdayPlan(conNuevo), "overdue_summary")}`);

  // MIGRATION 206: PRODUCTS AND ORDERS ONLY WHEN SOMETHING IS NEW. The memory written by
  // remember (19a) holds this week's items; the next week compares against it.
  const [pAgotado, pPocos] = productos;
  const igual = await filaDe(A, siguiente, periodo);
  check("21a. la semana siguiente, con los mismos productos y pedidos: 0 nuevos y atencion_cobros",
    Number(igual.new_attention_items) === 0 && thursdayPlan(igual).template === "atencion_cobros",
    `${igual.new_attention_items} · ${thursdayPlan(igual).template}`);
  await admin.from("products").update({ stock_opening: 0 }).eq("id", pPocos);
  const empeora = await filaDe(A, siguiente, periodo);
  check("21b. el que se estaba agotando se agota: es nuevo, y salen las líneas con los totales de hoy",
    Number(empeora.new_attention_items) === 1 && thursdayPlan(empeora).template === "atencion_negocio" && param(thursdayPlan(empeora), "out_of_stock") === "2",
    `${empeora.new_attention_items} · ${thursdayPlan(empeora).template} · agotados ${param(thursdayPlan(empeora), "out_of_stock")}`);
  await admin.from("products").update({ stock_opening: 2 }).eq("id", pPocos);
  await admin.from("products").update({ stock_opening: 1 }).eq("id", pAgotado);
  const repone = await filaDe(A, siguiente, periodo);
  check("21c. el agotado se repone a medias (queda por agotarse): NO es nuevo",
    Number(repone.new_attention_items) === 0 && thursdayPlan(repone).template === "atencion_cobros",
    `${repone.new_attention_items} · ${thursdayPlan(repone).template}`);
  await admin.from("products").update({ stock_opening: 0 }).eq("id", pAgotado);
  const { data: o2 } = await admin.from("catalog_orders").insert({
    owner_id: A, customer_name: "ZZ QA", customer_document: "7654321", customer_whatsapp: "584121112244", customer_whatsapp_raw: "04121112244",
  }).select("id").single();
  pedidos.push(o2.id);
  const pedido = await filaDe(A, siguiente, periodo);
  check("21d. llega un pedido nuevo: 1 nuevo, y la línea dice los 2 pedidos sin atender",
    Number(pedido.new_attention_items) === 1 && param(thursdayPlan(pedido), "open_orders") === "2",
    `${pedido.new_attention_items} · pedidos ${param(thursdayPlan(pedido), "open_orders")}`);
  const { count: itemsMemoria } = await admin.from("whatsapp_attention_item_memory").select("item_id", { count: "exact", head: true }).eq("owner_id", A).eq("period_key", periodo);
  check("21e. la memoria guardó los 3 de esa semana (agotado, por agotarse, pedido)", itemsMemoria === 3, String(itemsMemoria));

  // NOTHING OF THIS IS REACHABLE WITHOUT THE SERVER'S KEY.
  const intentos = await Promise.all([
    anon.rpc("whatsapp_business_weekly_targets", { p_period: periodo, p_prev_period: periodo }),
    anon.rpc("whatsapp_attention_remember", { p_owner_id: A, p_period: periodo }),
    anon.rpc("whatsapp_ledger_states", { p_owner_id: A }),
    anon.from("whatsapp_attention_memory").select("client_id"),
    anon.from("whatsapp_attention_item_memory").select("item_id"),
    anon.rpc("whatsapp_attention_items", { p_owner_id: A }),
  ]);
  check("20. anon no llega a ninguna de las cuatro funciones ni a las dos tablas", intentos.every((x) => x.error), intentos.map((x) => x.error?.code ?? "SIN ERROR").join(" · "));
} catch (e) {
  check("la prueba corrió entera", false, e instanceof Error ? e.message : String(e));
} finally {
  for (const id of usuarios) {
    await admin.from("whatsapp_attention_memory").delete().eq("owner_id", id);
    await admin.from("whatsapp_attention_item_memory").delete().eq("owner_id", id);
    await admin.from("whatsapp_sends").delete().eq("owner_id", id);
  }
  if (ventas.length) {
    await admin.from("sale_lines").delete().in("sale_id", ventas);
    await admin.from("sales").delete().in("id", ventas);
  }
  if (productos.length) await admin.from("products").delete().in("id", productos);
  if (pedidos.length) await admin.from("catalog_orders").delete().in("id", pedidos);
  for (const id of clientes) {
    await admin.from("movements").delete().eq("client_id", id);
    await admin.from("clients").delete().eq("id", id);
  }
  for (const id of usuarios) await admin.auth.admin.deleteUser(id);
  const { count } = usuarios.length ? await admin.from("owners").select("id", { count: "exact", head: true }).in("id", usuarios) : { count: 0 };
  const { count: quedanClientes } = await admin.from("clients").select("id", { count: "exact", head: true }).like("name", "ZZ QA semanal%");
  check("21. limpieza: no queda nada de la prueba en dev", count === 0 && quedanClientes === 0, `dueños ${count} · clientes ${quedanClientes}`);
}

const fallos = filas.filter((p) => !p).length;
console.log(`\n${fallos} FALLO(S) de ${filas.length}`);
process.exit(fallos === 0 ? 0 : 1);
