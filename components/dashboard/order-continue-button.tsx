"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useBorrador } from "@/components/dashboard/order-registration-summary";
import {
  tieneAlgoQueCobrar,
  type BloqueDeMoneda,
} from "@/lib/orders/bloques-de-moneda";

// «CONTINUAR», THE FOOT OF THE ORDER ONCE SOMETHING HAS BEEN REGISTERED —
// frame `1564:11979`, button `1564:12579`.
//
// ===========================================================================
// IT ONLY EXISTS WHEN AT LEAST ONE LINE IS REGISTERED
//
// The owner's instruction of 2026-10-24: *«aparecerá solo cuando al menos uno
// de los productos ya esté registrado»*. That is why the starting frame
// (`1518:10873`) has no such button and this one does — the difference is the
// draft, not the screen.
//
// A disabled button would have been the other reading and it is worse: it
// sits there inviting a tap that does nothing, on a screen whose whole job is
// to tell the shopkeeper what is left to do.
//
// ===========================================================================
// AND IT ASKS BEFORE LEAVING ANYTHING BEHIND
//
// Also his: *«Si algún producto falta por registrar y usuario selecciona
// "Continuar" se mostrará modal de confirmación mencionando que faltan "X"
// productos por registrar»*, and *«"Continuar igual" y esos productos no
// entran en la venta»*.
//
// The count is what makes the dialog worth showing: «faltan productos» is a
// sentence the shopkeeper taps past, «faltan 3 productos» is one they stop
// at. And the wording says what happens to them, because «Continuar igual»
// alone does not say they are dropped.
export function OrderContinueButton({
  pedidoId,
  bloques,
  href,
}: {
  pedidoId: string;
  bloques: BloqueDeMoneda[];
  // Where «Continuar» goes: the client's details, or the matched client's
  // confirmation. The page decides which, because only it knows whether the
  // order matched a ficha.
  href: string;
}) {
  const router = useRouter();
  const [preguntando, setPreguntando] = useState(false);
  const borrador = useBorrador(pedidoId);

  // ── POR MONEDA DESDE `CT-147`, NO POR PRODUCTO ────────────────────
  //
  // La regla del dueño del 2026-10-24 no cambia —el botón sale cuando hay
  // algo registrado, y avisa de lo que se queda fuera—; lo que cambia es qué
  // se cuenta. Un bloque de moneda sin rellenar significa que esa moneda
  // ENTERA no entra en la venta, que es bastante más que un producto suelto.
  //
  // SOLO SE CUENTAN LOS BLOQUES REGISTRABLES: uno cuyos productos ya no están
  // en el catálogo no se puede rellenar, así que contarlo como «falta» sería
  // pedirle al tendero algo que la pantalla no le deja hacer.
  const registrables = bloques.filter(tieneAlgoQueCobrar);
  const registradas = registrables.filter((b) => borrador?.monedas[b.moneda]).length;
  const faltan = registrables.length - registradas;

  // NOTHING REGISTERED, NO BUTTON. See the header: this is the owner's rule,
  // not a styling choice.
  if (registradas === 0) return null;

  return (
    <>
      <Button
        className="h-10 w-full"
        onClick={() => (faltan > 0 ? setPreguntando(true) : router.push(href))}
      >
        Continuar
      </Button>

      <AlertDialog open={preguntando} onOpenChange={setPreguntando}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {faltan === 1
                ? "Falta 1 moneda por registrar"
                : `Faltan ${faltan} monedas por registrar`}
            </AlertDialogTitle>
            {/* IT NAMES THE CONSEQUENCE, not the action. «Continuar igual»
                does not tell anybody that the products are dropped, and the
                shopkeeper finds out when the customer asks why their order
                came up short. */}
            <AlertDialogDescription>
              {faltan === 1
                ? "Lo de esa moneda no entrará en la venta. Puedes registrarlo antes de seguir."
                : `Lo de esas ${faltan} monedas no entrará en la venta. Puedes registrarlo antes de seguir.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction onClick={() => router.push(href)}>
              Continuar igual
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
