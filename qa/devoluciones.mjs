// Migration 185: returns.
//
// DEV ONLY, writes and cleans up after itself. Runs as the owner of
// QA_OWNER_EMAIL with HIS session: the rules live in a function that reads
// `auth.uid()`, and `sale_returns` is a new table with RLS, so the service key
// could not see either a missing grant or a refusal (migration 108).
//
// The cases follow the table at the top of `lib/returns/options.ts`: by
// currency, whether something is left over, and what is offered.
//
//   npm run qa:devoluciones
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

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const anon = () =>
  createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

async function comoDueno(email) {
  const login = anon();
  const { data: link, error: eL } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (eL) throw new Error(`generateLink: ${eL.message}`);
  const { data: s, error: eV } = await login.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  if (eV) throw new Error(`verifyOtp: ${eV.message}`);
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

const MARCA = `ZZ dev ${Date.now() % 100000}`;
const clientes = [];
const productos = [];
let A;

async function clienteNuevo() {
  const { data, error } = await admin
    .from("clients")
    .insert({ owner_id: A.id, name: `${MARCA} ${clientes.length}` })
    .select("id")
    .single();
  if (error) throw new Error(`cliente: ${error.message}`);
  clientes.push(data.id);
  return data.id;
}

async function productoNuevo(stock) {
  const { data, error } = await admin
    .from("products")
    .insert({
      owner_id: A.id,
      name: `${MARCA} prod ${productos.length}`,
      base_currency: "USD",
      base_currency_retail: "USD",
      price_retail: 10,
      published_retail: false,
      stock_opening: stock,
    })
    .select("id")
    .single();
  if (error) throw new Error(`producto: ${error.message}`);
  productos.push(data.id);
  return data.id;
}

// A sale as `registrarVenta` writes it: lines, what was paid at the counter, and
// a charge for what is left. Written with the owner's session on purpose.
async function fiado(clientId, { qty = 3, price = 10, pagado = 0, currency = "USD", product = null } = {}) {
  const { data: venta, error: e1 } = await A.db
    .from("sales")
    .insert({ owner_id: A.id, client_id: clientId, created_by: A.id })
    .select("id")
    .single();
  if (e1) throw new Error(`sale: ${e1.message}`);
  const lineCurrency = currency ?? "COP";
  const { data: linea, error: e2 } = await A.db
    .from("sale_lines")
    .insert({ sale_id: venta.id, product_id: product, name: `${MARCA} línea`, quantity: qty, unit_price: price, currency: lineCurrency, tier: "retail" })
    .select("id")
    .single();
  if (e2) throw new Error(`line: ${e2.message}`);
  if (pagado > 0) {
    const { error } = await A.db
      .from("sale_payments")
      .insert({ sale_id: venta.id, currency: lineCurrency, amount: pagado, entry_currency: currency, entry_amount: pagado });
    if (error) throw new Error(`payment: ${error.message}`);
  }
  const resto = qty * price - pagado;
  const { data: cargo, error: e3 } = await A.db
    .from("movements")
    .insert({ client_id: clientId, created_by: A.id, type: "charge", amount: resto, currency, sale_id: venta.id, source: "manual" })
    .select("id")
    .single();
  if (e3) throw new Error(`charge: ${e3.message}`);
  return { saleId: venta.id, lineId: linea.id, chargeId: cargo.id };
}

async function abono(clientId, amount, fiadoId, currency = "USD") {
  const { error } = await A.db
    .from("movements")
    .insert({ client_id: clientId, created_by: A.id, type: "payment", amount, currency, applies_to_movement_id: fiadoId, source: "manual" });
  if (error) throw new Error(`abono: ${error.message}`);
}

const devolver = (f, qty, resto = {}) =>
  A.db.rpc("registrar_devolucion", {
    p_movement_id: f.chargeId,
    p_line_id: f.lineId,
    p_quantity: qty,
    p_fiados: resto.fiados ?? [],
    p_a_favor: resto.aFavor ?? 0,
    p_efectivo: resto.efectivo ?? 0,
  });

async function pendiente(clientId, chargeId) {
  const { data } = await A.db.rpc("get_open_charges_for_client", { p_client_id: clientId });
  return Number((data ?? []).find((c) => c.movement_id === chargeId)?.pending ?? 0);
}
async function libro(clientId, moneda = "USD") {
  const { data } = await A.db.from("client_summary").select("balance, balance_usd, balance_eur").eq("client_id", clientId).single();
  return Number(moneda === "USD" ? data.balance_usd : moneda === "EUR" ? data.balance_eur : data.balance);
}
const estante = async (id) => (await admin.from("products").select("stock_opening").eq("id", id).single()).data.stock_opening;

try {
  const { error: e0 } = await admin.from("sale_returns").select("id").limit(1);
  check("0. la tabla sale_returns existe (migración 185 corrida en dev)", !e0, e0?.message);
  if (e0) throw new Error("sin la 185 no tiene sentido seguir");
  if (!env.QA_OWNER_EMAIL) throw new Error("falta QA_OWNER_EMAIL en .env.local");
  A = await comoDueno(env.QA_OWNER_EMAIL);

  // ── Row 1: nothing left over, no question ───────────────────────────────
  {
    const c = await clienteNuevo();
    const p = await productoNuevo(5);
    const f = await fiado(c, { qty: 3, price: 10, product: p });
    const stockTrasVenta = await estante(p);
    const { data: r, error } = await devolver(f, 1);
    check("1a. sin sobrante no hace falta decidir nada", r?.ok === true, error?.message ?? JSON.stringify(r));
    check("1b. el fiado baja de $30 a $20", igual(await pendiente(c, f.chargeId), 20), await pendiente(c, f.chargeId));
    check("1c. «Por cobrar» baja a $20", igual(await libro(c), 20), await libro(c));
    check("1d. la unidad vuelve al inventario", Number(await estante(p)) === Number(stockTrasVenta) + 1, `${stockTrasVenta} → ${await estante(p)}`);
    const { data: linea } = await admin.from("sale_lines").select("quantity").eq("id", f.lineId).single();
    check("1e. la línea vendida no se toca", Number(linea.quantity) === 3, linea.quantity);
    const { count } = await admin.from("movements").select("id", { count: "exact", head: true }).eq("client_id", c).eq("type", "payment");
    check("1f. no se escribe ningún abono: no entró dinero", count === 0, count);
    const { data: f2 } = await devolver(f, 1, { efectivo: 5 });
    check("1g. pedir efectivo sin sobrante se rechaza", f2?.code === "reparto_no_cuadra", f2?.code);
  }

  // ── Row 2: left over, other fiados owe ──────────────────────────────────
  {
    const c = await clienteNuevo();
    const a = await fiado(c, { qty: 3, price: 10 });
    await abono(c, 25, a.chargeId);
    const b = await fiado(c, { qty: 1, price: 20 });
    const { data: sinDecir } = await devolver(a, 1);
    check("2a. con sobrante hay que decidir: callar se rechaza", sinDecir?.code === "reparto_no_cuadra", sinDecir?.code);
    const { data: aFavor } = await devolver(a, 1, { aFavor: 5 });
    check("2b. saldo a favor NO se admite con deuda en esa moneda", aFavor?.code === "hay_deuda_en_esa_moneda", aFavor?.code);
    const { data: r, error } = await devolver(a, 1, { fiados: [{ fiado_id: b.chargeId, amount: 5 }] });
    check("2c. abonar el sobrante a otro fiado", r?.ok === true, error?.message ?? JSON.stringify(r));
    check("2d. A queda en $0 y B en $15", igual(await pendiente(c, a.chargeId), 0) && igual(await pendiente(c, b.chargeId), 15), `${await pendiente(c, a.chargeId)} / ${await pendiente(c, b.chargeId)}`);
    check("2e. «Por cobrar» $15", igual(await libro(c), 15), await libro(c));
  }

  // ── Row 2 with cash: allowed with debts alive ───────────────────────────
  {
    const c = await clienteNuevo();
    const a = await fiado(c, { qty: 3, price: 10 });
    await abono(c, 25, a.chargeId);
    const b = await fiado(c, { qty: 1, price: 20 });
    const { data: r } = await devolver(a, 1, { efectivo: 5 });
    check("2f. efectivo con otra deuda viva", r?.ok === true && igual(r.to_cash, 5), JSON.stringify(r));
    check("2g. B sigue en $20 y el libro en $20", igual(await pendiente(c, b.chargeId), 20) && igual(await libro(c), 20), await libro(c));
  }

  // ── Row 3: left over, nothing else owed ─────────────────────────────────
  {
    const c = await clienteNuevo();
    const a = await fiado(c, { qty: 3, price: 10 });
    await abono(c, 25, a.chargeId);
    const { data: r } = await devolver(a, 1, { aFavor: 5 });
    check("3a. saldo a favor sin otra deuda", r?.ok === true, JSON.stringify(r));
    check("3b. el libro queda en -$5", igual(await libro(c), -5), await libro(c));
    const { data: cr } = await A.db.rpc("get_client_credit", { p_client_id: c });
    check("3c. get_client_credit dice $5", igual((cr ?? []).find((x) => x.currency === "USD")?.credit ?? 0, 5), JSON.stringify(cr));

    // THE CARRY: a saldo written BEFORE a fiado has to reach it.
    const n = await fiado(c, { qty: 1, price: 12 });
    check("3d. el fiado siguiente debe $7, no $12", igual(await pendiente(c, n.chargeId), 7), await pendiente(c, n.chargeId));
    check("3e. el libro dice lo mismo: $7", igual(await libro(c), 7), await libro(c));
    await abono(c, 7, n.chargeId);
    check("3f. un abono de $7 lo salda y el libro queda en $0", igual(await pendiente(c, n.chargeId), 0) && igual(await libro(c), 0), await libro(c));
  }

  // ── Row 3 with cash, and a fully paid fiado: the zero-amount line ───────
  {
    const c = await clienteNuevo();
    const a = await fiado(c, { qty: 2, price: 10 });
    await abono(c, 20, a.chargeId);
    const { data: r } = await devolver(a, 1, { efectivo: 10 });
    check("3g. fiado pagado, todo en efectivo", r?.ok === true && igual(r.to_cash, 10), JSON.stringify(r));
    check("3h. el libro no se mueve", igual(await libro(c), 0), await libro(c));
    const { data: fila } = await admin.from("movements").select("amount, type").eq("id", r.movement_id).single();
    check("3i. igual queda una fila en el historial, en cero", fila?.type === "return" && igual(fila.amount, 0), JSON.stringify(fila));
  }

  // ── Row 4: abono to fiados and something is still left ──────────────────
  {
    const c = await clienteNuevo();
    const a = await fiado(c, { qty: 3, price: 10 });
    await abono(c, 25, a.chargeId);
    const b = await fiado(c, { qty: 1, price: 3 });
    const { data: r } = await devolver(a, 1, { fiados: [{ fiado_id: b.chargeId, amount: 3 }], aFavor: 2 });
    check("4a. abona $3 y deja $2 a favor", r?.ok === true, JSON.stringify(r));
    check("4b. el libro queda en -$2", igual(await libro(c), -2), await libro(c));
  }

  // ── By currency ─────────────────────────────────────────────────────────
  {
    const c = await clienteNuevo();
    const a = await fiado(c, { qty: 3, price: 10 });
    await abono(c, 25, a.chargeId);
    const eur = await fiado(c, { qty: 1, price: 20, currency: "EUR" });
    const { data: cruzado } = await devolver(a, 1, { fiados: [{ fiado_id: eur.chargeId, amount: 5 }] });
    check("5a. un sobrante en dólares no abona un fiado en euros", cruzado?.code === "fiado_ajeno", cruzado?.code);
    const { data: r } = await devolver(a, 1, { aFavor: 5 });
    check("5b. deuda en euros no impide saldo a favor en dólares", r?.ok === true, JSON.stringify(r));
    check("5c. cada libro por su lado: USD -$5, EUR €20", igual(await libro(c), -5) && igual(await libro(c, "EUR"), 20), `${await libro(c)} / ${await libro(c, "EUR")}`);
  }
  {
    const c = await clienteNuevo();
    const f = await fiado(c, { qty: 2, price: 1000, currency: null });
    const { data: r, error } = await devolver(f, 1);
    check("5d. libro colombiano: la línea 'COP' casa con el fiado null", r?.ok === true, error?.message ?? JSON.stringify(r));
    check("5e. baja a 1.000", igual(await libro(c, null), 1000), await libro(c, null));
  }

  // ── Limits ──────────────────────────────────────────────────────────────
  {
    const c = await clienteNuevo();
    const p = await productoNuevo(null);
    const f = await fiado(c, { qty: 2, price: 10, product: p });
    const { data: mucho } = await devolver(f, 3);
    check("6a. más unidades de las vendidas se rechaza", mucho?.code === "excede_la_cantidad", mucho?.code);
    await devolver(f, 2);
    const { data: repetida } = await devolver(f, 1);
    check("6b. lo ya devuelto no se devuelve dos veces", repetida?.code === "excede_la_cantidad", repetida?.code);
    check("6c. un producto sin cantidad sigue sin cantidad", (await estante(p)) === null, await estante(p));
    const { data: otra } = await A.db.rpc("registrar_devolucion", {
      p_movement_id: f.chargeId, p_line_id: "00000000-0000-4000-8000-000000000000", p_quantity: 1,
    });
    check("6d. una línea ajena se rechaza", otra?.code === "linea_ajena", otra?.code);
  }

  // ── Delete, restore, and the same units twice ───────────────────────────
  {
    const c = await clienteNuevo();
    const p = await productoNuevo(5);
    const f = await fiado(c, { qty: 2, price: 10, product: p });
    const antes = Number(await estante(p));
    const { data: r } = await devolver(f, 1);
    const { data: borrada, error: eB } = await A.db.rpc("eliminar_devolucion", { p_movement_id: r.movement_id });
    check("7a. eliminar devuelve la deuda", borrada?.ok === true && igual(await libro(c), 20), eB?.message ?? (await libro(c)));
    check("7b. y las unidades salen otra vez", Number(await estante(p)) === antes, await estante(p));
    const { count: avisos } = await admin.from("movement_deletions").select("id", { count: "exact", head: true }).eq("client_id", c);
    check("7c. deja un solo aviso", avisos === 1, avisos);
    const { data: vuelta } = await A.db.rpc("restaurar_devolucion", { p_movement_id: r.movement_id });
    check("7d. restaurar la vuelve a aplicar", vuelta?.ok === true && igual(await libro(c), 10) && Number(await estante(p)) === antes + 1, JSON.stringify(vuelta));
    await A.db.rpc("eliminar_devolucion", { p_movement_id: r.movement_id });
    await devolver(f, 2);
    const { data: doble } = await A.db.rpc("restaurar_devolucion", { p_movement_id: r.movement_id });
    check("7e. no se restaura si esas unidades ya volvieron", doble?.code === "ya_devuelto", doble?.code);
  }

  // ── The guards, from the owner's own session ────────────────────────────
  {
    const c = await clienteNuevo();
    const f = await fiado(c, { qty: 2, price: 10 });
    const { data: r } = await devolver(f, 1);
    const { error: eI } = await A.db.from("movements").insert({ client_id: c, created_by: A.id, type: "return", amount: 1, currency: "USD", source: "manual" });
    check("8a. no se escribe una devolución a mano", !!eI, eI?.message ?? "¡entró!");
    const { error: eF } = await A.db.from("movements").update({ deleted_at: new Date().toISOString() }).eq("id", f.chargeId);
    check("8b. un fiado con devolución viva no se borra", !!eF, eF?.message ?? "¡se borró!");
    const { error: eS } = await A.db.from("sales").update({ deleted_at: new Date().toISOString() }).eq("id", f.saleId);
    check("8c. su venta tampoco", !!eS, eS?.message ?? "¡se borró!");
    const { error: eR } = await A.db.from("movements").update({ deleted_at: new Date().toISOString() }).eq("id", r.movement_id);
    check("8d. la fila de la devolución no se borra a mano", !!eR, eR?.message ?? "¡se borró!");
    const { data: ve, error: eV } = await A.db.from("sale_returns").select("id").eq("client_id", c);
    check("8e. el dueño LEE sus devoluciones con su sesión", !eV && ve.length === 1, eV?.message ?? ve?.length);
    const { error: eW } = await A.db.from("sale_returns").update({ to_cash: 999 }).eq("client_id", c);
    check("8f. el dueño no las edita", !!eW, eW?.message ?? "¡sin error!");
    const { data: otroDueno } = await admin.from("owners").select("id").neq("id", A.id).limit(1).single();
    const { data: ajeno } = await admin.from("clients").select("id").eq("owner_id", otroDueno.id).limit(1).maybeSingle();
    if (ajeno) {
      const { data: x } = await A.db.rpc("get_client_credit", { p_client_id: ajeno.id });
      check("8g. no se lee el saldo de otro negocio", (x ?? []).length === 0, (x ?? []).length);
    }
    const { error: eA } = await anon().from("sale_returns").select("id").limit(1);
    check("8h. sin sesión no se leen devoluciones", !!eA, eA?.message ?? "¡se leyó!");
    const { data: sinSesion, error: eN } = await anon().rpc("registrar_devolucion", { p_movement_id: f.chargeId, p_line_id: f.lineId, p_quantity: 1 });
    check("8i. sin sesión no se registra", !!eN || sinSesion?.ok === false, eN?.message ?? sinSesion?.code);
  }

  // ── What the client's link carries ──────────────────────────────────────
  {
    const c = await clienteNuevo();
    const f = await fiado(c, { qty: 2, price: 10 });
    await devolver(f, 1);
    const { data: enlace } = await admin.from("share_links").insert({ client_id: c }).select("token").single();
    const { data: s, error } = await anon().rpc("get_shared_balance", { p_token: enlace.token });
    const fila = (s?.movements ?? []).find((m) => m.type === "return");
    const cargo = (s?.movements ?? []).find((m) => m.type === "charge");
    check("9a. el enlace trae la devolución", igual(fila?.devolucion?.amount ?? 0, 10), error?.message ?? JSON.stringify(fila?.devolucion));
    check("9b. y marca la línea devuelta", Number(cargo?.productos?.[0]?.devuelto) === 1, JSON.stringify(cargo?.productos));
    check("9c. su fiado la lista entre sus abonos, con su nombre", (s?.abonos_por_fiado?.[f.chargeId] ?? [])[0]?.tipo === "return", JSON.stringify(s?.abonos_por_fiado));
    check("9d. el saldo del enlace es el mismo", igual(s?.balance_usd, 10), s?.balance_usd);
  }

  // ── Every chain still adds up ───────────────────────────────────────────
  {
    let rotas = 0;
    for (const c of clientes) {
      const { data: ms } = await admin.from("movements").select("type, amount, currency").eq("client_id", c).is("deleted_at", null);
      const suma = {};
      for (const m of ms ?? []) suma[m.currency ?? "COP"] = (suma[m.currency ?? "COP"] ?? 0) + (m.type === "charge" ? 1 : -1) * Number(m.amount);
      for (const [moneda, total] of Object.entries(suma)) {
        if (!igual(await libro(c, moneda === "COP" ? null : moneda), total)) rotas++;
      }
    }
    check("10. en todos los clientes de la suite, saldo = suma de movimientos", rotas === 0, `${rotas} libro(s) rotos`);
  }
} catch (e) {
  check("ejecución", false, e.message);
} finally {
  // `service_role` is exempt from migration 180's rules; children first.
  for (const c of clientes) {
    await admin.from("sale_returns").delete().eq("client_id", c);
    await admin.from("movement_deletions").delete().eq("client_id", c);
    await admin.from("share_links").delete().eq("client_id", c);
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
