// SOLO LA RAMA DEV (vzqppwrwnmlbrxizskdh) — lee .env.local.
//
// SÍ ESCRIBE en dev: crea un enlace, un producto y unas pocas órdenes. El
// `finally` las borra aunque el script se caiga a mitad.
//
// ===========================================================================
// LOS BORDES QUE NINGUNA OTRA SUITE TOCA
//
// `qa:orden` prueba los topes **por el lado que falla**: 51 líneas no entran,
// sin nombre no entra, por debajo del mínimo se rechaza. Esta suite prueba
// **el lado que pasa**, que es la mitad que faltaba:
//
//   · 120 caracteres de nombre entran y 121 no.
//   · 40 de documento entran y 41 no.
//   · 50 líneas entran y 51 no.
//
// POR QUÉ ESA MITAD NO ES REDUNDANTE. Un tope mal escrito —`>=` donde iba
// `>`— sigue rechazando 51 y empieza a rechazar 50. La suite que solo prueba
// el lado que falla se queda verde y el catálogo rechaza pedidos legítimos,
// que es el fallo silencioso de `CT-68` otra vez: una tienda con éxito
// indistinguible de un script.
//
// Y DOS COSAS MÁS QUE NO ESTABAN PROBADAS EN NINGÚN SITIO:
//
//   · LA CANTIDAD. Cero, negativa y por encima del techo. Una línea con
//     cantidad −3 restaría del total si llegara a cotizarse.
//   · EL COMODÍN `error`. Es la única razón que no es nuestra: la devuelve el
//     `when others` de la función cuando pasa algo que no previó. Si ese
//     camino alguna vez deja escapar el texto de Postgres, es la regla de
//     `CLAUDE.md` sobre enmascarar errores rota en la superficie que cualquiera
//     puede llamar. Aquí se fuerza a propósito con un `product_id` que no es
//     un uuid, y se comprueba que lo que vuelve es el código y nada más.

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
// LA CLAVE ANÓNIMA, y es el punto entero de esta suite: la acción del servidor
// no valida nada importante a propósito —lo dice su propio comentario— porque
// cualquiera puede llamar al RPC con esta clave, que es pública. La frontera
// real es la base, así que es a la base a quien se le pregunta.
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

