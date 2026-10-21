import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CatalogShareButton, type PublishedCount } from "@/components/dashboard/catalog-share";
import { EmptyState } from "@/components/dashboard/empty-state";

// LA SECCIÓN DE PEDIDOS CUANDO NO HAY NINGUNO — frame `1467:9437`, pedido del
// dueño el 2026-10-19.
//
// ===========================================================================
// LO QUE CAMBIA NO ES EL TEXTO, SON LOS DOS BOTONES
//
// Antes era una frase en un recuadro a puntos: «Todavía no te ha llegado
// ningún pedido por el catálogo. Cuando alguien pida desde tu enlace, aparece
// aquí.» Describía el estado y no ofrecía nada, así que un tendero que llega
// aquí el primer día lee que tiene que esperar — cuando lo cierto es que
// todavía no ha hecho las dos cosas de las que depende que llegue un pedido.
//
// Las dos están en el frame y en ese orden: compartir el catálogo primero,
// porque sin enlace repartido no hay pedido posible ni habiendo cien
// productos; crear un producto después.
//
// ===========================================================================
// «COMPARTIR CATÁLOGO» ES EL MISMO BOTÓN DE LA CABECERA, NO UNA COPIA
//
// `CatalogShareButton` lleva dentro lo que de verdad cuesta: crear el enlace
// si el negocio todavía no tiene, el aviso de «no has publicado ningún
// producto» —sin el cual se mandaría el enlace de una página vacía— y el
// `navigator.share` sin `await` por delante, que es lo que iOS exige. Una
// segunda copia de eso aquí acabaría divergiendo justo en el caso raro.
//
// Lo único que cambia es el aspecto, y por eso ese componente admite ahora una
// variante en vez de llevar su estilo escrito a fuego.
export function OrdersEmpty({
  publishedCount,
  businessName,
  initialToken,
}: {
  publishedCount: PublishedCount;
  businessName: string;
  initialToken: string | null;
}) {
  return (
    <EmptyState
      title="Aún no tienes pedidos realizados"
      subtitle="Crea un nuevo producto en tu catálogo y/o comparte tu catálogo con tus clientes para que realicen sus pedidos vía WhatsApp."
    >
      <>
        <CatalogShareButton
          publishedCount={publishedCount}
          businessName={businessName}
          initialToken={initialToken}
          variante="relleno"
          etiqueta="Compartir catálogo"
        />
        {/* «CREAR PRODUCTO» VA AL MISMO FLUJO QUE TODO LO DEMÁS: desde el
            2026-10-20 el alta es una pantalla de cuatro pasos y no un
            diálogo, así que esto es un enlace a su ruta. No hay una segunda
            forma de crear un producto y no la va a haber por esta puerta. */}
        <Button asChild variant="outline" className="h-10 w-full text-base font-semibold">
          <Link href="/productos/nuevo">
            <Plus className="size-5" aria-hidden="true" />
            Crear producto
          </Link>
        </Button>
      </>
    </EmptyState>
  );
}
