"use server";

import { trackServer } from "@/lib/mixpanel-server";
import { flowContext, type FlowInput } from "@/lib/analytics/amounts";
import type { ProductRejectionReason, ProductSource } from "@/lib/analytics/events";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { puedeEscribir } from "@/lib/cuenta-pausada-server";
import { MENSAJE_CUENTA_PAUSADA } from "@/lib/cuenta-pausada";
import { parseAmount } from "@/lib/products/price";
import { MAX_DESCRIPTION_LENGTH } from "@/lib/products/description";
import { MAX_PRODUCT_PHOTOS } from "@/lib/products/photos";
import type { CostCurrency, PriceCurrency, PriceTier } from "@/lib/products/price";
import { foldForSearch } from "@/lib/search/fold";
import { storageFileExists } from "@/lib/storage-file-exists";
import {
  errorDeNombreDeCategoria,
  limpiarNombreDeCategoria,
  type Categoria,
} from "@/lib/products/categories";

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

// THE EXTRA PHOTOS, CLEANED THE SAME WAY AS THE COVER. Each path goes through
// `ownPhotoPath` (a path is an id from the browser, CLAUDE.md's ownership rule); empty,
// repeated or cover-equal paths are dropped, and at most four are kept -- the cover is the
// fifth. `undefined` stays `undefined`: see `ProductInput.extraPhotoPaths`.
function cleanExtraPhotos(
  extras: string[] | undefined,
  cover: string | null,
  userId: string,
): string[] | undefined {
  if (extras === undefined) return undefined;
  const out: string[] = [];
  for (const raw of extras) {
    const path = ownPhotoPath(raw, userId);
    if (path && path !== cover && !out.includes(path)) out.push(path);
  }
  return out.slice(0, MAX_PRODUCT_PHOTOS - 1);
}

// What a save answers when the photo it points at no longer exists: a draft
// older than the nightly cleanup's 7 days (`DM-12`, migration 182). See
// `lib/storage-file-exists.ts` for why the check runs only on a new path.
const PHOTO_GONE = "La foto de este producto ya no está disponible. Vuelve a subirla y guarda de nuevo.";

async function ownsProduct(productId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, ok: false as const };

  const { data } = await supabase
    .from("products")
    .select("id, photo_path")
    .eq("id", productId)
    .eq("owner_id", user.id)
    .maybeSingle();

  // `photoPath` is the one already saved, so `updateProduct` can tell a new
  // photo (checked against Storage) from the one it keeps (never checked).
  return { supabase, user, ok: Boolean(data), photoPath: (data?.photo_path as string | null) ?? null };
}

// Las monedas en las que un producto puede llevar precio. VES no está: es la
// moneda en la que el cliente paga, se enseña siempre calculada y no se
// agrega ni se quita (migración 087).
// USDT left on 2026-11-12 (CT-171, migration 203), owner's decision.
const SELLABLE: PriceCurrency[] = ["USD", "EUR", "COP"];

// The cost currencies the form offers, plus the ones old products may still carry
// (VES, and «Otro», retired in CT-66 but still saved). USDT is not here since CT-171;
// the database refuses it too, and this is what turns that refusal into a sentence.
const COST_CURRENCIES: string[] = ["USD", "EUR", "COP", "VES", "OTHER"];

export type FixedPrices = Partial<Record<PriceCurrency, string>>;

