"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Minus, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { Fecha } from "@/components/fecha";
import { useGuardiaDeCuentaPausada } from "@/components/dashboard/cuenta-pausada";
import { avisarCuentaPausada } from "@/lib/cuenta-pausada";
import { registrarDevolucion } from "@/app/(app)/devoluciones/actions";
import { formatLedgerAmount, type LedgerDisplay } from "@/lib/exchange-rate/movement-display";
import { TOLERANCE, choicesFor, splitOfReturn, spreadOverFiados, type OtherFiado } from "@/lib/returns/options";
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
// NOT IN THE FRAMES, and the owner chose it on 2026-11-03:
//
//   · WITH OTHER FIADOS OWING IN THAT CURRENCY the second popup offers «Abonar a
//     otros fiados» instead of «Registrar como saldo a favor», which the book
//     cannot hold next to a debt. «El cliente debe» is then what THIS fiado owes.
//   · When more than one fiado owes, a list asks which. It is mine.
//   · When the abono does not take it all, the same popup returns with the rest.

export type ReturnContext = {
  movementId: string;
  // What this fiado still owes.
  pendingOfFiado: number;
  // The other open fiados OF THE SAME CURRENCY. A debt in the other book does
  // not appear here on purpose: it changes nothing in the table.
  otherFiados: OtherFiado[];
};

