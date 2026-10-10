import { createClient } from "@/lib/supabase/server";
import { ScreenHeader } from "@/components/dashboard/screen-header";
import { CatalogTable } from "@/components/dashboard/catalog-table";
import { CatalogShare } from "@/components/dashboard/catalog-share";
import {
  CatalogFilterProvider,
  CatalogSearchField,
  CatalogFilterChips,
} from "@/components/dashboard/catalog-filters";
import { readOwnerCountry } from "@/lib/owner-country";
import { getOwnerRateContext } from "@/lib/exchange-rate/owner-rate";
import {
  getBolivarRates,
  PRODUCT_COLUMNS,
  type ProductRow,
  type PriceOverrideRow,
} from "@/lib/products/catalog";
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
export default async function ProductosPage({
  searchParams,
}: {
  // `?nuevo=1` lo pone el botón flotante de la barra de abajo, igual que en
  // Inicio. Es lo que deja que ese botón sea de `MobileNav` —donde viven las
  // cuatro condiciones que lo esconden— sin tener que mover el estado del
  // diálogo fuera de esta pantalla.
  searchParams: Promise<{ nuevo?: string }>;
}) {
  const { nuevo } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [
    { data: products, error: productsError },
    { data: overrides },
    { data: owner },
    country,
    rateContext,
  ] = await Promise.all([
      supabase
        .from("products")
        .select(PRODUCT_COLUMNS)
        .eq("owner_id", user!.id)
        .is("trashed_at", null)
        .order("name"),
      supabase.from("product_price_overrides").select("product_id, tier, currency, amount"),
      supabase.from("owners").select("business_name").eq("id", user!.id).maybeSingle(),
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

  // UN FALLO DE LECTURA NO PUEDE PARECERSE A «NO TIENES PRODUCTOS».
  //
  // Encontrado rindiendo la pantalla el 2026-10-10, con la 084 todavía sin
  // correr en dev: la consulta fallaba con «column products.published does not
  // exist», `products` llegaba null, y la pantalla pintaba tan tranquila su
  // estado vacío. La petición respondió 200 y no se registró nada.
  //
  // Es el peor de los dos fallos posibles. Un tendero con cuarenta productos
  // vería «Todavía no tienes productos» y lo leería como que se le borró el
  // catálogo — y nosotros, mirando los registros, no veríamos nada raro. Por
  // eso el error se queda en una variable en vez de descartarse al
  // desestructurar, y por eso la pantalla tiene un estado propio para él.
  //
  // El orden de despliegue de CLAUDE.md —migraciones primero— existe para que
  // esto no pase en producción. Esto es el cinturón para el día que pase igual.
  if (productsError) {
    console.error("[productos] no se pudo leer el catálogo:", productsError.message);
  }

  const rows = (products ?? []) as unknown as ProductRow[];
  // Se cuenta aquí y no en el diálogo de compartir: ese es un componente de
  // cliente y tendría que pedir la lista otra vez para saber un número que
  // esta consulta ya trajo.
  const publishedCount = rows.filter((p) => p.published).length;

  return (
    <div className="flex flex-1 flex-col gap-4">
      <CatalogFilterProvider rows={rows} rates={rates} compareCurrency={defaultCurrency}>
        <ScreenHeader
          title="Catálogo"
          /* En plural desde el frame 1175:5881: un producto tiene precio al
             detal y al mayor, y en Venezuela además una equivalencia por
             moneda. «Su precio», en singular, era de cuando solo había uno. */
          subtitle="Lo que vendes, con sus precios"
          action={
            <CatalogShare
              publishedCount={publishedCount}
              businessName={owner?.business_name || "mi negocio"}
            />
          }
          search={<CatalogSearchField />}
          filters={<CatalogFilterChips />}
        />
        <CatalogTable
          loadFailed={productsError != null}
          overrides={(overrides ?? []) as PriceOverrideRow[]}
          rates={rates}
          defaultCurrency={defaultCurrency}
          ownerId={user!.id}
          autoOpen={nuevo === "1"}
        />
      </CatalogFilterProvider>
    </div>
  );
}
