// SOLO LA RAMA DEV (vzqppwrwnmlbrxizskdh) — lee .env.local.
//
// Comprueba el catálogo público: migración 084 y sus correcciones, hasta la
// 106 — que dejó UN SOLO enlace por negocio donde había dos. Y los
// campos que le añade a la ficha. SÍ ESCRIBE en dev, a propósito: de una
// restricción y de un filtro lo único que importa es que de verdad rechacen, y
// eso no se lee, se provoca. Crea y borra lo suyo, y el `finally` limpia
// aunque el script se caiga a mitad.
//
// LO QUE VIGILA, y por qué cada cosa:
//
//   1. Que los dos `published_*` nazcan en FALSE. Si el día que esto cambie
//      nadie se da cuenta, el primer producto que escriba cualquiera de los 24
//      dueños queda publicado en internet sin que lo haya pedido. Es la
//      comprobación más barata de la lista y la que más daño evita.
//
//   2. Que `stock_opening` rechace un negativo, y que los dos márgenes nuevos
//      entren. Es lo que la 084 añadió a la ficha.
//
//   3. Que haya UN SOLO enlace por negocio, y que no se pueda crear un
//      segundo. Hasta el 2026-10-15 había dos, uno por escalón — decisión 11
//      del dueño y `CT-55` — y el propio dueño lo cambió al ver que el
//      detalle ya decide por cantidad qué precio aplica. Si la restricción
//      única se perdiera, un negocio tendría dos tokens vivos y el diálogo
//      enseñaría uno u otro según el orden de la consulta, sin error.
//
//   4. Que la tarjeta enseñe **el precio de UNA UNIDAD** — el de detal si
//      está publicado, el de mayor si es lo único que hay. No el más bajo,
//      que era el criterio de la 086 y encajaba con dos enlaces. Con uno
//      solo, enseñar 11 en la tarjeta y cobrar 13 al entrar es un cebo, y
//      nadie se enteraría mirando: las dos pantallas se verían bien.
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
    .select("id, published_retail, published_wholesale")
    .single();
  // Se para aquí y lo dice, en vez de reventar quince líneas más abajo con un
  // `null`: si la 084 no ha corrido en este entorno, TODO lo que sigue falla
  // por la misma causa y el informe se llena de ruido que no apunta a ella.
  if (ePub || !pub) {
    check("1. los dos `published_*` nacen en false", false, ePub?.message ?? "el insert no devolvió fila");
    throw new Error(
      "La migración 084 parece no haber corrido en este entorno. Córrela antes de seguir.",
    );
  }
  creados.push(pub.id);
  check(
    "1. los dos `published_*` nacen en false",
    pub.published_retail === false && pub.published_wholesale === false,
    `detal=${pub.published_retail} mayor=${pub.published_wholesale}`,
  );

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
      cost_currency: "USD",
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

  // ── 2c. El costo y su moneda van juntos ────────────────────────────────
  //
  // La 087 lo exige con un check, y el primer intento de esa migración se
  // estrelló justamente contra él: la restricción estaba ANTES del relleno.
  // Esta comprobación existe para que nadie la quite pensando que sobra.
  const { error: eSinMoneda } = await admin.from("products").insert({
    owner_id: ownerId,
    name: `${MARCA} costo sin moneda`,
    base_currency: "USD",
    price_retail: 10,
    cost: 7,
  });
  check(
    "2c. un costo sin moneda no entra",
    eSinMoneda != null && eSinMoneda.code === "23514",
    eSinMoneda ? eSinMoneda.code : "entró",
  );

  // «OTHER» SIN NOMBRE SÍ ENTRA desde la 089: la ficha dejó de preguntar cuál
  // es, así que exigirlo haría imposible guardar. Lo que sigue sin tener
  // sentido es una etiqueta colgando de una moneda que SÍ conocemos.
  //
  // Hasta el 2026-10-10 esta prueba esperaba lo contrario, y se deja dicho
  // porque la regla cambió de signo: lo que antes era el error ahora es el
  // caso normal.
  const { data: otraSinNombre, error: eOtraSinNombre } = await admin
    .from("products")
    .insert({
      owner_id: ownerId,
      name: `${MARCA} otra sin nombre`,
      base_currency: "USD",
      price_retail: 10,
      cost: 7,
      cost_currency: "OTHER",
    })
    .select("id")
    .single();
  check(
    "2d. `OTHER` sin el nombre de la moneda SÍ entra",
    eOtraSinNombre == null,
    eOtraSinNombre?.code,
  );
  if (otraSinNombre) creados.push(otraSinNombre.id);

  const { error: eEtiquetaSuelta } = await admin.from("products").insert({
    owner_id: ownerId,
    name: `${MARCA} etiqueta suelta`,
    base_currency: "USD",
    price_retail: 10,
    cost: 7,
    cost_currency: "USD",
    cost_currency_other: "Reales",
  });
  check(
    "2e. una etiqueta de moneda colgando de una moneda conocida no entra",
    eEtiquetaSuelta != null && eEtiquetaSuelta.code === "23514",
    eEtiquetaSuelta ? eEtiquetaSuelta.code : "entró",
  );

  // ── 3. UN SOLO enlace por negocio (migración 106) ──────────────────────
  //
  // Hasta el 2026-10-15 habia dos, uno por escalon, y esta seccion comprobaba
  // que existieran los dos y que cada uno ensenara su lista. El dueno lo
  // cambio: el detalle del producto ya decide por cantidad que escalon
  // aplica, asi que dos enlaces eran dos formas de ver lo mismo.
  //
  // LO QUE AHORA HAY QUE VIGILAR ES LO CONTRARIO: que no se puedan crear dos.
  // Si la restriccion unica se perdiera, un negocio acabaria con dos tokens
  // vivos y el dialogo ensenaria uno u otro segun el orden que devolviera la
  // consulta -- sin error y sin que nadie lo note.
  async function enlace() {
    const { data: existente } = await admin
      .from("catalog_share_links")
      .select("token")
      .eq("owner_id", ownerId)
      .maybeSingle();
    if (existente) return { token: existente.token, nuevo: false, error: null };
    const { data, error } = await admin
      .from("catalog_share_links")
      .insert({ owner_id: ownerId })
      .select("id, token")
      .single();
    if (data) enlacesCreados.push(data.id);
    return { token: data?.token ?? null, nuevo: true, error };
  }

  const unico = await enlace();
  const detal = unico;
  const mayor = unico;
  check("3a. el negocio tiene su enlace", unico.error == null && Boolean(unico.token), unico.error?.message);

  const { error: eDoble } = await admin
    .from("catalog_share_links")
    .insert({ owner_id: ownerId });
  check(
    "3b. un negocio NO puede tener dos enlaces",
    eDoble != null && eDoble.code === "23505",
    eDoble ? eDoble.code : "entró un segundo enlace",
  );

  const { data: columnas } = await admin.from("catalog_share_links").select("*").limit(1);
  check(
    "3c. la columna `tier` ya no existe",
    columnas != null && columnas.length > 0 && !("tier" in columnas[0]),
    columnas?.[0] ? Object.keys(columnas[0]).join(", ") : "sin filas",
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
      cost_currency: "USD",
      margin_retail_pct: 30,
      stock_opening: 5,
      published_retail: true,
      published_wholesale: true,
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
      published_retail: true,
      published_wholesale: true,
    })
    .select("id")
    .single();
  creados.push(soloMayor.id);

  const { data: catDetal, error: eDetal } = await anon.rpc("get_shared_catalog", {
    p_token: detal.token,
  });
  check(
    "4a. anon puede abrir el catálogo",
    eDetal == null && catDetal != null,
    eDetal?.message,
  );

  const enDetal = (catDetal?.products ?? []).find((p) => p.id === visible.id);

  // EL PRECIO DE UNA UNIDAD, NO EL MAS BAJO (migración 106).
  //
  // `visible` tiene 13 al detal y 11 al mayor, publicado en los dos. Hasta el
  // 2026-10-15 la tarjeta enseñaba 11 —el más bajo, criterio de la 086— y eso
  // tenía sentido con dos enlaces, uno por audiencia.
  //
  // Con un solo enlace, tarjeta y detalle son la misma página en dos pasos, y
  // el detalle abre en 1 unidad, que es precio al DETAL. Enseñar 11 en la
  // tarjeta y cobrar 13 al entrar es un cebo, así que ahora enseña 13.
  //
  // ESTA ES LA PRUEBA QUE SE ROMPE SI ALGUIEN VUELVE AL CRITERIO VIEJO, y es
  // justo la que hay que leer antes de cambiarlo: las dos versiones son
  // defendibles por separado y solo una encaja con un enlace único.
  check(
    "4b. la tarjeta enseña el precio de UNA UNIDAD, el de detal",
    enDetal != null && Number(enDetal.price) === 13 && enDetal.tier === "retail",
    enDetal ? `price=${enDetal.price} tier=${enDetal.tier}` : "sin producto",
  );

  const soloEnDetal = (catDetal?.products ?? []).find((p) => p.id === soloMayor.id);
  check(
    "4c. sin precio al detal publicado, la tarjeta enseña el de mayor y lo dice",
    soloEnDetal != null &&
      Number(soloEnDetal.price) === 7 &&
      soloEnDetal.tier === "wholesale",
    soloEnDetal ? `tier=${soloEnDetal.tier}` : "desapareció",
  );

  // UN ESCALÓN NO PUBLICADO NO ES CANDIDATO, aunque su precio sea el más bajo.
  //
  // Es la mitad de la regla que protege al tendero: «el más bajo» no puede
  // significar «el más bajo que tengas apuntado», porque entonces publicar al
  // detal filtraría el precio de mayorista a cualquiera con el enlace. Solo
  // compiten los escalones que él marcó.
  const { data: mayorOculto } = await admin
    .from("products")
    .insert({
      owner_id: ownerId,
      name: `${MARCA} zz mayor sin publicar`,
      base_currency: "USD",
      price_retail: 20,
      price_wholesale: 6,
      published_retail: true,
      published_wholesale: false,
    })
    .select("id")
    .single();
  creados.push(mayorOculto.id);

  const { data: catOculto } = await anon.rpc("get_shared_catalog", { p_token: detal.token });
  const oculto = (catOculto?.products ?? []).find((p) => p.id === mayorOculto.id);
  check(
    "4f. un escalón NO publicado no se cuela aunque sea más barato",
    oculto != null && Number(oculto.price) === 20 && oculto.tier === "retail",
    oculto ? `price=${oculto.price} tier=${oculto.tier}` : "desapareció",
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
  //
  // En USDT y no en bolívares: desde la 085 los bolívares no se pueden fijar
  // (ver 7e). Pero el candado sí tiene que llegar hasta aquí, porque es lo
  // único que hace que signifique algo — el tendero lo cerró precisamente
  // para que su cliente viera ESE número, no la conversión del día.
  // Se fija en el escalón QUE LA TARJETA ENSEÑA, que desde la migración 106 es
  // el de DETAL para este producto — porque la tarjeta enseña el precio de una
  // unidad, no el más bajo.
  //
  // HASTA EL 2026-10-15 ESTO ESPERABA LO CONTRARIO, y el cambio de expectativa
  // es la prueba de que la 106 hizo lo que decía: con el criterio de la 086
  // ganaba el de mayor (11 < 13) y los candados que llegaban eran los suyos.
  // Al correr la 106 esta comprobación falló con `{"EUR":99}` — exactamente el
  // candado del otro escalón, que es el que ahora manda.
  await admin.from("product_price_overrides").upsert(
    { product_id: visible.id, tier: "retail", currency: "USDT", amount: 9 },
    { onConflict: "product_id,tier,currency" },
  );
  // Y uno en el escalón que NO se enseña en la tarjeta. No debe aparecer: el
  // cliente lo verá en el detalle, cuando pida la cantidad que lo activa.
  await admin.from("product_price_overrides").upsert(
    { product_id: visible.id, tier: "wholesale", currency: "EUR", amount: 99 },
    { onConflict: "product_id,tier,currency" },
  );

  const { data: catPin } = await anon.rpc("get_shared_catalog", { p_token: detal.token });
  const conPin = (catPin?.products ?? []).find((p) => p.id === visible.id);
  check(
    "6a. el precio fijado en USDT llega al catálogo público",
    conPin != null && Number(conPin.pinned?.USDT) === 9,
    conPin ? JSON.stringify(conPin.pinned) : "sin producto",
  );
  check(
    "6b. el candado del escalón que la tarjeta NO enseña no aparece",
    conPin != null && conPin.pinned?.EUR === undefined,
    conPin ? JSON.stringify(conPin.pinned) : "sin producto",
  );

  // ── 7. Sin publicar, por escalón, y en la papelera ─────────────────────
  check(
    "7a. un producto sin publicar no sale",
    !(catDetal?.products ?? []).some((p) => p.id === pub.id),
  );

  // EL CASO QUE ESTRENA LA 085, y es la razón de ser de las dos columnas: un
  // producto publicado SOLO al detal no puede aparecer en el enlace de
  // mayorista. Con el `published` único de la 084 aparecía en los dos, con el
  // precio del enlace — o sea, su lista de mayorista en manos de cualquiera.
  const { data: soloDetal } = await admin
    .from("products")
    .insert({
      owner_id: ownerId,
      name: `${MARCA} zz solo publicado al detal`,
      base_currency: "USD",
      price_retail: 9,
      price_wholesale: 8,
      published_retail: true,
      published_wholesale: false,
    })
    .select("id")
    .single();
  creados.push(soloDetal.id);

  const { data: cat2Detal } = await anon.rpc("get_shared_catalog", { p_token: detal.token });
  check(
    "7b. publicado solo al detal SÍ sale en el catálogo",
    (cat2Detal?.products ?? []).some((p) => p.id === soloDetal.id),
  );

  // 7c COMPROBABA QUE ESE PRODUCTO **NO** SALIERA EN EL ENLACE DE MAYOR, que
  // era la razón de ser de los dos enlaces. Con uno solo (migración 106) la
  // pregunta cambia de sitio: un escalón sin publicar ya no decide quién ve el
  // producto, decide qué PRECIO se enseña — y eso lo vigilan 4b, 4c y 4f.
  check(
    "7c. y lo hace con su precio al detal, no con el de mayor sin publicar",
    (cat2Detal?.products ?? []).find((p) => p.id === soloDetal.id)?.tier === "retail",
    (cat2Detal?.products ?? []).find((p) => p.id === soloDetal.id)?.tier ?? "desapareció",
  );

  await admin
    .from("products")
    .update({ trashed_at: new Date().toISOString() })
    .eq("id", visible.id);
  const { data: catTrash } = await anon.rpc("get_shared_catalog", { p_token: detal.token });
  check(
    "7d. un producto en la papelera sale del catálogo",
    !(catTrash?.products ?? []).some((p) => p.id === visible.id),
  );
  await admin.from("products").update({ trashed_at: null }).eq("id", visible.id);

  // ── 7e. Un candado en bolívares ya no entra ────────────────────────────
  //
  // Decisión del dueño el 2026-10-10: la fila de bolívares se enseña calculada
  // y sin candado. La 085 lo lleva al esquema en vez de dejarlo solo en la
  // pantalla, porque lo que una pantalla decide, otra lo deshace — y un precio
  // en bolívares es el único de la ficha que se vuelve falso solo al moverse
  // la tasa.
  const { error: eVes } = await admin.from("product_price_overrides").insert({
    product_id: visible.id,
    tier: "retail",
    currency: "VES",
    amount: 12000,
  });
  check(
    "7e. un precio fijado en bolívares lo rechaza la base",
    eVes != null && eVes.code === "23514",
    eVes ? eVes.code : "entró",
  );

  // ── 7f. Las monedas activas del producto ───────────────────────────────
  //
  // La 087 las saca de `base_currency` a su propia tabla porque el tendero las
  // agrega y las quita. VES NO puede estar: es la moneda en la que el cliente
  // paga, se enseña siempre calculada y no se agrega ni se quita.
  //
  // `tier` VA EN EL INSERT DESDE LA 114, que lo metio en la clave primaria.
  // Sin el, esto fallaba con `23502` -- un not-null -- y daba por bueno un
  // rechazo que NO era el de la moneda. Una prueba que pasa por la razon
  // equivocada deja de vigilar lo que dice vigilar.
  const { error: eVesActiva } = await admin
    .from("product_currencies")
    .insert({ product_id: visible.id, tier: "retail", currency: "VES" });
  check(
    "7f. el bolívar no puede ser una moneda activa del producto",
    eVesActiva != null && eVesActiva.code === "23514",
    eVesActiva ? eVesActiva.code : "entró",
  );

  // LA CLAVE ES (product_id, tier, currency) DESDE LA 114, no
  // (product_id, currency): el detal y el mayor llevan su propia lista, que
  // es justo lo que el dueno reporto el 2026-10-15 -- anadir una moneda en
  // uno la anadia en el otro.
  await admin
    .from("product_currencies")
    .upsert(
      { product_id: visible.id, tier: "retail", currency: "EUR" },
      { onConflict: "product_id,tier,currency" },
    );
  const { data: monedas } = await admin
    .from("product_currencies")
    .select("currency")
    .eq("product_id", visible.id)
    .eq("tier", "retail");
  check(
    "7g. una moneda activa se guarda, en SU escalon",
    (monedas ?? []).some((m) => m.currency === "EUR"),
    (monedas ?? []).map((m) => m.currency).join(","),
  );

  // ── 7h. El rastro de la papelera (migración 090) ───────────────────────
  //
  // Es el único camino de vuelta que hoy tiene un producto borrado: la
  // papelera no sabe pintarlos (CT-44), así que si esta fila no se escribe, el
  // botón «Restaurar» de la notificación no existe y borrar es una puerta de
  // un solo sentido.
  await admin
    .from("product_hides")
    .insert({ product_id: visible.id, owner_id: ownerId, action: "trashed" });

  const { error: eAccion } = await admin
    .from("product_hides")
    .insert({ product_id: visible.id, owner_id: ownerId, action: "hidden" });
  check(
    "7h. `product_hides` solo admite las transiciones que la pantalla sabe pintar",
    eAccion != null && eAccion.code === "23514",
    eAccion ? eAccion.code : "entró 'hidden'",
  );

  const { data: rastros, error: eAnonHides } = await anon
    .from("product_hides")
    .select("id")
    .limit(1);
  check(
    "7i. anon NO ve el rastro de la papelera de nadie",
    eAnonHides != null || (rastros?.length ?? 0) === 0,
    eAnonHides ? eAnonHides.code : `leyó ${rastros?.length} filas`,
  );

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

  // Las monedas y los precios fijos cuelgan del producto con `on delete
  // cascade`. Si eso se rompiera quedarían filas apuntando a nada, y la
  // limpieza de arriba no se enteraría.
  const { count: monedasHuerfanas } = await admin
    .from("product_currencies")
    .select("product_id", { count: "exact", head: true })
    .in("product_id", creados.length ? creados : ["00000000-0000-0000-0000-000000000000"]);
  check(
    "12. borrar un producto se lleva sus monedas por cascada",
    monedasHuerfanas === 0,
    `quedan ${monedasHuerfanas}`,
  );

  const { count: rastrosHuerfanos } = await admin
    .from("product_hides")
    .select("product_id", { count: "exact", head: true })
    .in("product_id", creados.length ? creados : ["00000000-0000-0000-0000-000000000000"]);
  check(
    "13. y también su rastro de papelera",
    rastrosHuerfanos === 0,
    `quedan ${rastrosHuerfanos}`,
  );

  const fallos = filas.filter((f) => !f.pasa).length;
  console.log(`\n${filas.length - fallos}/${filas.length} pasan.`);
  if (fallos) process.exitCode = 1;
}