export type ProductInput = {
  // Which attempt this is and who called. Only for the funnels: this action has two
  // doors, the wizard and the quick sheet inside a sale.
  analitica?: FlowInput & { source?: ProductSource };
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
  // PHOTOS 2 TO 5, in order (CT-171, migration 204). `undefined` means "this caller does
  // not manage extra photos -- leave them as they are": the quick product sheet inside a
  // sale only has one photo field, and it must not wipe a product's gallery by saving.
  extraPhotoPaths?: string[];
  description: string | null;
  // Migration 184. OPTIONAL ON PURPOSE: the quick-create sheet inside a sale
  // (`quick-product-sheet.tsx`) does not ask for it. Absent means «leave the
  // category as it is» on an update and «no category» on a create, so a form
  // that does not know about categories can never wipe one by saving.
  categoryId?: string | null;
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

  // A DESCRIPTION OVER THE LIMIT IS REFUSED, NOT CUT (CT-171). Until 2026-11-12 the
  // server sliced it to 500 in silence, so a shopkeeper who typed 600 lost the end and
  // never knew. The field now stops at 500; what still reaches this is a tab holding
  // the old bundle, and it gets a sentence instead of a truncated description.
  if ((input.description ?? "").trim().length > MAX_DESCRIPTION_LENGTH) {
    return {
      error: `La descripción pasa de ${MAX_DESCRIPTION_LENGTH} caracteres. Acórtala y guarda de nuevo.`,
    };
  }

  // CADA LISTA SE LIMPIA Y SE VALIDA POR SEPARADO. Un escalón sin ninguna
  // moneda no tiene en qué escribir su precio, así que la frase habla del
  // escalón y no del producto: «deja al menos una moneda» a secas mandaría al
  // tendero a mirar el bloque equivocado.
  // A CURRENCY OUTSIDE THE LIST IS REFUSED, NOT FILTERED. Filtering a list whose FIRST
  // entry is foreign would move the base to the next currency and leave the stored number
  // meaning something else -- the product silently repriced. The form never sends one;
  // what does is a request built by hand, or a tab still holding the pre-CT-171 bundle
  // with USDT in its menu. Kept from the CT-79 lock it replaces, which reasoned the same.
  for (const [tier, list] of [
    ["retail", input.activeCurrenciesRetail],
    ["wholesale", input.activeCurrenciesWholesale],
  ] as const) {
    if (list.some((c) => !SELLABLE.includes(c))) {
      return {
        error:
          tier === "retail"
            ? "Esa moneda ya no se puede usar en el precio al detal. Quítala y guarda de nuevo."
            : "Esa moneda ya no se puede usar en el precio al mayor. Quítala y guarda de nuevo.",
      };
    }
  }
  if (input.costCurrency && !COST_CURRENCIES.includes(input.costCurrency)) {
    return { error: "Esa moneda ya no se puede usar en el costo. Elige otra y guarda de nuevo." };
  }

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
  extras?: string[],
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

  // PHOTOS 2 TO 5 (CT-171), rewritten whole like the two tables above, and only when the
  // caller manages them. If the insert fails after the delete, the extra photos are gone
  // from the product but their files stay in Storage for a week (the nightly cleanup's
  // `min_age`), so saving again restores them; the message says exactly that much.
  if (extras !== undefined) {
    const { error: eDelPh } = await supabase.from("product_photos").delete().eq("product_id", productId);
    if (eDelPh) {
      console.error("[writeSatellites] delete photos:", eDelPh.message);
      return "Guardamos el producto, pero no pudimos actualizar sus fotos.";
    }
    if (extras.length > 0) {
      const { error } = await supabase
        .from("product_photos")
        .insert(extras.map((path, i) => ({ product_id: productId, position: i + 1, path })));
      if (error) {
        console.error("[writeSatellites] insert photos:", error.message);
        return "Guardamos el producto, pero no pudimos guardar todas sus fotos. Vuelve a guardar.";
      }
    }
  }

  return null;
}

// THE CATEGORY MUST BE THE SAME OWNER'S. The id comes from the browser, so it
// is checked here explicitly (CLAUDE.md's ownership rule) before it is written;
// the composite foreign key of migration 184 refuses it again underneath.
// `undefined` = not sent (leave as is), `null` = no category.
async function categoriaPermitida(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  categoryId: string | null | undefined,
): Promise<{ ok: true; value: string | null | undefined } | { ok: false }> {
  if (categoryId === undefined || categoryId === null) return { ok: true, value: categoryId };
  const { data } = await supabase
    .from("product_categories")
    .select("id")
    .eq("id", categoryId)
    .eq("owner_id", userId)
    .maybeSingle();
  return data ? { ok: true, value: categoryId } : { ok: false };
}

const CATEGORIA_AJENA = "No encontramos esa categoría. Elige otra o créala de nuevo.";

