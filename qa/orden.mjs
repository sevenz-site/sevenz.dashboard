// SOLO LA RAMA DEV (vzqppwrwnmlbrxizskdh) — lee .env.local.
//
// LA PUERTA ANONIMA DE LAS ORDENES: migraciones 108 y 109.
//
// SÍ ESCRIBE en dev, a propósito y mucho. De una barrera lo único que importa
// es que de verdad rechace, y eso no se lee: se provoca. Crea su propio
// producto, sus órdenes y su enlace, y el `finally` limpia aunque el script se
// caiga a mitad.
//
// ===========================================================================
// POR QUÉ ESTA SUITE ES LA MÁS IMPORTANTE DEL CATÁLOGO
//
// `create_catalog_order` es la ÚNICA escritura de Sevenz que no tiene detrás
// ni una sesión ni una fila que ya existiera. La llama un desconocido por un
// enlace hecho para circular. Todo lo que en el resto del producto comprueba
// la aplicación —que el dato sea tuyo, que el precio sea el que es— aquí lo
// tiene que comprobar la base, porque arriba no hay nadie.
//
// Y los fallos de esta función no se ven desde ninguna pantalla: una orden con
// un precio falso llega al tendero con la misma pinta que una buena.
//
// LO QUE VIGILA, y por qué cada cosa:
//
//   1. Que el PRECIO salga de la ficha y no de quien llama. Es el candado que
//      impide que alguien pida dos aceites por dos céntimos.
//
//   2. Que un producto de OTRO dueño no entre. Sin esto, cualquiera con un
//      enlace podría meter en el pedido de una bodega el producto de otra.
//
//   3. Que no exista media orden. Si una línea falla, no queda nada — un
//      pedido incompleto lo atiende el tendero sin saber que le falta algo.
//
//   4. Que el tope por minuto frene de verdad. Es lo único entre el enlace
//      público y mil órdenes escritas por un guion.
//
//   5. Que la regla del escalón de la BASE y la de TypeScript digan lo mismo.
//      Son dos copias de una lógica de dinero y no hay forma de evitarlo —la
//      pantalla enseña, el servidor decide—, así que lo que queda es
//      vigilarlas. Si discrepan, el cliente ve un precio y la orden guarda
//      otro, SIN NINGÚN ERROR en ninguna parte.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { escalonParaCantidad } from "../lib/products/public-pricing.ts";

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
// ANON a propósito en TODAS las llamadas a la función: es exactamente quien la
// llama en producción. Probarla con la clave de servicio comprobaría otra cosa.
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

