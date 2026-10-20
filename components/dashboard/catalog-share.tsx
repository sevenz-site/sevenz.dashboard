"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, Loader2, MoreVertical, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getOrCreateCatalogLink } from "@/app/(app)/productos/actions";

export type PublishedCount = { retail: number; wholesale: number; any: number };

// COMPARTIR EL CATALOGO.
//
// ===========================================================================
// SIN DIALOGO: UN TOQUE Y LA HOJA DEL TELEFONO
//
// Decision del dueno el 2026-10-15. Habia un dialogo «Comparte tu catalogo»
// con el enlace en un campo, un boton de copiar y uno de compartir. Lo quito
// entero: tocar «Compartir» abre directamente la hoja nativa, igual que
// «Compartir enlace» en el perfil de un cliente.
//
// La razon vieja queda escrita porque es la que haria falta para revertirlo:
// el dialogo existia para ensenar el enlace y dejar copiarlo a mano. Lo que lo
// desplaza es que la hoja nativa ya ofrece copiar, ademas de mandar por
// WhatsApp, y el dialogo era una pantalla de por medio para llegar a lo mismo.
//
// Y antes de eso, hasta el 2026-10-10, el dialogo era ademas el sitio donde se
// decidia QUE catalogo existia, con dos botones «Crear el enlace». Eso se fue
// a la ficha del producto, que es donde vive la decision de publicar.
//
// ===========================================================================
// EL TOKEN LLEGA DEL SERVIDOR, Y SOLO SE ACUNA SI HACE FALTA
//
// `initialToken` es el que el negocio YA tiene, leido sin crear nada. Importa
// por dos cosas distintas:
//
//   1. Un token acunado en el alta pondria a los 24 negocios a una URL de
//      distancia de un catalogo que nunca decidieron publicar. Por eso la
//      pantalla LEE, y solo el primer «Compartir» CREA.
//   2. `navigator.share` quiere salir del gesto del dedo. Con el token ya en
//      la mano no hay ningun `await` entre el toque y la hoja, que es lo que
//      iOS Safari puede rechazar. Solo la primerisima vez hay espera.
// ===========================================================================
// DOS COMPONENTES Y NO UNO, PORQUE VAN A DOS ALTURAS DISTINTAS
//
// Decision del dueno el 2026-10-15: el «⋮» va en la fila del boton de volver,
// arriba del todo, y «Compartir» se queda abajo, junto al titulo.
//
// NO COMPARTEN ESTADO Y NO LO NECESITAN, que es lo que permite partirlos sin
// contexto ni estado elevado: los dos reciben `initialToken` del servidor, y
// si el negocio todavia no tiene, los dos llaman a `getOrCreateCatalogLink`,
// que es idempotente —selecciona primero, inserta si falta, y la restriccion
// unica por `owner_id` cierra la carrera—. Dos llamadas devuelven el MISMO
// token. Lo unico que cuesta es un viaje de mas la primera vez.
export function CatalogShareButton({
  publishedCount,
  businessName,
  initialToken,
  variante = "cabecera",
  etiqueta = "Compartir",
}: {
  publishedCount: PublishedCount;
  businessName: string;
  initialToken: string | null;
  // CÓMO SE VE, no qué hace. El comportamiento —crear el enlace, el aviso de
  // «no has publicado nada», el `navigator.share` sin `await` delante que iOS
  // exige— es lo caro y es el mismo en los dos sitios; lo que cambia es que en
  // la cabecera oscura es texto suelto y en el estado vacío de Pedidos es el
  // botón principal de la tarjeta (frame `1467:9437`).
  //
  // Entra como variante y no como `className` a propósito: los colores de
  // «cabecera» están escritos a fuego porque viven sobre un fondo que no se
  // invierte con el tema, y dejar que quien llama los pise es cómo ese cuidado
  // se pierde en el segundo sitio.
  variante?: "cabecera" | "relleno";
  etiqueta?: string;
}) {
  const [token, setToken] = useState<string | null>(initialToken);
  const [pending, startTransition] = useTransition();

  const sinNada = publishedCount.any === 0;

  function urlDe(t: string) {
    return `${window.location.origin}/c/${t}`;
  }

  // Devuelve el token, creandolo si el negocio todavia no tiene. `null` si
  // algo falla, y en ese caso ya se avisó.
  //
  // SOLO LA LLAMADA AL SERVIDOR VA DENTRO DE LA TRANSICION, envuelta en una
  // promesa — la misma forma que `resolveUrl` en `client-header-actions.tsx`,
  // que es la que lleva meses funcionando. Lo importante es lo que queda
  // FUERA: `navigator.share` tiene que salir del gesto del dedo, y meterlo
  // dentro de un `startTransition` es pedirle a iOS Safari que lo rechace.
  function conseguirToken(): Promise<string | null> {
    if (token) return Promise.resolve(token);
    return new Promise((resolve) => {
      startTransition(async () => {
        const result = await getOrCreateCatalogLink();
        if ("error" in result) {
          toast.error(result.error);
          resolve(null);
          return;
        }
        setToken(result.token);
        resolve(result.token);
      });
    });
  }

  async function compartir() {
    // SIN NADA PUBLICADO NO SE COMPARTE, y se dice por que.
    //
    // El dialogo que esto sustituye avisaba de lo mismo en un recuadro rojo.
    // Sin el, un «Compartir» a secas mandaria el enlace de una pagina que dice
    // «este negocio no tiene productos» — y el tendero se enteraria por su
    // cliente.
    if (sinNada) {
      toast.error("Todavía no has publicado ningún producto.", {
        description:
          "Abre un producto y enciende «Publicar producto en catálogo» para que aparezca aquí.",
      });
      return;
    }

    const t = await conseguirToken();
    if (!t) return;

    const mensaje = `Mira lo que tenemos en ${businessName} y a qué precio: ${urlDe(t)}`;

    if (navigator.share) {
      try {
        await navigator.share({ text: mensaje });
      } catch {
        // Cerrar la hoja la rechaza. Eso es el dueno decidiendo no mandarlo,
        // no un fallo, asi que no lleva aviso.
      }
      return;
    }

    // Un escritorio sin `navigator.share` cae al portapapeles, y copia el
    // MENSAJE entero y no solo el enlace: lo que se pega es lo mismo que
    // habria mandado la hoja.
    await navigator.clipboard.writeText(mensaje);
    toast.success("Mensaje copiado");
  }

  return (
    <>
      {/* MISMO ASPECTO QUE «SUBIR LIBRETA» en la cabecera de Clientes, a
          petición del dueño el 2026-10-10: texto e icono, sin recuadro. Antes
          llevaba borde y se leía como la acción principal de la pantalla,
          cuando la principal es crear un producto.

          Las clases salen de la variante `dark` de `ImportarCartera` y se
          copian en vez de importarse porque ese componente abre una hoja de
          subir fotos — lo compartible es el aspecto, no el comportamiento.
          Ninguno de esos colores es un token semántico, por lo de siempre:
          sobre un fondo que no se invierte con el tema, un color que sí lo
          hace rompe el contraste en silencio. */}
      <Button
        type="button"
        variant={variante === "relleno" ? "default" : "ghost"}
        size={variante === "relleno" ? "default" : "sm"}
        onClick={() => void compartir()}
        disabled={pending}
        className={
          variante === "relleno"
            ? "h-10 w-full text-base font-semibold [&_svg]:size-5"
            : "h-auto px-0 py-1.5 text-sm text-brand-secondary hover:bg-transparent hover:text-white focus-visible:ring-2 focus-visible:ring-white/40 [&_svg]:size-5"
        }
      >
        {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Share2 aria-hidden="true" />}
        {etiqueta}
      </Button>
    </>
  );
}

