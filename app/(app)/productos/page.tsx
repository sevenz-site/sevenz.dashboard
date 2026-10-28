import { OrdersCard } from "@/components/dashboard/orders-card";
import { createClient } from "@/lib/supabase/server";
import { countUnregisteredOrders } from "@/lib/orders/catalog-orders";
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
// EL `?nuevo=1` SE FUE EL 2026-10-20. Lo ponía el botón flotante de la barra
// para abrir el diálogo de alta sin sacar su estado de esta pantalla. Con el
// alta en su propia ruta (`/productos/nuevo`), ese botón simplemente navega.
export default async function ProductosPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [
    { data: products, error: productsError },
    { data: owner },
    { data: catalogLink },
    country,
    rateContext,
    ordenesSinAtender,
  ] = await Promise.all([
      supabase
        .from("products")
        .select(PRODUCT_COLUMNS)
        .eq("owner_id", user!.id)
        .is("trashed_at", null)
        .order("name"),
      // AQUÍ IBAN TRES CONSULTAS MÁS --los precios fijados, las monedas
      // activas y el último producto creado-- que esta pantalla NO usa: eran
      // para los dos diálogos que montaba. Desde el 2026-10-20 el alta y la
      // edición son rutas propias y cada una pide lo suyo, así que el
      // catálogo hace tres viajes menos por carga.
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
      // IN THE SAME ROUND TRIP as everything else this screen needs. It is a
      // `head: true` count, so it costs a plan and no rows.
      countUnregisteredOrders(supabase, user!.id),
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
        {/* THE ORDERS SECTION, inside Catálogo -- the owner's decision of
            2026-10-16 (CT-71), which asked for BOTH surfaces: the bell and a
            section of its own here.

            IT IS SHOWN EVEN AT ZERO, on purpose. Hiding it when empty would
            mean the one screen that answers "has anybody ordered?" only
            exists once somebody has, so a shopkeeper wondering could never
            check. Same reasoning as DESIGN-SYSTEM.md's rule for empty values:
            keep the row, say it is empty. */}
        {/* The card itself is `OrdersCard`, shared with Inicio -- the
            gradient is built from two theme tokens and a second hand-written
            copy of it is a copy that drifts. */}
        <OrdersCard unattended={ordenesSinAtender} />
        {/* SOLO `loadFailed`. Las otras ocho props existían para los dos
            diálogos que esta tabla montaba; desde el 2026-10-20 el alta y la
            edición son rutas propias y cada una pide sus datos. */}
        <CatalogTable
                loadFailed={productsError != null}
                businessName={owner?.business_name || "mi negocio"}
                catalogToken={catalogLink?.token ?? null}
              />
      </CatalogFilterProvider>
    </div>
  );
}
