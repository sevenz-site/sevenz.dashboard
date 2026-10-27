"use client";

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
import { ClientAccountSheet } from "@/components/dashboard/client-account-sheet";
import type { LedgerDisplay } from "@/lib/exchange-rate/movement-display";
import type { OrderClient } from "@/lib/orders/order-client-match";

// «VER CLIENTES»: THE FICHAS THAT SHARE THIS DOCUMENT'S DIGITS.
//
// The owner's instruction on 2026-10-24, alongside frame `1634:30094`: *«al
// seleccionar "Ver clientes" abre componente sheet con los clientes que
// coincide»*.
//
// ═══════════════════════════════════════════════════════════════════════
// WHY THIS SCREEN EXISTS, WHICH IS NOT OBVIOUS
//
// Migration `033`'s unique index normalises the document with `[^a-z0-9]`,
// and that KEEPS the letter. So `V-21054832` and `E-21054832` are two
// different keys and both fit in the same account. Dev holds three such
// groups right now, one of them three people deep.
//
// When the order carries no letter — every order older than `155` — nothing
// in it tells one from another. Choosing for the shopkeeper would be a coin
// flip on whose debt this becomes; this sheet hands the question to whoever
// has the answer.
//
// ───────────────────────────────────────────────────────────────────────
// IT REUSES `ClientResultList`, WHICH ALREADY IS THE PICK-A-CLIENT LIST
//
// The same one the payment's search uses: name, document with its letter, and
// a tappable row. Writing another list here would be the copy `StickyActions`
// taught us not to make — and this one already handles the `onMouseDown` that
// is needed when it hangs off a focused field.
export function OrderClientPickerSheet({
  clientes,
  ledger,
}: {
  clientes: OrderClient[];
  ledger: LedgerDisplay | null;
}) {
  const [abierta, setAbierta] = useState(false);
  // CUÁL DE LAS FICHAS SE ESTÁ MIRANDO. `null` = ninguna, o sea la lista.
  const [mirando, setMirando] = useState<OrderClient | null>(null);

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
          {/* IT SAYS HOW MANY AND WHY. «Varias cuentas» on the card does not
              explain what they have in common; there is room for it here, and
              it is what the shopkeeper needs in order to know what he is
              comparing. */}
          <SheetDescription>
            {clientes.length} fichas de tu cuenta comparten los números de este documento. Ábrelas
            para ver cuál es.
          </SheetDescription>
        </SheetHeader>
        {/* THE 16px GUTTERS: `SheetHeader` brings its own `p-4` and
            `SheetContent` brings none. Without this the list sits flush
            against both edges — it happened to the product detail the same
            day. */}
        <div className="px-4 pb-6">
          <ClientResultList
            results={clientes.map((c) => ({
              id: c.id,
              name: c.name,
              documentId: c.document_id,
              documentType: c.document_type ?? null,
            }))}
            // ABRE LA CUENTA EN OTRA HOJA, NO NAVEGA. Hasta el 2026-10-25
            // hacía `router.push("/clients/<id>")`, que es exactamente lo que
            // el dueño mandó quitar del caso de una sola ficha: *«debe
            // abrirse el perfil del cliente pero en sheet, para no salir del
            // flujo de registrar pedido»*. Las dos puertas llevan a la misma
            // pregunta —«¿quién es este?»—, así que arreglar solo una dejaba
            // la otra tirando el pedido a medio registrar.
            onSelect={(id) => {
              const elegido = clientes.find((c) => c.id === id);
              if (!elegido) return;
              setAbierta(false);
              setMirando(elegido);
            }}
          />
        </div>
      </SheetContent>

      {/* LA CUENTA DE LA FICHA ELEGIDA, encima de la lista. Se monta solo
          cuando hay una elegida: `ClientAccountSheet` pide su historial al
          abrirse, y tenerla montada por cada fila sería una consulta por
          cliente para una lista que el tendero quizá ni abra. */}
      {mirando ? (
        <ClientAccountSheet
          open
          onOpenChange={(v) => {
            if (!v) setMirando(null);
          }}
          clientId={mirando.id}
          clientName={mirando.name}
          ledger={ledger}
        />
      ) : null}
    </Sheet>
  );
}