type Step = "detalle" | "sobrante" | "fiados";
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
  // What has already been aimed at other fiados. Only a partial abono leaves
  // anything here: the rest comes back to the same popup.
  const [assigned, setAssigned] = useState<FiadoLine[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const money = (n: number) => formatLedgerAmount(n, currency, ledger);
  const value = round2(quantity * line.unitPrice);
  const { own, leftOver } = splitOfReturn(value, context.pendingOfFiado);

  const toFiados = round2(assigned.reduce((sum, l) => sum + l.amount, 0));
  const rest = round2(leftOver - toFiados);
  // Each fiado with what is left of its debt after what was already aimed at it.
  const remaining = context.otherFiados
    .map((f) => ({
      ...f,
      pending: round2(f.pending - (assigned.find((l) => l.fiado_id === f.id)?.amount ?? 0)),
    }))
    .filter((f) => f.pending > TOLERANCE);
  const remainingDebt = round2(remaining.reduce((sum, f) => sum + f.pending, 0));
  const choices = choicesFor(rest, remainingDebt);

  async function register(fiados: FiadoLine[], aFavor: number, efectivo: number) {
    if (guardia() || !line.id) return;
    setSaving(true);
    setError(null);
    const result = await registrarDevolucion({
      movementId: context.movementId,
      lineId: line.id,
      quantity,
      fiados,
      aFavor,
      efectivo,
    });
    if (!result.ok) {
      setSaving(false);
      if (!avisarCuentaPausada(result.error)) setError(result.error);
      return;
    }
    toast.success("Devolución registrada");
    router.push(`/transacciones/${result.movementId}?registrada=1`);
  }

  // `onlyId` null spreads oldest first. If the fiados take it all it registers;
  // if not, the second popup comes back with what is still left.
  function abonar(onlyId: string | null) {
    const { lines, rest: left } = spreadOverFiados(rest, remaining, onlyId);
    const merged = [...assigned];
    for (const l of lines) {
      const i = merged.findIndex((x) => x.fiado_id === l.fiado_id);
      if (i >= 0) merged[i] = { ...merged[i], amount: round2(merged[i].amount + l.amount) };
      else merged.push(l);
    }
    if (left === 0) {
      void register(merged, 0, 0);
      return;
    }
    setAssigned(merged);
    setStep("sobrante");
  }

  const title =
    step === "detalle"
      ? "Registrar devolución"
      : step === "sobrante"
        ? "¿Qué deseas hacer con el sobrante?"
        : "¿A qué fiado abonas?";

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
              <span className="min-w-0 text-right text-sm leading-5 break-words text-primary">{line.name}</span>
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

            {/* THE FRAME'S TWO AMBERS, as drawn: there is no warning token, and
                on this fill `--brand-report` measures above the 4,5:1 floor. */}
            <ul className="flex list-disc flex-col rounded-lg border border-[#ffe586] bg-[#fffbeb] py-2.5 pr-2.5 pl-6 text-xs leading-4 font-semibold text-brand-report">
              {context.pendingOfFiado <= TOLERANCE ? (
                <li>Este fiado ya estaba pagado.</li>
              ) : own >= context.pendingOfFiado - TOLERANCE ? (
                <li>Este fiado queda pagado.</li>
              ) : (
                <li>Este fiado baja a {money(round2(context.pendingOfFiado - own)).primary}.</li>
              )}
              <li>
                {line.stockCounted
                  ? `${quantity === 1 ? "1 Unidad vuelve" : `${quantity} Unidades vuelven`} al inventario.`
                  : "Este producto no lleva cantidad, así que el inventario no cambia."}
              </li>
              <li>No cuenta como abono o ingreso de dinero.</li>
              <li>Puedes revertir la devolución desde el historial.</li>
            </ul>

            {leftOver > 0 ? (
              <Button
                type="button"
                className="h-10 w-full text-base font-semibold"
                onClick={() => {
                  setAssigned([]);
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
                  disabled={saving}
                  onClick={() => void register([], 0, 0)}
                >
                  {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                  Registrar devolución
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
              {toFiados > 0 ? (
                <>
                  Abonaste <strong className="tabular-nums">{money(toFiados).primary}</strong> a otros fiados; Sobran{" "}
                  <strong className="tabular-nums">{money(rest).primary}</strong>
                </>
              ) : (
                <>
                  El cliente debe <strong className="tabular-nums">{money(context.pendingOfFiado).primary}</strong> menos{" "}
                  <strong className="tabular-nums">{money(value).primary}</strong> por devolución; Sobran{" "}
                  <strong className="tabular-nums">{money(rest).primary}</strong>
                </>
              )}
            </DialogDescription>

            <div className="flex flex-col gap-4">
              {choices.includes("fiados") ? (
                <Button
                  type="button"
                  className="h-10 w-full text-base font-semibold"
                  disabled={saving}
                  onClick={() => (remaining.length === 1 ? abonar(remaining[0].id) : setStep("fiados"))}
                >
                  Abonar a otros fiados
                </Button>
              ) : (
                <Button
                  type="button"
                  className="h-10 w-full text-base font-semibold"
                  disabled={saving}
                  onClick={() => void register(assigned, rest, 0)}
                >
                  Registrar como saldo a favor
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                className="h-10 w-full text-base font-semibold"
                disabled={saving}
                onClick={() => void register(assigned, 0, rest)}
              >
                Devolver dinero
              </Button>
              {remainingDebt > TOLERANCE ? (
                <p className="-mt-2 text-xs leading-4 text-muted-foreground">
                  Este cliente todavía debe {money(remainingDebt).primary} en esta moneda.
                </p>
              ) : null}
            </div>
          </>
        ) : null}

        {step === "fiados" ? (
          <>
            <DialogDescription className="text-sm leading-5 text-primary">
              Sobran <strong className="tabular-nums">{money(rest).primary}</strong>
            </DialogDescription>
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-10 w-full text-sm"
                disabled={saving}
                onClick={() => abonar(null)}
              >
                Repartir, del más antiguo al más nuevo
              </Button>
              {remaining.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  disabled={saving}
                  onClick={() => abonar(f.id)}
                  className="flex min-h-[50px] w-full items-center justify-between gap-2 rounded-[10px] border px-2.5 py-2 text-left text-sm leading-5 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{f.title}</span>
                    <span className="text-xs leading-4 text-muted-foreground">
                      <Fecha iso={f.chargeAt} />
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums">Debe {money(f.pending).primary}</span>
                </button>
              ))}
            </div>
          </>
        ) : null}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </DialogContent>
    </Dialog>
  );
}
