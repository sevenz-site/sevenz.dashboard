// Migration 186: returns of a sale paid in full.
//
// DEV ONLY, writes and cleans up after itself. Runs as the owner of
// QA_OWNER_EMAIL with HIS session, for the same reason as `qa:devoluciones`: the
// rules live in a function that reads `auth.uid()`.
//
// The first block is the owner's three cases of 2026-11-04, read back through
// the same functions the screens use. The figure each one must leave in «Ventas»
// is the point of the suite: it is what stayed in the till.
//
//   npm run qa:devoluciones-contado
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { cargarFacturacion } from "../lib/reports/facturacion.ts";
import { ventasDelPeriodo } from "../lib/reports/ventas-del-periodo.ts";
import { rangoDe } from "../lib/reports/rango.ts";
import { bookAfter } from "../lib/returns/options.ts";

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

const MARCA = `ZZ devc ${Date.now() % 100000}`;
const clientes = [];
const productos = [];
let A;

async function clienteNuevo(owner = A, extra = {}) {
  const { data, error } = await admin
    .from("clients")
    .insert({ owner_id: owner.id, name: `${MARCA} ${clientes.length}`, ...extra })
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

// A cash sale as `registrarVenta` writes it: lines and payments, nothing in
// `movements`. `pagado` below the lines' value is an old sale typed down.
async function contado(clientId, { qty = 3, price = 10, pagado = null, currency = "USD", product = null, owner = A } = {}) {
  const { data: venta, error: e1 } = await owner.db
    .from("sales")
    .insert({ owner_id: owner.id, client_id: clientId, created_by: owner.id })
    .select("id")
    .single();
  if (e1) throw new Error(`sale: ${e1.message}`);
  const { data: linea, error: e2 } = await owner.db
    .from("sale_lines")
    .insert({ sale_id: venta.id, product_id: product, name: `${MARCA} línea`, quantity: qty, unit_price: price, currency, tier: "retail" })
    .select("id")
    .single();
  if (e2) throw new Error(`line: ${e2.message}`);
  const { error: e3 } = await owner.db
    .from("sale_payments")
    .insert({ sale_id: venta.id, currency, amount: pagado ?? qty * price, entry_currency: currency, entry_amount: pagado ?? qty * price });
  if (e3) throw new Error(`payment: ${e3.message}`);
  return { saleId: venta.id, lineId: linea.id };
}

async function fiado(clientId, amount, { currency = "USD" } = {}) {
  const { data, error } = await A.db
    .from("movements")
    .insert({ client_id: clientId, created_by: A.id, type: "charge", amount, currency, source: "manual" })
    .select("id")
    .single();
  if (error) throw new Error(`fiado: ${error.message}`);
  return data.id;
}

// What `registrarVenta` writes when saldo a favor covers `saldo` of the sale.
async function ventaConSaldo(clientId, { valor, saldo }) {
  const { data: venta } = await A.db.from("sales").insert({ owner_id: A.id, client_id: clientId, created_by: A.id }).select("id").single();
  await A.db.from("sale_lines").insert({ sale_id: venta.id, name: `${MARCA} otro`, quantity: 1, unit_price: valor, currency: "USD", tier: "retail" });
  if (valor > saldo) {
    await A.db.from("sale_payments").insert({ sale_id: venta.id, currency: "USD", amount: valor - saldo, entry_currency: "USD", entry_amount: valor - saldo });
  }
  const { error } = await A.db
    .from("movements")
    .insert({ client_id: clientId, created_by: A.id, type: "charge", amount: saldo, currency: "USD", sale_id: venta.id, source: "manual", paid_with_credit: true });
  if (error) throw new Error(`venta con saldo: ${error.message}`);
}

const devolver = (v, qty, resto = {}, owner = A) =>
  owner.db.rpc("registrar_devolucion_contado", {
    p_sale_id: v.saleId,
    p_line_id: v.lineId,
    p_quantity: qty,
    p_fiados: resto.fiados ?? [],
    p_a_favor: resto.aFavor ?? 0,
    p_efectivo: resto.efectivo ?? 0,
  });

async function libro(clientId, campo = "balance_usd") {
  const { data } = await admin.from("client_summary_all").select("*").eq("client_id", clientId).maybeSingle();
  return Number(data?.[campo] ?? 0);
}
const pendiente = async (clientId, chargeId) => {
  const { data } = await A.db.rpc("get_open_charges_for_client", { p_client_id: clientId });
  return Number((data ?? []).find((c) => c.movement_id === chargeId)?.pending ?? 0);
};
const credito = async (clientId) => {
  const { data } = await A.db.rpc("get_client_credit", { p_client_id: clientId });
  return Number((data ?? []).find((c) => c.currency === "USD")?.credit ?? 0);
};
const reporte = (clientId) =>
  cargarFacturacion({ supabase: A.db, ownerId: A.id, rango: rangoDe({}), dosLibros: true, clientId });

try {
  if (!env.QA_OWNER_EMAIL) throw new Error("falta QA_OWNER_EMAIL en .env.local");
  A = await comoDueno(env.QA_OWNER_EMAIL);

  // ── 1. THE OWNER'S THREE CASES, WITH A $10 SHIRT ──────────────────────────
  {
    const inicioAntes = (await ventasDelPeriodo({ supabase: A.db, ownerId: A.id, rango: rangoDe({}) })).USD ?? 0;

    const c1 = await clienteNuevo();
    const v1 = await contado(c1, { qty: 1 });
    const { data: r1 } = await devolver(v1, 1, { efectivo: 10 });
    const f1 = await reporte(c1);
    check("1a. le regresa el dinero: la devolución se registra", r1?.ok === true, JSON.stringify(r1));
    check("1b. «Ventas» queda en $0", igual(f1.ventas.USD ?? 0, 0), f1.ventas.USD);
    check("1c. la suma del gráfico de ventas es la de la tarjeta", igual(f1.serieVentas.reduce((s, p) => s + (p.USD ?? 0), 0), f1.ventas.USD ?? 0));
    check("1d. «Devoluciones» dice $10", igual(f1.devoluciones.USD ?? 0, 10), f1.devoluciones.USD);
    check("1e. «Abonos» no se mueve", igual(f1.abonos.USD ?? 0, 0), f1.abonos.USD);
    check("1f. «Fiados» no se mueve", igual(f1.fiados.USD ?? 0, 0), f1.fiados.USD);
    check("1g. el gráfico cuenta una devolución", f1.serieTransacciones.reduce((s, p) => s + p.devolucion, 0) === 1);
    check("1h. el saldo del cliente no cambia", igual(await libro(c1), 0), await libro(c1));

    const c2 = await clienteNuevo();
    const v2 = await contado(c2, { qty: 1 });
    await devolver(v2, 1, { aFavor: 10 });
    check("2a. otro producto: queda saldo a favor de $10", igual(await credito(c2), 10), await credito(c2));
    await ventaConSaldo(c2, { valor: 10, saldo: 10 });
    const f2 = await reporte(c2);
    check("2b. «Ventas» queda en $10, lo que entró", igual(f2.ventas.USD ?? 0, 10), f2.ventas.USD);
    check("2c. no le queda ni deuda ni saldo", igual(await libro(c2), 0) && igual(await credito(c2), 0), await libro(c2));
    check("2d. «Fiados» sigue en $0: nadie prestó nada", igual(f2.fiados.USD ?? 0, 0), f2.fiados.USD);

    const c3 = await clienteNuevo();
    const v3 = await contado(c3, { qty: 1 });
    await devolver(v3, 1, { aFavor: 10 });
    await ventaConSaldo(c3, { valor: 15, saldo: 10 });
    const f3 = await reporte(c3);
    check("3a. uno más caro: «Ventas» queda en $15, lo que entró", igual(f3.ventas.USD ?? 0, 15), f3.ventas.USD);
    check("3b. no le queda ni deuda ni saldo", igual(await libro(c3), 0) && igual(await credito(c3), 0), await libro(c3));

    const inicioDespues = (await ventasDelPeriodo({ supabase: A.db, ownerId: A.id, rango: rangoDe({}) })).USD ?? 0;
    check("3c. el Inicio dice lo mismo: +$25 entre los tres casos", igual(inicioDespues - inicioAntes, 25), inicioDespues - inicioAntes);
  }

  // ── 2. WHAT IT WRITES ────────────────────────────────────────────────────
  {
    const c = await clienteNuevo();
    const p = await productoNuevo(5);
    const v = await contado(c, { qty: 3, product: p });
    // The sale took its three units off the shelf (migration 163): 5 is now 2.
    const { data: r } = await devolver(v, 2, { efectivo: 20 });
    const { data: ev } = await A.db.from("sale_returns").select("*").eq("id", r.return_id).single();
    check("4. el dueño lee su fila, sin fiado y con el efectivo", ev?.charge_movement_id === null && igual(ev?.to_cash, 20), ev?.charge_movement_id);
    const { data: lineas } = await admin.from("movements").select("amount, type, applies_to_movement_id, transaction_code").eq("payment_group_id", r.return_id);
    check("5. una línea en el libro, a cero y con su código", lineas?.length === 1 && igual(lineas[0].amount, 0) && !!lineas[0].transaction_code, JSON.stringify(lineas));
    const { data: pr } = await admin.from("products").select("stock_opening").eq("id", p).single();
    check("6. las unidades vuelven al inventario", igual(pr.stock_opening, 4), pr.stock_opening);

    const { data: mas } = await devolver(v, 2, { efectivo: 20 });
    check("7. no se devuelve más de lo que queda", mas?.code === "excede_la_cantidad", mas?.code);

    const { data: ok1 } = await A.db.rpc("eliminar_devolucion", { p_movement_id: r.movement_id });
    const { data: pr2 } = await admin.from("products").select("stock_opening").eq("id", p).single();
    const { data: aviso } = await admin.from("movement_deletions").select("movement_id").eq("client_id", c);
    check("8a. eliminarla devuelve el estante", ok1?.ok === true && igual(pr2.stock_opening, 2), pr2.stock_opening);
    check("8b. y deja su aviso para restaurarla", (aviso ?? []).length === 1, (aviso ?? []).length);
    const { data: ok2 } = await A.db.rpc("restaurar_devolucion", { p_movement_id: r.movement_id });
    const { data: pr3 } = await admin.from("products").select("stock_opening").eq("id", p).single();
    check("8c. restaurarla vuelve a ponerlo todo", ok2?.ok === true && igual(pr3.stock_opening, 4), pr3.stock_opening);

    const { error: sinBorrar } = await A.db.from("sales").update({ deleted_at: new Date().toISOString() }).eq("id", v.saleId);
    check("9. una venta con devolución viva no se borra", !!sinBorrar, sinBorrar?.message);
  }

  // ── 3. WHAT IS OFFERED ───────────────────────────────────────────────────
  {
    const c = await clienteNuevo();
    const v = await contado(c, { qty: 2 });
    const f = await fiado(c, 15);
    const { data: sinDecir } = await devolver(v, 1);
    check("10. sin decir qué se hace con el dinero se rechaza", sinDecir?.code === "reparto_no_cuadra", sinDecir?.code);
    const { data: conDeuda } = await devolver(v, 1, { aFavor: 10 });
    check("11. con deuda en esa moneda no hay saldo a favor", conDeuda?.code === "hay_deuda_en_esa_moneda", conDeuda?.code);
    const { data: abono } = await devolver(v, 1, { fiados: [{ fiado_id: f, amount: 10 }] });
    check("12a. abona al fiado", abono?.ok === true && igual(await pendiente(c, f), 5), await pendiente(c, f));
    check("12b. y el saldo baja", igual(await libro(c), 5), await libro(c));
    const { data: resto } = await devolver(v, 1, { fiados: [{ fiado_id: f, amount: 5 }], aFavor: 5 });
    check("13. lo que el fiado no se lleva queda a favor", resto?.ok === true && igual(await libro(c), -5), await libro(c));
    const reporteC = await reporte(c);
    check("14. nada de eso sale de «Ventas»: el dinero no salió de la caja", igual(reporteC.ventas.USD ?? 0, 20), reporteC.ventas.USD);

    const otraMoneda = await clienteNuevo();
    const ve = await contado(otraMoneda, { qty: 1 });
    await fiado(otraMoneda, 30, { currency: "EUR" });
    const { data: ok } = await devolver(ve, 1, { aFavor: 10 });
    check("15. una deuda en otra moneda no cambia nada", ok?.ok === true && igual(await libro(otraMoneda), -10), JSON.stringify(ok));
  }

  // ── 4. THE MOSTRADOR ─────────────────────────────────────────────────────
  {
    const { data: walk } = await admin.from("clients").select("id").eq("owner_id", A.id).eq("is_walk_in", true).maybeSingle();
    const mostrador = walk?.id ?? (await clienteNuevo(A, { is_walk_in: true }));
    const v = await contado(mostrador, { qty: 2 });
    const { data: favor } = await devolver(v, 1, { aFavor: 10 });
    check("16. una venta sin cliente no deja saldo a favor", favor?.code === "sin_cliente", favor?.code);
    const { data: ok } = await devolver(v, 1, { efectivo: 10 });
    check("17a. sí devuelve el dinero", ok?.ok === true, JSON.stringify(ok));
    check("17b. el mostrador sigue sin saldo", igual(await libro(mostrador), 0), await libro(mostrador));
    if (ok?.movement_id) {
      await A.db.rpc("eliminar_devolucion", { p_movement_id: ok.movement_id });
    }
    await admin.from("sale_returns").delete().eq("sale_id", v.saleId);
    await admin.from("movement_deletions").delete().eq("movement_id", ok?.movement_id);
    await admin.from("movements").delete().eq("id", ok?.movement_id);
    await admin.from("sales").delete().eq("id", v.saleId);
  }

  // ── 5. REFUSALS ──────────────────────────────────────────────────────────
  {
    const c = await clienteNuevo();
    const v = await contado(c, { qty: 3 });
    const otra = await contado(c, { qty: 1 });

    const { data: ajena } = await devolver({ saleId: v.saleId, lineId: otra.lineId }, 1, { efectivo: 10 });
    check("18. una línea de otra venta se rechaza", ajena?.code === "linea_ajena", ajena?.code);

    const { data: inventada } = await devolver({ saleId: crypto.randomUUID(), lineId: v.lineId }, 1, { efectivo: 10 });
    check("19. una venta que no existe se rechaza", inventada?.code === "venta_ajena", inventada?.code);

    const bajada = await contado(c, { qty: 2, pagado: 15 });
    const { data: uno } = await devolver(bajada, 1, { efectivo: 10 });
    const { data: dos } = await devolver(bajada, 1, { efectivo: 10 });
    check("20. no se devuelve más de lo que se cobró", uno?.ok === true && dos?.code === "excede_la_venta", dos?.code);

    const { data: sinSesion, error: eN } = await anon().rpc("registrar_devolucion_contado", {
      p_sale_id: v.saleId, p_line_id: v.lineId, p_quantity: 1, p_fiados: [], p_a_favor: 0, p_efectivo: 10,
    });
    check("21. sin sesión no se ejecuta", !!eN || sinSesion?.ok === false, eN?.message ?? sinSesion?.code);

    // A book that left a charge belongs to `registrar_devolucion`.
    const { data: mix } = await A.db.from("sales").insert({ owner_id: A.id, client_id: c, created_by: A.id }).select("id").single();
    const { data: lm } = await A.db.from("sale_lines").insert({ sale_id: mix.id, name: `${MARCA} mix`, quantity: 1, unit_price: 10, currency: "USD", tier: "retail" }).select("id").single();
    await A.db.from("movements").insert({ client_id: c, created_by: A.id, type: "charge", amount: 10, currency: "USD", sale_id: mix.id, source: "manual" });
    const { data: fiadoNo } = await devolver({ saleId: mix.id, lineId: lm.id }, 1, { efectivo: 10 });
    check("22. un libro con fiado no pasa por aquí", fiadoNo?.code === "tiene_fiado", fiadoNo?.code);
  }

  // ── 6. THE CLIENT'S LINK ─────────────────────────────────────────────────
  {
    const c = await clienteNuevo();
    const v = await contado(c, { qty: 3 });
    await devolver(v, 1, { aFavor: 10 });
    const token = `zz${Date.now()}${Math.random().toString(36).slice(2, 10)}`;
    const { error: eS } = await admin.from("share_links").insert({ client_id: c, token });
    if (eS) throw new Error(`share: ${eS.message}`);
    const { data: s, error } = await anon().rpc("get_shared_balance", { p_token: token });
    const fila = s?.movements?.find((m) => m.type === "return");
    check("23a. el cliente ve la devolución con su venta", fila?.devolucion?.sale_id === v.saleId && fila?.devolucion?.charge_movement_id === null, error?.message ?? JSON.stringify(fila?.devolucion));
    const compra = s?.ventas_de_contado?.find((x) => x.sale_id === v.saleId);
    check("23b. y la línea de su compra marca lo devuelto", Number(compra?.lineas?.[0]?.devuelto) === 1, JSON.stringify(compra?.lineas));
    check("23c. y su saldo a favor", igual(s?.balance_usd, -10), s?.balance_usd);
  }

  // ── 7. WHAT THE YELLOW NOTICE PROMISES ───────────────────────────────────
  //
  // `bookAfter` writes the figures of the notice. Each one is checked against
  // what the card reads once the return is really registered.
  {
    const promesa = async (nombre, { deuda, favor = 0, elige, esperado }) => {
      const c = await clienteNuevo();
      const v = await contado(c, { qty: 1 });
      let f = null;
      if (deuda) f = await fiado(c, deuda);
      if (favor) {
        const previa = await contado(c, { qty: 1, price: favor });
        await devolver(previa, 1, { aFavor: favor });
      }
      const antes = await libro(c);
      const promete = bookAfter(antes, 0, 10, deuda ?? 0);
      const r = elige === "efectivo"
        ? await devolver(v, 1, { efectivo: 10 })
        : elige === "favor"
          ? await devolver(v, 1, { aFavor: 10 })
          : await devolver(v, 1, { fiados: [{ fiado_id: f, amount: Math.min(10, deuda) }], efectivo: Math.max(0, 10 - deuda) });
      const prometido = elige === "efectivo" ? promete.afterOwn : elige === "favor" ? promete.afterCredit : promete.afterAbono;
      const despues = await libro(c);
      check(nombre, r.data?.ok === true && igual(prometido, esperado) && igual(despues, esperado), `prometió ${prometido}, la tarjeta dice ${despues}`);
    };
    await promesa("25a. sin deuda, dinero: sigue en $0", { elige: "efectivo", esperado: 0 });
    await promesa("25b. sin deuda, a favor: $10 a favor", { elige: "favor", esperado: -10 });
    await promesa("25c. con saldo previo, dinero: sigue a favor, no en $0", { favor: 3, elige: "efectivo", esperado: -3 });
    await promesa("25d. con saldo previo, a favor: se suman", { favor: 3, elige: "favor", esperado: -13 });
    await promesa("25e. debe $25, abono: baja a $15", { deuda: 25, elige: "abono", esperado: 15 });
    await promesa("25f. debe $25, dinero: sigue en $25", { deuda: 25, elige: "efectivo", esperado: 25 });
    await promesa("25g. debe $4, abono: baja a $0 y el resto se devuelve", { deuda: 4, elige: "abono", esperado: 0 });
  }

  // ── 8. A COLOMBIAN BOOK ──────────────────────────────────────────────────
  {
    const { data: co } = await admin.from("owners").select("id").eq("country", "CO").limit(1).maybeSingle();
    const { data: u } = co ? await admin.auth.admin.getUserById(co.id) : { data: null };
    if (!u?.user?.email) {
      check("24. libro colombiano", false, "no hay un dueño colombiano en dev");
    } else {
      const B = await comoDueno(u.user.email);
      const c = await clienteNuevo(B);
      const v = await contado(c, { qty: 2, price: 5000, currency: "COP", owner: B });
      const { data: r } = await devolver(v, 1, { aFavor: 5000 }, B);
      const { data: ev } = r?.ok ? await B.db.from("sale_returns").select("currency, to_credit").eq("id", r.return_id).single() : { data: null };
      check("24a. su libro se escribe NULL, no 'COP'", r?.ok === true && ev?.currency === null, JSON.stringify(r));
      check("24b. y el saldo a favor cae en ese libro", igual(await libro(c, "balance"), -5000), await libro(c, "balance"));
      const f = await cargarFacturacion({ supabase: B.db, ownerId: B.id, rango: rangoDe({}), dosLibros: false, clientId: c });
      check("24c. Reportes lo lee en su libro", igual(f.devoluciones.COP ?? 0, 5000) && igual(f.ventas.COP ?? 0, 10000), JSON.stringify(f.devoluciones));
    }
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
