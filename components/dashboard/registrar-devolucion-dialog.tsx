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
import {
  TOLERANCE,
  choicesOfFiado,
  choicesOfCashSale,
  planOfReturn,
  returnValue,
  type OtherFiado,
  type ReturnChoice,
} from "@/lib/returns/options";
import type { SaleLineRow } from "@/lib/sale-lines";
import type { LedgerCurrency } from "@/lib/types";

// THE POPUP OF A RETURN — one, owner's decision of 2026-11-04: *«sinteticemos todo
// a una modal»*. Section `1988:16553` for a cash sale, frames `1988:16505` and
// `1988:17547` for a fiado. His words of the same day: *«el copy debe ser exacto,
// solo puedes corregir errores ortográficos pero no cambiar el texto»*. So the
// sentences of the notice and the buttons below are his, including the ones that
// do not read like the rest of the app, and only the figures are computed. Do not
// tidy them.
//
// IT DISPLACES THE TWO POPUPS OF 2026-11-03 (sitemap `1976:16103`, *«Si hay dinero
// sobrante el patrón pasa a dos popups»*) and the sentence of each case: a notice
// that spoke of the case, then a second question. Now the notice lists what each
// button does and the buttons are the question.
//
// WHAT IT OFFERS AND WHEN IS THE TABLE IN `lib/returns/options.ts`, and
// `registrar_devolucion` checks all of it again. This file only draws it.
//
// NOTHING IS WRITTEN UNTIL A BUTTON IS PRESSED, and that button registers at once:
// the X closes without a trace, and the return can be deleted from its detail.
//
// THE MOSTRADOR'S «sigue debiendo» WAS DRAWN WITH $25,00, which that sale cannot
// owe. He kept the line with the real figure, $0,00, on 2026-11-04.

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
  const [saving, setSaving] = useState<ReturnChoice["kind"] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const money = (n: number) => formatLedgerAmount(n, currency, ledger);
  const value = returnValue(quantity, line.unitPrice, line.devuelto ?? 0, line.devueltoValor ?? 0, context.ceiling);
  // A sale charged below its lines: the units are worth what is left of it, and
  // the notice says so before anything is pressed. Owner's rule of checking the
  // worst case: being refused here sent him back to writing a false abono.
  const capped = value < round2(quantity * line.unitPrice) - TOLERANCE;
  const { own, toFiados, rest } = planOfReturn(value, context.pendingOfFiado, context.otherFiados);
  const { source } = context;
  const isCash = source.kind === "contado";
  const walkIn = source.kind === "contado" && source.walkIn;

  const choices: ReturnChoice[] =
    source.kind === "fiado"
      ? choicesOfFiado(value, context.pendingOfFiado, context.otherFiados)
      : walkIn
        ? [{ kind: "devolver", fiados: [], aFavor: 0, efectivo: value }]
        : choicesOfCashSale(value, context.otherFiados);

  // The book as the card reads it: a saldo a favor is never printed with a minus.
  const book = (n: number) =>
    n < -TOLERANCE ? `${money(-n).primary} a favor` : money(Math.max(n, 0)).primary;
  const balance = context.bookBalance;
  const amount = (n: number) => money(n).primary;
  const worth = amount(value);
  // What the saldo adds up to afterwards: a client may already hold one.
  const saldoAfter = amount(round2(rest + Math.max(-balance, 0)));

  function buttonLabel(kind: ReturnChoice["kind"]) {
    switch (kind) {
      case "a_favor":
        return `Registrar saldo a favor (${amount(rest)})`;
      case "abonar":
        return `Abonar ${worth} a deuda`;
      case "abonar_y_devolver":
        return `Abonar ${amount(toFiados)} y devolver ${amount(rest)}`;
      case "abonar_y_dejar":
        return `Abonar ${amount(toFiados)} y dejar a favor ${amount(rest)}`;
      case "devolver_sobrante":
        return `Devolver (${amount(rest)})`;
      case "devolver":
        // Only the first frame draws it in brackets, beside the one that does.
        return isCash && !walkIn && toFiados <= 0 ? `Devolver (${worth})` : `Devolver ${worth}`;
    }
  }

  // What each button does, in his words. See the header.
  function moneyLines(): string[] {
    if (source.kind === "fiado") {
      const lines = [
        `Por cobrar ${book(balance)}`,
        `Total de este fiado ${amount(context.pendingOfFiado)}`,
        `Devolver baja este fiado a ${amount(round2(context.pendingOfFiado - own))} y por cobrar a ${amount(Math.max(round2(balance - own - toFiados), 0))}`,
      ];
      // No frame had these two when the cash button came in: they are the cash
      // sale's, saying «abonos» because that is what falls on a fiado.
      return rest > 0
        ? [
            ...lines,
            `Registrar como saldo a favor al cliente le queda disponible ${saldoAfter} para otra compra.`,
            `Devolver el sobrante se resta de abonos ${amount(rest)}`,
          ]
        : lines;
    }
    const stays = `Devolver los ${worth} sigue debiendo ${book(balance)}.`;
    if (walkIn) {
      return [
        `Devolver esta compra de contado sobrarán ${worth}`,
        "Es una venta sin cliente: el dinero se devuelve y no hay “Por cobrar” que cambie.",
        stays,
      ];
    }
    const porCobrar = `Por cobrar${currency ? ` en ${currency === "USD" ? "Dólares" : "Euros"}` : ""} ${book(balance)}`;
    if (toFiados <= 0) {
      return [
        porCobrar,
        `Registrar como saldo a favor al cliente le queda disponible ${saldoAfter} para otra compra.`,
        `Devolver esta compra se resta de ventas ${worth}`,
      ];
    }
    if (rest <= 0) {
      return [porCobrar, `Abonar ${worth} a lo que debe, quedaría debiendo ${book(round2(balance - value))}.`, stays];
    }
    return [
      porCobrar,
      `Abonar ${amount(toFiados)} y devolver ${amount(rest)} por cobrar queda en ${book(round2(balance - toFiados))}`,
      `Abonar ${amount(toFiados)} y dejar a favor ${amount(rest)} al cliente le quedan disponibles ${amount(rest)} para otra compra.`,
      stays,
    ];
  }

  async function register(choice: ReturnChoice) {
    if (guardia() || !line.id) return;
    setSaving(choice.kind);
    setError(null);
    const { fiados, aFavor, efectivo } = choice;
    const payload = { lineId: line.id, quantity, fiados, aFavor, efectivo };
    const result =
      source.kind === "fiado"
        ? await registrarDevolucion({ ...payload, movementId: source.movementId })
        : await registrarDevolucionDeContado({ ...payload, saleId: source.saleId });
    if (!result.ok) {
      setSaving(null);
      if (!avisarCuentaPausada(result.error)) setError(result.error);
      return;
    }
    toast.success("Devolución registrada");
    router.push(`/transacciones/${result.movementId}?registrada=1`);
  }

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
          <DialogTitle className="text-xl leading-[26px] font-medium">Registrar devolución</DialogTitle>
          <DialogClose asChild>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Cerrar" className="shrink-0" disabled={saving !== null}>
              <X className="size-5" aria-hidden="true" />
            </Button>
          </DialogClose>
        </div>

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

        {/* THE FRAME'S TWO AMBERS, as drawn, and on this fill `--brand-report`
            measures above the 4,5:1 floor. */}
        <ul className="flex list-disc flex-col rounded-lg border border-[#ffe586] bg-[#fffbeb] py-2.5 pr-2.5 pl-6 text-xs leading-4 font-semibold text-brand-report">
          {capped ? (
            <li>
              {value > 0
                ? `De esta venta solo quedan ${amount(value)} por devolver.`
                : "De esta venta ya se devolvió todo lo que se cobró."}
            </li>
          ) : null}
          {value > 0 ? moneyLines().map((text) => <li key={text}>{text}</li>) : null}
          <li>
            {line.stockCounted
              ? `${quantity === 1 ? "1 unidad vuelve" : `${quantity} unidades vuelven`} al inventario.`
              : "Este producto no lleva cantidad, así que el inventario no cambia."}
          </li>
          {/* Neither the frames of a fiado nor the Mostrador's draw this line. */}
          {isCash && !walkIn ? <li>No cuenta como abono o ingreso de dinero.</li> : null}
          <li>Puedes revertir la devolución desde el historial.</li>
        </ul>

        <div className="flex flex-col gap-4">
          {choices.map((choice, index) => (
            <Button
              key={choice.kind}
              type="button"
              variant={index === 0 ? "default" : "outline"}
              className="h-auto min-h-10 w-full py-2 text-base font-semibold whitespace-normal"
              disabled={saving !== null || value <= 0}
              onClick={() => void register(choice)}
            >
              {saving === choice.kind ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              {buttonLabel(choice.kind)}
            </Button>
          ))}
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </DialogContent>
    </Dialog>
  );
}
