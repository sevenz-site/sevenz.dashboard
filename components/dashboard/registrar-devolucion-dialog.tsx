"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Fecha } from "@/components/fecha";
import { useGuardiaDeCuentaPausada } from "@/components/dashboard/cuenta-pausada";
import { avisarCuentaPausada } from "@/lib/cuenta-pausada";
import { registrarDevolucion } from "@/app/(app)/devoluciones/actions";
import { choicesFor, splitOfReturn, spreadOverFiados, type OtherFiado, type ReturnChoice } from "@/lib/returns/options";
import type { SaleLineRow } from "@/lib/sale-lines";

// THE CONFIRMATION OF A RETURN, with its consequences. Owner's request of
// 2026-11-03: *«al seleccionar la opción mostrará modal de confirmación con las
// consecuencias»*. There is no frame for it; the words and the layout are
// mine, and the report says so.
//
// WHAT IT ASKS, AND WHEN, IS THE TABLE AT THE TOP OF `lib/returns/options.ts`:
// by currency, whether something is left over, and what is offered. This file
// only draws that table. `registrar_devolucion` checks all of it again.

export type ReturnContext = {
  movementId: string;
  // What this fiado still owes.
  pendingOfFiado: number;
  // The other open fiados OF THE SAME CURRENCY. A debt in the other book does
  // not appear here on purpose: it changes nothing in the table.
  otherFiados: OtherFiado[];
};

const CHOICE_LABEL: Record<ReturnChoice, string> = {
  fiados: "Abonar a otros fiados",
  a_favor: "Dejar como saldo a favor",
  efectivo: "Entregar en efectivo",
};

const SPREAD_ALL = "todos";

const round2 = (n: number) => Math.round(n * 100) / 100;

function Option({
  selected,
  onSelect,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`flex min-h-10 w-full items-center justify-between gap-2 rounded-[10px] border px-3 py-2 text-left text-sm leading-5 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${
        selected ? "border-primary bg-accent" : "border-border"
      }`}
    >
      {children}
    </button>
  );
}

