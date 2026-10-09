"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
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

const MAX_NAME_LENGTH = 120;

function cleanName(value: string): string {
  return value.trim().slice(0, MAX_NAME_LENGTH);
}

// A typed price can arrive with a decimal comma, which is how it is written in
// Spanish. `Number("12,50")` is NaN, and a NaN reaching the database is a row
// that cannot be charged.
function toNumber(value: string | null | undefined): number | null {
  if (value == null) return null;
  const cleaned = String(value).trim().replace(/\./g, "").replace(",", ".");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
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

export async function createProduct(input: {
  name: string;
  unit: string | null;
  baseCurrency: PriceCurrency;
  // Which of the two prices is being written. Owner's decision, 2026-10-09:
  // creating a product on the fly makes the shopkeeper mark retail or
  // wholesale, so it is never born mislabelled.
  tier: PriceTier;
  price: string;
  cost?: string | null;
  marginPct?: string | null;
}): Promise<ProductResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sesión expirada, vuelve a entrar." };

  const name = cleanName(input.name);
  if (!name) return { error: "Escribe el nombre del producto." };

  const price = toNumber(input.price);
  if (price == null || price <= 0) return { error: "Escribe un precio mayor que cero." };

  const { data, error } = await supabase
    .from("products")
    .insert({
      owner_id: user.id,
      name,
      unit: input.unit?.trim() || null,
      base_currency: input.baseCurrency,
      // The other stays null on purpose: the table requires one of the two,
      // not both. Requiring both would make the inline creation impossible.
      price_retail: input.tier === "retail" ? price : null,
      price_wholesale: input.tier === "wholesale" ? price : null,
      cost: toNumber(input.cost),
      margin_pct: toNumber(input.marginPct),
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
  input: {
    name: string;
    unit: string | null;
    priceRetail: string | null;
    priceWholesale: string | null;
    cost: string | null;
    marginPct: string | null;
  },
): Promise<ProductResult> {
  const { supabase, user, ok } = await ownsProduct(productId);
  if (!user) return { error: "Sesión expirada, vuelve a entrar." };
  if (!ok) return { error: "No encontramos ese producto." };

  const name = cleanName(input.name);
  if (!name) return { error: "Escribe el nombre del producto." };

  const priceRetail = toNumber(input.priceRetail);
  const priceWholesale = toNumber(input.priceWholesale);
  // The same rule as the table's `check`, repeated here so the shopkeeper gets
  // a sentence instead of a database error. The constraint stays in the
  // database because this is the convenience and that one is the guarantee.
  if (priceRetail == null && priceWholesale == null) {
    return { error: "Deja al menos un precio, al detal o al mayor." };
  }

  const { error } = await supabase
    .from("products")
    .update({
      name,
      unit: input.unit?.trim() || null,
      price_retail: priceRetail,
      price_wholesale: priceWholesale,
      cost: toNumber(input.cost),
      margin_pct: toNumber(input.marginPct),
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
