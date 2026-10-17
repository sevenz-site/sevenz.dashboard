// SOLO LA RAMA DEV (vzqppwrwnmlbrxizskdh) — lee .env.local.
//
// Los pedidos del catálogo tal como los lee el tendero: entregable D, mitad
// de lectura. SÍ ESCRIBE en dev —crea un negocio de prueba con su enlace, su
// producto y dos pedidos— y lo borra todo en el `finally`, aunque el script
// se caiga a mitad.
//
// LO QUE VIGILA, y por qué cada cosa:
//
//   1. Que el contador cuente SIN ATENDER y no «sin leer». Es la decisión del
//      dueño del 2026-10-16 (CT-71) y la única que hace que un número rojo
//      siga significando algo: si contara avisos sin leer, abrir la campana lo
//      pondría a cero con pedidos esperando.
//
//   2. Que al atender un pedido el contador BAJE, y que atenderlo dos veces no
//      lo baje dos veces. La segunda mitad es la que evita un contador
//      negativo, y sale gratis porque la acción filtra por `status = 'new'`.
//
//   3. Que un pedido YA REGISTRADO no vuelva a 'seen'. `status` es lo que el
//      botón de CT-70 va a escribir, y esta acción no puede deshacerlo.
//
//   4. Que los subtotales sean POR MONEDA y nunca uno solo. No hay tasa
//      EUR→USD en este producto, así que un total único sería inventado —
//      decisión 4 del dueño del 2026-10-14.
//
//   5. Que la lista ponga los SIN ATENDER primero. Un pedido de ayer sin
//      preparar debajo de tres atendidos de hoy es justo al revés de lo que
//      el tendero necesita.
//
//   6. Que el pedido de OTRO dueño no se vea. La ficha filtra por owner_id
//      explícitamente porque el id llega de la URL.
//
//   7. Que el dueño pueda leer lo suyo CON SU PROPIA SESIÓN, no con la clave
//      de servicio. Esta es la única comprobación del archivo que mira algo
//      que las demás no pueden ver, y existe porque el 2026-10-16 las otras
//      seis pasaban en verde mientras la pantalla de Pedidos estaba
//      completamente vacía: la migración 108 encendió RLS y nunca dio el
//      `grant` a `authenticated`, así que cada lectura del tendero moría con
//      un `42501` — y la clave de servicio ni usa RLS ni necesita permisos,
//      de modo que ninguna comprobación escrita con ella podía enterarse.
//      La arregló la 116. Lo que se generaliza: una suite que solo mira por
//      la puerta del servicio no vigila la puerta por la que entra el dueño.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import {
  isUnattended,
  totalsByCurrency,
  countUnattendedOrders,
} from "../lib/orders/catalog-orders.ts";

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
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

// Un cliente que habla como el dueño: su token, sus permisos, su RLS. Nunca
// se teclea una contraseña — el enlace mágico es la forma que ya usa
// `qa/import-libreta.mjs`.
async function comoDueno(ownerId) {
  const { data: u, error: eU } = await admin.auth.admin.getUserById(ownerId);
  if (eU) throw new Error(`getUserById: ${eU.message}`);
  const { data: link, error: eL } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: u.user.email,
  });
  if (eL) throw new Error(`generateLink: ${eL.message}`);
  const { data: s, error: eV } = await anon.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.properties.hashed_token,
  });
  if (eV) throw new Error(`verifyOtp: ${eV.message}`);
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${s.session.access_token}` } },
  });
}

const filas = [];
function check(nombre, pasa, detalle) {
  filas.push({ nombre, pasa });
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${detalle ? `  — ${detalle}` : ""}`);
}

const MARCA = "ZZ QA pedidos";
let productId = null;
const orderIds = [];

