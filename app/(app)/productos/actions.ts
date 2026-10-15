"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseAmount } from "@/lib/products/price";
import type { CostCurrency, PriceCurrency, PriceTier } from "@/lib/products/price";

export type ProductResult = { error: string | null; id?: string };

// The shopkeeper's catalogue. First screen of stage 1 of inventory.
//
// ─────────────────────────────────────────────────────────────────────────
// EVERY ACTION CHECKS OWNERSHIP EXPLICITLY
//
// CLAUDE.md's rule: any action reading or writing a row whose id comes from
// the browser verifies in code that the row belongs to the caller, not just
// through RLS. RLS is the backstop, not the only line — the 2026-08-28 audit
// found two functions leaning on it alone.
//
// `products` carries `owner_id`, so `.eq("owner_id", user.id)` is enough.
// `product_price_overrides` and `product_currencies` do NOT, so both are
// checked against `products` first, the same way `getOrCreateShareLink` checks
// against `clients`.
//
// A STORAGE PATH IS ALSO AN ID FROM THE BROWSER. `photoPath` arrives as a
// string the client assembled, so it is checked against the caller's own
// folder before it is written — see `ownPhotoPath`.

const MAX_NAME_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_CURRENCY_LABEL = 24;
// Un proveedor es un nombre de comercio, no una direccion. 120 es el mismo
// techo que el nombre del producto, y recortar en el servidor es lo que impide
// que un campo de texto libre se convierta en una fila de kilobytes.
const MAX_SUPPLIER_LENGTH = 120;

function cleanName(value: string): string {
  return value.trim().slice(0, MAX_NAME_LENGTH);
}

function cleanDescription(value: string | null | undefined): string | null {
  const text = (value ?? "").trim().slice(0, MAX_DESCRIPTION_LENGTH);
  return text === "" ? null : text;
}

// EL PROVEEDOR SE GUARDA TAL CUAL LO ESCRIBIO, solo recortado por los bordes.
//
// No se normaliza la caja ni se busca un nombre parecido ya guardado para
// reutilizarlo, y es deliberado: es un dato suyo y «Makro» frente a «MAKRO» no
// le hace dano a nadie. Lo que evita que el mismo proveedor se escriba de tres
// formas es el AUTOCOMPLETADO del formulario, que sugiere lo que ya existe
// ignorando la caja -- arreglarlo aqui, reescribiendole el texto, seria
// corregirle algo que el no pidio corregir.
function cleanSupplier(value: string | null | undefined): string | null {
  const text = (value ?? "").trim().slice(0, MAX_SUPPLIER_LENGTH);
  return text === "" ? null : text;
}

// ONE PARSER, SHARED WITH THE FORM. The copy that used to live here read a
// dot as a thousands separator, so "11.5" — which is what a JS number
// stringifies to, and therefore what comes back out of the database and
// straight into a form field — parsed as 115. The next save would have written
// 115 into the row: an $11.50 product turned into a $115 one by being opened
// and saved. Found on 2026-10-10; see `parseAmount` for the rule and the cases.
const toNumber = parseAmount;

// Rejects a path that is not inside the caller's own folder.
function ownPhotoPath(photoPath: string | null | undefined, userId: string): string | null {
  if (!photoPath) return null;
  const path = photoPath.trim();
  if (!path.startsWith(`${userId}/`)) {
    console.error("[products] photo path outside the owner's folder was discarded");
    return null;
  }
  return path;
}

async function ownsProduct(productId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, ok: false as const };

  const { data } = await supabase
    .from("products")
    .select("id")
    .eq("id", productId)
    .eq("owner_id", user.id)
    .maybeSingle();

  return { supabase, user, ok: Boolean(data) };
}

// Las monedas en las que un producto puede llevar precio. VES no está: es la
// moneda en la que el cliente paga, se enseña siempre calculada y no se
// agrega ni se quita (migración 087).
const SELLABLE: PriceCurrency[] = ["USD", "EUR", "USDT", "COP"];

export type FixedPrices = Partial<Record<PriceCurrency, string>>;

