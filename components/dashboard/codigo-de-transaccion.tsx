"use client";

import { BotonCopiarCodigo } from "@/components/dashboard/boton-copiar-codigo";

// THE TRANSACTION CODE, UNDER THE TITLE OF EVERY DETAIL SCREEN.
//
// Asked for by the owner on 2026-10-23: *«En el detalle de las transacciones
// agrégalo debajo del título "Detalle de transacción" con el label "Código de
// transacción: ABC000" en color primary»*, and the frame `1580:11668` adds a
// copy button beside it (node `1592:11524`).
//
// WHY IT IS A COMPONENT AND NOT A LINE OF JSX. «Detalle de transacción» is
// written in FIVE pages — a movement, a sale by book, the abono flow's own
// detail, and the client's two — because each one builds its header itself.
// Five copies of a label do not behave differently until the day someone
// edits one, which is the reason `ScreenBackRow` exists two folders over.
//
// WHY THE COPY BUTTON EARNS ITS PLACE, beyond being in the frame: the code is
// meant to be pasted into the search box of the OTHER screen, or into a
// WhatsApp message. Six characters are easy to retype and easy to retype
// wrong, and a wrong code finds nothing — which reads as «the search is
// broken», not as «I typed a Z instead of a 2».
//
// IT DRAWS NOTHING WITHOUT A CODE, and that is deliberate rather than a
// fallback: `null` means the row predates migration 147 and never got one.
// A «Código de transacción: —» would be a promise of something to search for
// that no search can find.
export function CodigoDeTransaccion({ codigo }: { codigo: string | null }) {
  if (!codigo) return null;

  return (
    <div className="flex items-center gap-0.5">
      <p className="text-sm font-medium text-primary tabular-nums">
        Código de transacción: {codigo}
      </p>
      <BotonCopiarCodigo codigo={codigo} />
    </div>
  );
}
