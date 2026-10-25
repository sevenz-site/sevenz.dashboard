"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ClientAccountSheet } from "@/components/dashboard/client-account-sheet";
import type { LedgerDisplay } from "@/lib/exchange-rate/movement-display";

// «VER ‹NOMBRE›» ABRE UNA HOJA, NO UNA PANTALLA.
//
// Pedido por el dueño el 2026-10-25: *«Botón "Ver <cliente>" abre perfil de
// cliente pero en sheet, para no salir del flujo de registrar pedido»*.
//
// ===========================================================================
// POR QUÉ IMPORTA MÁS DE LO QUE PARECE
//
// Era un `Link` a `/clients/<id>`. Desde el detalle de un pedido eso no es
// «mirar un momento»: es irse, y volver con el botón de atrás a una pantalla
// que vuelve a montarse. Si el tendero ya había rellenado algo del registro,
// lo que vive en el borrador del navegador sigue ahí — pero el camino de
// vuelta no es el suyo, y con el cliente delante eso basta para perder el
// hilo.
//
// LA HOJA YA EXISTÍA Y SU PROPIO COMENTARIO DICE ESTO MISMO: `ClientAccountSheet`
// se escribió para el paso 4 del asistente de venta, y allí dejó escrito *«por
// eso es una HOJA y no una navegación: irse a la ficha del cliente perdería la
// venta entera»*. Es el mismo problema, así que es el mismo componente — no
// una copia.
//
// ===========================================================================
// SIN «REGISTRAR A CUENTA EXISTENTE»
//
// `onUsarEstaCuenta` se queda sin pasar a propósito. Ese atajo pertenece al
// asistente de venta, donde hay una venta en curso esperando a qué ficha ir.
// Aquí el pedido ya trae su comprador y la ficha ya está emparejada por
// documento: un botón que dijera «usar esta cuenta» no tendría nada que
// decidir.
export function OrderClientSheetButton({
  clientId,
  clientName,
  ledger,
}: {
  clientId: string;
  clientName: string;
  ledger: LedgerDisplay | null;
}) {
  const [abierta, setAbierta] = useState(false);

  return (
    <>
      {/* EL NOMBRE DE LA FICHA Y NO EL DEL PEDIDO. El botón dice a quién va a
          enseñar, y enseña al cliente que esta tienda tiene apuntado — que es
          el nombre que habrá al otro lado. */}
      <Button
        variant="outline"
        size="sm"
        className="h-10 w-full"
        onClick={() => setAbierta(true)}
      >
        Ver {clientName}
      </Button>

      {/* SE MONTA SOLO AL ABRIRLA: la hoja pide la cuenta del cliente al
          servidor en cuanto existe, y la mayoría de las veces nadie la abre. */}
      {abierta ? (
        <ClientAccountSheet
          open
          onOpenChange={(abierto: boolean) => !abierto && setAbierta(false)}
          clientId={clientId}
          clientName={clientName}
          ledger={ledger}
        />
      ) : null}
    </>
  );
}
