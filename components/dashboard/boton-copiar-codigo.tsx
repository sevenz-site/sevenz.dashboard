"use client";

import { Copy } from "lucide-react";
import { toast } from "sonner";

// COPY THE TRANSACTION CODE, FROM ANYWHERE IT IS WRITTEN.
//
// Asked for by the owner on 2026-10-23, first under the title of a detail
// screen (frame `1580:11668`, node `1592:11524`) and then in the footer of
// every related card: *«en el footer del código de la transacción agrega
// alineado a la derecha icon button copy»*.
//
// WHY IT EARNS ITS PLACE, beyond being in the frame: the code exists to be
// pasted into the search box of another screen or into a WhatsApp message.
// Seven characters are easy to retype and easy to retype wrong, and a wrong
// code finds nothing — which reads as «the search is broken», not as «I typed
// a Z instead of a 2».
//
// ===========================================================================
// `preventDefault` NO ES OPCIONAL
//
// En el pie de una tarjeta, este botón vive DENTRO de un `<Link>` que lleva a
// la ficha de esa transacción. Sin frenar el evento, copiar también navega —
// y el tendero acaba en otra pantalla preguntándose si copió algo.
export function BotonCopiarCodigo({ codigo }: { codigo: string }) {
  return (
    <button
      type="button"
      aria-label={`Copiar el código ${codigo}`}
      className="-m-1 shrink-0 rounded p-1 text-muted-foreground transition-colors active:bg-muted"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        // SIN `await` Y SIN BLOQUEAR NADA: copiar es una comodidad, y si el
        // navegador no deja —sin permiso, sin contexto seguro— lo que no
        // puede pasar es que el toque parezca haber hecho algo. Por eso el
        // aviso va en las dos ramas y no solo en la buena.
        void navigator.clipboard
          ?.writeText(codigo)
          .then(() => toast.success("Código copiado"))
          .catch(() => toast.error("No pudimos copiar el código"));
      }}
    >
      <Copy className="size-4" aria-hidden="true" />
    </button>
  );
}
