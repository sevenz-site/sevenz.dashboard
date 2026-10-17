// SOLO LA RAMA DEV (vzqppwrwnmlbrxizskdh) — lee .env.local.
//
// LA FRANJA DE PRODUCTOS DE /s/[token]: migración 123, encargo del dueño del
// 2026-10-17 (frame `1378:7916`).
//
// SÍ ESCRIBE en dev, a propósito: crea sus propios negocios de prueba, sus
// clientes, sus enlaces y sus productos, y el `finally` lo borra todo aunque
// el script se caiga a mitad.
//
// ===========================================================================
// QUÉ VIGILA, Y POR QUÉ CADA COSA
//
// `get_shared_catalog_preview` existe porque las dos páginas públicas se
// abren con tokens DISTINTOS: /s/ lleva uno de `share_links`, que es de un
// cliente, y /c/ lleva uno de `catalog_share_links`, que es del negocio. La
// función convierte el primero en el segundo. Eso la mete en dos categorías
// de riesgo a la vez:
//
//   1. ES UN PUENTE ENTRE DOS PANTALLAS QUE NADIE COMPARA. El cliente ve tres
//      tarjetas, toca una y aterriza en el catálogo. Si la franja ordenara
//      distinto, o pusiera otro precio, el producto que tocó no estaría donde
//      espera o costaría otra cosa al llegar. Un precio que cambia entre dos
//      pantallas de la misma bodega no se lee como un fallo: se lee como un
//      truco. La comprobación 4 es la única que mira las dos a la vez.
//
//   2. ES UNA FUNCIÓN QUE CONVIERTE UN TOKEN EN OTRO. Concedida a `anon`
//      sería una API pública para pedir el catálogo de cualquier negocio a
//      partir del enlace de cualquier cliente. La 9 es el candado, y se
//      prueba llamándola con la clave anónima de verdad, que es exactamente
//      la que viaja en el navegador.
//
// Y LA MITAD QUE NO SE PUEDE PROBAR AQUÍ, dicho por delante: que el evento
// `Catalog Opened From Share Link` llegue a Mixpanel. Esta suite no toca
// `/api/share-catalog`, que es una ruta HTTP con su propia resolución de
// dueño. Se verificó a mano en el navegador el 2026-10-17 (204, sin error en
// el log) y ahí se queda.

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
// ANON de verdad, construido aparte: es la clave que viaja en el navegador, y
// la comprobación 9 no significa nada con ninguna otra.
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