export type ProductInput = {
  name: string;
  unit: string | null;
  // Las monedas que maneja CADA ESCALÓN, y la PRIMERA de cada lista es su
  // moneda base: la que va en `price_retail` o en `price_wholesale`.
  //
  // DOS LISTAS DESDE LA MIGRACIÓN 114. Antes era una sola para el producto
  // entero, y por eso quitar una moneda en un bloque de la ficha la quitaba
  // del otro — lo reportó el dueño el 2026-10-15. Las dos pueden tener bases
  // distintas: el detal en dólares y el mayor en euros es el caso que él
  // pidió expresamente.
  activeCurrenciesRetail: PriceCurrency[];
  activeCurrenciesWholesale: PriceCurrency[];
  // El precio en la moneda base, por escalón.
  priceRetail: string | null;
  priceWholesale: string | null;
  // Lo que el tendero fijó a mano en las OTRAS monedas, por escalón.
  fixedRetail: FixedPrices;
  fixedWholesale: FixedPrices;
  cost: string | null;
  costCurrency: CostCurrency | null;
  costCurrencyOther: string | null;
  marginRetailPct: string | null;
  marginWholesalePct: string | null;
  stockOpening: string | null;
  // Donde compro el tendero este producto (migracion 103). Texto libre.
  supplier: string | null;
  // La cantidad a partir de la cual aplica el precio de mayor (migracion 088).
  wholesaleMinQuantity: string | null;
  publishedRetail: boolean;
  publishedWholesale: boolean;
  photoPath: string | null;
  description: string | null;
};

type Checked = {
  name: string;
  currencies: Record<PriceTier, PriceCurrency[]>;
  base: Record<PriceTier, PriceCurrency>;
};

// THE RULES THE TABLE ALSO ENFORCES, repeated here so the shopkeeper gets a
// sentence instead of error 23514. The constraints stay in the database
// because this is the convenience and those are the guarantee.
function validate(input: ProductInput): { error: string } | Checked {
  const name = cleanName(input.name);
  if (!name) return { error: "Escribe el nombre del producto." };

  // CADA LISTA SE LIMPIA Y SE VALIDA POR SEPARADO. Un escalón sin ninguna
  // moneda no tiene en qué escribir su precio, así que la frase habla del
  // escalón y no del producto: «deja al menos una moneda» a secas mandaría al
  // tendero a mirar el bloque equivocado.
  const currencies: Record<PriceTier, PriceCurrency[]> = {
    retail: input.activeCurrenciesRetail.filter((c) => SELLABLE.includes(c)),
    wholesale: input.activeCurrenciesWholesale.filter((c) => SELLABLE.includes(c)),
  };
  if (currencies.retail.length === 0) {
    return { error: "Deja al menos una moneda en el precio al detal." };
  }
  if (currencies.wholesale.length === 0) {
    return { error: "Deja al menos una moneda en el precio al mayor." };
  }
  const base: Record<PriceTier, PriceCurrency> = {
    retail: currencies.retail[0],
    wholesale: currencies.wholesale[0],
  };

  const retail = toNumber(input.priceRetail);
  const wholesale = toNumber(input.priceWholesale);
  if (retail == null && wholesale == null) {
    return { error: "Pon al menos un precio, al detal o al mayor." };
  }
  if ((retail != null && retail <= 0) || (wholesale != null && wholesale <= 0)) {
    return { error: "Un precio tiene que ser mayor que cero." };
  }

  const cost = toNumber(input.cost);
  if (cost != null && cost <= 0) return { error: "El costo tiene que ser mayor que cero." };
  if (cost != null && !input.costCurrency) {
    return { error: "Dinos en qué moneda está ese costo." };
  }
  // «OTRO» NO PIDE NOMBRE, y aquí había una regla que decía lo contrario.
  //
  // Era código muerto desde la 089 (2026-10-10), que relajó el check de la
  // base porque el dueño decidió que «Otro» se queda en «Otro»: lo que se
  // escribía ahí no servía para nada —no tenemos la tasa de esa moneda la
  // llame como la llame— y en dev acabó guardando un «Gjrj». La pantalla dejó
  // de preguntarlo ese mismo día; esta línea se quedó y bloqueaba el guardado
  // con la única moneda para la que el formulario ya no tiene qué preguntar.
  // Confirmado por el dueño el 2026-10-14: con «Otro» SE PUEDE guardar; lo
  // único que no se puede es calcular el precio desde el margen.

  const stock = toNumber(input.stockOpening);
  if (stock != null && stock < 0) return { error: "La cantidad no puede ser negativa." };

  const minQty = toNumber(input.wholesaleMinQuantity);
  if (minQty != null && minQty <= 0) {
    return { error: "La cantidad mínima para el precio al mayor tiene que ser mayor que cero." };
  }

  // LOS TECHOS DE LAS COLUMNAS, DICHOS EN CASTELLANO ANTES DE QUE POSTGRES LOS
  // DIGA EN `22003`.
  //
  // Encontrado el 2026-10-14 por el dueño: tecleó 1000000000000000 en el
  // inventario y la pantalla contestó «No pudimos guardar el producto. Intenta
  // de nuevo» — un mensaje que no dice qué campo ni qué hacer, delante de un
  // formulario de quince campos con una foto ya subida.
  //
  // Es el mismo trato que el resto de este `validate`: la restricción de la
  // base es la garantía y esto es la cortesía. Sin esta, el único camino era
  // borrar campos al azar hasta acertar.
  //
  // LOS LÍMITES SON LOS DE LAS COLUMNAS, no un tope de producto inventado por
  // mí. `numeric(14,3)` admite once dígitos enteros y `numeric(14,4)` diez, así
  // que estos números salen del esquema (083, 084, 088) y no de una opinión
  // sobre cuánto puede costar algo. Un tope más estrecho —«ningún producto
  // vale más de X»— sería una decisión del dueño, y no la ha tomado.
  const demasiadoGrande: Array<[number | null, number, string]> = [
    [stock, 1e11, "La cantidad en inventario es demasiado grande."],
    [minQty, 1e11, "La cantidad mínima para el precio al mayor es demasiado grande."],
    [cost, 1e10, "Ese costo es demasiado grande."],
    [retail, 1e10, "El precio al detal es demasiado grande."],
    [wholesale, 1e10, "El precio al mayor es demasiado grande."],
  ];
  for (const [valor, techo, mensaje] of demasiadoGrande) {
    if (valor != null && valor >= techo) return { error: mensaje };
  }

  return { name, currencies, base };
}

