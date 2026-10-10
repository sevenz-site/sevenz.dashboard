// SOLO LA RAMA DEV (vzqppwrwnmlbrxizskdh) — lee .env.local.
//
// Comprueba la migración 084: el catálogo público, sus dos enlaces y los
// campos que le añade a la ficha. SÍ ESCRIBE en dev, a propósito: de una
// restricción y de un filtro lo único que importa es que de verdad rechacen, y
// eso no se lee, se provoca. Crea y borra lo suyo, y el `finally` limpia
// aunque el script se caiga a mitad.
//
// LO QUE VIGILA, y por qué cada cosa:
//
//   1. Que `published` nazca en FALSE. Si el día que esto cambie nadie se da
//      cuenta, el primer producto que escriba cualquiera de los 24 dueños
//      queda publicado en internet sin que lo haya pedido. Es la comprobación
//      más barata de la lista y la que más daño evita.
//
//   2. Que `stock_opening` rechace un negativo, y que los dos márgenes nuevos
//      entren. Es lo que la 084 añadió a la ficha.
//
//   3. Que haya DOS enlaces y no uno: uno de detal y uno de mayor, y ni uno
//      más de cada. Es la decisión 11 del dueño y `CT-55`, y es lo que pidió
//      el Tendero 2, que tiene clientes de los dos tipos.
//
//   4. Que **cada enlace enseñe su propio precio**. Es la razón de ser de los
//      dos enlaces: si los dos devolvieran lo mismo, la función estaría
//      ignorando el escalón y nadie se enteraría mirando la pantalla — los dos
//      catálogos se verían perfectamente bien, con el precio equivocado en uno.
//
//   5. Que `get_shared_catalog` NO FILTRE lo que no debe: costo, márgenes,
//      cantidad, ni el precio del escalón que no es el del enlace. El costo de
//      la mercancía es exactamente lo que querría saber su competencia, y un
//      cliente de detal con el precio de mayor delante tiene con qué regatear.
//
//      Y se comprueba sobre las CLAVES del JSON, no sobre los valores: un
//      `cost: null` también sería un escape, porque bastaría que un producto
//      tuviera costo para que saliera.
//
//   6. Que un precio FIJADO A MANO llegue a la página pública. Sin esto el
//      candado sería cierto en la ficha y falso justo en la pantalla donde el
//      tendero lo fijó para que se viera.
//
//   7. Que un producto sin publicar y uno en la papelera no salgan. Son los
//      dos interruptores con los que el tendero decide qué se ve.
//
//   8. Que un token inexistente devuelva null y no un error. Quien pruebe
//      tokens al azar no debe poder distinguir «no existe» de «falló algo».
//
//   9. Que `anon` pueda EJECUTAR la función —es el punto— y NO pueda leer
//      `catalog_share_links`. Con esa tabla a la vista, cualquiera se
//      descargaría los tokens de los 24 negocios de una vez.
//
//  10. Que el bucket `product-photos` exista y sea público. Cero buckets es el
//      fallo del 2026-08-28 otra vez, y se manifiesta como «subir la foto no
//      funciona» sin que nada en el esquema esté mal.

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
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

