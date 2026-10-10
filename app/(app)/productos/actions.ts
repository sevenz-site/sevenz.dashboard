"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseAmount } from "@/lib/products/price";
import type { PriceCurrency, PriceTier } from "@/lib/products/price";

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
// `product_price_overrides` does NOT, so it is checked against `products`
// first, the same way `getOrCreateShareLink` checks against `clients`.
//
// A STORAGE PATH IS ALSO AN ID FROM THE BROWSER. `photoPath` arrives as a
// string the client assembled, so it is checked against the caller's own
// folder before it is written — see `ownPhotoPath`. The storage policy already
// stops an upload outside that folder, but nothing stops a crafted POST from
// pointing this COLUMN at somebody else's object.

const MAX_NAME_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 500;

function cleanName(value: string): string {
  return value.trim().slice(0, MAX_NAME_LENGTH);
}

function cleanDescription(value: string | null | undefined): string | null {
  const text = (value ?? "").trim().slice(0, MAX_DESCRIPTION_LENGTH);
  return text === "" ? null : text;
}

// ONE PARSER, SHARED WITH THE FORM. The copy that used to live here read a
// dot as a thousands separator, so "11.5" — which is what a JS number
// stringifies to, and therefore what comes back out of the database and
// straight into a form field — parsed as 115. The next save would have written
// 115 into the row: an $11.50 product turned into a $115 one by being opened
// and saved. Found on 2026-10-10; see `parseAmount` for the rule and the cases.
const toNumber = parseAmount;

// Rejects a path that is not inside the caller's own folder. Returns undefined
// for "leave it alone" and null for "clear it", which the callers below pass
// straight through to the update.
function ownPhotoPath(photoPath: string | null | undefined, userId: string): string | null {
  if (!photoPath) return null;
  const path = photoPath.trim();
  if (!path.startsWith(`${userId}/`)) {
    // Not an error the shopkeeper can act on, and not one a legitimate client
    // can produce. Dropping the value is enough; the product saves without a
    // photo rather than failing in front of somebody who did nothing wrong.
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

// What both the full form and the inline shortcut send. Everything but `name`
// and the two prices is optional, which is what keeps the second path
// possible: a product born inside a fiado passes a name, a tier and a price,
// and nothing else (owner's decision 11, 2026-10-09).
export type ProductInput = {
  name: string;
  unit: string | null;
  priceRetail: string | null;
  priceWholesale: string | null;
  cost: string | null;
  marginRetailPct: string | null;
  marginWholesalePct: string | null;
  stockOpening: string | null;
  published: boolean;
  photoPath: string | null;
  description: string | null;
};

// THE RULE THE TABLE ALSO ENFORCES, repeated here so the shopkeeper gets a
// sentence instead of error 23514. The constraint stays in the database
// because this is the convenience and that one is the guarantee.
function validate(input: ProductInput): { error: string } | { name: string } {
  const name = cleanName(input.name);
  if (!name) return { error: "Escribe el nombre del producto." };

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

  const stock = toNumber(input.stockOpening);
  if (stock != null && stock < 0) return { error: "La cantidad no puede ser negativa." };

  return { name };
}

// The columns both writes share. `stock_opening_at` is stamped only when there
// is a quantity: a date beside an empty number would read as "counted today,
// found nothing" instead of "not counted".
function rowFrom(input: ProductInput, name: string, userId: string) {
  const stock = toNumber(input.stockOpening);
  return {
    name,
    unit: input.unit?.trim() || null,
    price_retail: toNumber(input.priceRetail),
    price_wholesale: toNumber(input.priceWholesale),
    cost: toNumber(input.cost),
    margin_retail_pct: toNumber(input.marginRetailPct),
    margin_wholesale_pct: toNumber(input.marginWholesalePct),
    stock_opening: stock,
    stock_opening_at: stock == null ? null : new Date().toISOString(),
    published: input.published,
    photo_path: ownPhotoPath(input.photoPath, userId),
    description: cleanDescription(input.description),
  };
}

export async function createProduct(
  input: ProductInput & { baseCurrency: PriceCurrency },
): Promise<ProductResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sesión expirada, vuelve a entrar." };

  const checked = validate(input);
  if ("error" in checked) return { error: checked.error };

  const { data, error } = await supabase
    .from("products")
    .insert({
      owner_id: user.id,
      base_currency: input.baseCurrency,
      ...rowFrom(input, checked.name, user.id),
    })
    .select("id")
    .single();

  if (error) {
    console.error("[createProduct]", error.message);
    return { error: "No pudimos guardar el producto. Intenta de nuevo." };
  }

  revalidatePath("/productos");
  return { error: null, id: data.id };
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
    .update({
      ...rowFrom(input, checked.name, user.id),
      updated_at: new Date().toISOString(),
    })
    .eq("id", productId)
    .eq("owner_id", user.id);

  if (error) {
    console.error("[updateProduct]", error.message);
    return { error: "No pudimos guardar los cambios. Intenta de nuevo." };
  }

  revalidatePath("/productos");
  return { error: null };
}

// PUBLISHING FROM THE CARD, which is the frame's own gesture: «Toggle publica u
// oculta el producto en el catálogo».
//
// Its own action and not a trip through `updateProduct`, because that one
// validates and rewrites the whole row. Flipping one boolean through it would
// mean a product with, say, a blank name could never be unpublished — the
// validation it has nothing to do with would refuse the save.
export async function setProductPublished(
  productId: string,
  published: boolean,
): Promise<ProductResult> {
  const { supabase, user, ok } = await ownsProduct(productId);
  if (!user) return { error: "Sesión expirada, vuelve a entrar." };
  if (!ok) return { error: "No encontramos ese producto." };

  const { error } = await supabase
    .from("products")
    .update({ published, updated_at: new Date().toISOString() })
    .eq("id", productId)
    .eq("owner_id", user.id);

  if (error) {
    console.error("[setProductPublished]", error.message);
    return { error: "No pudimos cambiar eso. Intenta de nuevo." };
  }

  revalidatePath("/productos");
  return { error: null };
}

// THE PADLOCK, IN TWO ACTIONS AND NO COLUMN.
//
// Closing it inserts a row; opening it deletes one. A calculated price is not
// stored anywhere: it is calculated. That is why there is no "is pinned"
// boolean here that could drift out of step with the value it describes.
export async function pinPrice(
  productId: string,
  tier: PriceTier,
  currency: PriceCurrency,
  amount: string,
): Promise<ProductResult> {
  const { supabase, user, ok } = await ownsProduct(productId);
  if (!user) return { error: "Sesión expirada, vuelve a entrar." };
  if (!ok) return { error: "No encontramos ese producto." };

  const value = toNumber(amount);
  if (value == null || value <= 0) return { error: "Escribe un precio mayor que cero." };

  const { error } = await supabase
    .from("product_price_overrides")
    .upsert(
      { product_id: productId, tier, currency, amount: value, set_at: new Date().toISOString() },
      { onConflict: "product_id,tier,currency" },
    );

  if (error) {
    console.error("[pinPrice]", error.message);
    return { error: "No pudimos fijar ese precio. Intenta de nuevo." };
  }

  revalidatePath("/productos");
  return { error: null };
}

export async function unpinPrice(
  productId: string,
  tier: PriceTier,
  currency: PriceCurrency,
): Promise<ProductResult> {
  const { supabase, user, ok } = await ownsProduct(productId);
  if (!user) return { error: "Sesión expirada, vuelve a entrar." };
  if (!ok) return { error: "No encontramos ese producto." };

  const { error } = await supabase
    .from("product_price_overrides")
    .delete()
    .eq("product_id", productId)
    .eq("tier", tier)
    .eq("currency", currency);

  if (error) {
    console.error("[unpinPrice]", error.message);
    return { error: "No pudimos volver a calcular ese precio. Intenta de nuevo." };
  }

  revalidatePath("/productos");
  return { error: null };
}

// To the bin, not deleted. Same shape as a client: `trashed_at` instead of a
// `delete`. See CT-44 — the bin still only knows how to paint clients, so for
// now a product sent here shows up nowhere. It is done this way anyway because
// the alternative is a real delete that cannot be undone, and because the
// column has existed since 083.
//
// It also leaves the catalogue, and that is `get_shared_catalog`'s own
// `trashed_at is null` doing it rather than a second write here. One place
// decides what the public page shows.
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

  revalidatePath("/productos");
  return { error: null };
}

