import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { ImageOff } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getBolivarRates } from "@/lib/products/catalog";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  getProductPreviewImageUrl,
  getPublicProductPhotoUrl,
} from "@/lib/supabase/storage";
import { ProductDetail } from "@/components/public/product-detail";
import type { BolivarRates, PriceCurrency } from "@/lib/products/price";
import { bloqueDesdeRpc, type BloqueCrudo } from "@/lib/products/public-pricing";
import { ScreenTitle } from "@/components/dashboard/screen-chrome";
import { IconoVolver } from "@/components/dashboard/screen-chrome";

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
// CON `generateMetadata` DESDE EL 2026-10-27, Y ESO DESHACE LO QUE DECÍA AQUÍ
//
// Lo que había escrito, y queda porque es la razón que haría falta para
// revertirlo: *«SIN `generateMetadata` A PROPÓSITO. La página de la lista sí
// la tiene. Aquí no, y no es un olvido: el nombre y la foto de un producto en
// la vista previa de un enlace de WhatsApp le dirían a cualquiera que lo
// reenvíe qué vende ese negocio y a cómo. El enlace circula precisamente para
// eso, pero quien lo reenvía debería estar eligiendo hacerlo, no descubrirlo
// porque la miniatura ya lo contaba»*.
//
// LO QUE CAMBIÓ ES LA PREMISA, NO EL RIESGO. Ese día el enlace de un producto
// solo circulaba de rebote. El 2026-10-27 el dueño encargó un botón
// «Compartir» en el detalle y en cada tarjeta, con su frame de la vista previa
// (`1732:14757`): ahora el tendero ELIGE mandarlo, que es exactamente lo que
// el párrafo de arriba pedía.
//
// Y LA MITAD DEL MIEDO VIEJO SIGUE CUBIERTA: el frame no dibuja ningún precio.
// «Qué vende» pasa a verse; «a cómo» no.
//
// `robots: noindex` SE QUEDA. Compartir por WhatsApp y salir en Google son dos
// cosas distintas, y los rastreadores de los chats no miran esa etiqueta.
//
// LA IMAGEN la genera `opengraph-image.tsx`, al lado de este fichero.

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string; productId: string }>;
}): Promise<Metadata> {
  const { token, productId } = await params;

  // UN FALLO AQUÍ NO TUMBA LA PÁGINA: se devuelven los metadatos genéricos y
  // el producto se abre igual. Una vista previa pobre es un inconveniente; una
  // página que no carga por su `<head>` es un enlace roto.
  const generico: Metadata = {
    title: "Producto — Sevenz",
    robots: { index: false, follow: false },
  };
  if (!isSupabaseConfigured()) return generico;

  try {
    const supabase = await createClient();
    const { data } = await supabase.rpc("get_shared_product", {
      p_token: token,
      p_product_id: productId,
    });
    const d = data as {
      name?: string;
      description?: string | null;
      photo_path?: string | null;
    } | null;
    if (!d?.name) return generico;

    // ── LA IMAGEN ES LA FOTO, SERVIDA POR SUPABASE ───────────────────
    //
    // Y no una imagen generada, que es lo que había y lo que falló: pesaba
    // 1,6 MB y WhatsApp la descartaba. El porqué entero está en
    // `getProductPreviewImageUrl`.
    //
    // SIN FOTO, LA TARJETA DE LA MARCA. Un producto sin foto es el caso
    // corriente, y un enlace cuya vista previa es un hueco parece un enlace
    // roto. `/og.png` es la misma que enseñan el catálogo y el saldo.
    const imagen = d.photo_path
      ? getProductPreviewImageUrl(d.photo_path)
      : "/og.png";

    // EL TEXTO DEL FRAME, repartido donde el chat lo pinta: el nombre arriba,
    // la descripción debajo, y la línea de Sevenz como nombre del sitio.
    //
    // SIN PRECIO, que es la mitad de la decisión vieja que se conserva.
    //
    // `?? null` Y NO `?? undefined`, y la diferencia se vio en una captura:
    // `undefined` deja que Next herede la descripción del layout raíz, así
    // que un producto SIN descripción salía en WhatsApp anunciando *«¡Lleva
    // las cuentas claras de tu negocio sin tanta vaina!»* debajo de su
    // nombre -- la frase de la marca presentada como si describiera el
    // bafle. `null` dice «esta página no tiene descripción» y no hereda nada.
    const descripcion = d.description?.trim() || null;

    return {
      title: `${d.name} — Sevenz`,
      description: descripcion,
      robots: { index: false, follow: false },
      openGraph: {
        title: d.name,
        // `undefined` AQUI y `null` arriba, y no es incoherencia: dentro de
        // `openGraph` el tipo no admite `null`, y no hace falta -- este bloque
        // REEMPLAZA entero al del layout, asi que lo que no se declara no se
        // emite. Arriba si hace falta, porque `description` a secas sí hereda.
        description: descripcion ?? undefined,
        siteName: "Sevenz.site ¡Cuentas claras sin tanta vaina!",
        locale: "es_VE",
        type: "website",
        images: [{ url: imagen, width: 1200, height: 630, alt: d.name }],
      },
      // ── `twitter` TAMBIÉN, Y NO ES REDUNDANTE ──────────────────────
      //
      // `app/layout.tsx` declara un bloque `twitter` global con el título de
      // la marca y `/og.png`. Los metadatos se heredan POR CLAVE: definir
      // solo `openGraph` deja intacto el `twitter` del layout, y WhatsApp
      // --que lee los dos-- enseñaba el logo de Sevenz sobre un producto con
      // foto. Reportado por el dueño el 2026-10-27 con la captura.
      twitter: {
        card: "summary_large_image",
        title: d.name,
        description: descripcion ?? undefined,
        images: [imagen],
      },
    };
  } catch (error) {
    console.error(
      "[productoPublico] metadata:",
      error instanceof Error ? error.message : error,
    );
    return generico;
  }
}