function rowFrom(input: ProductInput, checked: Checked, userId: string) {
  const stock = toNumber(input.stockOpening);
  const cost = toNumber(input.cost);
  return {
    name: checked.name,
    unit: input.unit?.trim() || null,
    // `base_currency` ES EL VALOR POR DEFECTO DEL PRODUCTO y desde la 114 no
    // es la unidad de ningún precio. Se escribe con la del detal porque es la
    // que la rejilla y los filtros enseñan como «la moneda del producto», y
    // porque el detal es el escalón que casi todos los productos tienen.
    base_currency: checked.base.retail,
    // LAS QUE SÍ FIJAN UN PRECIO. Se escriben siempre, también al crear: la
    // columna es NOT NULL y un producto nuevo no tiene nada que rellenar, así
    // que omitirlas aquí solo funcionaría al editar. El trigger de la 115 es
    // la red para quien escriba sin saber de escalones, no una excusa para
    // que este sitio no las ponga.
    base_currency_retail: checked.base.retail,
    base_currency_wholesale: checked.base.wholesale,
    price_retail: toNumber(input.priceRetail),
    price_wholesale: toNumber(input.priceWholesale),
    cost,
    // El par va junto o no va: la 087 lo exige con un check, y aquí se
    // construye entero para no depender de que el formulario acierte.
    cost_currency: cost == null ? null : (input.costCurrency ?? null),
    // `|| null` al final, y no la cadena tal cual: desde la 089 el formulario
    // ya no pregunta QUÉ moneda es «Otro», así que esto llegaba vacío y se
    // guardaba como `""`. Una cadena vacía y un null significan lo mismo aquí
    // —no hay nombre— pero solo uno de los dos lo dice, y el otro obliga a
    // quien consulte la tabla a acordarse de comprobar las dos cosas.
    cost_currency_other:
      (cost != null && input.costCurrency === "OTHER"
        ? (input.costCurrencyOther ?? "").trim().slice(0, MAX_CURRENCY_LABEL)
        : "") || null,
    margin_retail_pct: toNumber(input.marginRetailPct),
    margin_wholesale_pct: toNumber(input.marginWholesalePct),
    stock_opening: stock,
    stock_opening_at: stock == null ? null : new Date().toISOString(),
    supplier: cleanSupplier(input.supplier),
    // `|| null` y no el número tal cual: un 0 significa «sin mínimo», y eso ya
    // lo dice el null. La 088 lo rechaza con un check por la misma razón.
    wholesale_min_quantity: toNumber(input.wholesaleMinQuantity) || null,
    published_retail: input.publishedRetail,
    published_wholesale: input.publishedWholesale,
    photo_path: ownPhotoPath(input.photoPath, userId),
    description: cleanDescription(input.description),
  };
}

