"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ClientResultList } from "@/components/dashboard/client-result-list";
import type { OrderClient } from "@/lib/orders/order-client-match";

// «VER CLIENTES»: LAS FICHAS QUE COMPARTEN LOS DÍGITOS DE ESTE DOCUMENTO.
//
// Instrucción del dueño el 2026-10-24, junto al frame `1634:30094`: *«al
// seleccionar "Ver clientes" abre componente sheet con los clientes que
// coincide»*.
//
// ═══════════════════════════════════════════════════════════════════════
// POR QUÉ ESTA PANTALLA EXISTE, QUE NO ES OBVIO
//
// El índice único de la migración `033` normaliza el documento con
// `[^a-z0-9]`, y eso CONSERVA la letra. Así que `V-21054832` y `E-21054832`
// son dos claves distintas y las dos caben en la misma cuenta. En dev hay tres
// grupos así ahora mismo, uno de tres personas.
//
// Cuando el pedido no trae letra —todos los anteriores a la `155`— no hay
// nada en él que distinga a una de otra. Elegir por la app sería cara o cruz
// sobre de quién va a ser la deuda; esta hoja le pasa la pregunta a quien
// tiene la respuesta.
//
// ───────────────────────────────────────────────────────────────────────
// SE REUSA `ClientResultList`, QUE YA ES LA LISTA DE ELEGIR UN CLIENTE
//
// Es la misma del buscador del abono: nombre, documento con su letra, y una
// fila tocable. Escribir otra lista aquí sería la copia que `StickyActions`
// enseñó a no hacer — y además esta ya resuelve el `onMouseDown` que hace
// falta cuando cuelga de un campo con foco.
export function OrderClientPickerSheet({ clientes }: { clientes: OrderClient[] }) {
  const router = useRouter();
  const [abierta, setAbierta] = useState(false);

  return (
    <Sheet open={abierta} onOpenChange={setAbierta}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="h-10 w-full">
          Ver clientes
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[90svh] overflow-y-auto rounded-t-xl">
        <SheetHeader>
          <SheetTitle>Clientes con ese documento</SheetTitle>
          {/* SE DICE CUÁNTOS Y POR QUÉ. «Varias cuentas» en la tarjeta no
              explica qué tienen en común; aquí hay sitio para decirlo, y es lo
              que el tendero necesita para saber qué está comparando. */}
          <SheetDescription>
            {clientes.length} fichas de tu cuenta comparten los números de este documento. Ábrelas
            para ver cuál es.
          </SheetDescription>
        </SheetHeader>
        {/* LOS 16px DE LOS LADOS: `SheetHeader` trae su propio `p-4` y
            `SheetContent` no trae ninguno. Sin esto la lista queda pegada a
            los dos bordes — pasó con el detalle del producto el mismo día. */}
        <div className="px-4 pb-6">
          <ClientResultList
            results={clientes.map((c) => ({
              id: c.id,
              name: c.name,
              documentId: c.document_id,
              documentType: c.document_type ?? null,
            }))}
            // ABRE LA FICHA, que es lo mismo que hace «Ver Pedro Pérez» en el
            // caso de una sola. El tendero mira el historial y decide quién
            // es; elegir «este pedido es de esta persona» todavía no existe,
            // porque el flujo de registro no está construido.
            onSelect={(id) => {
              setAbierta(false);
              router.push(`/clients/${id}`);
            }}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