// THE SHAREABLE CATALOGUE LINKS — ONE PER TIER.
//
// No browser-supplied id to check: a link belongs to the session's own owner,
// so `owner_id` comes from `auth.getUser()` and nowhere else.
//
// TWO LINKS, NOT ONE, and that is CT-55 and the owner's decision 11 of
// 2026-10-09: «el dueño querrá varios — uno de mayorista y uno de detal». It
// is what Tendero 2 asked for in the field. He has wholesale customers and
// retail customers, and a single catalogue forces him to show one of the two
// groups the wrong price.
//
// `unique (owner_id, tier)` in the table means this is an upsert-shaped
// get-or-create and there is never a question of which of three retail links
// is the real one.
//
// Created on first use, exactly like `getOrCreateShareLink`. A token minted at
// signup would put every one of the 24 businesses one URL guess away from a
// catalogue they never chose to publish.
export async function getOrCreateCatalogLink(
  tier: PriceTier,
): Promise<{ token: string } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sesión expirada, vuelve a entrar." };

  const { data: existing } = await supabase
    .from("catalog_share_links")
    .select("token")
    .eq("owner_id", user.id)
    .eq("tier", tier)
    .maybeSingle();

  if (existing) return { token: existing.token };

  const { data: created, error } = await supabase
    .from("catalog_share_links")
    .insert({ owner_id: user.id, tier })
    .select("token")
    .single();

  if (error || !created) {
    console.error("[getOrCreateCatalogLink]", error?.message);
    return { error: "No pudimos generar el enlace. Intenta de nuevo." };
  }

  return { token: created.token };
}