// LAS DOS TABLAS SATÉLITE SE REESCRIBEN ENTERAS: borrar y volver a insertar.
//
// No es pereza. La alternativa —calcular qué filas sobran y cuáles faltan—
// tiene que acertar en tres operaciones distintas y deja basura callada en
// cuanto una falla. Son como mucho cuatro monedas y ocho precios fijos por
// producto, así que reescribirlas cuesta dos consultas y no puede quedar a
// medias de una forma rara.
//
// LO QUE SÍ PUEDE QUEDAR A MEDIAS, y se dice: `supabase-js` no abre una
// transacción entre llamadas. Si el producto se guarda y estas fallan, el
// producto queda con sus monedas viejas. Por eso el error que devuelve lo
// dice con esas palabras en vez de «no se pudo guardar», que haría pensar que
// no se guardó nada.
async function writeSatellites(
  supabase: Awaited<ReturnType<typeof createClient>>,
  productId: string,
  checked: Checked,
  input: ProductInput,
): Promise<string | null> {
  const { error: eDelCur } = await supabase
    .from("product_currencies")
    .delete()
    .eq("product_id", productId);
  if (eDelCur) {
    console.error("[writeSatellites] delete currencies:", eDelCur.message);
    return "Guardamos el producto, pero no pudimos actualizar sus monedas.";
  }

  // CADA LISTA EN SU ESCALÓN (migración 114). Entre el 2026-10-15 y este
  // cambio esto duplicaba una sola lista a los dos, que era lo que conservaba
  // el comportamiento de entonces; ahora escribe lo que el tendero eligió en
  // cada bloque, que es lo que pidió.
  const { error: eInsCur } = await supabase.from("product_currencies").insert([
    ...checked.currencies.retail.map((currency) => ({
      product_id: productId,
      tier: "retail" as const,
      currency,
    })),
    ...checked.currencies.wholesale.map((currency) => ({
      product_id: productId,
      tier: "wholesale" as const,
      currency,
    })),
  ]);
  if (eInsCur) {
    console.error("[writeSatellites] insert currencies:", eInsCur.message);
    return "Guardamos el producto, pero no pudimos actualizar sus monedas.";
  }

  const { error: eDelPrice } = await supabase
    .from("product_price_overrides")
    .delete()
    .eq("product_id", productId);
  if (eDelPrice) {
    console.error("[writeSatellites] delete overrides:", eDelPrice.message);
    return "Guardamos el producto, pero no pudimos actualizar sus precios por moneda.";
  }

  // Solo las monedas ACTIVAS y distintas de la base: la base ya vive en
  // `price_retail` / `price_wholesale`, y una moneda que el tendero quitó no
  // puede dejar su precio escondido detrás.
  const filas: { product_id: string; tier: PriceTier; currency: PriceCurrency; amount: number }[] =
    [];
  for (const [tier, fixed] of [
    ["retail", input.fixedRetail],
    ["wholesale", input.fixedWholesale],
  ] as [PriceTier, FixedPrices][]) {
    // LA LISTA Y LA BASE DE ESTE ESCALÓN, no las del producto (114). Con una
    // sola lista compartida esto recorría las mismas monedas en los dos; con
    // dos, recorrer la del detal al guardar el mayor escribiría precios
    // fijados para monedas que ese escalón ya no ofrece.
    for (const currency of checked.currencies[tier]) {
      if (currency === checked.base[tier]) continue;
      const amount = toNumber(fixed[currency]);
      if (amount == null || amount <= 0) continue;
      filas.push({ product_id: productId, tier, currency, amount });
    }
  }

  if (filas.length > 0) {
    const { error } = await supabase.from("product_price_overrides").insert(filas);
    if (error) {
      console.error("[writeSatellites] insert overrides:", error.message);
      return "Guardamos el producto, pero no pudimos actualizar sus precios por moneda.";
    }
  }

  return null;
}