export function RegistrarDevolucionDialog({
  open,
  onOpenChange,
  line,
  context,
  formatAmount,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  line: SaleLineRow;
  context: ReturnContext;
  formatAmount: (amount: number) => string;
}) {
  const router = useRouter();
  const guardia = useGuardiaDeCuentaPausada();
  const available = round2(line.quantity - (line.devuelto ?? 0));
  const [quantity, setQuantity] = useState(Math.min(1, available));
  const [choice, setChoice] = useState<ReturnChoice | null>(null);
  const [spreadOn, setSpreadOn] = useState<string>(SPREAD_ALL);
  const [restChoice, setRestChoice] = useState<ReturnChoice | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const value = round2(quantity * line.unitPrice);
  const { own, leftOver } = splitOfReturn(value, context.pendingOfFiado);
  const otherDebt = round2(context.otherFiados.reduce((sum, f) => sum + f.pending, 0));
  const choices = choicesFor(leftOver, otherDebt);

  // A CHOICE THAT STOPPED BEING OFFERED IS NOT A CHOICE. Changing the quantity
  // can make the left-over vanish or change what is on the table.
  const chosen = choice && choices.includes(choice) ? choice : null;

  const spread =
    chosen === "fiados"
      ? spreadOverFiados(leftOver, context.otherFiados, spreadOn === SPREAD_ALL ? null : spreadOn)
      : { lines: [], rest: 0 };
  const toFiados = round2(spread.lines.reduce((sum, l) => sum + l.amount, 0));

  // WHAT IS STILL LEFT AFTER THE ABONO. Saldo a favor only with no debt left in
  // this book, which is the last row of the table.
  const restChoices: ReturnChoice[] = choicesFor(spread.rest, round2(otherDebt - toFiados)).filter(
    (c) => c !== "fiados",
  );
  const chosenRest = restChoice && restChoices.includes(restChoice) ? restChoice : null;

  const aFavor = round2(
    (chosen === "a_favor" ? leftOver : 0) + (chosenRest === "a_favor" ? spread.rest : 0),
  );
  const efectivo = round2(
    (chosen === "efectivo" ? leftOver : 0) + (chosenRest === "efectivo" ? spread.rest : 0),
  );

  const decided =
    leftOver === 0 || (chosen != null && (spread.rest === 0 || chosenRest != null));

  async function confirm() {
    if (guardia() || !line.id) return;
    setSaving(true);
    setError(null);
    const result = await registrarDevolucion({
      movementId: context.movementId,
      lineId: line.id,
      quantity,
      fiados: spread.lines,
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

  return (
    <Dialog open={open} onOpenChange={(o) => (saving ? null : onOpenChange(o))}>
      {/* `grid-cols` is the DESIGN-SYSTEM.md trap of a `DialogContent` that does
          not shrink; `dvh` the trap of the toolbar. */}
      <DialogContent className="max-h-[85dvh] grid-cols-[minmax(0,1fr)] gap-4 overflow-y-auto rounded-[16px] bg-background p-4">
        <div className="flex flex-col gap-1 pr-6">
          <DialogTitle className="text-xl leading-[26px] font-medium">Registrar devolución</DialogTitle>
          <DialogDescription className="text-sm leading-5 break-words">{line.name}</DialogDescription>
        </div>

        {available > 1 ? (
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm leading-5">Unidades devueltas</span>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-10"
                aria-label="Una unidad menos"
                disabled={quantity <= 1 || saving}
                onClick={() => setQuantity((q) => Math.max(1, round2(q - 1)))}
              >
                <Minus className="size-4" aria-hidden="true" />
              </Button>
              <span className="min-w-8 text-center text-base font-semibold tabular-nums">{quantity}</span>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-10"
                aria-label="Una unidad más"
                disabled={quantity >= available || saving}
                onClick={() => setQuantity((q) => Math.min(available, round2(q + 1)))}
              >
                <Plus className="size-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        ) : null}

        <div className="flex flex-col gap-1 rounded-[10px] border p-3 text-sm leading-5">
          <p className="flex justify-between gap-3">
            <span className="text-muted-foreground">Valor devuelto</span>
            <span className="font-semibold tabular-nums">{formatAmount(value)}</span>
          </p>
          <ul className="flex list-disc flex-col gap-1 pt-1 pl-4 text-xs leading-4 text-muted-foreground">
            {own > 0 ? (
              <li>
                {own >= context.pendingOfFiado - 0.005
                  ? "Este fiado queda pagado."
                  : `Este fiado baja ${formatAmount(own)}.`}
              </li>
            ) : null}
            <li>
              {line.stockCounted
                ? `${quantity === 1 ? "1 unidad vuelve" : `${quantity} unidades vuelven`} al inventario.`
                : "Este producto no lleva cantidad, así que el inventario no cambia."}
            </li>
            <li>No cuenta como dinero que entró.</li>
            <li>Puedes eliminarla desde su detalle si fue un error.</li>
          </ul>
        </div>

        {leftOver > 0 ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm leading-5">
              Sobran <span className="font-semibold tabular-nums">{formatAmount(leftOver)}</span> que el cliente ya
              pagó. ¿Qué haces con ese dinero?
            </p>
            {choices.map((c) => (
              <Option key={c} selected={chosen === c} onSelect={() => setChoice(c)}>
                {CHOICE_LABEL[c]}
              </Option>
            ))}

            {chosen === "efectivo" && otherDebt > 0.005 ? (
              <p className="text-xs leading-4 text-muted-foreground">
                Este cliente todavía debe {formatAmount(otherDebt)} en esta moneda.
              </p>
            ) : null}

            {chosen === "fiados" ? (
              <div className="flex flex-col gap-2 border-t pt-2">
                <p className="text-sm leading-5">¿A qué fiado?</p>
                {context.otherFiados.length > 1 ? (
                  <Option selected={spreadOn === SPREAD_ALL} onSelect={() => setSpreadOn(SPREAD_ALL)}>
                    Repartir, del más antiguo al más nuevo
                  </Option>
                ) : null}
                {context.otherFiados.map((f) => (
                  <Option
                    key={f.id}
                    selected={spreadOn === f.id || context.otherFiados.length === 1}
                    onSelect={() => setSpreadOn(f.id)}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{f.title}</span>
                      <span className="text-xs leading-4 text-muted-foreground">
                        <Fecha iso={f.chargeAt} />
                      </span>
                    </span>
                    <span className="shrink-0 tabular-nums">Debe {formatAmount(f.pending)}</span>
                  </Option>
                ))}
              </div>
            ) : null}

            {spread.rest > 0 ? (
              <div className="flex flex-col gap-2 border-t pt-2">
                <p className="text-sm leading-5">
                  Aún quedan <span className="font-semibold tabular-nums">{formatAmount(spread.rest)}</span>. ¿Qué
                  haces con ese dinero?
                </p>
                {restChoices.map((c) => (
                  <Option key={c} selected={chosenRest === c} onSelect={() => setRestChoice(c)}>
                    {CHOICE_LABEL[c]}
                  </Option>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <div className="flex flex-col gap-3">
          <Button
            type="button"
            className="h-10 w-full text-base font-semibold"
            disabled={saving || !decided}
            onClick={() => void confirm()}
          >
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Registrando...
              </>
            ) : (
              "Registrar devolución"
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-10 w-full text-base font-semibold"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
