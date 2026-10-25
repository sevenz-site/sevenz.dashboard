// DEV BRANCH ONLY (vzqppwrwnmlbrxizskdh) — reads .env.local.
//
// IT WRITES to dev: clients, products, catalog orders and sales. The
// `finally` removes them even if the script dies half way.
//
// REQUIRES `npm run dev` RUNNING on port 3000.
//
// ===========================================================================
// WHY THIS SUITE EXISTS, AND WHY IT IS WRITTEN BEFORE `CT-147` AND NOT AFTER
//
// `registrarPedidoComoVenta` is the one place where a catalogue order turns
// into money. Until it existed, an order and the ledger were two unrelated
// things — that is the owner's decision 7 of 2026-10-14, now displaced. So
// everything this action gets wrong is wrong about a real sale, and none of
// the existing suites look at it: `qa:pedidos` covers the orders screen and
// `qa:venta-accion` covers `registrarVenta` reached from the sale assistant.
//
// `CT-147` is going to REDESIGN this flow — charging per currency instead of
// per product. That is an argument for writing the suite now, not for
// waiting: a rewrite is exactly when the behaviours below get broken by
// accident, and one written afterwards can only confirm whatever survived.
//
// WHAT SURVIVES `CT-147` AND WHAT DOES NOT, stated so the next person does
// not have to guess: every ASSERTION here is about an outcome that does not
// depend on how the shopkeeper is asked to pay — the sealed price, the
// excluded line, the stamped order, the double registration, the ownership
// check, the client created from the flow. What `CT-147` changes is the
// INPUT: `pagos` stops being one row per line. That shape is built in ONE
// place, `pagoDeLinea()` below, so the rewrite updates one function instead
// of nine tests.
//
// ===========================================================================
// IT RUNS AS THE OWNER, AND THAT IS NOT INCIDENTAL
//
// Every call goes through the owner's own session cookie, the same way the
// shopkeeper's browser does — `generateLink` + `verifyOtp`, no password
// typed. So a missing grant, or a policy that filters the owner's rows away,
// shows up here. That is the gap migration `108` left open for the Pedidos
// screen and `116` closed, and it is the reason CLAUDE.md says a suite built
// only on the service key cannot see the two things that most often break a
// screen.

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