export async function createProduct(input: ProductInput): Promise<ProductResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sesión expirada, vuelve a entrar." };

  const flujo = flowContext(input.analitica);
  const source: ProductSource = input.analitica?.source === "quick_sheet" ? "quick_sheet" : "wizard";
  // WHAT STOPS A PRODUCT FROM SAVING. A refusal left no trace before. Filed under
  // the owner.
  const rechazar = (reason: ProductRejectionReason, error: string): ProductResult => {
    trackServer("Product Creation Rejected", user.id, { ...flujo, source, reason }, user.email);
    return { error };
  };
  // A BLOCKED ACCOUNT DOES NOT WRITE PRODUCTS (migration 170, plan of
  // 2026-10-31). The policy is the lock; this is the sign: asking first makes
  // the answer the paused-account message, not «No pudimos guardar».
  if (!(await puedeEscribir(supabase, user.id))) return rechazar("paused_account", MENSAJE_CUENTA_PAUSADA);

  const checked = validate(input);
  if ("error" in checked) return rechazar("validation", checked.error);

  const photo = ownPhotoPath(input.photoPath, user.id);
  if (photo && !(await storageFileExists("product-photos", photo))) return rechazar("photo_gone", PHOTO_GONE);
  const extras = cleanExtraPhotos(input.extraPhotoPaths, photo, user.id);
  for (const path of extras ?? []) {
    if (!(await storageFileExists("product-photos", path))) return rechazar("photo_gone", PHOTO_GONE);
  }

  const categoria = await categoriaPermitida(supabase, user.id, input.categoryId);
  if (!categoria.ok) return rechazar("foreign_category", CATEGORIA_AJENA);

  const { data, error } = await supabase
    .from("products")
    .insert({ owner_id: user.id, ...rowFrom(input, checked, user.id), category_id: categoria.value ?? null })
    .select("id")
    .single();

  if (error) {
    console.error("[createProduct]", error.message);
    return rechazar("db_error", "No pudimos guardar el producto. Intenta de nuevo.");
  }

  const aviso = await writeSatellites(supabase, data.id, checked, input, extras);
  revalidatePath("/productos");
  const photoCount = await savedPhotoCount(supabase, data.id, photo);

  // HOW MANY PRODUCTS EACH BUSINESS CREATES, AND HOW COMPLETE. Owner's request of
  // 2026-11-04: *«productos creados y sus eventos para funnel de creación de un
  // producto»*. Decides whether a thin catalogue is a lack of products or of details.
  // Only yes or no per field: a product's name or supplier never travels. Filed under
  // the owner.
  trackServer(
    "Product Created",
    user.id,
    {
      ...flujo,
      product_id: data.id,
      source,
      has_cost: Boolean(input.cost?.trim()),
      has_wholesale: Boolean(input.priceWholesale?.trim()),
      has_photo: Boolean(photo),
      has_description: Boolean(input.description?.trim()),
      has_category: Boolean(categoria.value),
      has_supplier: Boolean(input.supplier?.trim()),
      published: input.publishedRetail || input.publishedWholesale,
      satellites_failed: aviso != null,
      photo_count: photoCount,
    },
    user.email,
  );
  return { error: aviso, id: data.id };
}

// HOW MANY PHOTOS THE PRODUCT ENDED UP WITH, read back after saving: the cover plus the rows
// of `product_photos` (migration 204). Owner's request of 2026-11-14, asked whether the
// product events should say how many photos each product carries: «Sí». What it decides:
// whether the 5-photo gallery of v0.6.0 (CT-171) gets used or most products stay at one,
// which says if the next effort on the catalogue goes to photos or elsewhere.
//
// Read from the database and not from the request, so a save whose extra photos failed
// (`satellites_failed`) is not counted as having them. Never throws: an event must not cost
// a save, so a failed read counts the cover alone.
async function savedPhotoCount(
  supabase: Awaited<ReturnType<typeof createClient>>,
  productId: string,
  cover: string | null | undefined,
): Promise<number> {
  try {
    const { count } = await supabase
      .from("product_photos")
      .select("product_id", { count: "exact", head: true })
      .eq("product_id", productId);
    return (cover ? 1 : 0) + (count ?? 0);
  } catch {
    return cover ? 1 : 0;
  }
}