type SharedProductDetail = {
  business_name: string | null;
  owner_country: string | null;
  // `tier` ESTABA AQUI Y LA FUNCION NUNCA LA MANDO, igual que `description` en
  // la tarjeta. Quitada el 2026-10-16 sin reemplazo porque nadie la usaba: lo
  // que se arreglo ese dia es la hermana, que si la leia. La razon larga esta
  // en `app/c/[token]/page.tsx`; aqui basta con no volver a declarar un campo
  // que no llega, porque este tipo se escribe a mano y nada lo contrasta.
  id: string;
  name: string;
  unit: string | null;
  description: string | null;
  photo_path: string | null;
  // The product's default currency. Since migration 114 each tier carries its
  // own inside its block, and THAT is the one that prices it.
  base_currency: PriceCurrency;
  stock: number | null;
  wholesale_min_quantity: number | null;
  retail: BloqueCrudo | null;
  wholesale: BloqueCrudo | null;
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
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-4 px-4 py-10 text-center">
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
  searchParams,
}: {
  params: Promise<{ token: string; productId: string }>;
  // `?previa=1` LO TRAE LA TARJETA del catálogo cuando el tendero está
  // mirando su propia vista previa. Añadido el 2026-10-17 al cerrar `CT-95`.
  //
  // Se lee en el SERVIDOR y no en el navegador a propósito: de ello depende
  // que «Agregar» exista o no, y resolverlo en el cliente pintaría el botón
  // un instante antes de quitarlo — un parpadeo sobre un control que el
  // tendero no debe poder tocar.
  searchParams: Promise<{ previa?: string }>;
}) {
  const { token, productId } = await params;
  const { previa } = await searchParams;
  const esVistaPrevia = previa === "1";
  const volverAlCatalogo = esVistaPrevia ? `/c/${token}?previa=1` : `/c/${token}`;

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
  // THE USDT RATE NOW REACHES THE PUBLIC CATALOGUE TOO. Owner's decision on
  // 2026-10-15, which displaces the one of 2026-10-10 that kept third-party
  // calls off public pages.
  //
  // What displaced it is a measurement, not a change of mind: the call sits
  // behind a 60-second server cache and a 2-second timeout, so a thousand
  // visitors in a minute cost ONE request to CriptoYa, not a thousand. The
  // 2026-10-10 reasoning assumed one call per load.
  //
  // AND IT IS THE SAME CALL THE SHOPKEEPER'S OWN PRODUCT FORM MAKES, which
  // closes a gap that had nothing to do with cost: until now the shopkeeper
  // saw a USDT price on their product and their customer did not.
  //
  // It also writes the price down for `create_catalog_order` to read -- see
  // migrations 112 and 113. That is what keeps what is OFFERED and what is
  // ACCEPTED the same set; offering USDT without it would let the customer
  // fill in the whole form and then be rejected with `sin_tasa`.
  const tasaBase =
    detalle.owner_country === "VE" &&
    detalle.current_bcv_usd != null &&
    detalle.current_bcv_eur != null
      ? detalle.rate_mode === "CUSTOM" && detalle.custom_rate_usd && detalle.custom_rate_eur
        ? { usd: detalle.custom_rate_usd, eur: detalle.custom_rate_eur }
        : { usd: detalle.current_bcv_usd, eur: detalle.current_bcv_eur }
      : null;
  const rates: BolivarRates | null = tasaBase ? await getBolivarRates(tasaBase) : null;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col">
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
          href={volverAlCatalogo}
          aria-label="Volver al catálogo"
          className="absolute top-4 left-4 flex size-10 items-center justify-center rounded-full bg-background/90 shadow-sm backdrop-blur transition-colors hover:bg-background"
        >
          <IconoVolver className="text-primary" />
        </Link>
      </div>

      {/* `pb-0`: la fila de abajo de `ProductDetail` trae sus propios 40px
          desde el 2026-10-25. Los 20 de `py-5` encima dejarían el botón a 60
          del filo, no a 40 — el mismo descuadre que la hoja del tendero.
          Petición del dueño, y él mismo pidió ajustarlo «también en el
          carrito». */}
      <div className="flex flex-col gap-4 px-4 pt-5 pb-0">
        <div className="flex flex-col gap-1">
          <ScreenTitle>{detalle.name}</ScreenTitle>
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
          // EACH TIER ARRIVES WITH ITS OWN BASE AND ITS OWN LIST (114), so
          // the screen no longer takes a product-level base at all.
          // `bloqueDesdeRpc` holds the fallback for the window where this code
          // is deployed and 114 has not run yet.
          producto={{
            retail: bloqueDesdeRpc(detalle.retail, detalle.base_currency),
            wholesale: bloqueDesdeRpc(detalle.wholesale, detalle.base_currency),
            wholesale_min_quantity: detalle.wholesale_min_quantity,
          }}
          rates={rates}
          stock={detalle.stock}
          /* EN LA VISTA PREVIA EL TENDERO SOLO MIRA. Decisión del dueño el
             2026-10-17: «el dueño solo puede ver la pantalla del listado de
             productos y detalle de producto, el resto del flujo no». */
          isPreview={esVistaPrevia}
          volverAlCatalogo={volverAlCatalogo}
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