const filas = [];
function check(nombre, pasa, detalle) {
  filas.push({ nombre, pasa });
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${detalle ? `  — ${detalle}` : ""}`);
}

const MARCA = "QA 084";
const creados = [];
const enlacesCreados = [];

try {
  const { data: owner } = await admin.from("owners").select("id").limit(1).single();
  const ownerId = owner.id;

  // ── 1. Nada se publica por accidente ───────────────────────────────────
  const { data: pub, error: ePub } = await admin
    .from("products")
    .insert({
      owner_id: ownerId,
      name: `${MARCA} sin publicar`,
      base_currency: "USD",
      price_retail: 10,
    })
    .select("id, published")
    .single();
  // Se para aquí y lo dice, en vez de reventar quince líneas más abajo con un
  // `null`: si la 084 no ha corrido en este entorno, TODO lo que sigue falla
  // por la misma causa y el informe se llena de ruido que no apunta a ella.
  if (ePub || !pub) {
    check("1. `published` nace en false", false, ePub?.message ?? "el insert no devolvió fila");
    throw new Error(
      "La migración 084 parece no haber corrido en este entorno. Córrela antes de seguir.",
    );
  }
  creados.push(pub.id);
  check("1. `published` nace en false", pub.published === false, `nació ${pub.published}`);

  // ── 2. Cantidad negativa y márgenes ────────────────────────────────────
  const { error: eNeg } = await admin.from("products").insert({
    owner_id: ownerId,
    name: `${MARCA} negativo`,
    base_currency: "USD",
    price_retail: 10,
    stock_opening: -1,
  });
  check(
    "2a. una cantidad negativa no entra",
    eNeg != null && eNeg.code === "23514",
    eNeg ? eNeg.code : "entró",
  );

  const { data: conMargenes, error: eMargenes } = await admin
    .from("products")
    .insert({
      owner_id: ownerId,
      name: `${MARCA} con margenes`,
      base_currency: "USD",
      price_retail: 13,
      price_wholesale: 11,
      cost: 10,
      margin_retail_pct: 30,
      margin_wholesale_pct: 10,
      stock_opening: 12,
      stock_opening_at: new Date().toISOString(),
    })
    .select("id, margin_retail_pct, margin_wholesale_pct, stock_opening")
    .single();
  check(
    "2b. los dos márgenes y la cantidad se guardan",
    eMargenes == null &&
      Number(conMargenes.margin_retail_pct) === 30 &&
      Number(conMargenes.margin_wholesale_pct) === 10 &&
      Number(conMargenes.stock_opening) === 12,
    eMargenes?.message,
  );
  if (conMargenes) creados.push(conMargenes.id);

  // ── 3. DOS enlaces, uno por escalón ────────────────────────────────────
  // Pueden existir de una prueba anterior o de la propia pantalla: se
  // reutilizan en ese caso y solo se borra al final lo que haya creado ESTE
  // script.
  async function enlace(tier) {
    const { data: existente } = await admin
      .from("catalog_share_links")
      .select("token")
      .eq("owner_id", ownerId)
      .eq("tier", tier)
      .maybeSingle();
    if (existente) return { token: existente.token, nuevo: false, error: null };
    const { data, error } = await admin
      .from("catalog_share_links")
      .insert({ owner_id: ownerId, tier })
      .select("id, token")
      .single();
    if (data) enlacesCreados.push(data.id);
    return { token: data?.token ?? null, nuevo: true, error };
  }

  const detal = await enlace("retail");
  const mayor = await enlace("wholesale");
  check(
    "3a. existen los dos enlaces, detal y mayor",
    detal.error == null && mayor.error == null && detal.token && mayor.token,
    detal.error?.message ?? mayor.error?.message,
  );
  check(
    "3b. los dos tokens son distintos",
    detal.token !== mayor.token,
  );

  const { error: eDoble } = await admin
    .from("catalog_share_links")
    .insert({ owner_id: ownerId, tier: "retail" });
  check(
    "3c. un negocio no puede tener dos enlaces del mismo escalón",
    eDoble != null && eDoble.code === "23505",
    eDoble ? eDoble.code : "entró un segundo de detal",
  );

  // ── 4 y 5. Lo que cada enlace devuelve, y lo que NO ────────────────────
  // Un producto publicado con los dos precios, costo, margen y cantidad:
  // justo lo que no debe salir entero. Si la función filtrara mal, este es el
  // producto que lo delataría.
  const { data: visible } = await admin
    .from("products")
    .insert({
      owner_id: ownerId,
      name: `${MARCA} publicado`,
      base_currency: "USD",
      price_retail: 13,
      price_wholesale: 11,
      cost: 10,
      margin_retail_pct: 30,
      stock_opening: 5,
      published: true,
      description: "visible en el catálogo",
    })
    .select("id")
    .single();
  creados.push(visible.id);

  // Y uno que SOLO tiene precio al mayor: en el enlace de detal tiene que
  // salir con ese precio y dicho, no desaparecer.
  const { data: soloMayor } = await admin
    .from("products")
    .insert({
      owner_id: ownerId,
      name: `${MARCA} zz solo mayor`,
      base_currency: "USD",
      price_wholesale: 7,
      published: true,
    })
    .select("id")
    .single();
  creados.push(soloMayor.id);

  const { data: catDetal, error: eDetal } = await anon.rpc("get_shared_catalog", {
    p_token: detal.token,
  });
  const { data: catMayor, error: eMayor } = await anon.rpc("get_shared_catalog", {
    p_token: mayor.token,
  });
  check(
    "4a. anon puede abrir los dos catálogos",
    eDetal == null && eMayor == null && catDetal != null && catMayor != null,
    eDetal?.message ?? eMayor?.message,
  );

  const enDetal = (catDetal?.products ?? []).find((p) => p.id === visible.id);
  const enMayor = (catMayor?.products ?? []).find((p) => p.id === visible.id);

  check(
    "4b. el enlace de DETAL enseña el precio de detal",
    enDetal != null && Number(enDetal.price) === 13 && enDetal.price_tier === "retail",
    enDetal ? `price=${enDetal.price} tier=${enDetal.price_tier}` : "sin producto",
  );
  check(
    "4c. el enlace de MAYOR enseña el precio de mayor",
    enMayor != null && Number(enMayor.price) === 11 && enMayor.price_tier === "wholesale",
    enMayor ? `price=${enMayor.price} tier=${enMayor.price_tier}` : "sin producto",
  );
  check(
    "4d. el escalón del enlace viaja en la respuesta",
    catDetal?.tier === "retail" && catMayor?.tier === "wholesale",
    `detal=${catDetal?.tier} mayor=${catMayor?.tier}`,
  );

  const soloEnDetal = (catDetal?.products ?? []).find((p) => p.id === soloMayor.id);
  check(
    "4e. un producto con solo precio de mayor sale en el enlace de detal, y lo dice",
    soloEnDetal != null &&
      Number(soloEnDetal.price) === 7 &&
      soloEnDetal.price_tier === "wholesale",
    soloEnDetal ? `tier=${soloEnDetal.price_tier}` : "desapareció",
  );

  const PROHIBIDAS = [
    "cost",
    "margin_pct",
    "margin_retail_pct",
    "margin_wholesale_pct",
    "price_retail",
    "price_wholesale",
    "stock_opening",
    "stock_opening_at",
    "owner_id",
  ];
  const filtradas = enDetal ? PROHIBIDAS.filter((k) => k in enDetal) : [];
  check(
    "5. NO salen costo, márgenes, cantidad ni el otro precio",
    filtradas.length === 0,
    filtradas.length ? `se escapan: ${filtradas.join(", ")}` : "ninguna",
  );

  // ── 6. Un precio fijado a mano llega a la página pública ───────────────
  await admin.from("product_price_overrides").upsert(
    { product_id: visible.id, tier: "retail", currency: "VES", amount: 2500 },
    { onConflict: "product_id,tier,currency" },
  );
  const { data: catPin } = await anon.rpc("get_shared_catalog", { p_token: detal.token });
  const conPin = (catPin?.products ?? []).find((p) => p.id === visible.id);
  check(
    "6a. el precio fijado en Bs. llega al catálogo público",
    conPin != null && Number(conPin.pinned?.VES) === 2500,
    conPin ? JSON.stringify(conPin.pinned) : "sin producto",
  );
  // Y el del OTRO escalón no se cuela: el candado es por escalón.
  const { data: catPinMayor } = await anon.rpc("get_shared_catalog", { p_token: mayor.token });
  const pinMayor = (catPinMayor?.products ?? []).find((p) => p.id === visible.id);
  check(
    "6b. el candado del otro escalón NO aparece",
    pinMayor != null && pinMayor.pinned?.VES === undefined,
    pinMayor ? JSON.stringify(pinMayor.pinned) : "sin producto",
  );

  // ── 7. Sin publicar y en la papelera no salen ──────────────────────────
  check(
    "7a. un producto sin publicar no sale",
    !(catDetal?.products ?? []).some((p) => p.id === pub.id),
  );

  await admin
    .from("products")
    .update({ trashed_at: new Date().toISOString() })
    .eq("id", visible.id);
  const { data: catTrash } = await anon.rpc("get_shared_catalog", { p_token: detal.token });
  check(
    "7b. un producto en la papelera sale del catálogo",
    !(catTrash?.products ?? []).some((p) => p.id === visible.id),
  );
  await admin.from("products").update({ trashed_at: null }).eq("id", visible.id);

  // ── 8. Un token inexistente ────────────────────────────────────────────
  const { data: nada, error: eNada } = await anon.rpc("get_shared_catalog", {
    p_token: "no-existe-este-token-de-prueba",
  });
  check(
    "8. un token inexistente devuelve null, no un error",
    eNada == null && nada === null,
    eNada ? eNada.message : `devolvió ${JSON.stringify(nada)}`,
  );

  // ── 9. anon no puede leer la tabla de tokens ───────────────────────────
  const { data: tokens, error: eTokens } = await anon
    .from("catalog_share_links")
    .select("token")
    .limit(1);
  check(
    "9. anon NO puede listar los tokens de los catálogos",
    eTokens != null || (tokens?.length ?? 0) === 0,
    eTokens ? eTokens.code : `leyó ${tokens?.length} filas`,
  );

  // ── 10. El bucket de las fotos ─────────────────────────────────────────
  const { data: buckets, error: eBuckets } = await admin.storage.listBuckets();
  const bucket = (buckets ?? []).find((b) => b.id === "product-photos");
  check(
    "10. el bucket `product-photos` existe y es público",
    eBuckets == null && bucket != null && bucket.public === true,
    bucket ? `public=${bucket.public}` : "no existe",
  );
} finally {
  // Los candados se van por cascada con el producto (comprobado en qa:productos).
  for (const id of creados) await admin.from("products").delete().eq("id", id);
  for (const id of enlacesCreados) {
    await admin.from("catalog_share_links").delete().eq("id", id);
  }
  const { count: quedan } = await admin
    .from("products")
    .select("id", { count: "exact", head: true })
    .like("name", `${MARCA}%`);
  check("11. limpieza: no queda nada de la prueba en dev", quedan === 0, `quedan ${quedan}`);

  const fallos = filas.filter((f) => !f.pasa).length;
  console.log(`\n${filas.length - fallos}/${filas.length} pasan.`);
  if (fallos) process.exitCode = 1;
}
