import { createClient } from "@/lib/supabase/server";
import { ScreenHeader } from "@/components/dashboard/screen-header";
import { CatalogTable } from "@/components/dashboard/catalog-table";
import { CatalogShareButton, CatalogMenu } from "@/components/dashboard/catalog-share";
import {
  CatalogFilterProvider,
  CatalogSearchField,
  CatalogFilterChips,
} from "@/components/dashboard/catalog-filters";
import { readOwnerCountry } from "@/lib/owner-country";
import { getOwnerRateContext } from "@/lib/exchange-rate/owner-rate";
import {
  getBolivarRates,
  isPublished,
  PRODUCT_COLUMNS,
  type ProductRow,
  type PriceOverrideRow,
  type ProductCurrencyRow,
} from "@/lib/products/catalog";
import type { BolivarRates, CostCurrency, PriceCurrency } from "@/lib/products/price";

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
    { data: currencies },
    { data: ultimoProducto },
    { data: owner },
    { data: catalogLink },
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
      supabase.from("product_currencies").select("product_id, currency"),
      // LAS DOS MONEDAS DEL ÚLTIMO PRODUCTO QUE CREÓ ESTE NEGOCIO.
      //
      // Decisión del dueño el 2026-10-14: «las monedas en la opción de costo y
      // en la sección de precio aparecerán por defecto según el último
      // producto creado». Si el último lo creó con el costo en USDT y el
      // precio en euros, eso es lo que abre el siguiente.
      //
      // DESPLAZA LO QUE ÉL MISMO DECIDIÓ ESE MISMO DÍA unas horas antes, que
      // era «siempre dólares» (y pesos en Colombia). La razón de entonces
      // queda escrita porque es la que haría falta para revertir esto: el
      // dólar es la moneda en que se piensa el precio en Venezuela, y arrancar
      // en otra porque UNA vez se compró en euros convierte un caso raro en el
      // valor por defecto de todos los productos siguientes. Lo que la
      // desplaza es que un tendero que compra en USDT lo hace SIEMPRE, no una
      // vez, y entonces el caso raro es el dólar.
      //
      // `created_at` y no `updated_at`, que es lo que la versión anterior de
      // esta consulta usaba: el dueño dijo «el último producto CREADO», y son
      // preguntas distintas — corregirle el precio a un producto de hace tres
      // meses no dice nada sobre en qué moneda compra hoy.
      //
      // SALE DE SU PROPIO HISTORIAL Y NO DEL NAVEGADOR, a propósito: iOS
      // Safari borra `localStorage` tras un tiempo de inactividad, y entonces
      // la ficha «olvidaría» lo que el tendero lleva meses haciendo. Es la
      // regla de CLAUDE.md sobre no apoyarse en el navegador para nada que
      // importe, y el mismo criterio que `moneda-habitual.ts`.
      supabase
        .from("products")
        .select("cost_currency, base_currency")
        .eq("owner_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from("owners").select("business_name").eq("id", user!.id).maybeSingle(),
      // EL ENLACE QUE YA TIENE, LEIDO SIN CREARLO. Las dos razones son
      // distintas y las dos importan:
      //
      //   1. Un token acunado por el solo hecho de abrir esta pantalla
      //      pondria a los 24 negocios a una URL de distancia de un catalogo
      //      que nunca decidieron publicar. Por eso aqui se LEE; crear es
      //      cosa del primer «Compartir».
      //   2. `navigator.share` quiere salir del gesto del dedo. Con el token
      //      ya servido no hay ningun `await` entre el toque y la hoja, que
      //      es lo que iOS Safari puede rechazar.
      supabase
        .from("catalog_share_links")
        .select("token")
        .eq("owner_id", user!.id)
        .maybeSingle(),
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

  // LOS PROVEEDORES SALEN DE LAS FILAS QUE YA SE LEYERON, y eso es lo que hace
  // que el autocompletado del formulario no cueste ni una consulta: esta
  // pantalla trae TODOS los productos del dueño, sin paginar y sin filtrar en
  // el servidor —el buscador filtra en el navegador— así que la lista completa
  // de proveedores ya está en memoria.
  //
  // La primera versión de la migración 103 traía una función de Postgres para
  // esto. Se quitó antes de usarla, al mirar esta línea: habría sido una
  // SECURITY DEFINER que nadie llama, la misma trampa que la 092 documentó
  // para los valores de enum.
  //
  // Duplicados y mayúsculas los resuelve `SupplierField`, que es quien sabe
  // cómo quiere la lista. Aquí solo se quitan los vacíos.
  const supplierSuggestions = rows.map((p) => p.supplier ?? "").filter((s) => s.trim() !== "");
  // Se cuenta aquí y no en el diálogo de compartir: ese es un componente de
  // cliente y tendría que pedir la lista otra vez para saber un número que
  // esta consulta ya trajo.
  const publishedCount = {
    retail: rows.filter((p) => p.published_retail).length,
    wholesale: rows.filter((p) => p.published_wholesale).length,
    any: rows.filter(isPublished).length,
  };

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
            <CatalogShareButton
              publishedCount={publishedCount}
              businessName={owner?.business_name || "mi negocio"}
              initialToken={catalogLink?.token ?? null}
            />
          }
          /* EL «⋮» VA ARRIBA, a la altura del botón de volver, y «Compartir»
             se queda junto al título. Decisión del dueño el 2026-10-15: dos
             alturas a propósito — compartir es la acción de cada día y va
             donde cae la vista; el menú es la ocasional y va apartada. */
          topAction={<CatalogMenu initialToken={catalogLink?.token ?? null} />}
          search={<CatalogSearchField />}
          filters={<CatalogFilterChips />}
        />
        <CatalogTable
          loadFailed={productsError != null}
          overrides={(overrides ?? []) as PriceOverrideRow[]}
          currencies={(currencies ?? []) as ProductCurrencyRow[]}
          supplierSuggestions={supplierSuggestions}
          lastCostCurrency={(ultimoProducto?.cost_currency as CostCurrency | null) ?? null}
          lastBaseCurrency={(ultimoProducto?.base_currency as PriceCurrency | null) ?? null}
          rates={rates}
          defaultCurrency={defaultCurrency}
          ownerId={user!.id}
          autoOpen={nuevo === "1"}
        />
      </CatalogFilterProvider>
    </div>
  );
}
