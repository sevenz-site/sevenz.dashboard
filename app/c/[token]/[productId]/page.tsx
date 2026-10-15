import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { ChevronLeft, ImageOff } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getPublicProductPhotoUrl } from "@/lib/supabase/storage";
import { ProductDetail } from "@/components/public/product-detail";
import type { BolivarRates, PriceCurrency } from "@/lib/products/price";
import type { BloquePrecio } from "@/lib/products/public-pricing";

// EL DETALLE DE UN PRODUCTO EN EL CATÁLOGO PÚBLICO. Entregable B del frame
// 1192:4185, pantalla `1190:5833`.
//
// ===========================================================================
// UNA RUTA PROPIA Y NO UNA HOJA DENTRO DE LA LISTA
//
// Tres razones, y la tercera es la que decide:
//
//   1. El botón «atrás» del teléfono funciona solo. En una hoja hay que
//      interceptarlo, y si no se intercepta bien, atrás saca al cliente del
//      catálogo entero en vez de devolverlo a la lista.
//   2. El enlace de un producto se puede mandar por WhatsApp tal cual.
//   3. El carrito (entregable C) necesita volver aquí desde otra pantalla, y
//      una hoja no tiene a dónde volver.
//
// ===========================================================================
// SIN `generateMetadata` A PROPÓSITO
//
// La página de la lista sí la tiene. Aquí no, y no es un olvido: el nombre y
// la foto de un producto en la vista previa de un enlace de WhatsApp le dirían
// a cualquiera que lo reenvíe qué vende ese negocio y a cómo. El enlace circula
// precisamente para eso, pero quien lo reenvía debería estar eligiendo hacerlo,
// no descubrirlo porque la miniatura ya lo contaba.

export const metadata: Metadata = {
  title: "Producto — Sevenz",
  robots: { index: false, follow: false },
};

type SharedProductDetail = {
  business_name: string | null;
  owner_country: string | null;
  tier: "retail" | "wholesale";
  id: string;
  name: string;
  unit: string | null;
  description: string | null;
  photo_path: string | null;
  base_currency: PriceCurrency;
  // The product's enabled currencies (`product_currencies`, migration 087).
  // `get_shared_product` exposes them as of migration 111.
  currencies: PriceCurrency[] | null;
  stock: number | null;
  wholesale_min_quantity: number | null;
  retail: BloquePrecio | null;
  wholesale: BloquePrecio | null;
  rate_mode: string | null;
  current_bcv_usd: number | null;
  current_bcv_eur: number | null;
  custom_rate_usd: number | null;
  custom_rate_eur: number | null;
};

// LA MISMA PANTALLA PARA «NO EXISTE» Y PARA «NO ESTÁ PUBLICADO», igual que en
// la lista: quien pruebe identificadores al azar no aprende nada de la
// diferencia.
function NoDisponible({ token }: { token: string }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-4 py-10 text-center">
      <Image src="/fav-icon-primary.svg" alt="Sevenz" width={48} height={48} className="size-12" />
      <h1 className="text-xl font-semibold">Este producto ya no está</h1>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Puede que el negocio lo haya quitado del catálogo.
      </p>
      <Link href={`/c/${token}`} className="text-sm font-medium underline underline-offset-4">
        Ver el catálogo
      </Link>
    </main>
  );
}