const filas = [];
function check(nombre, pasa, detalle) {
  filas.push({ nombre, pasa });
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${detalle ? `  — ${detalle}` : ""}`);
}

const MARCA = "QA 123";
const productos = [];
const clientes = [];
const enlacesCatalogo = [];

async function preview(token) {
  const { data, error } = await admin.rpc("get_shared_catalog_preview", { p_token: token });
  if (error) throw new Error(`rpc: ${error.message}`);
  return data;
}

// Un cliente nuevo con su enlace, bajo el negocio que se le diga. Devuelve el
// token, que es lo que la página lleva en la barra de direcciones.
async function clienteConEnlace(ownerId, nombre) {
  const { data: c, error: eC } = await admin
    .from("clients")
    .insert({ owner_id: ownerId, name: nombre })
    .select("id")
    .single();
  if (eC) throw new Error(`cliente: ${eC.message}`);
  clientes.push(c.id);
  const { data: sl, error: eSl } = await admin
    .from("share_links")
    .insert({ client_id: c.id })
    .select("token")
    .single();
  if (eSl) throw new Error(`enlace: ${eSl.message}`);
  return { clientId: c.id, token: sl.token };
}

try {
  // ── LOS DOS NEGOCIOS, FIJADOS POR ID ────────────────────────────────────
  //
  // `.order("id")` y no el primero que salga. Es la lección del 2026-10-17
  // con `qa:orden`, que daba 32/35 un día y 35/35 al siguiente sin que
  // cambiara nada porque `.limit()` sin orden devuelve el negocio que
  // Postgres quiera. Una suite cuyo resultado se mueve sola es peor que una
  // que falla.
  const { data: duenos } = await admin.from("owners").select("id").order("id").limit(2);
  if (!duenos || duenos.length < 2) {
    console.error("Hacen falta al menos dos negocios en dev.");
    process.exit(1);
  }
  const [duenoA, duenoB] = duenos.map((d) => d.id);

  // El negocio A necesita enlace de catálogo. Si ya lo tiene se reutiliza; si
  // no, se crea y se borra al final — nunca se le deja uno puesto a un
  // negocio de dev que no lo tenía.
  let { data: catA } = await admin
    .from("catalog_share_links")
    .select("id, token")
    .eq("owner_id", duenoA)
    .maybeSingle();
  if (!catA) {
    const r = await admin
      .from("catalog_share_links")
      .insert({ owner_id: duenoA })
      .select("id, token")
      .single();
    catA = r.data;
    enlacesCatalogo.push(catA.id);
  }

  const cliA = await clienteConEnlace(duenoA, `${MARCA} cliente`);

  // ── LOS PRODUCTOS DE LA PRUEBA ──────────────────────────────────────────
  //
  // Los nombres empiezan todos por `MARCA` para que el orden alfabético los
  // agrupe y la comprobación 4 compare peras con peras, y para que la
  // limpieza los encuentre por prefijo.
  async function crearProducto(ownerId, sufijo, campos) {
    const { data, error } = await admin
      .from("products")
      .insert({ owner_id: ownerId, name: `${MARCA} ${sufijo}`, ...campos })
      .select("id")
      .single();
    if (error) throw new Error(`producto ${sufijo}: ${error.message}`);
    productos.push(data.id);
    return data.id;
  }

  const idDetal = await crearProducto(duenoA, "a detal", {
    base_currency: "USD",
    base_currency_retail: "USD",
    price_retail: 10,
    published_retail: true,
  });
  const idMayor = await crearProducto(duenoA, "b solo al mayor", {
    base_currency: "USD",
    base_currency_wholesale: "EUR",
    price_wholesale: 8,
    wholesale_min_quantity: 6,
    published_retail: false,
    published_wholesale: true,
  });
  const idSinPublicar = await crearProducto(duenoA, "c sin publicar", {
    base_currency: "USD",
    base_currency_retail: "USD",
    price_retail: 5,
    published_retail: false,
    published_wholesale: false,
  });
  const idPapelera = await crearProducto(duenoA, "d en la papelera", {
    base_currency: "USD",
    base_currency_retail: "USD",
    price_retail: 7,
    published_retail: true,
    trashed_at: new Date().toISOString(),
  });
  const idOtroDueno = await crearProducto(duenoB, "e de otro dueno", {
    base_currency: "USD",
    base_currency_retail: "USD",
    price_retail: 99,
    published_retail: true,
  });

  // DIEZ DE RELLENO, Y NO SON RELLENO. Sin ellos el negocio A llegaba a la
  // comprobación 8 con DOS productos publicados, y «nunca devuelve más de 8»
  // pasaba sin poder fallar — una fila verde que no mide nada. Lo mismo la
  // 4a: comparar el orden de dos elementos no es comparar un orden.
  //
  // Van con precios distintos a propósito. Si la franja y el catálogo
  // emparejaran mal las filas, con todos a 10 el fallo no se vería.
  for (let i = 1; i <= 10; i++) {
    await crearProducto(duenoA, `f${String(i).padStart(2, "0")} de relleno`, {
      base_currency: "USD",
      base_currency_retail: "USD",
      price_retail: 10 + i,
      published_retail: true,
    });
  }

  // ── 1. UN TOKEN QUE NO EXISTE ───────────────────────────────────────────
  const r1 = await preview("no-existe-este-token-0000000000000000");
  check(
    "1. un token inventado devuelve null, no un error",
    r1 === null,
    JSON.stringify(r1),
  );

  // ── 2. EL CASO NORMAL ───────────────────────────────────────────────────
  const r2 = await preview(cliA.token);
  check(
    "2. el enlace de un cliente devuelve el token del catálogo de SU negocio",
    r2?.catalog_token === catA.token,
    r2?.catalog_token === catA.token ? "coincide" : `devolvió ${r2?.catalog_token}`,
  );

  const ids = (r2?.products ?? []).map((p) => p.id);

  // ── 3. QUÉ ENTRA Y QUÉ NO ───────────────────────────────────────────────
  check("3a. el producto publicado al detal entra", ids.includes(idDetal));
  check("3b. el publicado SOLO al mayor también entra", ids.includes(idMayor));
  check("3c. el que no está publicado NO entra", !ids.includes(idSinPublicar));
  check("3d. el que está en la papelera NO entra", !ids.includes(idPapelera));
  check(
    "3e. y el producto de OTRO negocio NO entra por este enlace",
    !ids.includes(idOtroDueno),
    "es el candado: el dueño sale del token, nunca del navegador",
  );

  // ── 4. LA FRANJA Y EL CATÁLOGO DICEN LO MISMO ───────────────────────────
  //
  // LA COMPROBACIÓN QUE JUSTIFICA ESTA SUITE. Las dos funciones construyen su
  // lista por separado —misma consulta copiada, dos sitios— y nada las ata.
  // El día que una cambie y la otra no, el cliente tocará un producto y verá
  // otro precio al llegar, SIN NINGÚN ERROR en ninguna parte.
  const { data: cat, error: eCat } = await admin.rpc("get_shared_catalog", {
    p_token: catA.token,
  });
  if (eCat) throw new Error(`get_shared_catalog: ${eCat.message}`);

  const delCatalogo = (cat?.products ?? []).slice(0, (r2?.products ?? []).length);
  const mismos =
    delCatalogo.length === (r2?.products ?? []).length &&
    delCatalogo.every((p, i) => p.id === r2.products[i].id);
  check(
    "4a. la franja trae los MISMOS productos, en el MISMO orden que el catálogo",
    mismos,
    mismos
      ? `${delCatalogo.length} productos, uno a uno`
      : `franja [${ids.join(", ")}] vs catálogo [${delCatalogo.map((p) => p.id).join(", ")}]`,
  );

  const preciosIguales = mismos
    ? delCatalogo.every(
        (p, i) =>
          Number(p.price) === Number(r2.products[i].price) &&
          p.base_currency === r2.products[i].base_currency &&
          p.tier === r2.products[i].tier,
      )
    : false;
  check(
    "4b. y con el MISMO precio, la MISMA moneda y el MISMO escalón",
    preciosIguales,
    preciosIguales
      ? "idénticos al céntimo"
      : "DISCREPAN — el cliente vería un precio y encontraría otro al tocar",
  );

  // ── 5. EL ESCALÓN VIAJA, que es lo que impide un número engañoso ────────
  const mayorEnLaFranja = (r2?.products ?? []).find((p) => p.id === idMayor);
  check(
    "5. un producto solo de mayoreo dice `wholesale` y lleva SU precio y SU moneda",
    mayorEnLaFranja?.tier === "wholesale" &&
      Number(mayorEnLaFranja?.price) === 8 &&
      mayorEnLaFranja?.base_currency === "EUR",
    JSON.stringify(mayorEnLaFranja),
  );

  // ── 6. UN NEGOCIO SIN CATÁLOGO ──────────────────────────────────────────
  //
  // Es el estado NORMAL: el catálogo es opcional y la mayoría no lo ha
  // creado. Tiene que devolver token nulo y lista vacía, nunca crear uno —
  // quien llama es una página sin sesión que cualquiera puede abrir.
  const { data: catB } = await admin
    .from("catalog_share_links")
    .select("id")
    .eq("owner_id", duenoB)
    .maybeSingle();
  const cliB = await clienteConEnlace(duenoB, `${MARCA} cliente sin catalogo`);
  const r6 = await preview(cliB.token);
  if (catB) {
    check(
      "6. negocio SIN catálogo: token nulo (saltada, el negocio B sí tiene)",
      true,
      "no comprobada: el segundo negocio de dev tiene enlace de catálogo",
    );
  } else {
    check(
      "6. un negocio sin enlace de catálogo devuelve token nulo y lista vacía",
      r6?.catalog_token === null && Array.isArray(r6?.products) && r6.products.length === 0,
      JSON.stringify(r6),
    );
    const { count: creados } = await admin
      .from("catalog_share_links")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", duenoB);
    check(
      "6b. y NO le creó uno de paso — la página es pública y no puede escribir",
      creados === 0,
      `${creados} enlaces`,
    );
  }

  // ── 7. UN CLIENTE EN LA PAPELERA ────────────────────────────────────────
  //
  // Mismo criterio que `share_link_owner`: un cliente borrado no puede seguir
  // resolviendo a un negocio vivo. Si esto fallara, un enlace que el tendero
  // cree haber retirado seguiría enseñando su catálogo.
  await admin
    .from("clients")
    .update({ trashed_at: new Date().toISOString() })
    .eq("id", cliA.clientId);
  const r7 = await preview(cliA.token);
  check(
    "7. el enlace de un cliente en la papelera deja de resolver",
    r7 === null,
    JSON.stringify(r7),
  );
  await admin.from("clients").update({ trashed_at: null }).eq("id", cliA.clientId);

  // ── 8. EL TOPE ──────────────────────────────────────────────────────────
  //
  // CON DOCE PUBLICADOS, así que la fila puede fallar de verdad: antes de
  // crear los diez de relleno el negocio llegaba aquí con dos y «no más de
  // 8» era cierto hiciera lo que hiciera la función.
  const r8 = await preview(cliA.token);
  const { data: catTope } = await admin.rpc("get_shared_catalog", { p_token: catA.token });
  const publicados = (catTope?.products ?? []).length;
  check(
    "8. con más de 8 publicados, devuelve exactamente 8 — el resto es para «Ver todo»",
    publicados > 8 && (r8?.products ?? []).length === 8,
    `${publicados} publicados en el catálogo · ${(r8?.products ?? []).length} en la franja`,
  );

  // ── 9. EL CANDADO ───────────────────────────────────────────────────────
  //
  // Con la clave ANÓNIMA, que es la que viaja en el navegador. Concedida a
  // `anon`, esta función sería una API pública para sacar el catálogo de
  // cualquier negocio a partir del enlace de cualquier cliente.
  const { error: eAnon } = await anon.rpc("get_shared_catalog_preview", {
    p_token: cliA.token,
  });
  check(
    "9. anon NO puede llamarla — solo service_role",
    Boolean(eAnon),
    eAnon ? eAnon.message : "LA LLAMÓ: el grant está abierto",
  );
} catch (e) {
  check("la suite llegó al final", false, e instanceof Error ? e.message : String(e));
} finally {
  if (productos.length) await admin.from("products").delete().in("id", productos);
  // Los enlaces de cliente se van en cascada con el cliente.
  if (clientes.length) await admin.from("clients").delete().in("id", clientes);
  if (enlacesCatalogo.length) {
    await admin.from("catalog_share_links").delete().in("id", enlacesCatalogo);
  }

  const { count: quedanProd } = await admin
    .from("products")
    .select("id", { count: "exact", head: true })
    .like("name", `${MARCA}%`);
  const { count: quedanCli } = await admin
    .from("clients")
    .select("id", { count: "exact", head: true })
    .like("name", `${MARCA}%`);
  check(
    "10. limpieza: no queda nada de la prueba en dev",
    quedanProd === 0 && quedanCli === 0,
    `${quedanProd} productos · ${quedanCli} clientes`,
  );

  const fallos = filas.filter((f) => !f.pasa).length;
  console.log(`\n${filas.length - fallos}/${filas.length} pasan.`);
  if (fallos) process.exitCode = 1;
}