export async function updateProduct(
  productId: string,
  input: ProductInput,
): Promise<ProductResult> {
  const { supabase, user, ok, photoPath: savedPhoto } = await ownsProduct(productId);
  if (!user) return { error: "Sesión expirada, vuelve a entrar." };
  if (!ok) return { error: "No encontramos ese producto." };
  if (!(await puedeEscribir(supabase, user.id))) return { error: MENSAJE_CUENTA_PAUSADA };

  const checked = validate(input);
  if ("error" in checked) return { error: checked.error };

  const photo = ownPhotoPath(input.photoPath, user.id);
  if (photo && photo !== savedPhoto && !(await storageFileExists("product-photos", photo))) {
    return { error: PHOTO_GONE };
  }
  const extras = cleanExtraPhotos(input.extraPhotoPaths, photo, user.id);
  if (extras?.length) {
    const { data: guardadas } = await supabase
      .from("product_photos")
      .select("path")
      .eq("product_id", productId);
    const ya = new Set([savedPhoto, ...(guardadas ?? []).map((r) => r.path as string)]);
    for (const path of extras) {
      if (!ya.has(path) && !(await storageFileExists("product-photos", path))) return { error: PHOTO_GONE };
    }
  }

  // WHAT WAS THERE BEFORE, only to name which columns changed.
  const { data: antes } = await supabase.from("products").select("*").eq("id", productId).maybeSingle();
  const fila = rowFrom(input, checked, user.id);

  const categoria = await categoriaPermitida(supabase, user.id, input.categoryId);
  if (!categoria.ok) return { error: CATEGORIA_AJENA };

  const { error } = await supabase
    .from("products")
    .update({
      ...fila,
      ...(categoria.value === undefined ? {} : { category_id: categoria.value }),
      updated_at: new Date().toISOString(),
    })
    .eq("id", productId)
    .eq("owner_id", user.id);

  if (error) {
    console.error("[updateProduct]", error.message);
    return { error: "No pudimos guardar los cambios. Intenta de nuevo." };
  }

  const aviso = await writeSatellites(supabase, productId, checked, input, extras);
  revalidatePath("/productos");
  const photoCount = await savedPhotoCount(supabase, productId, fila.photo_path);

  // WHAT GETS EDITED MOST. If it is the price, a shortcut would save the whole
  // wizard. Column names only, never their values. Filed under the owner.
  const igual = (x: unknown, y: unknown) =>
    x === y || (x == null && y == null) || (x != null && y != null && Number(x) === Number(y)) || String(x ?? "") === String(y ?? "");
  trackServer(
    "Product Updated",
    user.id,
    {
      ...flowContext(input.analitica),
      product_id: productId,
      fields_changed: Object.entries(fila)
        .filter(([columna, valor]) => !igual((antes as Record<string, unknown> | null)?.[columna], valor))
        .map(([columna]) => columna),
      photo_count: photoCount,
    },
    user.email,
  );
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
  if (!(await puedeEscribir(supabase, user.id))) return { error: MENSAJE_CUENTA_PAUSADA };

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

  // DO THEY PUBLISH WHAT THEY CREATE? A catalogue with nothing published sells nothing,
  // and this is the only way to tell that from one nobody shares. Filed under the owner.
  trackServer(
    "Product Publication Changed",
    user.id,
    { product_id: productId, published_retail: tiers.retail, published_wholesale: tiers.wholesale },
    user.email,
  );
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
  if (!(await puedeEscribir(supabase, user.id))) return { error: MENSAJE_CUENTA_PAUSADA };

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

  // How many products get deleted, against those created. Filed under the owner.
  trackServer("Product Deleted", user.id, { product_id: productId }, user.email);

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
  if (!(await puedeEscribir(supabase, user.id))) return { error: MENSAJE_CUENTA_PAUSADA };

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

  // The notification is a deleted product's only way back (`CT-44`): this says whether
  // that is enough. Filed under the owner.
  trackServer("Product Restored", user.id, { product_id: productId }, user.email);

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

// ===========================================================================
// EL BUSCADOR DEL SELECTOR DE PRODUCTOS — paso 8, entregable `E` / `CT-51`
//
// WHY A SEARCH ACTION AND NOT A PROP. The movement dialog is mounted on the
// most used screens in the product, and loading every product of the business
// on each of those page loads would make the fiado form slower to pay for a
// field that most movements will not use -- 43% of movements in dev carry a
// description at all, and the plan measured 56% without one in production.
// The list is fetched the first time the picker opens, and never before.
//
// `limit(12)` IS A PRODUCT DECISION, not a performance one: a list longer than
// a phone screen stops being a list and becomes a scroll. If what the
// shopkeeper wants is not in the first twelve, typing two more letters is
// faster than scrolling, and the quick-create is right underneath.
export type ProductoBuscado = {
  id: string;
  name: string;
  unit: string | null;
  priceRetail: number | null;
  baseCurrencyRetail: string | null;
};

export async function buscarProductos(query: string): Promise<ProductoBuscado[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const q = query.trim();

  let builder = supabase
    .from("products")
    .select("id, name, unit, price_retail, base_currency_retail")
    .eq("owner_id", user.id)
    // La papelera no se ofrece: un producto en la papelera no se puede fiar.
    .is("trashed_at", null)
    .order("name", { ascending: true })
    .limit(12);

  // Sin texto se devuelven los primeros por nombre, que es lo que hace util
  // abrir el selector sin saber todavia que se busca.
  // ACCENT-INSENSITIVE since migration 172 (2026-10-31): `name_search` is
  // lower(unaccent(name)), generated by the database, and the typed text is
  // folded the same way here. Comparing against `name` made «azucar» miss
  // «Azúcar».
  if (q !== "") builder = builder.ilike("name_search", `%${foldForSearch(q)}%`);

  const { data, error } = await builder;
  if (error) {
    console.error("buscarProductos:", error.message);
    return [];
  }

  return (data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    unit: p.unit,
    priceRetail: p.price_retail == null ? null : Number(p.price_retail),
    baseCurrencyRetail: p.base_currency_retail,
  }));
}

