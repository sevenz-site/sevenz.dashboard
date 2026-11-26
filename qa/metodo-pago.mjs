// «MÉTODO DE PAGO» (migration 214, owner's request of 2026-11-17).
//
// DEV ONLY (vzqppwrwnmlbrxizskdh). Writes a throw-away business and deletes it at the end.
//
// Part 1 is pure: the list per book, the default per currency typed, the server's check.
// Part 2 is the database, and runs AS THE OWNER where the app does (CLAUDE.md: a suite on the
// service key sees through a missing grant): the column's check constraint, a method refused on
// a fiado, the split abono writing the method on every line, an edit by console refused (180),
// the client's link returning it, and the Reportes chart adding up to the «Ventas» and «Abonos»
// cards with a cash refund taken off the method the return says it went back by.
//
// The server actions (`registrarVenta`, `registrarAbonoDirigido`) are checked in the browser:
// they need the dev server and a session cookie, and their method is one `.insert` field.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

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

const M = await import("../lib/payments/methods.ts");

// ── 1. PURE ───────────────────────────────────────────────────────────────
check("1a. Venezuela: diez métodos, en el orden del dueño, con «Otro» al final",
  M.methodsForBook("USD").map((m) => m.label).join("|") === "Pago móvil|Efectivo|Punto|Biopago|Transferencia|Binance / USDT|Zelle|Paypal|Zinli|Otro");
check("1b. Colombia (COP o null): seis, Efectivo primero y «Otro» al final",
  M.methodsForBook("COP").map((m) => m.label).join("|") === "Efectivo|Nequi|QR|Punto de venta|Transferencia|Otro"
  && M.methodsForBook(null).length === 6);
// 1c and 1c2 checked the defaults per currency (2026-11-17) and for the abono (2026-11-25). Since
// 2026-11-26 the field opens empty and is required (owner's request), so no default is left.
check("1c. ya no hay método por defecto: el campo abre vacío (pedido del 2026-11-26)",
  !("defaultMethod" in M) && !("defaultAbonoMethod" in M));
check("1c2. «Otro» vale en los dos países",
  M.isMethodForBook("other", "USD") && M.isMethodForBook("other", "EUR") && M.isMethodForBook("other", null)
  && M.isMethodForBook("other", "COP") && M.methodLabel("other", "USD") === "Otro" && M.methodLabel("other", null) === "Otro");
check("1c3. Biopago vale en Venezuela y no en Colombia",
  M.isMethodForBook("biopago", "USD") && M.isMethodForBook("biopago", "EUR")
  && !M.isMethodForBook("biopago", null) && !M.isMethodForBook("biopago", "COP") && M.methodLabel("biopago", "USD") === "Biopago");
check("1d. Pago móvil se puede elegir cobrando en dólares (decisión del dueño)", M.isMethodForBook("mobile_payment", "USD"));
check("1e. Zelle no vale en Colombia ni Nequi en Venezuela; un valor inventado tampoco",
  !M.isMethodForBook("zelle", null) && !M.isMethodForBook("nequi", "USD") && !M.isMethodForBook("bitcoin", "USD")
  && !M.isMethodForBook(null, "USD"));
check("1f. la misma terminal se llama distinto por país", M.methodLabel("card", "USD") === "Punto" && M.methodLabel("card", null) === "Punto de venta");
check("1g. sin método no hay etiqueta (la ficha no dibuja la fila)", M.methodLabel(null, "USD") === null && M.methodLabel("", "USD") === null);

// ── 2. THE DATABASE ───────────────────────────────────────────────────────
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const tag = Math.random().toString(36).slice(2, 8);
let owner = null;