export async function createProduct(input: ProductInput): Promise<ProductResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sesión expirada, vuelve a entrar." };

  const checked = validate(input);
  if ("error" in checked) return { error: checked.error };

  const { data, error } = await supabase
    .from("products")
    .insert({ owner_id: user.id, ...rowFrom(input, checked, user.id) })
    .select("id")
    .single();

  if (error) {
    console.error("[createProduct]", error.message);
    return { error: "No pudimos guardar el producto. Intenta de nuevo." };
  }

  const aviso = await writeSatellites(supabase, data.id, checked, input);
  revalidatePath("/productos");
  return { error: aviso, id: data.id };
}

export async function updateProduct(
  productId: string,
  input: ProductInput,
): Promise<ProductResult> {
  const { supabase, user, ok } = await ownsProduct(productId);
  if (!user) return { error: "Sesión expirada, vuelve a entrar." };
  if (!ok) return { error: "No encontramos ese producto." };

  const checked = validate(input);
  if ("error" in checked) return { error: checked.error };

  const { error } = await supabase
    .from("products")
    .update({ ...rowFrom(input, checked, user.id), updated_at: new Date().toISOString() })
    .eq("id", productId)
    .eq("owner_id", user.id);

  if (error) {
    console.error("[updateProduct]", error.message);
    return { error: "No pudimos guardar los cambios. Intenta de nuevo." };
  }

  const aviso = await writeSatellites(supabase, productId, checked, input);
  revalidatePath("/productos");
  return { error: aviso };
}

// PUBLICAR DESDE LA TARJETA.
//
// Su propia acción y no un viaje por `updateProduct`, porque esa valida y
// reescribe la fila entera. Mover un booleano por ahí significaría que un
// producto con, pongamos, el nombre en blanco no se podría despublicar nunca:
// la validación que no tiene nada que ver rechazaría el guardado.
export async function setProductPublished(
  productId: string,
  tiers: { retail: boolean; wholesale: boolean },
): Promise<ProductResult> {
  const { supabase, user, ok } = await ownsProduct(productId);
  if (!user) return { error: "Sesión expirada, vuelve a entrar." };
  if (!ok) return { error: "No encontramos ese producto." };

  const { error } = await supabase
    .from("products")
    .update({
      published_retail: tiers.retail,
      published_wholesale: tiers.wholesale,
      updated_at: new Date().toISOString(),
    })
    .eq("id", productId)
    .eq("owner_id", user.id);

  if (error) {
    console.error("[setProductPublished]", error.message);
    return { error: "No pudimos cambiar eso. Intenta de nuevo." };
  }

  revalidatePath("/productos");
  return { error: null };
}