// ── CATEGORIES (migration 184) ───────────────────────────────────────────
//
// Owner's request of 2026-11-03: create, edit and delete them from the
// create-product flow. Every action checks the owner in code before touching a
// row (CLAUDE.md), and a blocked account cannot write them, like products.

export type CategoriaResult = { error: string } | { categoria: Categoria };

async function sesionQuePuedeEscribir() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, error: "Sesión expirada, vuelve a entrar." };
  if (!(await puedeEscribir(supabase, user.id))) return { supabase, user, error: MENSAJE_CUENTA_PAUSADA };
  return { supabase, user, error: null };
}

async function categoriasDe(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data } = await supabase.from("product_categories").select("id, name").eq("owner_id", userId);
  return (data ?? []) as Categoria[];
}

export async function crearCategoria(nombre: string): Promise<CategoriaResult> {
  const { supabase, user, error: sesion } = await sesionQuePuedeEscribir();
  if (!user || sesion) return { error: sesion ?? "Sesión expirada, vuelve a entrar." };

  const limpio = limpiarNombreDeCategoria(String(nombre ?? ""));
  const invalido = errorDeNombreDeCategoria(limpio, await categoriasDe(supabase, user.id));
  if (invalido) return { error: invalido };

  const { data, error } = await supabase
    .from("product_categories")
    .insert({ owner_id: user.id, name: limpio })
    .select("id, name")
    .single();
  if (error) {
    // 23505: the unique index on lower(name) won a race the check above lost.
    if (error.code === "23505") return { error: `Ya tienes la categoría «${limpio}».` };
    console.error("[crearCategoria]", error.message);
    return { error: "No pudimos crear la categoría. Intenta de nuevo." };
  }
  revalidatePath("/productos");
  // DO BUSINESSES USE CATEGORIES? They launched in v0.2.0, and this decides whether
  // they get more work. The name never travels. Filed under the owner.
  trackServer("Category Changed", user.id, { action: "create" }, user.email);
  return { categoria: data as Categoria };
}

export async function renombrarCategoria(categoryId: string, nombre: string): Promise<CategoriaResult> {
  const { supabase, user, error: sesion } = await sesionQuePuedeEscribir();
  if (!user || sesion) return { error: sesion ?? "Sesión expirada, vuelve a entrar." };

  const propias = await categoriasDe(supabase, user.id);
  if (!propias.some((c) => c.id === categoryId)) return { error: "No encontramos esa categoría." };

  const limpio = limpiarNombreDeCategoria(String(nombre ?? ""));
  const invalido = errorDeNombreDeCategoria(limpio, propias, categoryId);
  if (invalido) return { error: invalido };

  const { data, error } = await supabase
    .from("product_categories")
    .update({ name: limpio, updated_at: new Date().toISOString() })
    .eq("id", categoryId)
    .eq("owner_id", user.id)
    .select("id, name")
    .single();
  if (error) {
    if (error.code === "23505") return { error: `Ya tienes la categoría «${limpio}».` };
    console.error("[renombrarCategoria]", error.message);
    return { error: "No pudimos guardar el nombre. Intenta de nuevo." };
  }
  revalidatePath("/productos");
  trackServer("Category Changed", user.id, { action: "rename" }, user.email);
  return { categoria: data as Categoria };
}

// DELETING LEAVES THE PRODUCTS WITHOUT A CATEGORY, the owner's decision of
// 2026-11-03. The database does it (`on delete set null (category_id)`), so
// it cannot half-happen; the confirmation dialog names how many products lose
// it before he presses.
export async function eliminarCategoria(categoryId: string): Promise<{ error: string | null }> {
  const { supabase, user, error: sesion } = await sesionQuePuedeEscribir();
  if (!user || sesion) return { error: sesion ?? "Sesión expirada, vuelve a entrar." };

  const { data: propia } = await supabase
    .from("product_categories")
    .select("id")
    .eq("id", categoryId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!propia) return { error: "No encontramos esa categoría." };

  const { error } = await supabase
    .from("product_categories")
    .delete()
    .eq("id", categoryId)
    .eq("owner_id", user.id);
  if (error) {
    console.error("[eliminarCategoria]", error.message);
    return { error: "No pudimos eliminar la categoría. Intenta de nuevo." };
  }
  revalidatePath("/productos");
  trackServer("Category Changed", user.id, { action: "delete" }, user.email);
  return { error: null };
}
