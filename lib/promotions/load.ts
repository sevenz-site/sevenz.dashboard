import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { businessToday, lastDay, promotionStatus, type PromotionStatus } from "@/lib/promotions/rules";
import type { PriceCurrency } from "@/lib/products/price";

// THE OWNER'S PROMOTIONS, READ WITH HIS SESSION (CT-184, migration 228). RLS decides the rows;
// every query also says `.eq("owner_id", ownerId)` -- the explicit check CLAUDE.md asks for.

export type PromotionGroupRow = {
  percent: number;
  allProducts: boolean;
  productIds: string[]; // included (chosen group) or excluded (all-products group)
  wholesalePercent: number | null; // null = same as `percent` (migration 230)
};

export type PromotionRow = {
  id: string;
  name: string;
  bannerPath: string | null;
  startsOn: string;
  endsOn: string;
  extendedUntil: string | null;
  endedOn: string | null;
  code: string | null;
  codePercent: number | null;
  codeMaxUses: number | null;
  groups: PromotionGroupRow[];
  status: PromotionStatus;
  lastDay: string;
  orders: number;
};

export type PromoProduct = {
  id: string;
  name: string;
  photoPath: string | null;
  categoryId: string | null;
  price: number | null; // retail if published, else wholesale
  currency: PriceCurrency | null;
  // Each tier on its own, null when not published: the wizard warns when the discounted
  // wholesale ends up dearer than the discounted retail (owner's «Solo avisa», 2026-11-28).
  retailPrice: number | null;
  retailCurrency: PriceCurrency | null;
  wholesalePrice: number | null;
  wholesaleCurrency: PriceCurrency | null;
  cost: number | null;
  costCurrency: string | null;
};

export async function loadPromotions(supabase: SupabaseClient, ownerId: string): Promise<{ rows: PromotionRow[]; today: string; country: string | null } | null> {
  const [{ data: owner }, { data: promos, error }] = await Promise.all([
    supabase.from("owners").select("country").eq("id", ownerId).single(),
    supabase
      .from("promotions")
      .select("id, name, banner_path, starts_on, ends_on, extended_until, ended_at, code, code_percent, code_max_uses, promotion_groups(percent, wholesale_percent, all_products, position, promotion_group_items(product_id, kind))")
      .eq("owner_id", ownerId)
      .order("starts_on", { ascending: false }),
  ]);
  if (error) {
    console.error("[promociones] list:", error.message);
    return null;
  }
  const country = (owner?.country as string | null) ?? null;
  const today = businessToday(country);
  const ids = (promos ?? []).map((p) => p.id as string);
  const counts = new Map<string, number>();
  if (ids.length > 0) {
    const { data: orders } = await supabase
      .from("catalog_orders")
      .select("promotion_id")
      .eq("owner_id", ownerId)
      .in("promotion_id", ids);
    for (const o of orders ?? []) counts.set(o.promotion_id as string, (counts.get(o.promotion_id as string) ?? 0) + 1);
  }
  const rows = (promos ?? []).map((p) => {
    const endedOn = p.ended_at ? businessToday(country, new Date(p.ended_at as string)) : null;
    const base = { startsOn: p.starts_on as string, endsOn: p.ends_on as string, extendedUntil: (p.extended_until as string | null) ?? null, endedOn };
    const groups = ((p.promotion_groups ?? []) as { percent: number; wholesale_percent: number | null; all_products: boolean; position: number; promotion_group_items: { product_id: string; kind: string }[] }[])
      .sort((a, b) => a.position - b.position)
      .map((g) => ({
        percent: Number(g.percent),
        wholesalePercent: g.wholesale_percent == null ? null : Number(g.wholesale_percent),
        allProducts: g.all_products,
        productIds: (g.promotion_group_items ?? [])
          .filter((i) => i.kind === (g.all_products ? "exclude" : "include"))
          .map((i) => i.product_id),
      }));
    return {
      id: p.id as string,
      name: p.name as string,
      bannerPath: (p.banner_path as string | null) ?? null,
      ...base,
      code: (p.code as string | null) ?? null,
      codePercent: p.code_percent == null ? null : Number(p.code_percent),
      codeMaxUses: (p.code_max_uses as number | null) ?? null,
      groups,
      status: promotionStatus(base, today),
      lastDay: lastDay(base),
      orders: counts.get(p.id as string) ?? 0,
    };
  });
  return { rows, today, country };
}

// Published products only: a promotion discounts catalogue orders, so an unpublished product
// could never carry it.
export async function loadPromoProducts(
  supabase: SupabaseClient,
  ownerId: string,
): Promise<{ products: PromoProduct[]; categories: { id: string; name: string }[] }> {
  const [{ data: products, error }, { data: categories }] = await Promise.all([
    supabase
      .from("products")
      .select("id, name, photo_path, category_id, published_retail, published_wholesale, price_retail, price_wholesale, base_currency_retail, base_currency_wholesale, cost, cost_currency")
      .eq("owner_id", ownerId)
      .is("trashed_at", null)
      .or("published_retail.eq.true,published_wholesale.eq.true")
      .order("name"),
    supabase.from("product_categories").select("id, name").eq("owner_id", ownerId).order("name"),
  ]);
  if (error) console.error("[promociones] products:", error.message);
  return {
    products: (products ?? []).map((p) => {
      const retail = p.published_retail && p.price_retail != null;
      const wholesale = p.published_wholesale && p.price_wholesale != null;
      return {
        id: p.id as string,
        name: p.name as string,
        photoPath: (p.photo_path as string | null) ?? null,
        categoryId: (p.category_id as string | null) ?? null,
        price: retail ? Number(p.price_retail) : p.price_wholesale == null ? null : Number(p.price_wholesale),
        currency: ((retail ? p.base_currency_retail : p.base_currency_wholesale) as PriceCurrency | null) ?? null,
        retailPrice: retail ? Number(p.price_retail) : null,
        retailCurrency: retail ? ((p.base_currency_retail as PriceCurrency | null) ?? null) : null,
        wholesalePrice: wholesale ? Number(p.price_wholesale) : null,
        wholesaleCurrency: wholesale ? ((p.base_currency_wholesale as PriceCurrency | null) ?? null) : null,
        cost: p.cost == null ? null : Number(p.cost),
        costCurrency: (p.cost_currency as string | null) ?? null,
      };
    }),
    categories: (categories ?? []) as { id: string; name: string }[],
  };
}
