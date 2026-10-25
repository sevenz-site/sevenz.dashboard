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
// `CT-147` moves the term and the instalments off the line and onto the
// currency. When it lands, these two functions are what change; nothing
// below them does.
function pagoDeLinea(lineaId, { amount = 0, plazo = "", cuotas = "" } = {}) {
  return {
    lineaId,
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

function entradaDe(pedidoId, pagos, cliente, editadas = {}) {
  return { pedidoId, pagos, editadas, cliente };
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
  const correo = usuarios.data.users.find((u) => u.id === ve.id)?.email;
  if (!correo) throw new Error("el dueño VE no tiene correo con el que abrir sesión");
  const { data: link } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: correo,
  });
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
  const { data: verificado, error: eOtp } = await anon.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.properties.hashed_token,
  });
  if (eOtp) throw new Error(`verifyOtp: ${eOtp.message}`);

  const nombreCookie = `sb-${ref}-auth-token`;
  const valor =
    "base64-" + Buffer.from(JSON.stringify(verificado.session), "utf8").toString("base64url");
  const MAX = 3180;
  const cookie = (
    valor.length <= MAX
      ? [`${nombreCookie}=${valor}`]
      : Array.from(
          { length: Math.ceil(valor.length / MAX) },
          (_, i) => `${nombreCookie}.${i}=${valor.slice(i * MAX, (i + 1) * MAX)}`,
        )
  ).join("; ");

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

  const pedidoA = await nuevoPedido("contado", [lineaViva]);
  const pedidoB = await nuevoPedido("con linea muerta", [lineaViva, lineaMuerta]);
  const pedidoC = await nuevoPedido("todo muerto", [lineaMuerta]);

  // The catalogue price moves AFTER the orders were placed.
  await admin.from("products").update({ price_retail: 9 }).eq("id", prod.id);

  const accion = await idDeLaAccion(
    BASE,
    "registrarPedidoComoVenta",
    cookie,
    `/productos/ordenes/${pedidoA.id}/registrar/resumen`,
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
  async function registrar(entrada, pedidoId) {
    const res = await fetch(`${BASE}/productos/ordenes/${pedidoId}/registrar/resumen`, {
      method: "POST",
      headers: {
        "Next-Action": accion,
        "Content-Type": "text/plain;charset=UTF-8",
        Cookie: cookie,
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
      [pagoDeLinea(pedidoA.items[0].id, { amount: 10 })],
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

  // ═══ 4. NO SE REGISTRA DOS VECES ══════════════════════════════════════
  //
  // The worst case this closes is not a duplicated row: it is the customer
  // owing the same order twice, from one shopkeeper tapping back.
  const rRepe = await registrar(
    entradaDe(
      pedidoA.id,
      [pagoDeLinea(pedidoA.items[0].id, { amount: 10 })],
      clienteNuevo("11111112"),
    ),
    pedidoA.id,
  );
  check(
    "4. un pedido ya registrado se RECHAZA al segundo intento",
    rRepe.ok === false && /ya se registró/i.test(rRepe.error ?? ""),
    rRepe.ok ? "LO REGISTRÓ OTRA VEZ" : rRepe.error,
  );

  // ═══ 5. LA LÍNEA SIN PRODUCTO SE EXCLUYE Y SE NOMBRA ══════════════════
  const vivaB = pedidoB.items.find((i) => i.product_name === `${MARCA} producto`);
  const muertaB = pedidoB.items.find((i) => i.product_name === `${MARCA} descatalogado`);
  const rB = await registrar(
    entradaDe(
      pedidoB.id,
      [
        pagoDeLinea(vivaB.id, { amount: 0, plazo: "15" }),
        pagoDeLinea(muertaB.id, { amount: 0, plazo: "15" }),
      ],
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
    entradaDe(pedidoC.id, [pagoDeLinea(pedidoC.items[0].id, { amount: 0 })], clienteNuevo("33333333")),
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
      entradaDe(ajeno.id, [pagoDeLinea(ajeno.items[0].id, { amount: 10 })], clienteNuevo("44444444")),
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
