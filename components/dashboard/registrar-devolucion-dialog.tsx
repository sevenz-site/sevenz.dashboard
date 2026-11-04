"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Minus, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { useGuardiaDeCuentaPausada } from "@/components/dashboard/cuenta-pausada";
import { avisarCuentaPausada } from "@/lib/cuenta-pausada";
import { registrarDevolucion, registrarDevolucionDeContado } from "@/app/(app)/devoluciones/actions";
import { formatLedgerAmount, type LedgerDisplay } from "@/lib/exchange-rate/movement-display";
import { formatCantidad } from "@/lib/products/cantidad";
import { TOLERANCE, planOfReturn, returnValue, type OtherFiado } from "@/lib/returns/options";
import type { SaleLineRow } from "@/lib/sale-lines";
import type { LedgerCurrency } from "@/lib/types";

// THE POPUPS OF A RETURN — sitemap `1976:16103`, owner's request of 2026-11-03:
// *«Si hay dinero sobrante el patrón pasa a dos popups, sino entonces queda en
// un solo popup»*. Frames `1975:19140` (nothing left over), `1975:18842` (left
// over, first popup) and `1975:19198` (left over, second popup).
//
// WHAT IT ASKS AND WHEN IS THE TABLE AT THE TOP OF `lib/returns/options.ts`: by
// currency, whether something is left over, and what is offered. This file only
// draws it, and `registrar_devolucion` checks all of it again.
//
// THE SITEMAP'S DIAMOND, «¿Sobra dinero?», SITS BEFORE THE POPUP, but the answer
// depends on the units chosen inside it: one unit may leave nothing over and two
// may. So it is one popup whose last button changes as the counter moves, from
// «Registrar devolución» to «Continuar».
//
// NOTHING IS WRITTEN UNTIL THE LAST TAP. «Continuar» only moves on, and the X
// closes without a trace. The buttons of the second popup register at once, as
// drawn: no third confirmation, and the return can be deleted from its detail.
//
// THE LEFT-OVER IS «POR COBRAR» LESS THE VALUE, owner's decision of 2026-11-04:
// the value pays the debts of that currency by itself, and the popups only ask
// about what is still left. The second popup is therefore always the one drawn,
// saldo a favor or cash. Until that day it offered «Abonar a otros fiados» with a
// list to choose from, and cash with debts alive: the reasons, and why they went,
// are in `lib/returns/options.ts`.
//
// ON A CASH SALE THE WHOLE VALUE CAN STILL GO BACK, owner's request of the same
// day: with a debt smaller than the value the second popup offers a third
// button, and its first two say the amounts, because here they are what is being
// chosen. Their wording is mine.
//
// A SALE PAID IN FULL, owner's request of 2026-11-04 (migration 186), has no
// frame: the same popups with `pendingOfFiado` at 0. Mine, to be said in the
// report: the second popup's sentence when nothing is owed, which cannot speak
// of a fiado; the reminder that a saldo a favor buys another product, which is
// how his cases 2 and 3 are done; and a sale with no client staying in one popup,
// because with a single answer there is nothing to ask.

export type ReturnContext = {
  // What it hangs from. `walkIn` is the Mostrador.
  source: { kind: "fiado"; movementId: string } | { kind: "contado"; saleId: string; walkIn: boolean };
  // What this fiado still owes. 0 in a sale paid in full.
  pendingOfFiado: number;
  // The «Por cobrar» of this book today, signed: below zero is in favour.
  bookBalance: number;
  // What is left of this book of the sale to give back (migration 188).
  ceiling: number;
  // The other open fiados OF THE SAME CURRENCY. A debt in the other book does
  // not appear here on purpose: it changes nothing in the table.
  otherFiados: OtherFiado[];
};

type Step = "detalle" | "sobrante";
type FiadoLine = { fiado_id: string; amount: number };

const round2 = (n: number) => Math.round(n * 100) / 100;