const filas = [];
function check(nombre, pasa, detalle) {
  filas.push({ nombre, pasa });
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${detalle ? `  — ${detalle}` : ""}`);
}

const MARCA = "QA 109";
const TEL = "584121990109";
const productos = [];
let enlaceCreado = null;
let ownerId = null;

const CLIENTE = {
  p_customer_name: "QA Comprador",
  p_customer_document: "V-12345678",
  p_customer_whatsapp: TEL,
  p_wants_notices: false,
  p_consent_text: null,
};

async function pedir(token, items, extra = {}) {
  const { data, error } = await anon.rpc("create_catalog_order", {
    p_token: token,
    ...CLIENTE,
    ...extra,
    p_items: items,
  });
  if (error) return { ok: false, reason: `rpc:${error.message}` };
  return data;
}

try {
  const { data: owners } = await admin.from("owners").select("id").limit(2);
  ownerId = owners[0].id;
  const otroOwnerId = owners[1]?.id ?? null;

  // El enlace del catálogo de ese negocio. Se reutiliza si existe.
  let { data: link } = await admin
    .from("catalog_share_links")
    .select("id, token")
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (!link) {
    const r = await admin
      .from("catalog_share_links")
      .insert({ owner_id: ownerId })
      .select("id, token")
      .single();
    link = r.data;
    enlaceCreado = link.id;
  }
  const token = link.token;

  // ── El producto de la prueba ────────────────────────────────────────────
  // Los dos escalones publicados, mínimo 6, y un candado en EUR solo para el
  // de mayor. Con esto se puede probar el escalón, el precio fijado, y que el
  // candado del escalón que no aplica no se cuele.
  const { data: prod } = await admin
    .from("products")
    .insert({
      owner_id: ownerId,
      name: `${MARCA} dos escalones`,
      base_currency: "USD",
      price_retail: 10,
      price_wholesale: 8,
      wholesale_min_quantity: 6,
      published_retail: true,
      published_wholesale: true,
    })
    .select("id")
    .single();
  productos.push(prod.id);

  await admin.from("product_price_overrides").upsert(
    { product_id: prod.id, tier: "wholesale", currency: "EUR", amount: 7 },
    { onConflict: "product_id,tier,currency" },
  );

  const { data: soloMayor } = await admin
    .from("products")
    .insert({
      owner_id: ownerId,
      name: `${MARCA} solo al mayor`,
      base_currency: "USD",
      price_wholesale: 4,
      wholesale_min_quantity: 12,
      published_retail: false,
      published_wholesale: true,
    })
    .select("id")
    .single();
  productos.push(soloMayor.id);

  const { data: sinPublicar } = await admin
    .from("products")
    .insert({
      owner_id: ownerId,
      name: `${MARCA} sin publicar`,
      base_currency: "USD",
      price_retail: 5,
      published_retail: false,
      published_wholesale: false,
    })
    .select("id")
    .single();
  productos.push(sinPublicar.id);

  // ── 0. EL TOPE POR MINUTO, lo primero y con la ventana limpia ───────────
  //
  // Va antes que todo porque llena la ventana de un minuto: dejarlo para el
  // final haría que las órdenes de las demás pruebas contaran contra él y el
  // resultado dependería de cuántas hubiera. Al terminar se borran las suyas,
  // así que la ventana queda libre otra vez para el resto.
  await admin.from("catalog_orders").delete().eq("catalog_link_id", link.id);

  const unaLinea = [{ product_id: prod.id, quantity: 1, currency: "USD" }];
  let rechazada = null;
  let creadas = 0;
  for (let i = 0; i < 21; i++) {
    const r = await pedir(token, unaLinea);
    if (r.ok) creadas++;
    else {
      rechazada = r.reason;
      break;
    }
  }
  check(
    "0. el tope por minuto frena, y en el número 21",
    creadas === 20 && rechazada === "demasiadas_ordenes",
    `entraron ${creadas}, la siguiente dijo "${rechazada}"`,
  );
  await admin.from("catalog_orders").delete().eq("catalog_link_id", link.id);

  // ── 1. EL PRECIO SALE DE LA FICHA ───────────────────────────────────────
  const r1 = await pedir(token, [{ product_id: prod.id, quantity: 2, currency: "USD" }]);
  const { data: it1 } = await admin
    .from("catalog_order_items")
    .select("unit_price, quantity, tier, currency, product_name")
    .eq("order_id", r1.order_id);
  check(
    "1a. la orden entra y guarda el precio de la ficha",
    r1.ok && it1?.length === 1 && Number(it1[0].unit_price) === 10,
    JSON.stringify(it1?.[0] ?? r1),
  );
  check(
    "1b. y congela el NOMBRE del producto",
    it1?.[0]?.product_name === `${MARCA} dos escalones`,
    it1?.[0]?.product_name,
  );

  // Se cambia el precio de la ficha DESPUÉS de pedir: la orden no se mueve.
  await admin.from("products").update({ price_retail: 99 }).eq("id", prod.id);
  const { data: it1b } = await admin
    .from("catalog_order_items")
    .select("unit_price")
    .eq("order_id", r1.order_id);
  check(
    "1c. subir el precio del producto NO cambia una orden ya hecha",
    Number(it1b[0].unit_price) === 10,
    `la orden sigue a ${it1b[0].unit_price} con la ficha a 99`,
  );
  await admin.from("products").update({ price_retail: 10 }).eq("id", prod.id);

  // ── 2. EL ESCALÓN, y que coincida con TypeScript ────────────────────────
  const productoTs = {
    retail: { price: 10, pinned: {} },
    wholesale: { price: 8, pinned: { EUR: 7 } },
    wholesale_min_quantity: 6,
  };
  const cantidades = [1, 5, 6, 12];
  const desacuerdos = [];
  for (const q of cantidades) {
    const r = await pedir(token, [{ product_id: prod.id, quantity: q, currency: "USD" }]);
    const { data: it } = await admin
      .from("catalog_order_items")
      .select("tier, unit_price")
      .eq("order_id", r.order_id)
      .single();
    const esperado = escalonParaCantidad(productoTs, q);
    if (it.tier !== esperado) desacuerdos.push(`${q}→base:${it.tier} ts:${esperado}`);
  }
  check(
    "2a. la base y TypeScript eligen el MISMO escalón",
    desacuerdos.length === 0,
    desacuerdos.length ? desacuerdos.join(" · ") : "1, 5, 6 y 12 coinciden",
  );

  const r2 = await pedir(token, [{ product_id: prod.id, quantity: 6, currency: "USD" }]);
  const { data: it2 } = await admin
    .from("catalog_order_items")
    .select("tier, unit_price")
    .eq("order_id", r2.order_id)
    .single();
  check(
    "2b. con 6 cobra el precio de MAYOR, no el de detal",
    it2.tier === "wholesale" && Number(it2.unit_price) === 8,
    `${it2.tier} a ${it2.unit_price}`,
  );

  // ── 3. LAS MONEDAS ──────────────────────────────────────────────────────
  const r3 = await pedir(token, [{ product_id: prod.id, quantity: 6, currency: "EUR" }]);
  const { data: it3 } = await admin
    .from("catalog_order_items")
    .select("unit_price, currency")
    .eq("order_id", r3.order_id)
    .single();
  check(
    "3a. una moneda FIJADA usa su importe exacto, sin convertir",
    r3.ok && Number(it3.unit_price) === 7 && it3.currency === "EUR",
    `${it3?.unit_price} ${it3?.currency}`,
  );

  const r3b = await pedir(token, [{ product_id: prod.id, quantity: 1, currency: "EUR" }]);
  check(
    "3b. esa misma moneda NO vale en el escalón que no la tiene fijada",
    !r3b.ok && r3b.reason === "moneda_invalida",
    r3b.reason,
  );

  const r3c = await pedir(token, [{ product_id: prod.id, quantity: 1, currency: "USDT" }]);
  check(
    "3c. una moneda inventada se rechaza en vez de convertirse",
    !r3c.ok && r3c.reason === "moneda_invalida",
    r3c.reason,
  );

  // ── 4. LOS PRODUCTOS QUE NO DEBEN ENTRAR ────────────────────────────────
  const r4a = await pedir(token, [{ product_id: sinPublicar.id, quantity: 1, currency: "USD" }]);
  check(
    "4a. un producto SIN PUBLICAR no entra",
    !r4a.ok && r4a.reason === "producto_invalido",
    r4a.reason,
  );

  if (otroOwnerId) {
    const { data: ajeno } = await admin
      .from("products")
      .insert({
        owner_id: otroOwnerId,
        name: `${MARCA} de otro dueño`,
        base_currency: "USD",
        price_retail: 3,
        published_retail: true,
      })
      .select("id")
      .single();
    productos.push(ajeno.id);
    const r4b = await pedir(token, [{ product_id: ajeno.id, quantity: 1, currency: "USD" }]);
    check(
      "4b. el producto de OTRO dueño no entra por este enlace",
      !r4b.ok && r4b.reason === "producto_invalido",
      r4b.reason,
    );
  } else {
    check("4b. el producto de OTRO dueño no entra por este enlace", false, "dev no tiene un segundo dueño");
  }

  await admin.from("products").update({ trashed_at: new Date().toISOString() }).eq("id", prod.id);
  const r4c = await pedir(token, [{ product_id: prod.id, quantity: 1, currency: "USD" }]);
  check(
    "4c. un producto en la PAPELERA no entra",
    !r4c.ok && r4c.reason === "producto_invalido",
    r4c.reason,
  );
  await admin.from("products").update({ trashed_at: null }).eq("id", prod.id);

  const r4d = await pedir(token, [
    { product_id: "00000000-0000-0000-0000-000000000000", quantity: 1, currency: "USD" },
  ]);
  check(
    "4d. un id que no existe no entra",
    !r4d.ok && r4d.reason === "producto_invalido",
    r4d.reason,
  );

  // ── 5. MEDIA ORDEN NO EXISTE ────────────────────────────────────────────
  const antes = (await admin.from("catalog_orders").select("id", { count: "exact", head: true })
    .eq("catalog_link_id", link.id)).count;
  const r5 = await pedir(token, [
    { product_id: prod.id, quantity: 1, currency: "USD" },
    { product_id: sinPublicar.id, quantity: 1, currency: "USD" },
  ]);
  const despues = (await admin.from("catalog_orders").select("id", { count: "exact", head: true })
    .eq("catalog_link_id", link.id)).count;
  check(
    "5. una línea mala deshace la orden ENTERA, no deja media",
    !r5.ok && antes === despues,
    `${r5.reason} · órdenes antes ${antes}, después ${despues}`,
  );

  // ── 6. EL MÍNIMO DEL MAYOR, cuando no hay dónde caer ────────────────────
  const r6a = await pedir(token, [{ product_id: soloMayor.id, quantity: 3, currency: "USD" }]);
  check(
    "6a. solo al mayor: por debajo del mínimo se rechaza",
    !r6a.ok && r6a.reason === "cantidad_bajo_el_minimo",
    r6a.reason,
  );
  const r6b = await pedir(token, [{ product_id: soloMayor.id, quantity: 12, currency: "USD" }]);
  check("6b. y con el mínimo justo sí entra", r6b.ok, r6b.reason ?? "ok");

  // ── 7. LOS DATOS DE QUIEN PIDE ──────────────────────────────────────────
  const r7a = await pedir(token, unaLinea, { p_customer_name: "   " });
  check("7a. sin nombre no entra", !r7a.ok && r7a.reason === "nombre_invalido", r7a.reason);
  const r7b = await pedir(token, unaLinea, { p_customer_document: "" });
  check("7b. sin documento no entra", !r7b.ok && r7b.reason === "documento_invalido", r7b.reason);
  const r7c = await pedir(token, unaLinea, { p_customer_whatsapp: "abc" });
  check("7c. con un WhatsApp ilegible no entra", !r7c.ok && r7c.reason === "whatsapp_invalido", r7c.reason);

  // ── 8. TAMAÑO ───────────────────────────────────────────────────────────
  const muchas = Array.from({ length: 51 }, () => ({
    product_id: prod.id,
    quantity: 1,
    currency: "USD",
  }));
  const r8a = await pedir(token, muchas);
  check("8a. 51 líneas no entran", !r8a.ok && r8a.reason === "demasiados_productos", r8a.reason);
  const r8b = await pedir(token, []);
  check("8b. una orden vacía no entra", !r8b.ok && r8b.reason === "sin_productos", r8b.reason);

  // ── 9. EL TOKEN ─────────────────────────────────────────────────────────
  const r9 = await pedir("noexisteestetoken", unaLinea);
  check("9. un token inventado no entra", !r9.ok && r9.reason === "enlace_invalido", r9.reason);

  // ── 10. EL PERMISO DE WHATSAPP ──────────────────────────────────────────
  await admin.from("client_whatsapp_consents").delete().eq("phone", TEL);

  const r10a = await pedir(token, unaLinea);
  const { count: sinPedirlo } = await admin
    .from("client_whatsapp_consents")
    .select("id", { count: "exact", head: true })
    .eq("phone", TEL);
  check(
    "10a. sin marcar la casilla NO se escribe permiso",
    r10a.ok && sinPedirlo === 0,
    `${sinPedirlo} filas`,
  );

  const r10b = await pedir(token, unaLinea, {
    p_wants_notices: true,
    p_consent_text: "Acepto recibir avisos de mis compras y mi saldo por WhatsApp.",
  });
  const { data: permiso } = await admin
    .from("client_whatsapp_consents")
    .select("event, source, consent_text")
    .eq("phone", TEL)
    .maybeSingle();
  check(
    "10b. marcándola se escribe, con origen `client_order`",
    r10b.ok && permiso?.event === "granted" && permiso?.source === "client_order",
    JSON.stringify(permiso),
  );
  check(
    "10c. y guarda el texto EXACTO que el cliente tenía en pantalla",
    permiso?.consent_text === "Acepto recibir avisos de mis compras y mi saldo por WhatsApp.",
    permiso?.consent_text,
  );

  // ── 11. ANON NO TOCA LAS TABLAS ─────────────────────────────────────────
  const { error: eLeer } = await anon.from("catalog_orders").select("id").limit(1);
  check(
    "11a. anon NO puede leer las órdenes de nadie",
    eLeer != null,
    eLeer?.message ?? "¡LAS LEYÓ!",
  );
  const { error: eEscribir } = await anon
    .from("catalog_orders")
    .insert({ owner_id: ownerId, customer_name: "x", customer_document: "x", customer_whatsapp: "1", customer_whatsapp_raw: "1" });
  check(
    "11b. anon NO puede insertar una orden a mano, solo por la función",
    eEscribir != null,
    eEscribir?.message ?? "¡LA INSERTÓ!",
  );
} finally {
  // Las órdenes se van por cascada al borrar nada: no cuelgan del producto
  // sino del enlace, así que se borran por el enlace del negocio.
  const { data: link } = await admin
    .from("catalog_share_links")
    .select("id")
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (link) await admin.from("catalog_orders").delete().eq("catalog_link_id", link.id);
  if (enlaceCreado) await admin.from("catalog_share_links").delete().eq("id", enlaceCreado);
  if (productos.length) await admin.from("products").delete().in("id", productos);
  await admin.from("client_whatsapp_consents").delete().eq("phone", TEL);

  const { count: quedanProd } = await admin
    .from("products")
    .select("id", { count: "exact", head: true })
    .like("name", `${MARCA}%`);
  const { count: quedanPermisos } = await admin
    .from("client_whatsapp_consents")
    .select("id", { count: "exact", head: true })
    .eq("phone", TEL);
  check(
    "12. limpieza: no queda nada de la prueba en dev",
    quedanProd === 0 && quedanPermisos === 0,
    `${quedanProd} productos · ${quedanPermisos} permisos`,
  );

  const fallos = filas.filter((f) => !f.pasa).length;
  console.log(`\n${filas.length - fallos}/${filas.length} pasan.`);
  if (fallos) process.exitCode = 1;
}
