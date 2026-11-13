import type { SupabaseClient } from "@supabase/supabase-js";
import { PRODUCT_COLUMNS, getBolivarRates, currenciesOf, overridesByTier } from "@/lib/products/catalog";
import { readOwnerCountry } from "@/lib/owner-country";
import { getOwnerRateContext } from "@/lib/exchange-rate/owner-rate";
import type { ProductRow } from "@/lib/products/catalog";
import type { BolivarRates, CostCurrency, PriceCurrency, PriceTier } from "@/lib/products/price";
import type { CategoriaConConteo } from "@/components/dashboard/category-manager";
import { readAllPages } from "@/lib/supabase/read-all";

// LO QUE EL FLUJO DE CREAR O EDITAR UN PRODUCTO NECESITA DEL SERVIDOR.
//
// Vive aquí y no en cada ruta porque son DOS --`/productos/nuevo` y
// `/productos/[id]/editar`-- y la pantalla del catálogo monta el mismo
// formulario con los mismos datos. Tres copias de estas consultas es cómo
// empiezan a divergir: una añade un `order`, otra no, y el formulario abre
// con un valor por defecto distinto según por dónde se entró.
//
// LOS COMENTARIOS LARGOS DE CADA CONSULTA SIGUEN EN `productos/page.tsx`, que
// es donde se escribieron y donde se van a buscar. Aquí se nombra lo que
// cada una es, no por qué.
export type DatosDelFlujo = {
  rates: BolivarRates | null;
  defaultCurrency: PriceCurrency;
  supplierSuggestions: string[];
  // Migration 184, with how many (live) products each one has: the delete
  // confirmation names that number.
  categorias: CategoriaConConteo[];
  lastCostCurrency: CostCurrency | null;
  lastBaseCurrency: PriceCurrency | null;
};

export async function cargarDatosDelFlujo(
  supabase: SupabaseClient,
  ownerId: string,
): Promise<DatosDelFlujo> {
  const [{ data: products }, { data: ultimoProducto }, country, rateContext, { data: categorias }] = await Promise.all([
    // PL-34: every product, not the first 1,000 (lib/supabase/read-all.ts). The supplier
    // suggestions and category counts come from these; a failure reads as none, as when
    // the error was dropped.
    readAllPages<{ supplier: string | null; category_id: string | null }>((from, to) =>
      supabase
        .from("products")
        .select("supplier, category_id", { count: "exact" })
        .eq("owner_id", ownerId)
        .is("trashed_at", null)
        .order("id")
        .range(from, to),
    ).then(
      (data) => ({ data }),
      (e: Error) => {
        console.error("[datos del flujo] productos:", e.message);
        return { data: [] as { supplier: string | null; category_id: string | null }[] };
      },
    ),
    // La moneda del ÚLTIMO producto creado: con ella abre el siguiente.
    // Decisión del dueño el 2026-10-14, explicada entera en `productos/page.tsx`.
    supabase
      .from("products")
      .select("cost_currency, base_currency")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    readOwnerCountry(supabase, ownerId),
    getOwnerRateContext(supabase, ownerId),
    supabase.from("product_categories").select("id, name").eq("owner_id", ownerId),
  ]);

  const porCategoria = new Map<string, number>();
  for (const p of (products ?? []) as { category_id: string | null }[]) {
    if (p.category_id) porCategoria.set(p.category_id, (porCategoria.get(p.category_id) ?? 0) + 1);
  }

  return {
    rates: rateContext ? await getBolivarRates(rateContext.effectiveRate) : null,
    defaultCurrency: country === "CO" ? "COP" : "USD",
    supplierSuggestions: ((products ?? []) as { supplier: string | null }[])
      .map((p) => p.supplier ?? "")
      .filter((s) => s.trim() !== ""),
    categorias: ((categorias ?? []) as { id: string; name: string }[]).map((c) => ({
      ...c,
      productos: porCategoria.get(c.id) ?? 0,
    })),
    lastCostCurrency: (ultimoProducto?.cost_currency as CostCurrency | null) ?? null,
    lastBaseCurrency: (ultimoProducto?.base_currency as PriceCurrency | null) ?? null,
  };
}

// LO QUE SOLO HACE FALTA AL EDITAR: el producto, sus monedas por escalón y sus
// precios fijados. Separado del de arriba porque el alta no lo necesita y una
// pantalla de alta no tiene por qué pagar tres consultas que no usa.
export async function cargarProductoParaEditar(
  supabase: SupabaseClient,
  ownerId: string,
  productId: string,
): Promise<{
  product: ProductRow;
  overrides: Record<PriceTier, Partial<Record<PriceCurrency, number>>>;
  initialCurrencies: Record<PriceTier, PriceCurrency[]>;
  // Photos 2 to 5 in order (CT-171, migration 204). The cover is `product.photo_path`.
  extraPhotos: string[];
} | null> {
  const [{ data: product }, { data: overrides }, { data: currencies }, { data: fotos }] = await Promise.all([
    supabase
      .from("products")
      .select(PRODUCT_COLUMNS)
      .eq("id", productId)
      // LA PROPIEDAD, EN CÓDIGO Y NO SOLO POR RLS. Es la regla de `CLAUDE.md`
      // para toda fila que se toca por un id que viene del navegador.
      .eq("owner_id", ownerId)
      .is("trashed_at", null)
      .maybeSingle(),
    // ONE PRODUCT'S ROWS, since 2026-11-09 (PL-34). Both reads took every row the owner
    // can see and kept this product's in JS: past ~200 products that is over 1,000 rows,
    // the Data API cuts them silently, and the editor would open with this product's
    // pinned prices or enabled currencies missing — and save them that way.
    supabase.from("product_price_overrides").select("product_id, tier, currency, amount").eq("product_id", productId),
    supabase.from("product_currencies").select("product_id, tier, currency").eq("product_id", productId),
    // The owner's own session, so RLS and the grant of 204 are what let this through.
    supabase.from("product_photos").select("path, position").eq("product_id", productId).order("position"),
  ]);

  if (!product) return null;
  const fila = product as unknown as ProductRow;

  return {
    product: fila,
    extraPhotos: ((fotos ?? []) as { path: string }[]).map((f) => f.path),
    overrides: overridesByTier(overrides ?? [], fila.id),
    // UNA LISTA POR ESCALÓN, cada una con SU base primera. Una sola para los
    // dos es lo que hacía que quitar una moneda al mayor la quitara también
    // al detal — reportado por el dueño el 2026-10-15, migración 114.
    initialCurrencies: {
      retail: currenciesOf(currencies ?? [], fila.id, "retail", fila.base_currency_retail),
      wholesale: currenciesOf(currencies ?? [], fila.id, "wholesale", fila.base_currency_wholesale),
    },
  };
}