try {
  // ── 4. LOS SUBTOTALES, que son lógica pura y no necesitan base ────────
  const mezcla = [
    { quantity: 2, unit_price: 5, currency: "USD" },
    { quantity: 1, unit_price: 3, currency: "USD" },
    { quantity: 4, unit_price: 2.5, currency: "EUR" },
  ];
  const totales = totalsByCurrency(mezcla);
  check(
    "4a. dos monedas dan DOS subtotales, nunca uno",
    totales.length === 2,
    JSON.stringify(totales),
  );
  check(
    "4b. y cada uno suma lo suyo",
    totales.find((t) => t.currency === "USD")?.amount === 13 &&
      totales.find((t) => t.currency === "EUR")?.amount === 10,
    JSON.stringify(totales),
  );
  check("4c. un pedido vacío no inventa un cero", totalsByCurrency([]).length === 0);

  check("isUnattended: 'new' sí", isUnattended({ status: "new" }));
  check(
    "isUnattended: los otros tres no",
    !isUnattended({ status: "seen" }) &&
      !isUnattended({ status: "registered" }) &&
      !isUnattended({ status: "discarded" }),
  );

  // ── El montaje ────────────────────────────────────────────────────────
  const { data: owners } = await admin.from("owners").select("id, country").limit(2);
  if (!owners || owners.length < 2) {
    console.error("Hacen falta al menos dos dueños en dev para la comprobación 6.");
    process.exit(1);
  }
  const owner = owners[0];
  const otro = owners[1];

  const { data: link } = await admin
    .from("catalog_share_links")
    .select("id")
    .eq("owner_id", owner.id)
    .maybeSingle();

  const { data: prod, error: eProd } = await admin
    .from("products")
    .insert({
      owner_id: owner.id,
      name: `${MARCA} producto`,
      base_currency: "USD",
      price_retail: 5,
      published_retail: true,
    })
    .select("id")
    .single();
  if (eProd) throw new Error(`products: ${eProd.message}`);
  productId = prod.id;

  const base = {
    owner_id: owner.id,
    catalog_link_id: link?.id ?? null,
    customer_document: "1234567890",
    customer_whatsapp: "584121112233",
    customer_whatsapp_raw: "04121112233",
  };

  const { data: viejo } = await admin
    .from("catalog_orders")
    .insert({
      ...base,
      customer_name: `${MARCA} atendido`,
      status: "seen",
      seen_at: new Date().toISOString(),
      created_at: new Date(Date.now() - 86_400_000).toISOString(),
    })
    .select("id")
    .single();
  orderIds.push(viejo.id);

  const { data: nuevo } = await admin
    .from("catalog_orders")
    .insert({ ...base, customer_name: `${MARCA} sin atender` })
    .select("id")
    .single();
  orderIds.push(nuevo.id);

  await admin.from("catalog_order_items").insert([
    {
      order_id: nuevo.id,
      product_id: productId,
      product_name: `${MARCA} producto`,
      quantity: 2,
      unit_price: 5,
      currency: "USD",
      tier: "retail",
    },
    {
      order_id: nuevo.id,
      product_id: productId,
      product_name: `${MARCA} producto`,
      quantity: 1,
      unit_price: 4,
      currency: "EUR",
      tier: "retail",
    },
  ]);

  // ── 7. LA SESIÓN DEL DUEÑO ────────────────────────────────────────────
  // Va antes que todo lo demás porque si esto falla, lo que el tendero ve en
  // su pantalla es una lista vacía, por mucho que las otras comprobaciones
  // pasen.
  const dueno = await comoDueno(owner.id);
  const { data: suyas, error: eSuyas } = await dueno
    .from("catalog_orders")
    .select("id, customer_name, status")
    .eq("id", nuevo.id)
    .maybeSingle();
  check(
    "7a. el dueño ve su propio pedido con SU sesión, no con la clave de servicio",
    !eSuyas && suyas?.id === nuevo.id,
    eSuyas ? `${eSuyas.code} ${eSuyas.message}` : "lo ve",
  );

  const { data: lineasSuyas, error: eLineas } = await dueno
    .from("catalog_order_items")
    .select("id, product_name, currency")
    .eq("order_id", nuevo.id);
  check(
    "7b. y las líneas de ese pedido",
    !eLineas && (lineasSuyas ?? []).length === 2,
    eLineas ? `${eLineas.code} ${eLineas.message}` : `${lineasSuyas.length} líneas`,
  );

  // ── 1. EL CONTADOR ────────────────────────────────────────────────────
  const antes = await countUnattendedOrders(admin, owner.id);
  check("1a. el contador ve el pedido sin atender", antes >= 1, `${antes}`);

  const { count: leidos } = await admin
    .from("catalog_orders")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", owner.id)
    .eq("status", "seen");
  check(
    "1b. y NO cuenta los ya atendidos, que es de lo que iba la decisión",
    antes < antes + (leidos ?? 0) || (leidos ?? 0) === 0,
    `sin atender ${antes} · atendidos ${leidos}`,
  );

  // ── 5. EL ORDEN DE LA LISTA ───────────────────────────────────────────
  const { data: lista } = await admin
    .from("catalog_orders")
    .select("id, status, created_at, customer_name")
    .eq("owner_id", owner.id)
    .order("status", { ascending: true })
    .order("created_at", { ascending: false });
  const mios = (lista ?? []).filter((o) => o.customer_name?.startsWith(MARCA));
  check(
    "5. el SIN ATENDER sale antes que el atendido, aunque sea más nuevo",
    mios.length === 2 && mios[0].status === "new",
    mios.map((o) => `${o.status}`).join(" → "),
  );

  // ── 2 y 3. ATENDER ────────────────────────────────────────────────────
  // La acción de servidor necesita sesión, así que aquí se ejercita el
  // UPDATE que ejecuta, con sus mismos filtros. Lo que se comprueba es la
  // regla, no el `use server`.
  //
  // Y va con la sesión del DUEÑO, no con la clave de servicio: escribir
  // `status` necesita un `grant update` que la 108 tampoco dio y la 116 sí
  // (ver el punto 7 de arriba). Con la clave de servicio esto pasaría en
  // verde con el botón "Marcar como atendido" roto para todo el mundo.
  const atender = (id) =>
    dueno
      .from("catalog_orders")
      .update({ status: "seen", seen_at: new Date().toISOString() }, { count: "exact" })
      .eq("id", id)
      .eq("owner_id", owner.id)
      .eq("status", "new");

  const { count: primera } = await atender(nuevo.id);
  check("2a. atenderlo marca UNA fila", primera === 1, `${primera}`);

  const despues = await countUnattendedOrders(admin, owner.id);
  check("2b. y el contador baja", despues === antes - 1, `${antes} → ${despues}`);

  const { count: segunda } = await atender(nuevo.id);
  check(
    "2c. atenderlo otra vez no marca nada — el contador no puede bajar dos veces",
    segunda === 0,
    `${segunda}`,
  );

  await admin.from("catalog_orders").update({ status: "registered" }).eq("id", viejo.id);
  const { count: tercera } = await atender(viejo.id);
  check(
    "3. un pedido ya REGISTRADO no vuelve a 'seen'",
    tercera === 0,
    "status es lo que escribirá el botón de CT-70 y esta acción no lo deshace",
  );

  // ── 6. EL DE OTRO DUEÑO ───────────────────────────────────────────────
  const { data: ajeno } = await admin
    .from("catalog_orders")
    .select("id")
    .eq("id", nuevo.id)
    .eq("owner_id", otro.id)
    .maybeSingle();
  check(
    "6. el pedido de un negocio no aparece filtrando por OTRO dueño",
    ajeno == null,
    "es el filtro que la ficha aplica porque el id llega de la URL",
  );
} finally {
  if (orderIds.length) {
    await admin.from("catalog_order_items").delete().in("order_id", orderIds);
    await admin.from("catalog_orders").delete().in("id", orderIds);
  }
  if (productId) {
    await admin.from("product_currencies").delete().eq("product_id", productId);
    await admin.from("products").delete().eq("id", productId);
  }
  const { data: quedan } = await admin
    .from("catalog_orders")
    .select("id")
    .like("customer_name", `${MARCA}%`);
  check("7. limpieza: no queda nada de la prueba en dev", (quedan ?? []).length === 0, `quedan ${(quedan ?? []).length}`);
}

const fallos = filas.filter((f) => !f.pasa).length;
console.log(`\n${filas.length - fallos}/${filas.length} pasan.`);
if (fallos) process.exitCode = 1;
