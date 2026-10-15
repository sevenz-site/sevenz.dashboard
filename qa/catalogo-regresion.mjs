// REGRESIÓN DEL CATÁLOGO: casos borde y peores escenarios.
//
// Pedida por el dueño el 2026-10-15 antes de empezar el entregable D. No
// sustituye a `qa:orden`, `qa:carrito` ni `qa:precio-publico` -- esas vigilan
// las reglas ya acordadas. Esta busca los HUECOS: lo que nadie ha ejecutado
// nunca, y lo que pasa cuando algo va mal a mitad.
//
// ===========================================================================
// TODO SE PIDE CON LA CLAVE ANÓNIMA, que es exactamente quien abre un
// catálogo. Probarlo con la clave de servicio comprobaría otra cosa: esa se
// salta las políticas, así que un agujero de permisos saldría en verde.
//
// ===========================================================================
// LO QUE MONTA Y LO QUE DEVUELVE AL SITIO
//
// Crea un negocio COLOMBIANO con enlace y producto -- el camino que `CT-74`
// lleva abierto desde el 2026-10-15 porque en dev NINGÚN dueño CO tenía
// enlace de catálogo, así que no había dónde probarlo. Y fuerza un stock en
// cero, que tampoco existía.
//
// Todo lo que crea lo borra en el `finally`, y lo que TOCA de productos reales
// lo devuelve a su valor anterior leyéndolo antes. Si esto se corta por la
// mitad, la última comprobación lo dice en vez de dejarlo a medias en
// silencio.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { escalonParaCantidad, monedasDelBloque } from "../lib/products/public-pricing.ts";

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

