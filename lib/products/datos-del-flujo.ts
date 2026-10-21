import type { SupabaseClient } from "@supabase/supabase-js";
import { PRODUCT_COLUMNS, getBolivarRates, currenciesOf, overridesByTier } from "@/lib/products/catalog";
import { readOwnerCountry } from "@/lib/owner-country";
import { getOwnerRateContext } from "@/lib/exchange-rate/owner-rate";
import type { ProductRow } from "@/lib/products/catalog";
import type { BolivarRates, CostCurrency, PriceCurrency, PriceTier } from "@/lib/products/price";

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
  lastCostCurrency: CostCurrency | null;
  lastBaseCurrency: PriceCurrency | null;
};

export async function cargarDatosDelFlujo(
  supabase: SupabaseClient,
  ownerId: string,
): Promise<DatosDelFlujo> {
  const [{ data: products }, { data: ultimoProducto }, country, rateContext] = await Promise.all([
    supabase
      .from("products")
      .select("supplier")
      .eq("owner_id", ownerId)
      .is("trashed_at", null),
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
  ]);

  return {
    rates: rateContext ? await getBolivarRates(rateContext.effectiveRate) : null,
    defaultCurrency: country === "CO" ? "COP" : "USD",
    supplierSuggestions: ((products ?? []) as { supplier: string | null }[])
      .map((p) => p.supplier ?? "")
      .filter((s) => s.trim() !== ""),
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
} | null> {
  const [{ data: product }, { data: overrides }, { data: currencies }] = await Promise.all([
    supabase
      .from("products")
      .select(PRODUCT_COLUMNS)
      .eq("id", productId)
      // LA PROPIEDAD, EN CÓDIGO Y NO SOLO POR RLS. Es la regla de `CLAUDE.md`
      // para toda fila que se toca por un id que viene del navegador.
      .eq("owner_id", ownerId)
      .is("trashed_at", null)
      .maybeSingle(),
    supabase.from("product_price_overrides").select("product_id, tier, currency, amount"),
    supabase.from("product_currencies").select("product_id, tier, currency"),
  ]);

  if (!product) return null;
  const fila = product as unknown as ProductRow;

  return {
    product: fila,
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
