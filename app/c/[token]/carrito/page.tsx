import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { CartScreen } from "@/components/public/cart-screen";
import type { CatalogStripProduct } from "@/components/public/catalog-strip";

// «TU CARRITO», del frame `1190:5793`.
//
// UNA RUTA Y NO UNA HOJA, por lo mismo que el detalle: el «atrás» del teléfono
// funciona solo, y el formulario de la orden necesita volver aquí si algo
// falla.
//
// LA PÁGINA ES UNA CÁSCARA, y eso es deliberado. El carrito vive en el
// navegador, así que el servidor no sabe qué hay dentro: no puede rendir ni
// una línea. Lo único que aporta es el `<main>`, el título y el pie
// antifraude; el resto lo monta el cliente leyendo `localStorage` y pidiendo
// los productos con `get_shared_products`.
//
// SIN `generateMetadata` y SIN INDEXAR, igual que el detalle: la vista previa
// de un enlace reenviado no tiene por qué contar lo que alguien está a punto
// de comprar.
export const metadata: Metadata = {
  title: "Tu carrito — Sevenz",
  robots: { index: false, follow: false },
};

export default async function CarritoPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  if (!isSupabaseConfigured())
    return (
      <CartScreen
        token={token}
        businessName=""
        ownerWhatsapp={null}
        ownerCountry={null}
      />
    );

  // EL NOMBRE Y EL TELEFONO DEL NEGOCIO, que la pantalla necesita para armar
  // el mensaje de WhatsApp. Salen de `get_shared_catalog` y no de una funcion
  // nueva: ya devuelve los dos y esta pagina solo se abre una vez por pedido.
  //
  // ERRORES ENMASCARADOS, y el `try` no devuelve JSX por lo mismo que en las
  // otras dos publicas: construir el arbol dentro de un try hace que un error
  // de renderizado lo atrape este catch en vez de la frontera que le toca.
  const negocio = await (async (): Promise<{
    nombre: string;
    whatsapp: string | null;
    pais: string | null;
    // EL CATÁLOGO, para el carrusel «Otros productos» del comprobante
    // (encargo del dueño, 2026-10-17). Sale de la MISMA llamada que ya se
    // hacía aquí: `get_shared_catalog` devuelve los productos de todas
    // formas, así que esto no cuesta ni una consulta más.
    productos: CatalogStripProduct[];
  }> => {
    try {
      const supabase = await createClient();
      const { data, error } = await supabase.rpc("get_shared_catalog", {
        p_token: token,
      });
      if (error) {
        console.error("[carrito] rpc:", error.message);
        return { nombre: "", whatsapp: null, pais: null, productos: [] };
      }
      const shared = data as {
        business_name: string | null;
        owner_whatsapp: string | null;
        owner_country: string | null;
        products: CatalogStripProduct[] | null;
      } | null;
      return {
        nombre: shared?.business_name ?? "",
        whatsapp: shared?.owner_whatsapp ?? null,
        pais: shared?.owner_country ?? null,
        // OCHO, el mismo tope que la franja del saldo. Un carrusel es una
        // invitación, no un catálogo; «Ver todo» es para el resto.
        productos: (shared?.products ?? []).slice(0, 8),
      };
    } catch (error) {
      console.error(
        "[carrito] threw:",
        error instanceof Error ? error.message : error,
      );
      return { nombre: "", whatsapp: null, pais: null, productos: [] };
    }
  })();

  return (
    <CartScreen
      token={token}
      businessName={negocio.nombre}
      ownerWhatsapp={negocio.whatsapp}
      ownerCountry={negocio.pais}
      relacionados={negocio.productos}
    />
  );
}