const filas = [];
function check(nombre, pasa, detalle) {
  filas.push({ nombre, pasa });
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${detalle ? `  — ${detalle}` : ""}`);
}

const MARCA = "QA REG";
const creados = { productos: [], enlaces: [] };
const restaurar = [];

async function pedir(token, items, extra = {}) {
  const { data } = await anon.rpc("create_catalog_order", {
    p_token: token,
    p_customer_name: `${MARCA} comprador`,
    p_customer_document: "V-99999999",
    p_customer_whatsapp: "04149999999",
    p_wants_notices: false,
    p_consent_text: null,
    p_items: items,
    ...extra,
  });
  return data ?? { ok: false, reason: "sin respuesta" };
}

try {
  // ══════════════════════════════════════════════════════════════════════
  // 1. EL NEGOCIO COLOMBIANO — `CT-74`
  //
  // El riesgo real no es un error: es que de COP no hay tasa a bolívares
  // (`bolivaresPorUnidad` devuelve null a propósito), así que todo lo que
  // convierte tiene que quedarse quieto. Si algo intenta convertir, el
  // colombiano ve un hueco donde debería ir su precio -- o peor, un número.
  // ══════════════════════════════════════════════════════════════════════
  const { data: co } = await admin
    .from("owners")
    .select("id, business_name")
    .eq("country", "CO")
    .limit(1)
    .single();

  const { data: enlaceCo } = await admin
    .from("catalog_share_links")
    .insert({ owner_id: co.id })
    .select("id, token")
    .single();
  creados.enlaces.push(enlaceCo.id);

  const { data: prodCo } = await admin
    .from("products")
    .insert({
      owner_id: co.id,
      name: `${MARCA} colombiano`,
      base_currency: "COP",
      base_currency_retail: "COP",
      base_currency_wholesale: "COP",
      price_retail: 12000,
      price_wholesale: 9500,
      wholesale_min_quantity: 6,
      published_retail: true,
      published_wholesale: true,
    })
    .select("id")
    .single();
  creados.productos.push(prodCo.id);
  await admin.from("product_currencies").insert([
    { product_id: prodCo.id, tier: "retail", currency: "COP" },
    { product_id: prodCo.id, tier: "wholesale", currency: "COP" },
  ]);

  const { data: catCo } = await anon.rpc("get_shared_catalog", { p_token: enlaceCo.token });
  const filaCo = (catCo?.products ?? []).find((p) => p.id === prodCo.id);
  check(
    "1a. CO: el catálogo devuelve el producto con su precio en pesos",
    filaCo != null && filaCo.base_currency === "COP" && Number(filaCo.price) === 12000,
    filaCo == null ? "no vino" : `${filaCo.base_currency} ${filaCo.price}`,
  );
  check(
    "1b. CO: NO se manda tasa de bolívares — no existe COP/VES y no se inventa",
    catCo?.current_bcv_usd == null && catCo?.current_bcv_eur == null,
    `bcv_usd ${catCo?.current_bcv_usd} · bcv_eur ${catCo?.current_bcv_eur}`,
  );
  check(
    "1c. CO: la única moneda que se ofrece es la suya",
    Array.isArray(filaCo?.currencies) && filaCo.currencies.length === 1 && filaCo.currencies[0] === "COP",
    JSON.stringify(filaCo?.currencies),
  );

  const { data: detCo } = await anon.rpc("get_shared_product", {
    p_token: enlaceCo.token,
    p_product_id: prodCo.id,
  });
  const bloqueCoDetal = detCo?.retail
    ? { ...detCo.retail, base: detCo.retail.base_currency, currencies: detCo.retail.currencies ?? [] }
    : null;
  check(
    "1d. CO: el detalle ofrece pesos y NADA más, con tasa nula",
    JSON.stringify(monedasDelBloque(bloqueCoDetal, null)) === JSON.stringify(["COP"]),
    JSON.stringify(monedasDelBloque(bloqueCoDetal, null)),
  );

  const rCo = await pedir(enlaceCo.token, [
    { product_id: prodCo.id, quantity: 2, currency: "COP" },
  ]);
  const { data: itCo } = rCo.ok
    ? await admin
        .from("catalog_order_items")
        .select("unit_price, currency, tier")
        .eq("order_id", rCo.order_id)
        .single()
    : { data: null };
  check(
    "1e. CO: una orden en pesos entra y guarda el precio de la ficha",
    itCo != null && itCo.currency === "COP" && Number(itCo.unit_price) === 12000,
    itCo == null ? `rechazada: ${rCo.reason}` : `${itCo.currency} ${itCo.unit_price} (${itCo.tier})`,
  );

  const rCoUsd = await pedir(enlaceCo.token, [
    { product_id: prodCo.id, quantity: 2, currency: "USD" },
  ]);
  check(
    "1f. CO: pedir en dólares se RECHAZA, no se convierte con una tasa inventada",
    !rCoUsd.ok && rCoUsd.reason === "moneda_invalida",
    rCoUsd.reason,
  );

  // EL HUECO DEL NEGOCIO COLOMBIANO, fijado aquí para que no se redescubra.
  // Toda conversión de este producto pasa por bolívares, y de un negocio CO no
  // se lee ninguna tasa, así que su catálogo SOLO puede ofrecer la moneda base
  // de cada escalón. Si el tendero colombiano activa una segunda, su cliente
  // no la verá y nada se lo dirá.
  await admin
    .from("product_currencies")
    .insert({ product_id: prodCo.id, tier: "retail", currency: "USD" });
  const { data: detCo2 } = await anon.rpc("get_shared_product", {
    p_token: enlaceCo.token,
    p_product_id: prodCo.id,
  });
  const bloqueCo2 = detCo2?.retail
    ? { ...detCo2.retail, base: detCo2.retail.base_currency, currencies: detCo2.retail.currencies ?? [] }
    : null;
  const rCoUsd2 = await pedir(enlaceCo.token, [
    { product_id: prodCo.id, quantity: 1, currency: "USD" },
  ]);
  check(
    "1h. CO: una segunda moneda activada NO se ofrece ni se acepta — coherente, pero el tendero no se entera",
    !monedasDelBloque(bloqueCo2, null).includes("USD") && !rCoUsd2.ok,
    `ofrecidas ${JSON.stringify(monedasDelBloque(bloqueCo2, null))} · orden ${rCoUsd2.reason}`,
  );
  await admin
    .from("product_currencies")
    .delete()
    .eq("product_id", prodCo.id)
    .eq("tier", "retail")
    .eq("currency", "USD");

  const rCoMayor = await pedir(enlaceCo.token, [
    { product_id: prodCo.id, quantity: 6, currency: "COP" },
  ]);
  const { data: itCoM } = rCoMayor.ok
    ? await admin
        .from("catalog_order_items")
        .select("unit_price, tier")
        .eq("order_id", rCoMayor.order_id)
        .single()
    : { data: null };
  check(
    "1g. CO: con 6 cobra el precio de mayor, igual que un venezolano",
    itCoM != null && itCoM.tier === "wholesale" && Number(itCoM.unit_price) === 9500,
    itCoM == null ? `rechazada: ${rCoMayor.reason}` : `${itCoM.tier} ${itCoM.unit_price}`,
  );

  // ══════════════════════════════════════════════════════════════════════
  // 2. STOCK EN CERO — nunca se había visto
  //
  // La tarjeta y el detalle lo pintan por caminos distintos, y hasta hoy el
  // detalle decía «Disponible: 0» mientras la tarjeta decía «No disponible».
  // Se arregló el 2026-10-15 sin poder comprobarlo, porque ningún producto de
  // dev tenía cero.
  // ══════════════════════════════════════════════════════════════════════
  const { data: cero } = await admin
    .from("products")
    .insert({
      owner_id: co.id,
      name: `${MARCA} agotado`,
      base_currency: "COP",
      base_currency_retail: "COP",
      base_currency_wholesale: "COP",
      price_retail: 500,
      published_retail: true,
      stock_opening: 0,
    })
    .select("id")
    .single();
  creados.productos.push(cero.id);
  await admin
    .from("product_currencies")
    .insert({ product_id: cero.id, tier: "retail", currency: "COP" });

  const { data: catCero } = await anon.rpc("get_shared_catalog", { p_token: enlaceCo.token });
  const filaCero = (catCero?.products ?? []).find((p) => p.id === cero.id);
  check(
    "2a. stock 0 viaja como 0 y NO como null — «no hay» y «no se sabe» no son lo mismo",
    filaCero != null && filaCero.stock === 0,
    `stock = ${JSON.stringify(filaCero?.stock)}`,
  );
  const rCero = await pedir(enlaceCo.token, [
    { product_id: cero.id, quantity: 1, currency: "COP" },
  ]);
  check(
    "2b. CON STOCK 0 LA ORDEN ENTRA IGUAL, y es deliberado",
    rCero.ok,
    "el inventario no lo mantiene nadie (CT-59): bloquear por él perdería ventas reales",
  );

  // ══════════════════════════════════════════════════════════════════════
  // 3. UNA FICHA DESCUADRADA: la base no está en la lista de su escalón
  //
  // No debería pasar -- el formulario pone la base primera -- pero es el
  // estado en el que queda un producto si alguien toca la base de datos a
  // mano, o si una migración futura se deja una fila. Lo que NO puede pasar
  // es que el producto deje de poder pedirse en su propia moneda.
  // ══════════════════════════════════════════════════════════════════════
  const { data: descuadrado } = await admin
    .from("products")
    .insert({
      owner_id: co.id,
      name: `${MARCA} descuadrado`,
      base_currency: "COP",
      base_currency_retail: "COP",
      base_currency_wholesale: "COP",
      price_retail: 800,
      published_retail: true,
    })
    .select("id")
    .single();
  creados.productos.push(descuadrado.id);
  // A propósito: NINGUNA fila en `product_currencies`.

  const { data: detDesc } = await anon.rpc("get_shared_product", {
    p_token: enlaceCo.token,
    p_product_id: descuadrado.id,
  });
  check(
    "3a. sin filas de moneda, el escalón sigue ofreciendo su base",
    JSON.stringify(detDesc?.retail?.currencies) === JSON.stringify(["COP"]),
    JSON.stringify(detDesc?.retail?.currencies),
  );
  const rDesc = await pedir(enlaceCo.token, [
    { product_id: descuadrado.id, quantity: 1, currency: "COP" },
  ]);
  check(
    "3b. y se puede pedir en ella — un producto nunca se queda sin su propia moneda",
    rDesc.ok,
    rDesc.reason ?? "ok",
  );

  // ══════════════════════════════════════════════════════════════════════
  // 4. EL ESCALÓN SIN PUBLICAR
  //
  // Varios productos de dev tienen `price_wholesale` escrito y el mayor
  // APAGADO. Pedir doce unidades no puede cobrar ese precio escondido.
  // ══════════════════════════════════════════════════════════════════════
  const { data: soloDetal } = await admin
    .from("products")
    .insert({
      owner_id: co.id,
      name: `${MARCA} mayor apagado`,
      base_currency: "COP",
      base_currency_retail: "COP",
      base_currency_wholesale: "COP",
      price_retail: 1000,
      price_wholesale: 100,
      wholesale_min_quantity: 3,
      published_retail: true,
      published_wholesale: false,
    })
    .select("id")
    .single();
  creados.productos.push(soloDetal.id);
  await admin
    .from("product_currencies")
    .insert({ product_id: soloDetal.id, tier: "retail", currency: "COP" });

  const r4 = await pedir(enlaceCo.token, [
    { product_id: soloDetal.id, quantity: 12, currency: "COP" },
  ]);
  const { data: it4 } = r4.ok
    ? await admin
        .from("catalog_order_items")
        .select("unit_price, tier")
        .eq("order_id", r4.order_id)
        .single()
    : { data: null };
  check(
    "4a. con el mayor APAGADO, pedir 12 cobra el detal y no el precio escondido",
    it4 != null && it4.tier === "retail" && Number(it4.unit_price) === 1000,
    it4 == null ? `rechazada: ${r4.reason}` : `${it4.tier} ${it4.unit_price} (el de mayor era 100)`,
  );
  check(
    "4b. y TypeScript decide lo mismo que la base",
    escalonParaCantidad(
      { retail: { price: 1000 }, wholesale: null, wholesale_min_quantity: 3 },
      12,
    ) === "retail",
  );

  // ══════════════════════════════════════════════════════════════════════
  // 5. CANTIDAD CON DECIMALES
  //
  // Un producto que se vende por peso. La función admite `numeric`, así que
  // 2,5 kg tiene que entrar y cobrarse como 2,5 -- redondearlo a 2 le
  // regalaría medio kilo al cliente, y a 3 se lo cobraría de más.
  // ══════════════════════════════════════════════════════════════════════
  const r5 = await pedir(enlaceCo.token, [
    { product_id: prodCo.id, quantity: 2.5, currency: "COP" },
  ]);
  const { data: it5 } = r5.ok
    ? await admin
        .from("catalog_order_items")
        .select("quantity, unit_price")
        .eq("order_id", r5.order_id)
        .single()
    : { data: null };
  check(
    "5a. 2,5 unidades se guardan como 2,5 — ni 2 ni 3",
    it5 != null && Number(it5.quantity) === 2.5,
    it5 == null ? `rechazada: ${r5.reason}` : `cantidad ${it5.quantity}`,
  );

  // ══════════════════════════════════════════════════════════════════════
  // 6. LA MONEDA QUE SE RETIRA MIENTRAS EL CARRITO ESPERA
  //
  // El carrito vive en el navegador y puede estar días ahí. Si el tendero
  // quita esa moneda del escalón, la orden tiene que rechazarse ENTERA en vez
  // de cobrarse en otra.
  // ══════════════════════════════════════════════════════════════════════
  //
  // EL PRODUCTO VA BAJO UN DUEÑO VENEZOLANO, y la primera versión de esta
  // prueba lo puso bajo el colombiano y falló con `sin_tasa`. No era un fallo
  // del producto: para un negocio CO la conversión NO EXISTE, porque toda
  // conversión pasa por bolívares y la tasa solo se carga `if v_country =
  // 'VE'`. O sea que un producto colombiano solo se puede pedir en su base.
  //
  // Es coherente -- la pantalla tampoco ofrece la otra, así que lo ofrecido y
  // lo aceptado siguen siendo el mismo conjunto -- pero es un HUECO DE
  // PRODUCTO que la prueba 1h de arriba deja fijado: el tendero colombiano
  // puede activar una segunda moneda y su cliente no la verá nunca, sin que
  // nada se lo diga.
  const { data: veDuenyo } = await admin
    .from("catalog_share_links")
    .select("owner_id, token, id")
    .neq("id", enlaceCo.id)
    .limit(1)
    .single();
  const { data: dosMonedas } = await admin
    .from("products")
    .insert({
      owner_id: veDuenyo.owner_id,
      name: `${MARCA} dos monedas`,
      base_currency: "USD",
      base_currency_retail: "USD",
      base_currency_wholesale: "USD",
      price_retail: 10,
      published_retail: true,
    })
    .select("id")
    .single();
  creados.productos.push(dosMonedas.id);
  await admin.from("product_currencies").insert([
    { product_id: dosMonedas.id, tier: "retail", currency: "USD" },
    { product_id: dosMonedas.id, tier: "retail", currency: "EUR" },
  ]);

  const rAntes = await pedir(veDuenyo.token, [
    { product_id: dosMonedas.id, quantity: 1, currency: "EUR" },
  ]);
  check(
    "6a. con el euro activo, el pedido en euros entra",
    rAntes.ok,
    rAntes.reason ?? "ok",
  );

  await admin
    .from("product_currencies")
    .delete()
    .eq("product_id", dosMonedas.id)
    .eq("tier", "retail")
    .eq("currency", "EUR");

  const rDespues = await pedir(veDuenyo.token, [
    { product_id: dosMonedas.id, quantity: 1, currency: "EUR" },
  ]);
  check(
    "6b. quitado el euro, el MISMO pedido se rechaza — no se cobra en otra moneda",
    !rDespues.ok && rDespues.reason === "moneda_invalida",
    rDespues.reason,
  );

  // ══════════════════════════════════════════════════════════════════════
  // 7. MEDIA ORDEN NO EXISTE, con una línea buena y otra mala
  // ══════════════════════════════════════════════════════════════════════
  const { count: antes7 } = await admin
    .from("catalog_orders")
    .select("id", { count: "exact", head: true })
    .eq("catalog_link_id", enlaceCo.id);
  const r7 = await pedir(enlaceCo.token, [
    { product_id: prodCo.id, quantity: 1, currency: "COP" },
    // La mala: una moneda que este producto no vende.
    { product_id: prodCo.id, quantity: 1, currency: "EUR" },
  ]);
  const { count: despues7 } = await admin
    .from("catalog_orders")
    .select("id", { count: "exact", head: true })
    .eq("catalog_link_id", enlaceCo.id);
  check(
    "7a. una línea mala deshace la orden ENTERA, sin dejar la buena suelta",
    !r7.ok && antes7 === despues7,
    `${r7.reason} · órdenes antes ${antes7}, después ${despues7}`,
  );

  // ══════════════════════════════════════════════════════════════════════
  // 8. EL PRODUCTO DE OTRO DUEÑO POR ESTE ENLACE
  // ══════════════════════════════════════════════════════════════════════
  const { data: ajeno } = await admin
    .from("products")
    .select("id, name")
    .eq("name", "Casco")
    .single();
  const r8 = await pedir(enlaceCo.token, [
    { product_id: ajeno.id, quantity: 1, currency: "USD" },
  ]);
  check(
    "8a. el producto de OTRO negocio no entra por este enlace",
    !r8.ok && r8.reason === "producto_invalido",
    r8.reason,
  );
  const { data: detAjeno } = await anon.rpc("get_shared_product", {
    p_token: enlaceCo.token,
    p_product_id: ajeno.id,
  });
  check(
    "8b. ni se puede mirar cambiando el id en la barra de direcciones",
    detAjeno == null,
    JSON.stringify(detAjeno)?.slice(0, 40) ?? "null",
  );
} finally {
  for (const [tabla, filtro, valor] of restaurar) {
    await admin.from(tabla).update(filtro).eq("id", valor);
  }
  // LAS ÓRDENES SE BORRAN POR EL NOMBRE DEL COMPRADOR, no por el enlace.
  //
  // La primera versión las borraba solo de los enlaces que esta suite crea, y
  // dejó una suelta: el caso 6 usa el enlace de un negocio VENEZOLANO que ya
  // existía, porque la conversión entre monedas no existe para uno
  // colombiano. Borrar por enlace deja fuera justo las órdenes que esta suite
  // mete en catálogos ajenos.
  await admin.from("catalog_orders").delete().like("customer_name", `${MARCA}%`);
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
  const { count: quedanOrdenes } = await admin
    .from("catalog_orders")
    .select("id", { count: "exact", head: true })
    .like("customer_name", `${MARCA}%`);
  check(
    "9. limpieza: no queda nada de la prueba en dev",
    quedan === 0 && quedanOrdenes === 0,
    `${quedan} productos · ${quedanOrdenes} órdenes`,
  );

  const fallos = filas.filter((f) => !f.pasa).length;
  console.log(`\n${filas.length - fallos}/${filas.length} pasan.`);
  if (fallos) process.exitCode = 1;
}