export function RegistrarDevolucionDialog({
  open,
  onOpenChange,
  line,
  context,
  currency,
  ledger,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  line: SaleLineRow;
  context: ReturnContext;
  currency: LedgerCurrency | null;
  ledger: LedgerDisplay | null;
}) {
  const router = useRouter();
  const guardia = useGuardiaDeCuentaPausada();
  const available = round2(line.quantity - (line.devuelto ?? 0));
  const [quantity, setQuantity] = useState(Math.min(1, available));
  const [step, setStep] = useState<Step>("detalle");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const money = (n: number) => formatLedgerAmount(n, currency, ledger);
  const value = returnValue(quantity, line.unitPrice, line.devuelto ?? 0, line.devueltoValor ?? 0, context.ceiling);
  // A sale charged below its lines: the units are worth what is left of it, and
  // the notice says so before anything is pressed. Owner's rule of checking the
  // worst case: being refused here sent him back to writing a false abono.
  const capped = value < round2(quantity * line.unitPrice) - TOLERANCE;
  const { own, lines, toFiados, rest } = planOfReturn(value, context.pendingOfFiado, context.otherFiados);
  const { source } = context;
  const isCash = source.kind === "contado";
  const walkIn = source.kind === "contado" && source.walkIn;

  // THE NOTICE SAYS WHERE THE VALUE GOES AND WHAT «POR COBRAR» WILL READ, in the
  // owner's words of 2026-11-04: *«qué pasa con el valor devuelto? cómo afecta el
  // saldo "Por cobrar"? explícalo en la alerta amarilla»*. It speaks of the book
  // and not of this fiado, because that is the figure on the card. Only what is
  // certain: the same day he took out the two lines that said «si abonas» and
  // «si devuelves», so with nothing owed there is no line, because the book then
  // depends on the second popup. A debt in the other currency is left out on
  // purpose: that card does not move.
  const label = `«Por cobrar»${currency ? ` en ${currency === "USD" ? "dólares" : "euros"}` : ""}`;
  const book = (n: number) =>
    n < -TOLERANCE ? `${money(-n).primary} a favor` : money(Math.max(n, 0)).primary;
  const debt = round2(context.pendingOfFiado + context.otherFiados.reduce((sum, f) => sum + f.pending, 0));
  // A cash sale with a debt and something left over: the debt may stay, if the
  // whole value goes back in the second popup. So the notice cannot promise it.
  const canReturnWhole = isCash && toFiados > 0 && rest > 0;
  const lowersDebt = own + toFiados > 0 && !canReturnWhole;

  async function register(fiados: FiadoLine[], aFavor: number, efectivo: number) {
    if (guardia() || !line.id) return;
    setSaving(true);
    setError(null);
    const money = { lineId: line.id, quantity, fiados, aFavor, efectivo };
    const result =
      source.kind === "fiado"
        ? await registrarDevolucion({ ...money, movementId: source.movementId })
        : await registrarDevolucionDeContado({ ...money, saleId: source.saleId });
    if (!result.ok) {
      setSaving(false);
      if (!avisarCuentaPausada(result.error)) setError(result.error);
      return;
    }
    toast.success("Devolución registrada");
    router.push(`/transacciones/${result.movementId}?registrada=1`);
  }

  const title = step === "detalle" ? "Registrar devolución" : "¿Qué deseas hacer con el sobrante?";

  const valor = money(value);

  return (
    <Dialog open={open} onOpenChange={(o) => (saving ? null : onOpenChange(o))}>
      {/* `grid-cols` is the DESIGN-SYSTEM.md trap of a `DialogContent` that does
          not shrink; `dvh` the trap of the toolbar. */}
      <DialogContent
        showCloseButton={false}
        className="max-h-[85dvh] grid-cols-[minmax(0,1fr)] gap-4 overflow-y-auto rounded-[16px] bg-background p-4"
      >
        <div className="flex items-start justify-between gap-2.5">
          <DialogTitle className="text-xl leading-[26px] font-medium">{title}</DialogTitle>
          <DialogClose asChild>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Cerrar" className="shrink-0" disabled={saving}>
              <X className="size-5" aria-hidden="true" />
            </Button>
          </DialogClose>
        </div>

        {step === "detalle" ? (
          <>
            <DialogDescription className="flex items-center justify-between gap-4 py-2">
              <span className="text-xs leading-4 text-muted-foreground">Producto</span>
              <span className="min-w-0 text-right text-sm leading-5 break-words text-primary">
                {/* What was bought, not what is left: owner's request of 2026-11-04. */}
                {line.name} x {formatCantidad(line.quantity)}
              </span>
            </DialogDescription>

            <div className="flex flex-col gap-1">
              <span className="text-sm leading-5">Unidades devueltas</span>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-10 shrink-0 rounded-[12px]"
                  aria-label="Una unidad menos"
                  disabled={quantity <= 1}
                  onClick={() => setQuantity((q) => Math.max(1, round2(q - 1)))}
                >
                  <Minus className="size-4" aria-hidden="true" />
                </Button>
                <span className="flex h-10 min-w-0 flex-1 items-center justify-center rounded-[12px] border text-lg font-medium tabular-nums">
                  {quantity}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-10 shrink-0 rounded-[12px]"
                  aria-label="Una unidad más"
                  disabled={quantity >= available}
                  onClick={() => setQuantity((q) => Math.min(available, round2(q + 1)))}
                >
                  <Plus className="size-4" aria-hidden="true" />
                </Button>
              </div>
            </div>

            <div className="flex items-center justify-between gap-1 py-2">
              <span className="text-base leading-6 font-semibold">Valor devuelto</span>
              <span className="flex flex-col items-end">
                <span className="inline-flex items-center gap-1 text-base leading-6 font-semibold tabular-nums">
                  {valor.primary}
                  {currency ? <CurrencyFlagIcon currency={currency} className="size-4" /> : null}
                </span>
                {valor.secondary ? (
                  <span className="text-xs leading-4 text-muted-foreground tabular-nums">{valor.secondary} Hoy</span>
                ) : null}
              </span>
            </div>

            {/* THE FRAME'S TWO AMBERS, as drawn, and on this fill
                `--brand-report` measures above the 4,5:1 floor. */}
            <ul className="flex list-disc flex-col rounded-lg border border-[#ffe586] bg-[#fffbeb] py-2.5 pr-2.5 pl-6 text-xs leading-4 font-semibold text-brand-report">
              {capped ? (
                <li>
                  {value > 0
                    ? `De esta venta solo quedan ${money(value).primary} por devolver.`
                    : "De esta venta ya se devolvió todo lo que se cobró."}
                </li>
              ) : null}
              {value <= 0 ? null : isCash ? (
                <li>
                  {rest > 0
                    ? `Al devolver esta compra de contado sobrarán ${money(rest).primary}.`
                    : "Al devolver esta compra de contado no sobra dinero: se abona a sus fiados."}
                </li>
              ) : context.pendingOfFiado <= TOLERANCE ? (
                <li>
                  {rest > 0
                    ? `Este fiado ya estaba pagado, así que sobran ${money(rest).primary}.`
                    : "Este fiado ya estaba pagado: el valor se abona a sus otros fiados."}
                </li>
              ) : own >= context.pendingOfFiado - TOLERANCE ? (
                <li>
                  Este fiado queda pagado
                  {rest > 0
                    ? ` y sobran ${money(rest).primary}`
                    : toFiados > 0
                      ? " y el resto se abona a sus otros fiados"
                      : ""}
                  .
                </li>
              ) : (
                <li>Este fiado baja a {money(round2(context.pendingOfFiado - own)).primary}.</li>
              )}
              {walkIn ? (
                <li>Es una venta sin cliente: el dinero se devuelve y no hay «Por cobrar» que cambie.</li>
              ) : lowersDebt ? (
                <li>
                  {label} baja de {book(context.bookBalance)} a {book(round2(context.bookBalance - own - toFiados))}.
                </li>
              ) : null}
              <li>
                {line.stockCounted
                  ? `${quantity === 1 ? "1 Unidad vuelve" : `${quantity} Unidades vuelven`} al inventario.`
                  : "Este producto no lleva cantidad, así que el inventario no cambia."}
              </li>
              {walkIn ? null : <li>No cuenta como abono o ingreso de dinero.</li>}
              <li>Puedes revertir la devolución desde el historial.</li>
            </ul>

            {rest > 0 && !walkIn ? (
              <Button
                type="button"
                className="h-10 w-full text-base font-semibold"
                disabled={value <= 0}
                onClick={() => {
                  setError(null);
                  setStep("sobrante");
                }}
              >
                Continuar
              </Button>
            ) : (
              <div className="flex flex-col gap-4">
                <Button
                  type="button"
                  className="h-10 w-full text-base font-semibold"
                  disabled={saving || value <= 0}
                  onClick={() => void register(lines, 0, walkIn ? rest : 0)}
                >
                  {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                  {walkIn ? "Devolver dinero" : "Registrar devolución"}
                </Button>
                <DialogClose asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 w-full text-base font-semibold"
                    disabled={saving}
                  >
                    Cancelar
                  </Button>
                </DialogClose>
              </div>
            )}
          </>
        ) : null}

        {step === "sobrante" ? (
          <>
            <DialogDescription className="text-sm leading-5 text-primary">
              {isCash && debt <= TOLERANCE ? (
                <>
                  Esta compra ya estaba pagada; Sobran{" "}
                  <strong className="tabular-nums">{money(rest).primary}</strong>
                </>
              ) : (
                <>
                  El cliente debe <strong className="tabular-nums">{money(debt).primary}</strong> menos{" "}
                  <strong className="tabular-nums">{money(value).primary}</strong> por devolución; Sobran{" "}
                  <strong className="tabular-nums">{money(rest).primary}</strong>
                </>
              )}
            </DialogDescription>

            <div className="flex flex-col gap-4">
              {canReturnWhole ? (
                <>
                  <Button
                    type="button"
                    className="h-auto min-h-10 w-full py-2 text-sm font-semibold whitespace-normal"
                    disabled={saving}
                    onClick={() => void register(lines, 0, rest)}
                  >
                    Abonar {money(toFiados).primary} y devolver {money(rest).primary}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-auto min-h-10 w-full py-2 text-sm font-semibold whitespace-normal"
                    disabled={saving}
                    onClick={() => void register(lines, rest, 0)}
                  >
                    Abonar {money(toFiados).primary} y dejar {money(rest).primary} a favor
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-auto min-h-10 w-full py-2 text-sm font-semibold whitespace-normal"
                    disabled={saving}
                    onClick={() => void register([], 0, value)}
                  >
                    Devolver los {money(value).primary}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    type="button"
                    className="h-10 w-full text-base font-semibold"
                    disabled={saving}
                    onClick={() => void register(lines, rest, 0)}
                  >
                    Registrar como saldo a favor
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 w-full text-base font-semibold"
                    disabled={saving}
                    onClick={() => void register(lines, 0, rest)}
                  >
                    Devolver dinero
                  </Button>
                </>
              )}
              {isCash ? (
                <p className="-mt-2 text-xs leading-4 text-muted-foreground">
                  Con el saldo a favor puede llevarse otro producto.
                </p>
              ) : null}
            </div>
          </>
        ) : null}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </DialogContent>
    </Dialog>
  );
}