const filas = [];
function check(nombre, pasa, detalle) {
  filas.push({ nombre, pasa });
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${detalle ? `  — ${detalle}` : ""}`);
}

const MARCA = "QA BORDES";
const creados = { productos: [], enlaces: [], ordenes: [] };

// Las razones que la función puede devolver. Cualquier otra cosa en ese campo
// es texto que se escapó, y el check 7 lo comprueba.
const RAZONES = new Set([
  "enlace_invalido",
  "demasiadas_ordenes",
  "nombre_invalido",
  "documento_invalido",
  "whatsapp_invalido",
  "sin_productos",
  "demasiados_productos",
  "producto_invalido",
  "cantidad_invalida",
  "cantidad_bajo_el_minimo",
  "sin_precio",
  "moneda_invalida",
  "sin_tasa",
  "error",
]);
const vistas = [];

let token;

async function pedir(items, extra = {}) {
  const { data, error } = await anon.rpc("create_catalog_order", {
    p_token: token,
    p_customer_name: `${MARCA} comprador`,
    p_customer_document: "V-99999999",
    // LA LETRA, desde la migración `155`. Sin ella la llamada no encuentra la
    // función: Postgres resuelve por firma, y la de siete argumentos ya no
    // existe. Va aquí y no en cada caso porque es parte del sobre, no de lo que
    // cada prueba quiere medir.
    p_customer_document_type: "V",
    p_customer_whatsapp: "04149999999",
    p_wants_notices: false,
    p_consent_text: null,
    p_items: items,
    ...extra,
  });
  // UN ERROR DE TRANSPORTE NO ES UN RECHAZO, y confundirlos haría que una
  // suite verde significara «la base está caída».
  if (error) return { ok: false, reason: `RPC_ERROR: ${error.message}` };
  const r = data ?? { ok: false, reason: "sin respuesta" };
  if (!r.ok) vistas.push(r.reason);
  if (r.ok && r.order_id) creados.ordenes.push(r.order_id);
  return r;
}

try {
  const { data: ve } = await admin
    .from("owners")
    .select("id, business_name")
    .eq("country", "VE")
    .order("id")
    .limit(1)
    .single();

  const { data: enlace } = await admin
    .from("catalog_share_links")
    .insert({ owner_id: ve.id })
    .select("id, token")
    .single();
  creados.enlaces.push(enlace.id);
  token = enlace.token;

  const { data: prod } = await admin
    .from("products")
    .insert({
      owner_id: ve.id,
      name: `${MARCA} producto`,
      base_currency: "USD",
      base_currency_retail: "USD",
      base_currency_wholesale: "USD",
      price_retail: 10,
      published_retail: true,
      published_wholesale: false,
    })
    .select("id")
    .single();
  creados.productos.push(prod.id);
  await admin
    .from("product_currencies")
    .insert([{ product_id: prod.id, tier: "retail", currency: "USD" }]);

  const linea = { product_id: prod.id, quantity: 1, currency: "USD", comment: null };

  // ══════════════════════════════════════════════════════════════════════
  // 1. EL NOMBRE: 120 entra, 121 no
  // ══════════════════════════════════════════════════════════════════════
  const r1a = await pedir([linea], { p_customer_name: "N".repeat(120) });
  check("1a. un nombre de 120 caracteres ENTRA — el tope es 120, no 119", r1a.ok === true, r1a.reason ?? "ok");

  const r1b = await pedir([linea], { p_customer_name: "N".repeat(121) });
  check("1b. y uno de 121 no entra", r1b.ok === false && r1b.reason === "nombre_invalido", r1b.reason);

  // Un nombre de solo espacios: la función hace `btrim` antes de medir, así
  // que esto es «vacío» y no «de tres caracteres».
  const r1c = await pedir([linea], { p_customer_name: "   " });
  check(
    "1c. un nombre de solo espacios cuenta como vacío — la función hace btrim antes de medir",
    r1c.ok === false && r1c.reason === "nombre_invalido",
    r1c.reason,
  );

  // ══════════════════════════════════════════════════════════════════════
  // 2. EL DOCUMENTO: 40 entra, 41 no
  // ══════════════════════════════════════════════════════════════════════
  const r2a = await pedir([linea], { p_customer_document: "D".repeat(40) });
  check("2a. un documento de 40 caracteres ENTRA", r2a.ok === true, r2a.reason ?? "ok");

  const r2b = await pedir([linea], { p_customer_document: "D".repeat(41) });
  check("2b. y uno de 41 no entra", r2b.ok === false && r2b.reason === "documento_invalido", r2b.reason);

  // ══════════════════════════════════════════════════════════════════════
  // 3. LAS LÍNEAS: 50 entran, 51 no
  //
  // Es el borde que más me preocupaba: el tope está escrito `> 50`, así que
  // 50 tiene que pasar. Con `>=` el catálogo rechazaría un pedido legítimo de
  // cincuenta líneas sin que ninguna suite se diera cuenta.
  // ══════════════════════════════════════════════════════════════════════
  const r3a = await pedir(Array.from({ length: 50 }, () => ({ ...linea })));
  check("3a. 50 líneas exactas ENTRAN — el tope es `> 50`", r3a.ok === true, r3a.reason ?? "ok");

  const r3b = await pedir(Array.from({ length: 51 }, () => ({ ...linea })));
  check("3b. y 51 no", r3b.ok === false && r3b.reason === "demasiados_productos", r3b.reason);

  // ══════════════════════════════════════════════════════════════════════
  // 4. LA CANTIDAD, que no estaba probada en ninguna suite
  // ══════════════════════════════════════════════════════════════════════
  const r4a = await pedir([{ ...linea, quantity: 0 }]);
  check("4a. cantidad 0 se rechaza", r4a.ok === false && r4a.reason === "cantidad_invalida", r4a.reason);

  const r4b = await pedir([{ ...linea, quantity: -3 }]);
  check(
    "4b. cantidad NEGATIVA se rechaza — si llegara a cotizarse, restaría del total",
    r4b.ok === false && r4b.reason === "cantidad_invalida",
    r4b.reason,
  );

  const r4c = await pedir([{ ...linea, quantity: 1e12 }]);
  check(
    "4c. una cantidad por encima del techo se rechaza",
    r4c.ok === false && r4c.reason === "cantidad_invalida",
    r4c.reason,
  );

  const r4d = await pedir([{ ...linea, quantity: null }]);
  check("4d. cantidad nula se rechaza", r4d.ok === false && r4d.reason === "cantidad_invalida", r4d.reason);

  // ══════════════════════════════════════════════════════════════════════
  // 5. EL COMODÍN `error`, forzado a propósito
  //
  // `(v_item ->> 'product_id')::uuid` con algo que no es un uuid lanza 22P02,
  // que no es ninguna de nuestras razones y cae en el `when others`.
  // ══════════════════════════════════════════════════════════════════════
  const r5 = await pedir([{ ...linea, product_id: "esto-no-es-un-uuid" }]);
  check(
    "5a. un product_id que no es uuid cae en el comodín `error`, no en un error crudo",
    r5.ok === false && r5.reason === "error",
    r5.reason,
  );
  check(
    "5b. y ese comodín NO lleva texto de Postgres dentro",
    r5.reason === "error" &&
      !/invalid input|syntax|uuid|relation|column|PL\/pgSQL/i.test(String(r5.reason)),
    `reason = ${JSON.stringify(r5.reason)}`,
  );

  // ══════════════════════════════════════════════════════════════════════
  // 6. LA ORDEN RECHAZADA NO DEJA RASTRO
  //
  // La función inserta la cabecera ANTES de recorrer las líneas, y confía en
  // que el bloque `exception` sea una subtransacción que se la lleve. Si eso
  // dejara de ser cierto, cada rechazo de línea dejaría una orden vacía — y
  // veinte de esas agotan el tope del minuto sin que nadie haya comprado.
  // ══════════════════════════════════════════════════════════════════════
  const { count: huerfanas } = await admin
    .from("catalog_orders")
    .select("id", { count: "exact", head: true })
    .eq("catalog_link_id", enlace.id)
    .eq("customer_document", "V-99999999");
  // Las que pasaron: 50 líneas, y los dos bordes de nombre y documento que
  // entraron con su propio documento. Con el documento de la marca solo
  // quedan 3a y 1a... que llevan documento por defecto.
  const { data: todas } = await admin
    .from("catalog_orders")
    .select("id")
    .eq("catalog_link_id", enlace.id);
  check(
    "6. solo quedan las órdenes que PASARON — ningún rechazo dejó una cabecera suelta",
    (todas?.length ?? -1) === creados.ordenes.length,
    `en la base ${todas?.length} · aceptadas ${creados.ordenes.length} (con el documento de la marca: ${huerfanas})`,
  );

  // ══════════════════════════════════════════════════════════════════════
  // 7. TODO LO QUE VOLVIÓ ES UN CÓDIGO NUESTRO
  // ══════════════════════════════════════════════════════════════════════
  const desconocidas = vistas.filter((r) => !RAZONES.has(r));
  check(
    `7. las ${vistas.length} razones que esta suite provocó son códigos cerrados, ninguna es una frase`,
    desconocidas.length === 0,
    desconocidas.length ? `se escaparon: ${desconocidas.join(", ")}` : `${vistas.length} razones, todas del catálogo`,
  );

  // ══════════════════════════════════════════════════════════════════════
  // 8. ANON NO LEE LAS TABLAS POR SU CUENTA
  // ══════════════════════════════════════════════════════════════════════
  // `select("*")` Y NO `select("id")`: `product_currencies` dejó de tener una
  // columna `id` en la migración 114 —su clave es (product_id, tier, currency)—
  // y pedirla devolvía 42703, «no existe esa columna». Un código de error que
  // no es 42501 no dice que la tabla esté cerrada: dice que la pregunta estaba
  // mal escrita. Con `*` no hay columna que adivinar y lo que vuelve es el
  // permiso de verdad.
  const lecturas = [];
  for (const tabla of ["products", "catalog_orders", "catalog_share_links", "product_currencies"]) {
    const { data, error } = await anon.from(tabla).select("*").limit(1);
    lecturas.push(`${tabla}:${error ? error.code : `LEYÓ ${data?.length ?? 0}`}`);
  }
  check(
    "8. anon no puede leer products, catalog_orders, catalog_share_links ni product_currencies",
    lecturas.every((l) => l.endsWith(":42501")),
    lecturas.join(" · "),
  );
} finally {
  // ── LIMPIEZA, pase lo que pase ──────────────────────────────────────
  if (creados.ordenes.length) {
    await admin.from("catalog_orders").delete().in("id", creados.ordenes);
  }
  if (creados.enlaces.length) {
    // Por si alguna orden se escapó de la lista: se borran por el enlace.
    await admin.from("catalog_orders").delete().in("catalog_link_id", creados.enlaces);
  }
  if (creados.productos.length) {
    await admin.from("products").delete().in("id", creados.productos);
  }
  if (creados.enlaces.length) {
    await admin.from("catalog_share_links").delete().in("id", creados.enlaces);
  }

  const { count: quedan } = await admin
    .from("products")
    .select("id", { count: "exact", head: true })
    .like("name", `${MARCA}%`);
  check("9. limpieza: no queda nada de la prueba en dev", (quedan ?? 0) === 0, `quedan ${quedan}`);

  const fallan = filas.filter((f) => !f.pasa).length;
  console.log(`\n${filas.length - fallan}/${filas.length} pasan.`);
  process.exit(fallan ? 1 : 0);
}
