"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { addMovement, type MovementFormState } from "@/app/(app)/dashboard/actions";
import { AttachmentUploader } from "@/components/dashboard/attachment-uploader";
import { PlazoPagoSelect } from "@/components/dashboard/plazo-pago-select";
import { LedgerCurrencyRadio, BsAmountPreview } from "@/components/dashboard/movement-currency-field";
import { formatCurrency } from "@/lib/format";
import { formatDisplayCurrency } from "@/lib/exchange-rate/format";
import type { MovementRateContext } from "@/lib/exchange-rate/convert";
import { track } from "@/lib/mixpanel";
import { cn } from "@/lib/utils";
import { DEFAULT_PLAZO_PAGO, DEFAULT_LEDGER_CURRENCY, type LedgerCurrency } from "@/lib/types";

const initialState: MovementFormState = { error: null, clientId: null };

export function AddMovementDialog({
  clientId,
  clientName,
  ownerId,
  currentDebtCop,
  currentDebtUsd,
  currentDebtEur,
  isFlagged,
  triggerClassName,
  rateContext,
}: {
  clientId: string;
  clientName: string;
  ownerId: string;
  // COP debt — used when rateContext is null (a 'CO' owner).
  currentDebtCop: number;
  // Independent per-currency debts — used when rateContext is present. A
  // client can owe in one currency, the other, both, or neither.
  currentDebtUsd: number;
  currentDebtEur: number;
  isFlagged: boolean;
  // Lets the client detail page's mobile layout make this button full-width
  // without affecting the default (desktop) trigger.
  triggerClassName?: string;
  // Only present for a country='VE' owner with a rate already fetched —
  // null means "behave exactly like today's COP flow", no currency select.
  rateContext: MovementRateContext | null;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"charge" | "payment">("charge");
  const [plazoPago, setPlazoPago] = useState(DEFAULT_PLAZO_PAGO);
  const [currency, setCurrency] = useState<LedgerCurrency>(DEFAULT_LEDGER_CURRENCY);
  const [amountStr, setAmountStr] = useState("");
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState(addMovement, initialState);
  const [prevOpen, setPrevOpen] = useState(open);

  // The debt each currency owes is independent — no conversion, since the
  // cap is the currency the owner is actively typing in. Switching between
  // USD/EUR while "Abono" is open picks a different cap live.
  const currentDebt = rateContext ? (currency === "USD" ? currentDebtUsd : currentDebtEur) : currentDebtCop;
  const canPay = currentDebt > 0;
  const formattedMaxDebt = rateContext ? formatDisplayCurrency(currentDebt, currency) : formatCurrency(currentDebt);

  // Whether "Agregar abono" should even be clickable — checked against
  // whichever currency actually has debt, not just the one currently
  // selected (which defaults to USD before the dialog has ever opened).
  const canPayAny = rateContext ? currentDebtUsd > 0 || currentDebtEur > 0 : currentDebtCop > 0;

  function openForCharge() {
    setType("charge");
    setOpen(true);
  }

  function openForPayment() {
    // Land on whichever currency actually has debt, so the in-dialog
    // Select isn't immediately reverted back to "charge" by the
    // type === "payment" && !canPay guard below.
    if (rateContext && currentDebtUsd <= 0 && currentDebtEur > 0) {
      setCurrency("EUR");
    }
    setType("payment");
    setOpen(true);
  }

  // "Abono" only makes sense for a currency that's actually owed — if the
  // owner picks payment then switches to a currency with no debt, fall back
  // to a charge rather than leaving an invalid combination selected.
  if (type === "payment" && !canPay) {
    setType("charge");
  }

  if (open !== prevOpen) {
    setPrevOpen(open);
    if (!open) {
      setPhotoPath(null);
      setAmountStr("");
    }
  }

  const [handledState, setHandledState] = useState(state);
  if (state !== handledState && state.clientId) {
    setHandledState(state);
    setOpen(false);
  }

  useEffect(() => {
    if (state === initialState || pending || state.error) return;
    if (state.clientId) {
      toast.success("Movimiento registrado");
      track("Movement Added", { client_id: state.clientId, movement_type: type });
      router.refresh();
    }
  }, [state, pending, router, type]);

  return (
    <>
      <div className={cn("flex gap-2", triggerClassName)}>
        <Button size="sm" className="flex-1" onClick={openForCharge}>
          <Plus className="size-4" />
          Agregar fiado
        </Button>
        <Button size="sm" variant="outline" className="flex-1" disabled={!canPayAny} onClick={openForPayment}>
          <Plus className="size-4" />
          Agregar abono
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Registrar movimiento</DialogTitle>
          <DialogDescription>Para {clientName} · el saldo se recalcula automáticamente.</DialogDescription>
        </DialogHeader>
        <form ref={formRef} action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="client_id" value={clientId} />

          <div className="flex flex-col gap-2">
            <Label>Tipo</Label>
            <Select name="type" value={type} onValueChange={(v) => setType(v as "charge" | "payment")}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="charge">Cargo (fía algo)</SelectItem>
                <SelectItem value="payment" disabled={!canPay}>
                  Abono (paga)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {type === "charge" ? <PlazoPagoSelect value={plazoPago} onValueChange={setPlazoPago} /> : null}

          {rateContext ? <LedgerCurrencyRadio currency={currency} onCurrencyChange={setCurrency} /> : null}

          <div className="flex flex-col gap-2">
            <Label htmlFor="amount">Monto</Label>
            <Input
              id="amount"
              name="amount"
              type="number"
              min="0"
              max={type === "payment" ? currentDebt : undefined}
              step="0.01"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              required
            />
            {rateContext ? (
              <BsAmountPreview amount={amountStr} currency={currency} rateContext={rateContext} />
            ) : null}
            {type === "payment" ? (
              <p className="text-xs text-muted-foreground">
                Máximo {formattedMaxDebt} — lo que {clientName} debe hoy.
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="description">Detalle (opcional)</Label>
            <Input id="description" name="description" />
          </div>

          <div className="flex flex-col gap-2">
            <Label>Foto (opcional)</Label>
            <AttachmentUploader ownerId={ownerId} value={photoPath} onChange={setPhotoPath} />
            <input type="hidden" name="photo_path" value={photoPath ?? ""} />
          </div>

          {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}

          <DialogFooter>
            {isFlagged && type === "charge" ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" variant="destructive" disabled={pending}>
                    {pending ? "Guardando fiado..." : "Guardar fiado"}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{clientName} está marcado como Mala paga</AlertDialogTitle>
                    <AlertDialogDescription>
                      Revisa el motivo en su historial. ¿Fiarle de todas formas?
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                      variant="destructive"
                      onClick={() => formRef.current?.requestSubmit()}
                    >
                      Fiar de todas formas
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : (
              <Button type="submit" disabled={pending}>
                {pending
                  ? type === "charge"
                    ? "Guardando fiado..."
                    : "Guardando abono..."
                  : type === "charge"
                    ? "Guardar fiado"
                    : "Guardar abono"}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
      </Dialog>
    </>
  );
}
