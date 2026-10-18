"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTour } from "@/components/dashboard/tour-context";

// EL «AGREGAR» DE INICIO EN ESCRITORIO, que desde el 2026-10-18 abre la venta.
//
// Decisión del dueño: *«los cuatro pasos se mostrarán al presionar el botón
// "Agregar" en el home, ahí abre el paso 1/4»*. En teléfono esa puerta es el
// botón flotante de `MobileNav`; de `md:` en adelante no hay barra abajo y la
// puerta es ésta.
//
// ===========================================================================
// POR QUÉ ES UN COMPONENTE Y NO UN `<Link>` DENTRO DE LA PÁGINA
//
// Por dos cosas que solo se pueden hacer en el cliente, y las dos se rompen en
// silencio si se olvidan:
//
// 1. `data-tour="new-client-button"` es el blanco del primer paso del tour en
//    escritorio. Aquí reemplaza al disparador de `ClientSearchDialog`, que lo
//    llevaba y ya no se pinta: sin el marcador, `querySelector` no encuentra
//    nada y el tour se queda sin su primer paso, sin error.
// 2. El tour avanza AL PULSAR. Era lo que hacía el diálogo y es lo que hace el
//    botón flotante del teléfono; si solo navegara, el tendero llegaría al
//    paso 1/4 con el globo del tour todavía señalando el botón que acaba de
//    dejar atrás.
//
// EL MARCADOR VA SOLO AQUÍ. El tour busca su blanco con `querySelector`, que
// devuelve el primero que coincide en el DOM: dos elementos con el mismo
// marcador significan que puede iluminar el que no está en pantalla.
export function NewSaleButton() {
  const tour = useTour();
  return (
    <Button asChild size="sm" className="w-full sm:w-auto">
      <Link
        href="/ventas/nueva"
        data-tour="new-client-button"
        onClick={() => {
          if (tour.step === 1) tour.advance();
        }}
      >
        <Plus className="size-4" aria-hidden="true" />
        Agregar
      </Link>
    </Button>
  );
}
