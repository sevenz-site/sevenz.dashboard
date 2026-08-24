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
  DialogTrigger,
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
import { MovementCurrencyField } from "@/components/dashboard/movement-currency-field";
import { formatCurrency } from "@/lib/format";
import { formatBs, formatDisplayCurrency } from "@/lib/exchange-rate/format";
import { fromUsd, type MovementCurrency, type MovementRateContext } from "@/lib/exchange-rate/convert";
import { track } from "@/lib/mixpanel";
import { cn } from "@/lib/utils";
import { DEFAULT_PLAZO_PAGO } from "@/lib/types";

const initialState: MovementFormState = { error: null, clientId: null };

export function AddMovementDialog({
  clientId,
  clientName,
  ownerId,
  currentDebt,
  isFlagged,
  triggerClassName,
  rateContext,
}: {
  clientId: string;
  clientName: string;
  ownerId: string;
  currentDebt: number;
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
  const [currency, setCurrency] = useState<MovementCurrency>("VES");
  const [amountStr, setAmountStr] = useState("");
  const canPay = currentDebt > 0;
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState(addMovement, initialState);
  const [prevOpen, setPrevOpen] = useState(open);

  // The debt cap has to be expressed in whatever currency the owner is
  // currently typing in — currentDebt is USD (the ledger's unit for a VE
  // owner), so a Bs or EUR entry needs converting before it can be compared.
  const maxDebtInCurrency = rateContext
    ? fromUsd(currentDebt, currency, rateContext.effectiveRate)
    : currentDebt;
  const formattedMaxDebt = rateContext
    ? currency === "VES"
      ? formatBs(maxDebtInCurrency)
      : formatDisplayCurrency(maxDebtInCurrency, currency)
    : formatCurrency(currentDebt);

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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className={cn(triggerClassName)}>
          <Plus className="size-4" />
          Agregar movimiento
        </Button>
      </DialogTrigger>
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
            {!canPay ? (
              <p className="text-xs text-muted-foreground">
                {clientName} no debe nada — no se puede registrar un abono.
              </p>
            ) : null}
          </div>

          {type === "charge" ? <PlazoPagoSelect value={plazoPago} onValueChange={setPlazoPago} /> : null}

          <div className="flex flex-col gap-2">
            <Label htmlFor="amount">Monto</Label>
            <Input
              id="amount"
              name="amount"
              type="number"
              min="0"
              max={type === "payment" ? maxDebtInCurrency : undefined}
              step="0.01"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              required
            />
            {type === "payment" ? (
              <p className="text-xs text-muted-foreground">
                Máximo {formattedMaxDebt} — lo que {clientName} debe hoy.
              </p>
            ) : null}
          </div>

          {rateContext ? (
            <MovementCurrencyField
              amount={amountStr}
              currency={currency}
              onCurrencyChange={setCurrency}
              rateContext={rateContext}
            />
          ) : null}

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
                    {pending ? "Guardando..." : "Guardar"}
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
                {pending ? "Guardando..." : "Guardar"}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