// A LA PAPELERA, NO BORRADO. Misma forma que un cliente: `trashed_at` en vez
// de un `delete`. El dato sobrevive porque un producto borrado explica por qué
// un movimiento viejo menciona algo que ya no está en el catálogo.
//
// Y DEJA RASTRO EN NOTIFICACIONES (migración 090), decisión del dueño el
// 2026-10-10. Es el camino de vuelta: sin él, borrar es una puerta de un solo
// sentido que el tendero descubre cuando ya no hay nada que hacer.
//
// El rastro NO hace fallar el borrado si no se escribe. Es la misma elección
// que `trashClient`: perder una notificación es perder el atajo para
// deshacer; hacer fallar el borrado por eso sería perder la acción que el
// tendero sí pidió.
export async function trashProduct(productId: string): Promise<ProductResult> {
  const { supabase, user, ok } = await ownsProduct(productId);
  if (!user) return { error: "Sesión expirada, vuelve a entrar." };
  if (!ok) return { error: "No encontramos ese producto." };

  const { error } = await supabase
    .from("products")
    .update({ trashed_at: new Date().toISOString() })
    .eq("id", productId)
    .eq("owner_id", user.id);

  if (error) {
    console.error("[trashProduct]", error.message);
    return { error: "No pudimos eliminar el producto. Intenta de nuevo." };
  }

  const { error: hideError } = await supabase.from("product_hides").insert({
    product_id: productId,
    owner_id: user.id,
    action: "trashed",
  });
  if (hideError) console.error("[trashProduct] product_hides insert failed", hideError.message);

  revalidatePath("/productos");
  revalidatePath("/notificaciones");
  return { error: null };
}

/**
 * Devuelve un producto de la papelera al catálogo.
 *
 * Se llama desde la notificación, que es el único sitio donde hoy se puede:
 * la papelera todavía no sabe pintar productos (ver CT-44). Esa es justo la
 * razón por la que la notificación tiene que llevar el botón — si no, un
 * producto borrado no tendría ninguna vuelta.
 */
export async function restoreProduct(productId: string): Promise<ProductResult> {
  const { supabase, user, ok } = await ownsProduct(productId);
  if (!user) return { error: "Sesión expirada, vuelve a entrar." };
  if (!ok) return { error: "No encontramos ese producto." };

  const { error } = await supabase
    .from("products")
    .update({ trashed_at: null })
    .eq("id", productId)
    .eq("owner_id", user.id);

  if (error) {
    console.error("[restoreProduct]", error.message);
    return { error: "No pudimos restaurar el producto. Intenta de nuevo." };
  }

  const { error: hideError } = await supabase.from("product_hides").insert({
    product_id: productId,
    owner_id: user.id,
    action: "restored",
  });
  if (hideError) console.error("[restoreProduct] product_hides insert failed", hideError.message);

  revalidatePath("/productos");
  revalidatePath("/notificaciones");
  return { error: null };
}

// THE SHAREABLE CATALOGUE LINKS — ONE PER TIER.
//
// No browser-supplied id to check: a link belongs to the session's own owner,
// so `owner_id` comes from `auth.getUser()` and nowhere else.
//
// TWO LINKS, NOT ONE, and that is CT-55 and the owner's decision 11 of
// 2026-10-09. Created on first use, exactly like `getOrCreateShareLink`: a
// token minted at signup would put every one of the 24 businesses one URL
// guess away from a catalogue they never chose to publish.
// UN SOLO ENLACE POR NEGOCIO desde el 2026-10-15 (migración 106). Antes
// recibía el escalón y había uno de detal y otro de mayor; la razón de aquello
// y la de esto están escritas en la cabecera de la migración.
//
// Sigue sin acuñarse en el alta: un token creado al registrarse pondría a los
// 24 negocios a una URL de distancia de un catálogo que nunca decidieron
// publicar. Se crea la primera vez que el tendero abre «Compartir».
export async function getOrCreateCatalogLink(): Promise<{ token: string } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sesión expirada, vuelve a entrar." };

  // `owner_id` sale de `auth.getUser()` y nunca del navegador — la regla de
  // las comprobaciones de propiedad explícitas de CLAUDE.md. La RLS es el
  // respaldo, no la única línea.
  const { data: existing } = await supabase
    .from("catalog_share_links")
    .select("token")
    .eq("owner_id", user.id)
    .maybeSingle();

  if (existing) return { token: existing.token };

  const { data: created, error } = await supabase
    .from("catalog_share_links")
    .insert({ owner_id: user.id })
    .select("token")
    .single();

  if (error || !created) {
    console.error("[getOrCreateCatalogLink]", error?.message);
    return { error: "No pudimos generar el enlace. Intenta de nuevo." };
  }

  return { token: created.token };
}
