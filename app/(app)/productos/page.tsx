import { createClient } from "@/lib/supabase/server";
import { ScreenHeader } from "@/components/dashboard/screen-header";
import { CatalogTable } from "@/components/dashboard/catalog-table";
import { readOwnerCountry } from "@/lib/owner-country";
import { getOwnerRateContext } from "@/lib/exchange-rate/owner-rate";
import { getBolivarRates, type ProductRow, type PriceOverrideRow } from "@/lib/products/catalog";
import type { BolivarRates, PriceCurrency } from "@/lib/products/price";

// EL CATÁLOGO. Primera pantalla de la etapa 1 de inventario.
//
// ─────────────────────────────────────────────────────────────────────────
// NACE VACÍO, Y ESO ES EL DISEÑO
//
// Los dos tenderos entrevistados el 2026-10-09 dijeron, con esas palabras, que
// NO llevan inventario. Si esta pantalla abriera pidiendo «carga tus
// productos», ninguno de los dos pasaría de ahí: uno ya tiene un sistema que
// le funciona —mirar— y nadie lo cambia por uno que empieza con dos horas de
// trabajo.
//
// Así que el estado vacío no se disculpa ni empuja: dice que se llena solo
// según vaya fiando y vendiendo, que es la decisión 5 del dueño hecha pantalla.
export default async function ProductosPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: products }, { data: overrides }, country, rateContext] = await Promise.all([
    supabase
      .from("products")
      .select("id, name, unit, base_currency, price_retail, price_wholesale, cost, margin_pct")
      .eq("owner_id", user!.id)
      .is("trashed_at", null)
      .order("name"),
    supabase
      .from("product_price_overrides")
      .select("product_id, tier, currency, amount"),
    readOwnerCountry(supabase, user!.id),
    getOwnerRateContext(supabase, user!.id),
  ]);

  // Las equivalencias solo existen donde hay tasas. Un negocio colombiano
  // cobra en pesos y no tiene Bs/COP, así que su ficha enseña un precio y ya
  // — ver la cabecera de lib/products/price.ts.
  const rates: BolivarRates | null = rateContext
    ? await getBolivarRates(rateContext.effectiveRate)
    : null;

  // La moneda en la que un producto nuevo nace. Un negocio colombiano cobra en
  // pesos; uno venezolano, en la moneda de su libro. No se pregunta en el
  // formulario rápido: una decisión menos entre el tendero y guardar.
  const defaultCurrency: PriceCurrency = country === "CO" ? "COP" : "USD";

  return (
    <div className="flex flex-col gap-4">
      <ScreenHeader
        title="Catálogo"
        subtitle="Lo que vendes, con su precio"
        search={null}
        filters={null}
      />
      <CatalogTable
        products={(products ?? []) as ProductRow[]}
        overrides={(overrides ?? []) as PriceOverrideRow[]}
        rates={rates}
        defaultCurrency={defaultCurrency}
      />
    </div>
  );
}
