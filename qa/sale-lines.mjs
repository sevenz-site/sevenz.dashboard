// SOLO LA RAMA DEV (vzqppwrwnmlbrxizskdh) — lee .env.local.
//
// LA VENTA: migración 124 — `sales`, `sale_lines`, `sale_payments`,
// `movements.sale_id` y `clients.is_walk_in`.
//
// SÍ ESCRIBE en dev: crea sus propias ventas, líneas y clientes, y el
// `finally` los borra aunque el script se caiga a mitad.
//
// ===========================================================================
// SUSTITUYE A `qa/productos-del-movimiento.mjs`, que vigilaba la tabla
// `movement_products` de la migración 122. Esa tabla ya no existe: las líneas
// se mudaron a la venta porque una venta pagada al contado no escribe nada en
// `movements` y por tanto no tiene movimiento del que colgar.
//
// ===========================================================================
// LA MITAD QUE IMPORTA: ESTO LEE **CON LA SESIÓN DEL DUEÑO**
//
// Todo script de `qa/` se autentica con la clave de servicio, que **salta la
// RLS y no necesita ningún grant**. La sesión del tendero no tiene ninguna de
// las dos cosas, así que una suite construida solo sobre esa clave no puede
// ver los dos fallos que más a menudo rompen una pantalla: una política que
// le filtra sus propias filas, y un `grant` que falta.
//
// NO ES TEÓRICO. La migración `108` creó `catalog_orders`, encendió la RLS,
// escribió una política correcta — y no concedió nada a `authenticated`. Cada
// lectura del dueño murió con `42501`, la pantalla de Pedidos decía «todavía
// no te ha llegado ningún pedido» con tres pedidos dentro, y `qa:pedidos`
// pasaba 14 de 14 en ese mismo instante. Lo arregló la `116`.
//
// La `124` concede explícitamente, y las comprobaciones 6 y 7 son las que lo
// demuestran en vez de confiarlo.

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
  console.error("Este script ESCRIBE. Nunca contra producción.");
  process.exit(1);
}

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const filas = [];
function check(nombre, pasa, detalle) {
  filas.push({ nombre, pasa });
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${detalle ? `  — ${detalle}` : ""}`);
}

const MARCA = "ZZ QA venta";
const ventas = [];
const clientes = [];
const productos = [];
const movimientos = [];

try {
  // EL NEGOCIO, FIJADO POR ID. `.order("id")` y no el primero que salga: es
  // la lección del 2026-10-17 con `qa:orden`, que daba 32/35 un día y 35/35
  // al siguiente porque `.limit()` sin orden devuelve lo que Postgres quiera.
  const { data: ve } = await admin
    .from("owners")
    .select("id, country")
    .eq("country", "VE")
    .order("id")
    .limit(1)
    .maybeSingle();
  if (!ve) {
    console.error("ME NIEGO A CORRER: no hay ningún negocio VE en dev.");
    process.exit(1);
  }

  const { data: otro } = await admin
    .from("owners")
    .select("id")
    .neq("id", ve.id)
    .order("id")
    .limit(1)
    .maybeSingle();

  const { data: cliente } = await admin
    .from("clients")
    .insert({ owner_id: ve.id, name: `${MARCA} cliente` })
    .select("id")
    .single();
  clientes.push(cliente.id);

  const { data: prod } = await admin
    .from("products")
    .insert({
      owner_id: ve.id,
      name: `${MARCA} producto`,
      base_currency: "USD",
      base_currency_retail: "USD",
      price_retail: 10,
    })
    .select("id")
    .single();
  productos.push(prod.id);

  // ── 1. UNA VENTA PAGADA NO TOCA EL SALDO ────────────────────────────
  //
  // Es la decisión del dueño del 2026-10-17 hecha comprobación, y la razón
  // entera de que el modelo sea así: `recalc_client_running_balance` no tiene
  // fila neutra, y el contado no puede entrar en el puntaje de crédito.
  const { data: saldoAntes } = await admin
    .from("client_summary")
    .select("balance_usd")
    .eq("client_id", cliente.id)
    .maybeSingle();

  const { data: ventaContado, error: eVenta } = await admin
    .from("sales")
    .insert({ owner_id: ve.id, client_id: cliente.id })
    .select("id")
    .single();
  if (eVenta) throw new Error(`alta de venta: ${eVenta.message}`);
  ventas.push(ventaContado.id);

  await admin.from("sale_lines").insert({
    sale_id: ventaContado.id,
    product_id: prod.id,
    name: `${MARCA} producto`,
    quantity: 2,
    unit_price: 10,
    currency: "USD",
  });
  await admin.from("sale_payments").insert({
    sale_id: ventaContado.id,
    currency: "USD",
    amount: 20,
    entry_currency: "VES",
    entry_amount: 760,
    rate_used: 38,
  });

  const { data: saldoDespues } = await admin
    .from("client_summary")
    .select("balance_usd")
    .eq("client_id", cliente.id)
    .maybeSingle();

  // LAS DOS FILAS TIENEN QUE EXISTIR, y esa condición no sobra: la primera
  // versión de esta comprobación preguntaba por `id` en vez de `client_id`,
  // así que las dos lecturas devolvían `null`, el `?? 0` las convertía en
  // ceros y la fila pasaba comparando 0 con 0. Verde, y sin medir nada.
  check(
    "1. una venta PAGADA no mueve el saldo del cliente",
    saldoAntes != null &&
      saldoDespues != null &&
      Number(saldoAntes.balance_usd) === Number(saldoDespues.balance_usd),
    saldoAntes == null || saldoDespues == null
      ? "NO SE LEYÓ EL SALDO — la comprobación no mide nada"
      : `antes ${saldoAntes.balance_usd} · después ${saldoDespues.balance_usd}`,
  );

  const { count: movimientosDeLaVenta } = await admin
    .from("movements")
    .select("id", { count: "exact", head: true })
    .eq("sale_id", ventaContado.id);
  check(
    "1b. y NO escribe ningún movimiento — por eso el puntaje de crédito no la ve",
    movimientosDeLaVenta === 0,
    `${movimientosDeLaVenta} movimientos`,
  );

  // ── 2. LO QUE DE VERDAD SE ENTREGÓ SE CONSERVA ──────────────────────
  const { data: pago } = await admin
    .from("sale_payments")
    .select("amount, currency, entry_amount, entry_currency, rate_used")
    .eq("sale_id", ventaContado.id)
    .single();
  check(
    "2. el pago guarda el libro Y lo que el cliente entregó, con su tasa",
    Number(pago.amount) === 20 &&
      pago.currency === "USD" &&
      Number(pago.entry_amount) === 760 &&
      pago.entry_currency === "VES" &&
      Number(pago.rate_used) === 38,
    JSON.stringify(pago),
  );

  // ── 3. UNA VENTA A CRÉDITO ESCRIBE EL CARGO POR LO QUE QUEDA ────────
  //
  // «una compra por 10 USD puede abonar 5 y quedar debiendo 5» — el dueño,
  // 2026-10-17. Los 10 nunca entran como deuda porque nunca se debieron 10.
  const { data: ventaCredito, error: eCredito } = await admin
    .from("sales")
    .insert({ owner_id: ve.id, client_id: cliente.id })
    .select("id")
    .single();
  if (eCredito) throw new Error(`venta a credito: ${eCredito.message}`);
  ventas.push(ventaCredito.id);
  await admin.from("sale_lines").insert({
    sale_id: ventaCredito.id,
    product_id: prod.id,
    name: `${MARCA} producto`,
    quantity: 1,
    unit_price: 10,
    currency: "USD",
  });
  await admin
    .from("sale_payments")
    .insert({ sale_id: ventaCredito.id, currency: "USD", amount: 5 });

  const { data: cargo, error: eCargo } = await admin
    .from("movements")
    .insert({
      client_id: cliente.id,
      type: "charge",
      amount: 5,
      currency: "USD",
      plazo_dias: 30,
      // DOS Y NO UNA: el `check` de la migración `118` exige entre 2 y 36,
      // porque «una cuota» no son cuotas. La primera versión de esta prueba
      // puso 1 y la base la rechazó — exactamente para lo que está ese check.
      cuotas: 2,
      sale_id: ventaCredito.id,
      description: `${MARCA} resto`,
    })
    .select("id, amount, sale_id")
    .single();
  if (eCargo) throw new Error(`cargo del resto: ${eCargo.message}`);
  movimientos.push(cargo.id);

  check(
    "3. el cargo es por el RESTO (5), no por el total (10), y apunta a su venta",
    Number(cargo.amount) === 5 && cargo.sale_id === ventaCredito.id,
    `${cargo.amount} · sale_id ${cargo.sale_id === ventaCredito.id ? "correcto" : "MAL"}`,
  );

  const { data: saldoCredito } = await admin
    .from("client_summary")
    .select("balance_usd")
    .eq("client_id", cliente.id)
    .maybeSingle();
  check(
    "3b. y el saldo sube SOLO por ese resto",
    saldoCredito != null &&
      saldoAntes != null &&
      Number(saldoCredito.balance_usd) - Number(saldoAntes.balance_usd) === 5,
    saldoCredito == null || saldoAntes == null
      ? "NO SE LEYÓ EL SALDO"
      : `subió ${Number(saldoCredito.balance_usd) - Number(saldoAntes.balance_usd)}`,
  );

  // ── 4. EL PRODUCTO DE OTRO NEGOCIO NO ENTRA ─────────────────────────
  //
  // `product_id` llega desde el navegador. La RLS protege la FILA, no lo que
  // esa fila apunta: sin el disparador, un dueño podría meter en SU venta una
  // línea que referencia el producto de otro y ninguna política lo vería.
  let rechazado = null;
  if (otro) {
    const { data: ajeno } = await admin
      .from("products")
      .insert({
        owner_id: otro.id,
        name: `${MARCA} ajeno`,
        base_currency: "USD",
        base_currency_retail: "USD",
        price_retail: 99,
      })
      .select("id")
      .single();
    productos.push(ajeno.id);
    const { error } = await admin.from("sale_lines").insert({
      sale_id: ventaContado.id,
      product_id: ajeno.id,
      name: "intruso",
      quantity: 1,
      unit_price: 99,
      currency: "USD",
    });
    rechazado = error?.message ?? null;
  }
  check(
    "4. una línea que apunta al producto de OTRO negocio se rechaza",
    rechazado != null && /producto_de_otro_negocio/.test(rechazado),
    rechazado ?? "NO se rechazó",
  );

  // ── 5. SIN USDT ─────────────────────────────────────────────────────
  //
  // Decisión del dueño del 2026-10-17: el USDT vuelve con el paso 11. El
  // `check` de la columna es lo que convierte eso en un fallo ruidoso en vez
  // de una venta guardada en una moneda que el libro no sabe sumar.
  const { error: eUsdt } = await admin.from("sale_lines").insert({
    sale_id: ventaContado.id,
    product_id: null,
    name: "en usdt",
    quantity: 1,
    unit_price: 1,
    currency: "USDT",
  });
  check(
    "5. una línea en USDT se rechaza — vuelve con el paso 11 (CT-79)",
    eUsdt != null,
    eUsdt?.message ?? "LA ACEPTÓ",
  );

  // ── 6 y 7. CON LA SESIÓN DEL DUEÑO, que es lo que la clave de servicio
  //          no puede comprobar ──────────────────────────────────────────
  const usuarios = await admin.auth.admin.listUsers({ perPage: 200 });
  const correo = usuarios.data.users.find((u) => u.id === ve.id)?.email;
  const { data: link } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: correo,
  });
  const anonParaSesion = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false } },
  );
  const { data: sesion } = await anonParaSesion.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.properties.hashed_token,
  });
  const dueno = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${sesion.session.access_token}` } },
  });

  const r6 = await dueno.from("sale_lines").select("name").eq("sale_id", ventaContado.id);
  check(
    "6. el DUEÑO lee sus líneas con su sesión — el grant existe y la política le deja",
    !r6.error && (r6.data ?? []).length > 0,
    r6.error ? r6.error.message : `${r6.data.length} líneas`,
  );

  const r6b = await dueno
    .from("sales")
    .insert({ owner_id: ve.id, client_id: cliente.id })
    .select("id");
  if (!r6b.error && r6b.data?.[0]) ventas.push(r6b.data[0].id);
  check(
    "6b. y puede CREAR una venta — `insert` es otro grant distinto de `select`",
    !r6b.error,
    r6b.error ? r6b.error.message : "creada",
  );

  // ANON DE VERDAD, construido aparte: el cliente de arriba consumió un
  // enlace mágico y lleva la sesión del dueño encima. Reutilizarlo diría que
  // «anon puede leer» cuando quien lee es el dueño. Pasó el 2026-10-17.
  const anonDeVerdad = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false } },
  );
  const r7 = await anonDeVerdad.from("sale_lines").select("id").limit(1);
  check(
    "7. anon NO puede leer ninguna línea de venta",
    r7.error != null || (r7.data ?? []).length === 0,
    r7.error ? r7.error.message : `devolvió ${r7.data.length}`,
  );

  // ── 8. EL CLIENTE MOSTRADOR, uno por negocio ────────────────────────
  const { data: mostrador } = await admin
    .from("clients")
    .insert({ owner_id: ve.id, name: `${MARCA} mostrador`, is_walk_in: true })
    .select("id")
    .single();
  clientes.push(mostrador.id);
  const { error: eSegundo } = await admin
    .from("clients")
    .insert({ owner_id: ve.id, name: `${MARCA} mostrador 2`, is_walk_in: true })
    .select("id")
    .single();
  check(
    "8. un negocio no puede tener DOS clientes mostrador",
    eSegundo != null,
    eSegundo?.message ?? "ACEPTÓ EL SEGUNDO",
  );
} catch (e) {
  check("la suite llegó al final", false, e instanceof Error ? e.message : String(e));
} finally {
  if (movimientos.length) await admin.from("movements").delete().in("id", movimientos);
  if (ventas.length) await admin.from("sales").delete().in("id", ventas);
  if (productos.length) await admin.from("products").delete().in("id", productos);
  if (clientes.length) await admin.from("clients").delete().in("id", clientes);

  const { count: quedanVentas } = await admin
    .from("sale_lines")
    .select("id", { count: "exact", head: true })
    .like("name", `${MARCA}%`);
  const { count: quedanClientes } = await admin
    .from("clients")
    .select("id", { count: "exact", head: true })
    .like("name", `${MARCA}%`);
  check(
    "9. limpieza: no queda nada de la prueba en dev",
    quedanVentas === 0 && quedanClientes === 0,
    `${quedanVentas} líneas · ${quedanClientes} clientes`,
  );

  const fallos = filas.filter((f) => !f.pasa).length;
  console.log(`\n${filas.length - fallos}/${filas.length} pasan.`);
  if (fallos) process.exitCode = 1;
}