// EL MENU DE LA FILA DE ARRIBA, a la altura del boton de volver.
//
// Solo lleva la vista previa. Vivia dentro del dialogo «Comparte tu catalogo»
// y quitarlo la dejo sin sitio; preguntado al dueno el 2026-10-15, el frame
// dibujaba las dos opciones aqui dentro y el eligio dejar «Compartir» fuera,
// de un toque. Es lo correcto: compartir es lo que el tendero hace a diario, y
// meterlo en un menu le costaria un toque cada vez.
export function CatalogMenu({ initialToken }: { initialToken: string | null }) {
  const [token, setToken] = useState<string | null>(initialToken);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function conseguirToken(): Promise<string | null> {
    if (token) return Promise.resolve(token);
    return new Promise((resolve) => {
      startTransition(async () => {
        const result = await getOrCreateCatalogLink();
        if ("error" in result) {
          toast.error(result.error);
          resolve(null);
          return;
        }
        setToken(result.token);
        resolve(result.token);
      });
    });
  }

  // NAVEGA EN LA MISMA VENTANA, Y NO ES UN DETALLE DE ESTILO.
  //
  // La primera version abria la previa con `window.open(..., "_blank")`. En el
  // escritorio eso es una pestana; **en la PWA instalada es una pestana del
  // SISTEMA**, que llega con su barra de direcciones encima. El dueno lo vio
  // el 2026-10-15: la previa salia con la URL arriba, la flecha de atras
  // dejaba la barra puesta y la vista de la app rota detras, y cualquiera
  // podia editar la direccion a mano.
  //
  // Navegando en la misma ventana la previa se queda DENTRO de la app: sin
  // barra, sin URL editable, y el boton de volver —un `Link` a /productos—
  // devuelve al catalogo como cualquier otra pantalla.
  //
  // Lo que esto cuesta, dicho por delante: el tendero sale de la pantalla del
  // catalogo en vez de abrir una ventana aparte. Es lo correcto de todos
  // modos — en un telefono nadie compara dos pestanas, y lo que la previa
  // tiene que responder es «¿como se ve esto?», no «¿como se ve al lado de lo
  // otro?».
  //
  // `router.push` y no `window.location`: es una ruta de la misma app, asi
  // que la navegacion del cliente es mas rapida y no recarga el documento.
  async function verPrevia() {
    const t = await conseguirToken();
    if (!t) return;
    // `?previa=1` es lo UNICO que distingue esta pagina de la que ve el
    // cliente: le añade un boton de volver. Decision del dueno el 2026-10-15.
    router.push(`/c/${t}?previa=1`);
  }

  return (
    <>
      {/* LA VISTA PREVIA, EN UN MENU APARTE. Decisión del dueño el 2026-10-15:
          «Compartir» se queda de un toque y la previa pasa aquí. El frame
          dibujaba las dos dentro del menú; esto se aparta de él a propósito,
          porque compartir es lo que el tendero hace a diario y meterlo en un
          menú le costaría un toque cada vez.

          Abre la página de verdad en otra pestaña, no una copia dentro del
          panel: una copia se queda atrás del original sin que nadie se entere,
          y un marco de 400px respondería «se ve bien» a la única pregunta que
          importa, que es si se lee en un teléfono. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={pending}
            title="Más"
            /* BLANCO Y CON FONDO AL TOCAR, como los iconos de accion de la
               barra oscura de Inicio (`NotificationsButton` y el enlace de
               «Notificaciones»). NO el color de marca que usa «Compartir»:
               ese esta junto al titulo, y aqui el vecino es la flecha de
               volver. Dos colores de marca distintos en una misma fila se
               leen como un descuido.

               La flecha se queda en `brand-muted` a proposito: es navegacion,
               y tiene que pesar menos que una accion. */
            className="size-9 shrink-0 text-white hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/40 [&_svg]:size-5"
          >
            <MoreVertical aria-hidden="true" />
            <span className="sr-only">Más opciones</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => void verPrevia()}>
            <Eye />
            Vista previa
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
