// THE TRANSACTION CODE, UNDER THE TITLE OF EVERY DETAIL SCREEN.
//
// Asked for by the owner on 2026-10-23: *«En el detalle de las transacciones
// agrégalo debajo del título "Detalle de transacción" con el label "Código de
// transacción: ABC000" en color primary»*.
//
// WHY IT IS A COMPONENT AND NOT A LINE OF JSX. «Detalle de transacción» is
// written in FOUR pages — a movement, a sale by book, the abono flow's own
// detail, and the client's link — because each one builds its header itself.
// Four copies of a label do not behave differently until the day someone
// edits one, which is the reason `ScreenBackRow` exists two folders over.
//
// IT DRAWS NOTHING WITHOUT A CODE, and that is deliberate rather than a
// fallback: `null` means the row predates migration 147 and never got one.
// A «Código de transacción: —» would be a promise of something to search for
// that no search can find.
export function CodigoDeTransaccion({ codigo }: { codigo: string | null }) {
  if (!codigo) return null;
  return (
    <p className="text-sm font-medium text-primary tabular-nums">
      Código de transacción: {codigo}
    </p>
  );
}