async function comoDueno(email) {
  const { data: link, error: eL } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (eL) throw new Error(`generateLink: ${eL.message}`);
  const { data: s, error: eV } = await anon.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  if (eV) throw new Error(`verifyOtp: ${eV.message}`);
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${s.session.access_token}` } },
  });
}

try {
  const email = `zz-metodo-pago-${tag}@example.com`;
  const { data: u, error: eU } = await admin.auth.admin.createUser({
    email, email_confirm: true,
    user_metadata: { business_name: "ZZ QA método de pago", first_name: "Rosa", last_name: "QA", country: "VE", whatsapp: "584140000002" },
  });
  if (eU) throw new Error(`createUser: ${eU.message}`);
  owner = u.user.id;
  await admin.from("owners").update({ country: "VE" }).eq("id", owner);
  const dueno = await comoDueno(email);

  // 0. The migration is there: without it everything below would be a false green.
  const { error: eCol } = await admin.from("sale_payments").select("payment_method").limit(1);
  check("0. la columna existe en dev (migración 214)", !eCol, eCol?.message ?? "");
  if (eCol) throw new Error("falta la 214 en dev");

  const { data: c, error: eC } = await dueno.from("clients").insert({ owner_id: owner, name: "ZZ QA cliente método" }).select("id").single();
  if (eC) throw new Error(`clients: ${eC.message}`);
  // THE CASH SALE GOES TO A CLIENT WITH NO DEBT: a cash refund to someone who owes in that book is
  // steered onto his fiados first, and the refund case below needs the cash to really go back.
  const { data: c2, error: eC2 } = await dueno.from("clients").insert({ owner_id: owner, name: "ZZ QA cliente contado" }).select("id").single();
  if (eC2) throw new Error(`clients: ${eC2.message}`);

  // A cash sale paid by Zelle, written as the owner, the way `registrarVenta` does.
  const { data: v, error: eVe } = await dueno.from("sales").insert({ owner_id: owner, client_id: c2.id }).select("id").single();
  if (eVe) throw new Error(`sales: ${eVe.message}`);
  const { data: linea } = await dueno.from("sale_lines").insert({ sale_id: v.id, name: "ZZ QA", quantity: 1, unit_price: 10, currency: "USD" }).select("id").single();
  const pago = await dueno.from("sale_payments").insert({ sale_id: v.id, currency: "USD", amount: 10, entry_currency: "USD", entry_amount: 10, payment_method: "zelle" });
  check("2a. el dueño guarda un pago de contado por Zelle", !pago.error, pago.error?.message ?? "");

  const malo = await dueno.from("sale_payments").insert({ sale_id: v.id, currency: "USD", amount: 1, entry_currency: "USD", entry_amount: 1, payment_method: "bitcoin" });
  check("2b. la base rechaza un método fuera de la lista", malo.error != null, malo.error?.code ?? "lo aceptó");

  // Two fiados, then a split abono through the RPC, as the owner.
  const fiar = async (monto) => {
    const { data, error } = await dueno.from("movements").insert({ client_id: c.id, created_by: owner, type: "charge", amount: monto, currency: "USD", source: "manual" }).select("id").single();
    if (error) throw new Error(`charge: ${error.message}`);
    return data.id;
  };
  const f1 = await fiar(8);
  const f2 = await fiar(6);
  const cargoConMetodo = await dueno.from("movements").insert({ client_id: c.id, created_by: owner, type: "charge", amount: 1, currency: "USD", source: "manual", payment_method: "cash" });
  check("2c. un fiado no lleva método: la base lo rechaza", cargoConMetodo.error != null, cargoConMetodo.error?.code ?? "lo aceptó");

  const { data: rep, error: eRep } = await dueno.rpc("registrar_abono_repartido", {
    p_lineas: [
      { fiado_id: f1, amount: 5, entry_currency: "USD", entry_amount: 5, payment_method: "zinli" },
      { fiado_id: f2, amount: 3, entry_currency: "USD", entry_amount: 3, payment_method: "zinli" },
    ],
  });
  check("2d. el abono repartido se guarda", !eRep && rep?.ok === true, eRep?.message ?? JSON.stringify(rep));
  const { data: lineas } = await admin.from("movements").select("id, payment_method").eq("payment_group_id", rep?.group_id ?? "00000000-0000-0000-0000-000000000000");
  check("2e. y cada línea lleva el método", (lineas ?? []).length === 2 && lineas.every((l) => l.payment_method === "zinli"), JSON.stringify(lineas));

  const repMalo = await dueno.rpc("registrar_abono_repartido", { p_lineas: [{ fiado_id: f1, amount: 1, payment_method: "bitcoin" }] });
  check("2f. un método inventado tumba el reparto entero", repMalo.error != null || repMalo.data?.ok === false, repMalo.error?.code ?? JSON.stringify(repMalo.data));

  const edicion = await dueno.from("movements").update({ payment_method: "cash" }).eq("id", lineas?.[0]?.id ?? "00000000-0000-0000-0000-000000000000").select("payment_method");
  const tras = await admin.from("movements").select("payment_method").eq("id", lineas?.[0]?.id ?? "").single();
  check("2g. cambiar el método por consola no se queda (regla de la 180)", tras.data?.payment_method === "zinli", edicion.error?.code ?? "sin error, pero comprobado en la base");

  // ── THE CLIENT'S LINK ──
  const token = `qa${tag}${Math.random().toString(36).slice(2, 12)}`;
  const token2 = `qb${tag}${Math.random().toString(36).slice(2, 12)}`;
  await admin.from("share_links").insert([{ client_id: c.id, token }, { client_id: c2.id, token: token2 }]);
  const { data: compartido, error: eS } = await anon.rpc("get_shared_balance", { p_token: token });
  const { data: compartido2 } = await anon.rpc("get_shared_balance", { p_token: token2 });
  const abonoDelLink = (compartido?.movements ?? []).find((m) => m.type === "payment");
  const contado = (compartido2?.ventas_de_contado ?? []).find((x) => x.sale_id === v.id);
  const abonosF1 = compartido?.abonos_por_fiado?.[f1] ?? [];
  check("3a. el enlace del cliente trae el método del abono", !eS && abonoDelLink?.payment_method === "zinli", eS?.message ?? JSON.stringify(abonoDelLink?.payment_method));
  check("3b. y el de la venta de contado", contado?.payment_method === "zelle", JSON.stringify(contado?.payment_method));
  check("3c. y el de cada abono en la ficha del fiado", abonosF1.length === 1 && abonosF1[0].payment_method === "zinli", JSON.stringify(abonosF1));

  // ── REPORTES ──
  const { cargarFacturacion } = await import("../lib/reports/facturacion.ts");
  const ahora = new Date();
  const rango = { desde: new Date(ahora.getTime() - 86400000), hasta: new Date(ahora.getTime() + 86400000) };
  const f = await cargarFacturacion({ supabase: dueno, ownerId: owner, rango, dosLibros: true, effectiveRate: null, clientId: null });
  const usd = f.porMetodo.USD ?? {};
  const suma = Object.values(usd).reduce((a, b) => a + b, 0);
  check("4a. Reportes: Zelle 10 y Zinli 8", Math.abs((usd.zelle ?? 0) - 10) < 0.005 && Math.abs((usd.zinli ?? 0) - 8) < 0.005, JSON.stringify(usd));
  check("4b. los métodos suman lo mismo que «Ventas» + «Abonos»",
    Math.abs(suma - ((f.ventas.USD ?? 0) + (f.abonos.USD ?? 0))) < 0.005, `${suma} vs ${(f.ventas.USD ?? 0) + (f.abonos.USD ?? 0)}`);

  // THE RETURN ASKS HOW THE CASH WENT BACK (owner's decision of 2026-11-17, «Preguntar al
  // devolver»). The Zelle sale comes back whole and the $10 go back by Pago móvil: the chart takes
  // them off Pago móvil, which goes to -10, and Zelle stays at 10. Through the real function, as
  // the owner, so its new parameter is what is being checked.
  const { data: dev, error: eDev } = await dueno.rpc("registrar_devolucion_contado", {
    p_sale_id: v.id, p_line_id: linea.id, p_quantity: 1, p_fiados: [], p_a_favor: 0, p_efectivo: 10, p_metodo: "mobile_payment",
  });
  check("4c0. la devolución en dinero se guarda con su método", !eDev && dev?.ok === true, eDev?.message ?? JSON.stringify(dev));
  const { data: filaDev } = await admin.from("sale_returns").select("refund_method, to_cash").eq("id", dev?.return_id ?? "00000000-0000-0000-0000-000000000000").maybeSingle();
  check("4c1. y queda escrito en la devolución", filaDev?.refund_method === "mobile_payment", JSON.stringify(filaDev));
  const g = await cargarFacturacion({ supabase: dueno, ownerId: owner, rango, dosLibros: true, effectiveRate: null, clientId: null });
  const usd2 = g.porMetodo.USD ?? {};
  const suma2 = Object.values(usd2).reduce((a, b) => a + b, 0);
  check("4c. la devolución sale del método por el que se devolvió (Pago móvil) y no de Zelle",
    Math.abs((usd2.mobile_payment ?? 0) + 10) < 0.005 && Math.abs((usd2.zelle ?? 0) - 10) < 0.005, JSON.stringify(usd2));
  check("4d. y la suma sigue siendo «Ventas» + «Abonos»",
    Math.abs(suma2 - ((g.ventas.USD ?? 0) + (g.abonos.USD ?? 0))) < 0.005, `${suma2} vs ${(g.ventas.USD ?? 0) + (g.abonos.USD ?? 0)}`);

  // ── BIOPAGO (migration 220): the three doors that store a method ──
  const { data: repBio, error: eRepBio } = await dueno.rpc("registrar_abono_repartido", {
    p_lineas: [{ fiado_id: f2, amount: 1, entry_currency: "USD", entry_amount: 1, payment_method: "biopago" }],
  });
  check("5b. un abono por Biopago se guarda", !eRepBio && repBio?.ok === true, eRepBio?.message ?? JSON.stringify(repBio));
  const { data: v2 } = await dueno.from("sales").insert({ owner_id: owner, client_id: c2.id }).select("id").single();
  const { data: l2 } = await dueno.from("sale_lines").insert({ sale_id: v2.id, name: "ZZ QA 2", quantity: 1, unit_price: 4, currency: "USD" }).select("id").single();
  const bio = await dueno.from("sale_payments").insert({ sale_id: v2.id, currency: "USD", amount: 4, entry_currency: "USD", entry_amount: 4, payment_method: "biopago" });
  check("5a. un pago de una venta por Biopago se guarda", !bio.error, bio.error?.message ?? "");
  const { data: devBio, error: eDevBio } = await dueno.rpc("registrar_devolucion_contado", {
    p_sale_id: v2.id, p_line_id: l2.id, p_quantity: 1, p_fiados: [], p_a_favor: 0, p_efectivo: 4, p_metodo: "biopago",
  });
  check("5c. y una devolución en dinero por Biopago también", !eDevBio && devBio?.ok === true, eDevBio?.message ?? JSON.stringify(devBio));

  // ── «OTRO» (migration 224): the three doors that store a method ──
  const { data: repOtro, error: eRepOtro } = await dueno.rpc("registrar_abono_repartido", {
    p_lineas: [{ fiado_id: f2, amount: 1, entry_currency: "USD", entry_amount: 1, payment_method: "other" }],
  });
  check("6b. un abono por «Otro» se guarda (migración 224)", !eRepOtro && repOtro?.ok === true, eRepOtro?.message ?? JSON.stringify(repOtro));
  const { data: v3 } = await dueno.from("sales").insert({ owner_id: owner, client_id: c2.id }).select("id").single();
  const { data: l3 } = await dueno.from("sale_lines").insert({ sale_id: v3.id, name: "ZZ QA 3", quantity: 1, unit_price: 2, currency: "USD" }).select("id").single();
  const otro = await dueno.from("sale_payments").insert({ sale_id: v3.id, currency: "USD", amount: 2, entry_currency: "USD", entry_amount: 2, payment_method: "other" });
  check("6a. un pago de una venta por «Otro» se guarda", !otro.error, otro.error?.message ?? "");
  const { data: devOtro, error: eDevOtro } = await dueno.rpc("registrar_devolucion_contado", {
    p_sale_id: v3.id, p_line_id: l3.id, p_quantity: 1, p_fiados: [], p_a_favor: 0, p_efectivo: 2, p_metodo: "other",
  });
  check("6c. y una devolución en dinero por «Otro» también", !eDevOtro && devOtro?.ok === true, eDevOtro?.message ?? JSON.stringify(devOtro));
} catch (e) {
  check("la prueba corrió entera", false, e instanceof Error ? e.message : String(e));
} finally {
  if (owner) {
    const { error } = await admin.auth.admin.deleteUser(owner);
    console.log(error ? `  limpieza: NO se borró el negocio de prueba: ${error.message}` : "  limpieza: negocio de prueba borrado");
  }
}

const fallos = filas.filter((x) => !x).length;
console.log(`\n${fallos} FALLO(S) de ${filas.length}`);
process.exit(fallos ? 1 : 0);
