"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RegisterSheet } from "@/components/dashboard/register-sheet";
import { useTour } from "@/components/dashboard/tour-context";

// EL BOTÓN «REGISTRAR» DE ESCRITORIO, que abre la hoja de las tres cosas que
// el tendero puede anotar — frame `1389:11227`, 2026-10-18.
//
// ===========================================================================
// THIS IS THE ONLY ONE. EVERY SCREEN THAT OFFERS TO REGISTER MOUNTS IT
//
// The owner's instruction on 2026-10-24, with the screenshots of `/clients`
// and `/malas-pagas` circled in red: *«usa el mismo componente en todas las
// pantallas para que en un futuro al cambiar el botón en una pantalla se
// cambie a todas»*. Those two were still drawing `ClientSearchDialog`'s own
// trigger — an «Agregar movimiento» button that opened the old «Agregar
// transacción» dialog — while Inicio already opened the sheet. Three screens,
// two flows, and theirs was the retired one.
//
// It was called `NewSaleButton` until that day. The name came from when it
// opened the sale wizard and already described the wrong thing: it opens
// `RegisterSheet`, which offers three things and only one of them is a sale.
// With the button mounting in three places, a name that lies is what makes
// the next person write another one.
//
// Se llamó «Agregar» hasta ese día y abrió tres cosas distintas en tres
// semanas: el diálogo de movimientos, luego el asistente de venta, y ahora la
// hoja que deja elegir. El nombre cambió con lo último, a petición del dueño:
// «Agregar» describe lo que hace el botón, «Registrar» describe lo que el
// tendero viene a hacer.
//
// En teléfono esta puerta es el botón flotante de `MobileNav`; de `md:` en
// adelante no hay barra abajo y la puerta es ésta.
//
// WHICH IS WHY WHOEVER MOUNTS IT WRAPS IT IN `hidden md:block`: without that,
// a phone would show two «Registrar», the floating one and this one.
//
// ===========================================================================
// POR QUÉ ES UN COMPONENTE Y NO UN BOTÓN DENTRO DE LA PÁGINA
//
// Por tres cosas que solo se pueden hacer en el cliente, y las tres se rompen
// en silencio si se olvidan:
//
// 1. La hoja necesita estado abierto/cerrado.
// 2. `data-tour="new-client-button"` es el blanco del primer paso del tour en
//    escritorio. Aquí reemplaza al disparador de `ClientSearchDialog`, que lo
//    llevaba y ya no se pinta: sin el marcador, `querySelector` no encuentra
//    nada y el tour se queda sin su primer paso, sin error.
// 3. El tour avanza AL PULSAR, como hacía el diálogo y como hace el botón
//    flotante del teléfono. Si no, el globo seguiría señalando el botón
//    mientras la hoja ya está encima.
//
// EL MARCADOR VA SOLO AQUÍ. El tour busca su blanco con `querySelector`, que
// devuelve el primero que coincide en el DOM: dos elementos con el mismo
// marcador significan que puede iluminar el que no está en pantalla.
export function RegisterButton() {
  const tour = useTour();
  const [abierta, setAbierta] = useState(false);

  return (
    <>
      <Button
        size="sm"
        className="w-full sm:w-auto"
        data-tour="new-client-button"
        onClick={() => {
          if (tour.step === 1) tour.advance();
          setAbierta(true);
        }}
      >
        <Plus className="size-4" aria-hidden="true" />
        Registrar
      </Button>
      <RegisterSheet open={abierta} onOpenChange={setAbierta} />
    </>
  );
}
