import { methodLabel } from "@/lib/payments/methods";

// «MÉTODO DE PAGO» IN A TRANSACTION'S DETAIL: the abono's and the cash sale's, on the owner's
// screens and on the client's link (owner's decision of 2026-11-17, «Sí, igual que el dueño»).
// One component for the four screens, so the label and its spacing cannot drift between them.
//
// NOTHING IS DRAWN WITHOUT A METHOD: every payment recorded before 2026-11-17 has none, and a
// «—» there would read as «paid by no method» rather than «not recorded».
//
// It renders a `dt`/`dd` pair, for the `<dl>` groups those screens are built from, with the gap
// below that the «Descripción» under it needs.
export function MetodoDePagoFila({
  metodo,
  bookCurrency,
}: {
  metodo: string | null | undefined;
  bookCurrency: string | null | undefined;
}) {
  const etiqueta = methodLabel(metodo, bookCurrency);
  if (!etiqueta) return null;
  return (
    <>
      <dt className="text-xs leading-5 text-muted-foreground">Método de pago</dt>
      <dd className="pb-2 text-sm">{etiqueta}</dd>
    </>
  );
}

/**
 * The one method of a set of payments, or null when they used more than one or any lacks one:
 * two methods have no single honest answer for a row that shows one. The same rule
 * `get_shared_balance` applies for the client (migration 214).
 */
export function metodoUnico(metodos: (string | null | undefined)[]): string | null {
  if (metodos.length === 0 || metodos.some((m) => !m)) return null;
  return new Set(metodos).size === 1 ? (metodos[0] as string) : null;
}