const BASE = process.env.QA_BASE_URL ?? "http://localhost:3000";

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const filas = [];
function check(nombre, pasa, detalle) {
  filas.push({ nombre, pasa });
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${detalle ? `  — ${detalle}` : ""}`);
}

const MARCA = "QA PEDIDO REG";
const creados = { clientes: [], productos: [], pedidos: [], ventas: [] };

// ── THE INPUT SHAPE, IN ONE PLACE ──────────────────────────────────────
//
// `CT-147` landed on 2026-10-25 and this is what it changed: the term and
// the instalments moved off the LINE and onto the CURRENCY, and a call now
// registers one currency block instead of the whole order. Every assertion
// below is untouched by that, which is what the two functions are for.
function pagoDeMoneda({ amount = 0, plazo = "", cuotas = "" } = {}) {
  return {
    amount,
    entryCurrency: null,
    entryAmount: null,
    plazo,
    cuotas,
    usarPrevista: false,
    photoPath: null,
    description: "",
  };
}

function entradaDe(pedidoId, moneda, pago, cliente, editadas = {}) {
  return { pedidoId, moneda, pago, editadas, cliente };
}

function clienteNuevo(documento) {
  return {
    fichaId: null,
    name: `${MARCA} comprador ${documento}`,
    documentId: documento,
    documentType: "V",
    whatsapp: "584121119999",
    address: "Calle de prueba",
    consienteWhatsapp: false,
  };
}

// Discovery of the server-action id: the same approach as
// `qa/venta-accion.mjs`, whose comments explain why the id is discovered and
// never written down (it is a per-build hash, so a literal would rot).
async function idDeLaAccion(base, nombre, cookie, ruta) {
  const res = await fetch(`${base}${ruta}`, { headers: { Cookie: cookie } });
  if (!res.ok) throw new Error(`${ruta} respondió HTTP ${res.status} en ${base}`);
  const html = await res.text();

  const urls = [
    ...new Set([...html.matchAll(/(?:src|href)="(\/_next\/[^"]+\.js)"/g)].map((m) => m[1])),
  ];
  if (urls.length === 0) {
    throw new Error(
      `la página de ${base} no declara ningún chunk — ¿la sesión no entró y devolvió el login?`,
    );
  }
  const vistos = new Set(urls);
  const textos = new Map();
  for (const u of [...urls]) {
    const r = await fetch(`${base}${u}`);
    if (!r.ok) continue;
    const t = await r.text();
    textos.set(u, t);
    for (const m of t.matchAll(/["'(]((?:\/_next\/)[^"')]+?\.js)["')]/g)) {
      if (!vistos.has(m[1]) && vistos.size < 400) {
        vistos.add(m[1]);
        urls.push(m[1]);
      }
    }
  }
  const re = new RegExp(`"([0-9a-f]{40,})"[^()]{0,200}?"${nombre}"`);
  for (const u of urls) {
    let t = textos.get(u);
    if (t == null) {
      const r = await fetch(`${base}${u}`);
      if (!r.ok) continue;
      t = await r.text();
    }
    const m = re.exec(t);
    if (m) return m[1];
  }
  return null;
}

try {
  // ── THE OWNER'S SESSION, with no password typed ───────────────────────
  const { data: ve, error: eVe } = await admin
    .from("owners")
    .select("id, business_name")
    .eq("country", "VE")
    .order("id")
    .limit(1)
    .single();
  if (eVe) throw new Error(`owners VE: ${eVe.message}`);

  const usuarios = await admin.auth.admin.listUsers({ perPage: 200 });

  // UNA FUNCIÓN Y NO UN BLOQUE, porque hacen falta DOS sesiones: la del dueño
  // venezolano y la del colombiano. Escribir la segunda a mano, copiada, es
  // cómo las dos dejan de ser la misma cosa el día que una cambie.
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
  async function cookieDe(ownerId, etiqueta) {
    const correo = usuarios.data.users.find((u) => u.id === ownerId)?.email;
    if (!correo) throw new Error(`el dueño ${etiqueta} no tiene correo con el que abrir sesión`);
    const { data: link } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: correo,
    });
    const { data: verificado, error: eOtp } = await anon.auth.verifyOtp({
      type: "magiclink",
      token_hash: link.properties.hashed_token,
    });
    if (eOtp) throw new Error(`verifyOtp ${etiqueta}: ${eOtp.message}`);
    const nombreCookie = `sb-${ref}-auth-token`;
    const valor =
      "base64-" + Buffer.from(JSON.stringify(verificado.session), "utf8").toString("base64url");
    const MAX = 3180;
    return (
      valor.length <= MAX
        ? [`${nombreCookie}=${valor}`]
        : Array.from(
            { length: Math.ceil(valor.length / MAX) },
            (_, i) => `${nombreCookie}.${i}=${valor.slice(i * MAX, (i + 1) * MAX)}`,
          )
    ).join("; ");
  }
  const cookie = await cookieDe(ve.id, "VE");

  // ── THE FIXTURES ──────────────────────────────────────────────────────
  //
  // The product is created at 5 and MOVED to 9 before the first
  // registration. That gap is the whole point of the first check: the
  // customer placed the order seeing 5.
  const { data: prod, error: eProd } = await admin
    .from("products")
    .insert({
      owner_id: ve.id,
      name: `${MARCA} producto`,
      base_currency: "USD",
      price_retail: 5,
      published_retail: true,
    })
    .select("id")
    .single();
  if (eProd) throw new Error(`products: ${eProd.message}`);
  creados.productos.push(prod.id);

  async function nuevoPedido(nombre, lineas) {
    const { data: p, error } = await admin
      .from("catalog_orders")
      .insert({
        owner_id: ve.id,
        customer_name: `${MARCA} ${nombre}`,
        customer_document: "1234567",
        customer_whatsapp: "584121119999",
        customer_whatsapp_raw: "04121119999",
      })
      .select("id")
      .single();
    if (error) throw new Error(`catalog_orders: ${error.message}`);
    creados.pedidos.push(p.id);
    const { data: items, error: eIt } = await admin
      .from("catalog_order_items")
      .insert(lineas.map((l) => ({ order_id: p.id, ...l })))
      .select("id, product_name");
    if (eIt) throw new Error(`catalog_order_items: ${eIt.message}`);
    return { id: p.id, items };
  }

  const lineaViva = {
    product_id: prod.id,
    product_name: `${MARCA} producto`,
    quantity: 2,
    unit_price: 5,
    currency: "USD",
    tier: "retail",
  };
  // A line whose product left the catalogue: `product_id` null, which is
  // exactly what `ON DELETE SET NULL` leaves behind. The NAME survives, and
  // that is what lets the owner's «se avisa» name it.
  const lineaMuerta = {
    product_id: null,
    product_name: `${MARCA} descatalogado`,
    quantity: 1,
    unit_price: 7,
    currency: "USD",
    tier: "retail",
  };

  // A SECOND PRODUCT PRICED IN EUROS, for the two-currency order. Its own
  // `base_currency` rather than converting the dollar one: a derived EUR
  // price depends on today's rate being readable, so the suite would go red
  // for a reason that has nothing to do with what it is testing.
  const { data: prodEur, error: eProdEur } = await admin
    .from("products")
    .insert({
      owner_id: ve.id,
      name: `${MARCA} producto euros`,
      base_currency: "EUR",
      price_retail: 4,
      published_retail: true,
    })
    .select("id")
    .single();
  if (eProdEur) throw new Error(`products EUR: ${eProdEur.message}`);
  creados.productos.push(prodEur.id);

  const lineaEuros = {
    product_id: prodEur.id,
    product_name: `${MARCA} producto euros`,
    quantity: 3,
    unit_price: 4,
    currency: "EUR",
    tier: "retail",
  };

  const pedidoA = await nuevoPedido("contado", [lineaViva]);
  const pedidoD = await nuevoPedido("dos monedas", [lineaViva, lineaEuros]);
  const pedidoB = await nuevoPedido("con linea muerta", [lineaViva, lineaMuerta]);
  const pedidoC = await nuevoPedido("todo muerto", [lineaMuerta]);

  // The catalogue price moves AFTER the orders were placed.
  await admin.from("products").update({ price_retail: 9 }).eq("id", prod.id);

  const accion = await idDeLaAccion(
    BASE,
    "registrarPedidoComoVenta",
    cookie,
    `/productos/ordenes/${pedidoA.id}/registrar/cliente`,
  );
  check(
    `0. el id de \`registrarPedidoComoVenta\` se descubre en los chunks que sirve ${BASE}`,
    accion != null,
    accion
      ? `${accion.slice(0, 10)}…`
      : "NO ENCONTRADO — ¿Next dejó de emitir el nombre junto al id?",
  );
  if (!accion) throw new Error("sin id de acción no hay nada que probar");

  // A broken transport is NOT a rejection: this THROWS instead of returning
  // `{ok:false}`, because the rows that EXPECT a rejection would otherwise
  // go green against an unreachable action. Nine rows did exactly that once
  // in `qa/venta-accion.mjs`, with every call answering HTTP 404.
  async function registrar(entrada, pedidoId, comoCookie = cookie) {
    const res = await fetch(`${BASE}/productos/ordenes/${pedidoId}/registrar/cliente`, {
      method: "POST",
      headers: {
        "Next-Action": accion,
        "Content-Type": "text/plain;charset=UTF-8",
        Cookie: comoCookie,
      },
      body: JSON.stringify([entrada]),
    });
    const texto = await res.text();
    const i = texto.indexOf('{"ok":');
    if (i < 0) {
      throw new Error(
        `la acción no devolvió un resultado (HTTP ${res.status}). Primeros 200: ${texto.slice(0, 200)}`,
      );
    }
    // The object is trimmed by COUNTING BRACES, not with an expression: a
    // regexp stops at the first `}` before `]`, which in a saved sale is the
    // one closing the `cobrado` array, and `JSON.parse` then dies mid-object.
    let prof = 0;
    let enCadena = false;
    let escapado = false;
    for (let j = i; j < texto.length; j++) {
      const c = texto[j];
      if (escapado) {
        escapado = false;
        continue;
      }
      if (c === "\\") {
        escapado = true;
        continue;
      }
      if (c === '"') {
        enCadena = !enCadena;
        continue;
      }
      if (enCadena) continue;
      if (c === "{") prof++;
      else if (c === "}" && --prof === 0) {
        const r = JSON.parse(texto.slice(i, j + 1));
        if (r.ok && r.saleId) creados.ventas.push(r.saleId);
        return r;
      }
    }
    throw new Error("no se pudo recortar el objeto de la respuesta");
  }

  const VACIO = "00000000-0000-0000-0000-000000000000";

  // ═══ 1. EL PRECIO SELLADO MANDA ═══════════════════════════════════════
  const rA = await registrar(
    entradaDe(
      pedidoA.id,
      "USD",
      pagoDeMoneda({ amount: 10 }),
      clienteNuevo("11111111"),
    ),
    pedidoA.id,
  );
  check("1a. un pedido de contado se registra", rA.ok === true, rA.ok ? rA.saleId : rA.error);

  const { data: lineasA } = await admin
    .from("sale_lines")
    .select("unit_price, quantity, currency")
    .eq("sale_id", rA.saleId ?? VACIO);
  check(
    "1b. se cobra el PRECIO SELLADO (5) y no el del catálogo de hoy (9)",
    lineasA?.length === 1 && Number(lineasA[0].unit_price) === 5,
    `unit_price = ${lineasA?.[0]?.unit_price}`,
  );

  // ═══ 2. EL CONTADO NO TOCA EL LIBRO ═══════════════════════════════════
  //
  // The half of the money no other check sees: a sale paid in full writes
  // nothing to `movements` on purpose, so every balance assertion in the
  // regression checklist passes with this path broken.
  const { data: ventaA } = await admin
    .from("sales")
    .select("client_id")
    .eq("id", rA.saleId ?? VACIO)
    .maybeSingle();
  if (ventaA?.client_id) creados.clientes.push(ventaA.client_id);
  const { count: movsA } = await admin
    .from("movements")
    .select("id", { count: "exact", head: true })
    .eq("sale_id", rA.saleId ?? VACIO);
  check(
    "2. un pedido pagado entero deja CERO filas en `movements`",
    (movsA ?? 0) === 0,
    `${movsA} movimientos`,
  );

  // ═══ 3. EL PEDIDO QUEDA SELLADO ═══════════════════════════════════════
  const { data: selloA } = await admin
    .from("catalog_orders")
    .select("sale_id, registered_at, status")
    .eq("id", pedidoA.id)
    .single();
  check(
    "3. el pedido queda con `sale_id`, `registered_at` y `status = registered`",
    selloA?.sale_id === rA.saleId && selloA?.registered_at != null && selloA?.status === "registered",
    `sale_id ${selloA?.sale_id ? "sí" : "no"} · fecha ${selloA?.registered_at ? "sí" : "no"} · status ${selloA?.status}`,
  );

  // ═══ 3b. REGISTRAR DA EL PEDIDO POR ATENDIDO ═════════════════════════
  //
  // Decisión del dueño el 2026-10-25, al quitar «Marcar como atendido» de la
  // pantalla: *«registrar lo da por atendido»*. Era el único sitio desde el
  // que se podía ejecutar esa acción, así que ahora registrar es lo único que
  // saca un pedido de «sin atender» — y la campana y la lista de Pedidos
  // cuentan por `status`.
  //
  // UN PEDIDO DE UNA SOLA MONEDA SALTA DE `new` A `registered` directo, sin
  // pasar por `seen`: `registered` ya no es «sin atender», que es lo que esta
  // fila comprueba. El escalón intermedio se ve en la fila 11b.
  check(
    "3b. registrar saca el pedido de «sin atender» (status deja de ser `new`)",
    selloA?.status !== "new",
    `status ${selloA?.status}`,
  );

  // ═══ 4. NO SE REGISTRA DOS VECES ══════════════════════════════════════
  //
  // The worst case this closes is not a duplicated row: it is the customer
  // owing the same order twice, from one shopkeeper tapping back.
  const rRepe = await registrar(
    entradaDe(
      pedidoA.id,
      "USD",
      pagoDeMoneda({ amount: 10 }),
      clienteNuevo("11111112"),
    ),
    pedidoA.id,
  );
  check(
    "4. una moneda ya registrada se RECHAZA al segundo intento",
    rRepe.ok === false && /ya se registró/i.test(rRepe.error ?? ""),
    rRepe.ok ? "LO REGISTRÓ OTRA VEZ" : rRepe.error,
  );

  // ═══ 5. LA LÍNEA SIN PRODUCTO SE EXCLUYE Y SE NOMBRA ══════════════════
  const rB = await registrar(
    entradaDe(
      pedidoB.id,
      "USD",
      pagoDeMoneda({ amount: 0, plazo: "15" }),
      clienteNuevo("22222222"),
    ),
    pedidoB.id,
  );
  check(
    "5a. el pedido con una línea descatalogada SÍ se registra",
    rB.ok === true,
    rB.ok ? rB.saleId : rB.error,
  );
  check(
    "5b. la línea excluida vuelve NOMBRADA, no contada",
    rB.ok === true && rB.excluidas?.length === 1 && rB.excluidas[0] === `${MARCA} descatalogado`,
    JSON.stringify(rB.excluidas ?? null),
  );
  const { data: lineasB } = await admin
    .from("sale_lines")
    .select("name")
    .eq("sale_id", rB.saleId ?? VACIO);
  check(
    "5c. la venta lleva SOLO la línea viva",
    lineasB?.length === 1 && lineasB[0].name === `${MARCA} producto`,
    `${lineasB?.length} líneas`,
  );

  // ═══ 6. EL FIADO SÍ ESCRIBE CARGO, Y POR EL PRECIO SELLADO ════════════
  const { data: ventaB } = await admin
    .from("sales")
    .select("client_id")
    .eq("id", rB.saleId ?? VACIO)
    .maybeSingle();
  if (ventaB?.client_id) creados.clientes.push(ventaB.client_id);
  const { data: movsB } = await admin
    .from("movements")
    .select("type, amount, currency")
    .eq("sale_id", rB.saleId ?? VACIO);
  check(
    "6. el fiado escribe UN cargo por el precio sellado (2 × 5 = 10), no por el de hoy (18)",
    movsB?.length === 1 && movsB[0].type === "charge" && Number(movsB[0].amount) === 10,
    movsB?.length ? `${movsB[0].type} ${movsB[0].amount} ${movsB[0].currency}` : "ningún movimiento",
  );

  // ═══ 7. SIN NINGUNA LÍNEA VIVA, SE RECHAZA ENTERO ═════════════════════
  const rC = await registrar(
    entradaDe(pedidoC.id, "USD", pagoDeMoneda({ amount: 0 }), clienteNuevo("33333333")),
    pedidoC.id,
  );
  check(
    "7. un pedido sin una sola línea viva se rechaza, sin crear venta ni cliente",
    rC.ok === false && /catálogo/i.test(rC.error ?? ""),
    rC.ok ? "CREÓ UNA VENTA VACÍA" : rC.error,
  );

  // ═══ 8. EL PEDIDO DE OTRO DUEÑO NO EXISTE ═════════════════════════════
  //
  // The ownership check is EXPLICIT in the action (`.eq("owner_id", …)`), not
  // only RLS — CLAUDE.md, «Explicit ownership checks in server actions». This
  // is the row that notices the day somebody takes it out.
  const { data: otro } = await admin
    .from("owners")
    .select("id")
    .neq("id", ve.id)
    .order("id")
    .limit(1)
    .maybeSingle();
  let rAjeno = null;
  if (otro) {
    const ajeno = await nuevoPedido("de otro dueno", [lineaViva]);
    await admin.from("catalog_orders").update({ owner_id: otro.id }).eq("id", ajeno.id);
    rAjeno = await registrar(
      entradaDe(ajeno.id, "USD", pagoDeMoneda({ amount: 10 }), clienteNuevo("44444444")),
      ajeno.id,
    );
  }
  check(
    "8. un pedido de OTRO dueño no se encuentra, aunque el id sea válido",
    otro == null || (rAjeno.ok === false && /No encontramos ese pedido/i.test(rAjeno.error ?? "")),
    otro == null
      ? "no hay un segundo dueño en dev — fila omitida"
      : rAjeno.ok
        ? "LO REGISTRÓ"
        : rAjeno.error,
  );

  // ═══ 9. EL CLIENTE NACE DEL FLUJO, Y NACE BIEN ════════════════════════
  const { data: clienteA } = await admin
    .from("clients")
    .select("document_id, document_type, document_source, address, name")
    .eq("id", ventaA?.client_id ?? VACIO)
    .maybeSingle();
  check(
    "9a. el cliente se crea desde el flujo, con el documento en SOLO dígitos",
    clienteA?.document_id === "11111111",
    `document_id = ${clienteA?.document_id}`,
  );
  check(
    "9b. el documento queda marcado como confirmado por el TENDERO, no tecleado por el cliente",
    clienteA?.document_source === "owner",
    `document_source = ${clienteA?.document_source}`,
  );
  check(
    "9c. la dirección del pedido llega a la ficha del cliente",
    clienteA?.address === "Calle de prueba",
    `address = ${clienteA?.address ?? "null"}`,
  );
  // ═══ 11. DOS MONEDAS: DOS VENTAS, UN SOLO CLIENTE ════════════════════
  //
  // The whole of `CT-147` in one block. Before it, a two-currency order was
  // registered line by line and one of the two terms was silently dropped;
  // now each currency is its own pass, with its own term.
  //
  // The owner's decision of 2026-10-25: *«dos ventas pero el cliente se
  // guarda al final de la primera venta y se usa para la segunda venta»*.
  const rD1 = await registrar(
    entradaDe(pedidoD.id, "USD", pagoDeMoneda({ amount: 0, plazo: "7" }), clienteNuevo("55555555")),
    pedidoD.id,
  );
  check(
    "11a. la primera moneda se registra y AVISA de la que queda",
    rD1.ok === true && JSON.stringify(rD1.pendientes) === '["EUR"]',
    rD1.ok ? `pendientes = ${JSON.stringify(rD1.pendientes)}` : rD1.error,
  );
  if (rD1.ok && rD1.clientId) creados.clientes.push(rD1.clientId);

  const { data: selloMedio } = await admin
    .from("catalog_orders")
    .select("status, registered_at, seen_at")
    .eq("id", pedidoD.id)
    .single();
  check(
    "11b. con una moneda sin cobrar el pedido NO se da por registrado",
    selloMedio?.status !== "registered" && selloMedio?.registered_at == null,
    `status ${selloMedio?.status} · registered_at ${selloMedio?.registered_at ?? "null"}`,
  );
  // EL ESCALÓN INTERMEDIO, que es la otra mitad de la decisión del 2026-10-25:
  // a medio registrar el pedido ya NO cuenta como «sin atender» --el tendero
  // está trabajándolo-- aunque todavía no esté terminado.
  check(
    "11b bis. pero SÍ deja de estar «sin atender» con la primera moneda",
    selloMedio?.status === "seen",
    `status ${selloMedio?.status}`,
  );

  // THE SECOND PASS SENDS BACK THE FICHA THE FIRST ONE CREATED. If it did
  // not, the order would end with the same person in the list twice — and
  // the second time would fail outright on the unique document.
  const rD2 = await registrar(
    entradaDe(
      pedidoD.id,
      "EUR",
      pagoDeMoneda({ amount: 12 }),
      { ...clienteNuevo("55555555"), fichaId: rD1.ok ? rD1.clientId : null },
    ),
    pedidoD.id,
  );
  check(
    "11c. la segunda moneda se registra y ya no queda ninguna",
    rD2.ok === true && Array.isArray(rD2.pendientes) && rD2.pendientes.length === 0,
    rD2.ok ? `pendientes = ${JSON.stringify(rD2.pendientes)}` : rD2.error,
  );
  check(
    "11d. las dos ventas van al MISMO cliente, no a dos fichas",
    rD1.ok === true && rD2.ok === true && rD1.clientId === rD2.clientId,
    `${rD1.clientId} · ${rD2.clientId}`,
  );

  const { data: ventasD } = await admin
    .from("sales")
    .select("id")
    .eq("catalog_order_id", pedidoD.id)
    .is("deleted_at", null);
  check(
    "11e. el pedido queda enlazado con SUS DOS ventas por `catalog_order_id`",
    ventasD?.length === 2,
    `${ventasD?.length} ventas`,
  );

  const { data: selloFinal } = await admin
    .from("catalog_orders")
    .select("status, registered_at, sale_id")
    .eq("id", pedidoD.id)
    .single();
  check(
    "11f. con la última moneda cobrada, el pedido SÍ queda registrado",
    selloFinal?.status === "registered" && selloFinal?.registered_at != null,
    `status ${selloFinal?.status} · registered_at ${selloFinal?.registered_at ? "sí" : "no"}`,
  );
  check(
    "11g. `sale_id` sigue apuntando a la PRIMERA venta, no la pisó la segunda",
    rD1.ok === true && selloFinal?.sale_id === rD1.saleId,
    `sale_id ${selloFinal?.sale_id === (rD1.ok ? rD1.saleId : null) ? "= la primera" : "= " + selloFinal?.sale_id}`,
  );

  // ═══ 12. CADA MONEDA SE QUEDA CON SU PROPIO PLAZO ═════════════════════
  //
  // This is the defect `CT-147` was opened for, stated as a check: dollars
  // were agreed at 7 days and euros were paid in cash. Under the old flow a
  // second dollar line with a longer term would have overwritten the 7 —
  // «gana el plazo más largo», the patch the owner called a patch.
  // `plazo_dias` Y NO `due_date`: la columna se llama así desde la migración
  // `017`. La primera versión de esta fila preguntaba por `due_date`, la
  // consulta fallaba entera, y el resultado era 12a en rojo con un mensaje
  // que decía «no hay cargo» --y 12b en VERDE, porque una lista vacía cumple
  // cualquier `every`. Una consulta rota no se parece a un dato: se parece a
  // la respuesta que esperabas.
  const { data: cargosD, error: errorCargos } = await admin
    .from("movements")
    .select("currency, amount, plazo_dias")
    .in("sale_id", (ventasD ?? []).map((v) => v.id))
    .eq("type", "charge");
  const cargoUsd = (cargosD ?? []).find((m) => m.currency === "USD");
  check(
    "12a. el fiado en dólares conserva SU plazo de 7 días",
    errorCargos == null && cargoUsd != null && Number(cargoUsd.plazo_dias) === 7,
    errorCargos
      ? `la consulta falló: ${errorCargos.message}`
      : cargoUsd
        ? `plazo_dias = ${cargoUsd.plazo_dias}, por $${cargoUsd.amount}`
        : "no hay cargo en dólares",
  );
  check(
    "12b. los euros se pagaron de contado, así que no dejan cargo",
    errorCargos == null && (cargosD ?? []).every((m) => m.currency !== "EUR"),
    errorCargos ? `la consulta falló: ${errorCargos.message}` : `cargos: ${(cargosD ?? []).map((m) => m.currency).join(", ") || "ninguno"}`,
  );

  // ═══ 12c. «PAGO ÚNICO» NO ES UNA CUOTA ═══════════════════════════════
  //
  // La fila que faltaba, y la encontró el navegador y no esta suite: el
  // desplegable de cuotas manda `"1"` cuando el tendero deja «Pago único»,
  // que es su valor POR DEFECTO, y `registrarVenta` exige de 2 a 36. Las
  // pruebas de arriba mandaban la cadena vacía --el otro camino-- así que
  // pasaban en verde con el camino corriente roto.
  //
  // Se registra el tercer pedido que quedaba libre con `cuotas: "1"`: si
  // vuelve a convertirse mal, esto se pone rojo con el mensaje de Postgres
  // en la mano.
  const pedidoE = await nuevoPedido("pago unico", [lineaViva]);
  const rE = await registrar(
    entradaDe(
      pedidoE.id,
      "USD",
      pagoDeMoneda({ amount: 0, plazo: "15", cuotas: "1" }),
      clienteNuevo("66666666"),
    ),
    pedidoE.id,
  );
  check(
    "12c. «Pago único» (cuotas = 1) se registra; no se manda como una cuota",
    rE.ok === true,
    rE.ok ? rE.saleId : rE.error,
  );
  if (rE.ok && rE.clientId) creados.clientes.push(rE.clientId);

  // ═══ 14. UN FALLO A MITAD NO SE LLEVA LO QUE YA SE GUARDÓ ════════════
  //
  // Dos monedas son dos llamadas, así que la segunda puede fallar con la
  // primera ya escrita. `registrarTodoElPedido` lo contempla --devuelve
  // `monedasHechas` y lo dice en el mensaje-- y hasta hoy nadie lo había
  // ejecutado.
  //
  // EL FALLO ES UN ABONO MAYOR QUE EL TOTAL, y la elección importa: la
  // primera versión de esta fila usaba una moneda cuyos productos ya no
  // estaban en el catálogo, y se puso roja contra un comportamiento que es
  // CORRECTO -- una moneda que nunca va a poder registrarse no debe dejar el
  // pedido pendiente para siempre, así que el pedido SÍ queda sellado. Lo
  // equivocado era la prueba. Un fallo de verdad es el de una moneda que sí
  // se puede cobrar y cuya llamada se cae.
  //
  // LO QUE TIENE QUE PASAR, y no es «deshacerlo todo»: la venta en dólares se
  // QUEDA --el tendero ya se llevó ese dinero y el cliente ya lo debe-- y el
  // pedido NO se da por registrado, así que sigue reclamando los euros.
  // Borrar la primera para dejar la pantalla limpia sería quitarle un cargo
  // del que el cliente ya está enterado.
  const pedidoF = await nuevoPedido("fallo a mitad", [lineaViva, lineaEuros]);
  const rF1 = await registrar(
    entradaDe(pedidoF.id, "USD", pagoDeMoneda({ amount: 10 }), clienteNuevo("77777777")),
    pedidoF.id,
  );
  if (rF1.ok && rF1.clientId) creados.clientes.push(rF1.clientId);
  const clienteF = { ...clienteNuevo("77777777"), fichaId: rF1.ok ? rF1.clientId : null };

  // 3 × 4 = 12 €. Un abono de 9.999 lo rechaza `registrarVenta`.
  const rF2 = await registrar(
    entradaDe(pedidoF.id, "EUR", pagoDeMoneda({ amount: 9999 }), clienteF),
    pedidoF.id,
  );
  check(
    "14a. la segunda moneda se rechaza si el abono pasa del total",
    rF2.ok === false,
    rF2.ok ? "LA REGISTRÓ" : rF2.error,
  );
  const { data: ventasF } = await admin
    .from("sales")
    .select("id")
    .eq("catalog_order_id", pedidoF.id)
    .is("deleted_at", null);
  check(
    "14b. la venta de la PRIMERA moneda se queda escrita, no se deshace",
    ventasF?.length === 1,
    `${ventasF?.length} ventas`,
  );
  const { data: selloF } = await admin
    .from("catalog_orders")
    .select("status, registered_at")
    .eq("id", pedidoF.id)
    .single();
  check(
    "14c. y el pedido NO queda registrado, así que sigue reclamando lo que falta",
    selloF?.status !== "registered" && selloF?.registered_at == null,
    `status ${selloF?.status} · registered_at ${selloF?.registered_at ?? "null"}`,
  );

  // Y SE PUEDE REINTENTAR, que es la promesa entera: el tendero corrige el
  // monto y la moneda que faltaba entra sin tocar la que ya estaba.
  const rF3 = await registrar(
    entradaDe(pedidoF.id, "EUR", pagoDeMoneda({ amount: 12 }), clienteF),
    pedidoF.id,
  );
  const { data: selloF2 } = await admin
    .from("catalog_orders")
    .select("status, registered_at")
    .eq("id", pedidoF.id)
    .single();
  check(
    "14d. al reintentarla con el monto bueno, entra y el pedido queda cerrado",
    rF3.ok === true &&
      Array.isArray(rF3.pendientes) &&
      rF3.pendientes.length === 0 &&
      selloF2?.status === "registered",
    rF3.ok ? `pendientes ${JSON.stringify(rF3.pendientes)} · status ${selloF2?.status}` : rF3.error,
  );

  // ═══ 13. UNA VENTA RECHAZADA NO DEJA UN CLIENTE HUÉRFANO ══════════════
  //
  // La fila que encontró el fallo, y lo encontró por la puerta de atrás: la
  // limpieza del final dejaba un cliente vivo después del intento 4, el de
  // registrar dos veces. La ficha se crea ANTES de llamar a `registrarVenta`
  // --no hay otra forma, esa función necesita el id-- así que cualquier
  // rechazo suyo dejaba una persona nueva en la lista del tendero que nunca
  // compró nada. Venía de antes del rediseño.
  const { count: huerfanos } = await admin
    .from("clients")
    .select("id", { count: "exact", head: true })
    .eq("document_id", "11111112");
  check(
    "13. el cliente del intento rechazado NO se queda en la lista del tendero",
    (huerfanos ?? 0) === 0,
    `${huerfanos} fichas con ese documento`,
  );
  // ═══ 15. COLOMBIA, QUE NO ES OPCIONAL ════════════════════════════════
  //
  // `CLAUDE.md` lo tiene escrito para las ventas y esto PRODUCE ventas:
  // *«COLOMBIA TIENE SU PROPIA FIXTURE Y NO ES OPCIONAL»*. Un negocio
  // colombiano lleva UN solo libro y sus dos mitades se escriben distinto --
  // `sale_lines.currency` dice `'COP'` y `movements.currency` dice `NULL`--,
  // así que cruzar esas dos columnas en bruto no casa nunca. Ya costó una
  // fila fantasma de contado en la pantalla del propio cliente el 2026-10-20,
  // y ninguna prueba de dev lo habría cazado porque no había una sola venta
  // de un negocio colombiano.
  //
  // AQUÍ LO QUE SE COMPRUEBA ES EL FLUJO DEL PEDIDO: que un bloque en COP se
  // registre, que el fiado escriba su cargo con `currency` NULA, y que el
  // pedido quede sellado. Sin esto, el flujo nuevo saldría a producción
  // probado solo contra Venezuela.
  const { data: co } = await admin
    .from("owners")
    .select("id, country")
    .eq("country", "CO")
    .order("id")
    .limit(1)
    .maybeSingle();

  if (!co) {
    check("15. Colombia: hay un dueño CO en dev con el que probar", false, "no hay ninguno");
  } else {
    const { data: prodCo } = await admin
      .from("products")
      .insert({
        owner_id: co.id,
        name: `${MARCA} producto COP`,
        base_currency: "COP",
        price_retail: 8000,
        published_retail: true,
      })
      .select("id")
      .single();
    creados.productos.push(prodCo.id);

    const { data: pedCo } = await admin
      .from("catalog_orders")
      .insert({
        owner_id: co.id,
        customer_name: `${MARCA} comprador CO`,
        customer_document: "1098765",
        customer_whatsapp: "573001112233",
        customer_whatsapp_raw: "3001112233",
      })
      .select("id")
      .single();
    creados.pedidos.push(pedCo.id);
    const { data: itemsCo } = await admin
      .from("catalog_order_items")
      .insert([
        {
          order_id: pedCo.id,
          product_id: prodCo.id,
          product_name: `${MARCA} producto COP`,
          quantity: 2,
          unit_price: 8000,
          currency: "COP",
          tier: "retail",
        },
      ])
      .select("id");
    void itemsCo;

    // La acción corre con la sesión del dueño VE, así que un pedido del
    // colombiano tiene que salir por el candado de propiedad -- que es en sí
    // mismo lo que la fila 8 prueba, y aquí vuelve a quedar cubierto.
    const rCoAjeno = await registrar(
      entradaDe(pedCo.id, "COP", pagoDeMoneda({ amount: 0 }), clienteNuevo("88888888")),
      pedCo.id,
    );
    check(
      "15a. el pedido del dueño colombiano no lo puede registrar otro dueño",
      rCoAjeno.ok === false && /No encontramos ese pedido/i.test(rCoAjeno.error ?? ""),
      rCoAjeno.ok ? "LO REGISTRÓ" : rCoAjeno.error,
    );

    // ── Y AHORA DE VERDAD: REGISTRADO POR EL TENDERO COLOMBIANO ──────
    //
    // Con SU sesión, no con la del venezolano. Las dos filas anteriores de
    // esta sección comprobaban la fixture --que la línea estuviera en COP--
    // y eso no prueba nada del flujo: la fixture la escribe esta misma
    // suite. Lo que hay que saber es si un tendero colombiano puede llegar
    // al final.
    const cookieCo = await cookieDe(co.id, "CO");
    const rCo = await registrar(
      entradaDe(pedCo.id, "COP", pagoDeMoneda({ amount: 0, plazo: "30" }), clienteNuevo("1098765")),
      pedCo.id,
      cookieCo,
    );
    check(
      "15b. el tendero COLOMBIANO registra su pedido, con su propia sesión",
      rCo.ok === true,
      rCo.ok ? rCo.saleId : rCo.error,
    );
    if (rCo.ok && rCo.clientId) creados.clientes.push(rCo.clientId);

    const { data: lineasCo } = await admin
      .from("sale_lines")
      .select("currency, unit_price, quantity")
      .eq("sale_id", rCo.saleId ?? VACIO);
    check(
      "15c. la venta se escribe en COP, al precio sellado",
      lineasCo?.length === 1 &&
        lineasCo[0].currency === "COP" &&
        Number(lineasCo[0].unit_price) === 8000,
      lineasCo?.length ? `${lineasCo[0].currency} ${lineasCo[0].unit_price}` : "sin líneas",
    );

    // LA MITAD QUE NO CASA, y es la que costó la fila fantasma el 2026-10-20:
    // `sale_lines` dice COP y `movements` dice NULL. Las dos son correctas; lo
    // que no se puede es cruzarlas en bruto.
    const { data: movsCo } = await admin
      .from("movements")
      .select("type, amount, currency, plazo_dias")
      .eq("sale_id", rCo.saleId ?? VACIO);
    check(
      "15d. su cargo va al libro único: `movements.currency` es NULA, no «COP»",
      movsCo?.length === 1 &&
        movsCo[0].type === "charge" &&
        movsCo[0].currency == null &&
        Number(movsCo[0].amount) === 16000,
      movsCo?.length
        ? `${movsCo[0].type} ${movsCo[0].amount} currency=${movsCo[0].currency ?? "null"}`
        : "ningún movimiento",
    );

    const { data: selloCo } = await admin
      .from("catalog_orders")
      .select("status, registered_at")
      .eq("id", pedCo.id)
      .single();
    check(
      "15e. y el pedido colombiano queda registrado, como el venezolano",
      selloCo?.status === "registered" && selloCo?.registered_at != null,
      `status ${selloCo?.status}`,
    );
  }

} catch (e) {
  check("la suite llegó al final", false, e.message);
} finally {
  // ── LIMPIEZA ─────────────────────────────────────────────────────────
  if (creados.ventas.length) await admin.from("sales").delete().in("id", creados.ventas);
  if (creados.clientes.length) {
    await admin.from("movements").delete().in("client_id", creados.clientes);
    await admin.from("sales").delete().in("client_id", creados.clientes);
    await admin.from("clients").delete().in("id", creados.clientes);
  }
  if (creados.pedidos.length) {
    await admin.from("catalog_order_items").delete().in("order_id", creados.pedidos);
    await admin.from("catalog_orders").delete().in("id", creados.pedidos);
  }
  if (creados.productos.length) await admin.from("products").delete().in("id", creados.productos);

  const [{ count: quedanC }, { count: quedanP }, { count: quedanO }] = await Promise.all([
    admin.from("clients").select("id", { count: "exact", head: true }).like("name", `${MARCA}%`),
    admin.from("products").select("id", { count: "exact", head: true }).like("name", `${MARCA}%`),
    admin
      .from("catalog_orders")
      .select("id", { count: "exact", head: true })
      .like("customer_name", `${MARCA}%`),
  ]);
  check(
    "10. limpieza: no queda nada de la prueba en dev",
    (quedanC ?? 0) === 0 && (quedanP ?? 0) === 0 && (quedanO ?? 0) === 0,
    `${quedanC} clientes · ${quedanP} productos · ${quedanO} pedidos`,
  );

  const fallan = filas.filter((f) => !f.pasa).length;
  console.log(`\n${filas.length - fallan}/${filas.length} pasan.`);
  process.exit(fallan ? 1 : 0);
}
