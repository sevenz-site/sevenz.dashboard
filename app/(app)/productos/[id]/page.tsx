import { notFound, redirect } from "next/navigation";
import { ownerPreviewPriceInput, previewPriceLine } from "@/lib/products/preview-price";
import { getCurrentUser, getRequestClient } from "@/lib/supabase/current-user";
import { DEFAULT_LOW_STOCK_THRESHOLD } from "@/lib/products/availability";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { SetupNotice } from "@/components/setup-notice";
import { ProductDetail } from "@/components/dashboard/product-detail";
import { cargarProductoParaEditar } from "@/lib/products/datos-del-flujo";
import { getOwnerRateContext } from "@/lib/exchange-rate/owner-rate";
import { getBolivarRates } from "@/lib/products/catalog";
import type { BolivarRates } from "@/lib/products/price";

export const metadata = { title: "Producto — Sevenz" };

// LA FICHA DE UN PRODUCTO — frame `1730:14329`, encargo del dueño el
// 2026-10-27.
//
// ES LA PANTALLA A LA QUE AHORA LLEVA LA TARJETA del catálogo, que antes iba
// derecha a `/productos/<id>/editar`. El porqué del cambio --y la anotación
// del frame que decía lo contrario-- está en `product-detail.tsx`.
//
// REUSA EL CARGADOR DE LA EDICIÓN y eso no es pereza: `cargarProductoParaEditar`
// ya trae la comprobación de propiedad EN CÓDIGO (`.eq("owner_id", ...)`, más
// `trashed_at is null`), que es lo que `CLAUDE.md` exige de toda fila que se
// toca por un id venido del navegador. Escribir aquí una segunda consulta sería
// un segundo sitio donde olvidarse de ese `.eq`.
//
// LOS `overrides` SÍ SE USAN desde el 2026-11-15, y este comentario decía lo
// contrario: los precios por moneda «salen de `allPrices` con las tasas, igual que
// el catálogo». Igual que el catálogo no era: el catálogo del cliente sí pasa los
// precios tecleados a `allPrices`, y esta ficha no, así que un producto puesto a
// €10 y $10 a mano enseñaba aquí «$11,07» y al cliente $10,00. Lo encontró el
// dueño con las dos capturas delante: *«el valor escrito a mano es el que manda,
// el app no debe recalcularlo»*. Las `initialCurrencies` siguen sin usarse aquí.
export default async function ProductoPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) return <SetupNotice />;

  const { id } = await params;
  const supabase = await getRequestClient();
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [cargado, { data: owner }, { data: catalogLink }, rateContext] = await Promise.all([
    cargarProductoParaEditar(supabase, user.id, id),
    // `low_stock_threshold` RIDES ALONG with the name instead of taking a
    // query of its own: the chip under the title needs it to know whether
    // this product is running low, and one more column on a row we already
    // fetch costs nothing.
    supabase
      .from("owners")
      .select("business_name, low_stock_threshold")
      .eq("id", user.id)
      .maybeSingle(),
    // EL ENLACE QUE YA TIENE, LEÍDO SIN CREARLO -- misma razón que en
    // `/productos`: acuñar un token por abrir una pantalla pondría al negocio
    // a una URL de distancia de un catálogo que nunca decidió publicar. Crear
    // es cosa del primer «Compartir».
    supabase.from("catalog_share_links").select("token").eq("owner_id", user.id).maybeSingle(),
    // Display only: never waits for the BCV fetch (RefreshWait in ensure-fresh.ts).
    getOwnerRateContext(supabase, user.id, { refresh: "background" }),
  ]);

  // Un producto de otro negocio, o uno en la papelera, no existe para esta
  // pantalla.
  if (!cargado) notFound();

  // Las equivalencias solo existen donde hay tasas. Un negocio colombiano
  // cobra en pesos y su ficha enseña un precio y ya.
  const rates: BolivarRates | null = rateContext
    ? await getBolivarRates(rateContext.effectiveRate)
    : null;

  return (
    <ProductDetail
      product={cargado.product}
      extraPhotos={cargado.extraPhotos}
      overrides={cargado.overrides}
      rates={rates}
      // The price its «Compartir» message carries (owner's request of
      // 2026-11-09), from the same rows the screen already loaded.
      sharePriceLine={previewPriceLine(
        ownerPreviewPriceInput(cargado.product, cargado.overrides, cargado.initialCurrencies, rates),
      )}
      catalogToken={catalogLink?.token ?? null}
      lowStockThreshold={Number(
        owner?.low_stock_threshold ?? DEFAULT_LOW_STOCK_THRESHOLD,
      )}
    />
  );
}