export default async function ProductoPublicoPage({
  params,
}: {
  params: Promise<{ token: string; productId: string }>;
}) {
  const { token, productId } = await params;

  if (!isSupabaseConfigured()) return <NoDisponible token={token} />;

  const supabase = await createClient();

  // ERRORES ENMASCARADOS, la regla de CLAUDE.md para todo lo que se puede
  // llamar sin sesión. Y el `try` no devuelve JSX, por lo mismo que la lista:
  // construir el árbol dentro de un try hace que un error de renderizado lo
  // atrape este catch en vez de la frontera de error que le toca.
  const detalle = await (async (): Promise<SharedProductDetail | null> => {
    try {
      const { data, error } = await supabase.rpc("get_shared_product", {
        p_token: token,
        p_product_id: productId,
      });
      if (error) {
        console.error("[productoPublico] rpc:", error.message);
        return null;
      }
      return data as SharedProductDetail | null;
    } catch (error) {
      console.error("[productoPublico] threw:", error instanceof Error ? error.message : error);
      return null;
    }
  })();

  if (!detalle) return <NoDisponible token={token} />;

  // Las mismas tasas que la lista, y por el mismo camino: la del tendero si la
  // fijó, la del BCV si no, y ninguna fuera de Venezuela.
  const rates: BolivarRates | null =
    detalle.owner_country === "VE" &&
    detalle.current_bcv_usd != null &&
    detalle.current_bcv_eur != null
      ? detalle.rate_mode === "CUSTOM" && detalle.custom_rate_usd && detalle.custom_rate_eur
        ? { usd: detalle.custom_rate_usd, eur: detalle.custom_rate_eur, usdt: null }
        : { usd: detalle.current_bcv_usd, eur: detalle.current_bcv_eur, usdt: null }
      : null;

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col">
      {/* LA FOTO A SANGRE Y EL CHEVRON ENCIMA, como el frame. El botón vuelve
          a la lista con un Link y no con `history.back()`: si alguien abrió
          este enlace directo —que es para lo que existe la ruta— no hay
          historial al que volver, y el botón no haría nada. */}
      <div className="relative aspect-square w-full bg-muted">
        {detalle.photo_path ? (
          <Image
            src={getPublicProductPhotoUrl(detalle.photo_path)}
            alt=""
            fill
            unoptimized
            sizes="(min-width: 640px) 640px, 100vw"
            className="object-cover"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <ImageOff className="size-8" aria-hidden="true" />
            <span className="text-xs">Sin foto</span>
          </div>
        )}
        <Link
          href={`/c/${token}`}
          aria-label="Volver al catálogo"
          className="absolute top-4 left-4 flex size-10 items-center justify-center rounded-full bg-background/90 shadow-sm backdrop-blur transition-colors hover:bg-background"
        >
          <ChevronLeft className="size-5" />
        </Link>
      </div>

      <div className="flex flex-col gap-4 px-4 py-5">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{detalle.name}</h1>
          {detalle.unit ? (
            <p className="text-xs text-muted-foreground">{detalle.unit}</p>
          ) : null}
        </div>

        {detalle.description ? (
          <div className="flex flex-col gap-1">
            <p className="text-xs text-muted-foreground">Descripción del producto</p>
            <p className="text-sm leading-relaxed">{detalle.description}</p>
          </div>
        ) : null}

        <ProductDetail
          token={token}
          productId={detalle.id}
          producto={{
            retail: detalle.retail,
            wholesale: detalle.wholesale,
            wholesale_min_quantity: detalle.wholesale_min_quantity,
          }}
          baseCurrency={detalle.base_currency}
          // THE FALLBACK IS THE BASE, not an empty list. If this page were
          // served against a database without migration 111, `currencies`
          // would arrive null and an empty list would leave the product with
          // no currency to choose -- that is, unbuyable. Degrading to "only
          // the shopkeeper's own" is the previous behaviour, which worked.
          currencies={detalle.currencies ?? [detalle.base_currency]}
          rates={rates}
          stock={detalle.stock}
        />

        {/* EL MISMO PIE QUE LA LISTA. Un cliente que llega aquí desde un
            mensaje puede no haber pasado por el catálogo nunca. */}
        <p className="pt-2 text-center text-xs leading-relaxed text-muted-foreground">
          Sevenz no pide códigos ni pagos vía WhatsApp ni a través de llamadas. Pagos y abonos
          deben hacerse directamente con el dueño del comercio.
        </p>
      </div>
    </main>
  );
}
