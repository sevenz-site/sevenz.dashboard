"use client";

import { useState, useTransition } from "react";
import { Share2 } from "lucide-react";
import { toast } from "sonner";
import { getOrCreateCatalogLink } from "@/app/(app)/productos/actions";

// COMPARTIR UN PRODUCTO SUELTO — frames `1175:5758` (la tarjeta) y
// `1730:14329` (el detalle).
//
// Encargo del dueño el 2026-10-27: *«El detalle tiene un nuevo botón que es el
// de "Compartir", ese botón compartirá el producto individual»*, y *«las cards
// de los productos en el catálogo deben tener botón "Compartir"»*.
//
// ═══════════════════════════════════════════════════════════════════════
// QUÉ ENLACE MANDA, Y POR QUÉ ESE
//
// `/c/<token>/<producto>`: la ficha del producto en el catálogo PÚBLICO, que
// ya existe desde el entregable B. No se inventa una ruta nueva porque esa
// pantalla ya es exactamente lo que el cliente tiene que ver -- con su precio
// del escalón que le toca, su botón de agregar al carrito y su vuelta al
// catálogo entero.
//
// EL TOKEN ES EL DEL NEGOCIO, no uno por producto: el mismo que comparte el
// catálogo. Un token por producto multiplicaría por cien las filas que hay que
// poder revocar el día que alguien quiera cortar un enlace.
//
// ═══════════════════════════════════════════════════════════════════════
// EL TOKEN SE ACUÑA AL PRIMER TOQUE, NO AL DIBUJAR LA PANTALLA
//
// Es la misma regla que `catalog-share.tsx`: acuñarlo al entrar pondría a los
// negocios a una URL de distancia de un catálogo que nunca decidieron
// publicar. Así que la pantalla LEE el que ya exista y solo el primer
// «Compartir» CREA -- y `getOrCreateCatalogLink` es idempotente, así que dos
// tarjetas tocadas seguidas devuelven el MISMO token.
//
// Y POR ESO `navigator.share` VA FUERA DE LA TRANSICIÓN: tiene que salir del
// gesto del dedo. Un `await` de por medio es lo que iOS Safari rechaza, y es
// la razón por la que `conseguirToken` envuelve solo la llamada al servidor.
export function ProductShareButton({
  productId,
  productName,
  businessName,
  initialToken,
  variante = "flotante",
  sinServidor = false,
}: {
  productId: string;
  productName: string;
  businessName: string;
  // El que el negocio YA tiene, leído sin crear nada. `null` = todavía no hay.
  initialToken: string | null;
  // `flotante` = el disco blanco sobre la foto de una TARJETA del catálogo,
  //   32px -- frame `1175:5758`, nodo `1665:18324`.
  // `grande` = el mismo disco sobre la foto de la FICHA, 45px con el icono a
  //   21 -- frame `1730:14329`, nodo `1730:14430`. Es más grande porque ahí
  //   no compite con nada: la foto ocupa el ancho entero de la pantalla.
  // `fila` = el icono suelto de una fila de acciones.
  variante?: "flotante" | "grande" | "fila";
  // ── EN EL CATÁLOGO DEL CLIENTE NO HAY SESIÓN ────────────────────────
  //
  // `getOrCreateCatalogLink` es una acción del DUEÑO: lee `auth.getUser()` y
  // sin sesión devuelve error. En `/c/<token>` quien mira no tiene cuenta --
  // ni tiene por qué-- así que esa llamada no puede ocurrir nunca.
  //
  // HOY NO OCURRIRÍA IGUALMENTE, porque esa página siempre trae el token en
  // su propia URL y `conseguirToken` corta antes. Esto no es por hoy: es para
  // que el día que alguien monte este botón en otra pantalla pública sin
  // token, falle al escribirlo y no delante de un cliente.
  //
  // El síntoma que evita es de los que no se parecen a su causa: el cliente
  // toca «Compartir», no pasa nada visible, y lo único que queda es un toast
  // diciendo «Sesión expirada» a alguien que nunca inició una.
  sinServidor?: boolean;
}) {
  const [token, setToken] = useState(initialToken);
  const [, startTransition] = useTransition();

  function conseguirToken(): Promise<string | null> {
    if (token) return Promise.resolve(token);
    // La puerta del modo público: sin token y sin servidor no hay nada que
    // pedir, así que se contesta `null` y el botón no hace nada en vez de
    // llamar a una acción que exige sesión.
    if (sinServidor) return Promise.resolve(null);
    return new Promise((resolve) => {
      startTransition(async () => {
        const r = await getOrCreateCatalogLink();
        if ("error" in r) {
          toast.error(r.error);
          resolve(null);
          return;
        }
        setToken(r.token);
        resolve(r.token);
      });
    });
  }

  async function compartir(e: React.MouseEvent) {
    // LA TARJETA ENTERA ES UN BOTÓN que abre el producto, y este vive encima.
    // Sin esto, compartir abriría además la ficha por debajo.
    e.preventDefault();
    e.stopPropagation();

    const t = await conseguirToken();
    if (!t) return;

    const url = `${window.location.origin}/c/${t}/${productId}`;
    // EL NOMBRE DEL NEGOCIO VA EN EL MENSAJE, no solo en la vista previa: el
    // cliente recibe el enlace en un chat donde ya hay veinte enlaces, y «Mira
    // esto» sin decir de quién es no se abre.
    const mensaje = `${productName} en ${businessName}: ${url}`;

    if (navigator.share) {
      try {
        await navigator.share({ text: mensaje });
      } catch {
        // Cerrar la hoja la rechaza, y eso es el tendero decidiendo no
        // mandarlo. No es un error que haya que contarle.
      }
      return;
    }

    // Un escritorio sin `navigator.share` cae al portapapeles.
    await navigator.clipboard.writeText(mensaje);
    toast.success("Enlace copiado");
  }

  // EL DISCO BLANCO AL 72%, arriba a la derecha de la foto, 32px con el icono
  // a 16 -- las medidas del frame `1175:5758`, nodo `1665:18324`.
  //
  // `absolute` SOBRE LA FOTO Y NO EN LA FILA DE DEBAJO: en una rejilla de dos
  // columnas la fila de debajo es donde está el precio, y un icono ahí le
  // quitaría ancho a la cifra -- que es el dato por el que se mira un catálogo.
  if (variante === "flotante" || variante === "grande") {
    const grande = variante === "grande";
    return (
      <button
        type="button"
        onClick={compartir}
        aria-label={`Compartir ${productName}`}
        className={
          grande
            ? // `right-4 top-2`: el frame mete el disco dentro de un marco con
              // 16px a los lados y 8px arriba (nodo `1730:14330`).
              "absolute right-4 top-2 z-10 flex size-[45px] items-center justify-center rounded-full bg-background/72 backdrop-blur-sm transition-colors active:bg-background"
            : "absolute right-2 top-2 z-10 flex size-8 items-center justify-center rounded-full bg-background/72 backdrop-blur-sm transition-colors active:bg-background"
        }
      >
        <Share2 className={grande ? "size-5" : "size-4"} aria-hidden="true" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={compartir}
      aria-label={`Compartir ${productName}`}
      className="flex size-10 items-center justify-center rounded-md transition-colors hover:bg-accent"
    >
      <Share2 className="size-5" aria-hidden="true" />
    </button>
  );
}
