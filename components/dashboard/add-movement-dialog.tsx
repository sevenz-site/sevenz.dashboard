"use client";

import { useActionState, useEffect, useState } from "react";
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
import { formatCurrency } from "@/lib/format";
import { DEFAULT_PLAZO_PAGO } from "@/lib/types";

const initialState: MovementFormState = { error: null, clientId: null };

export function AddMovementDialog({
  clientId,
  clientName,
  ownerId,
  currentDebt,
}: {
  clientId: string;
  clientName: string;
  ownerId: string;
  currentDebt: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"charge" | "payment">("charge");
  const [plazoPago, setPlazoPago] = useState(DEFAULT_PLAZO_PAGO);
  const canPay = currentDebt > 0;
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState(addMovement, initialState);
  const [prevOpen, setPrevOpen] = useState(open);

  if (open !== prevOpen) {
    setPrevOpen(open);
    if (!open) setPhotoPath(null);
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
      router.refresh();
    }
  }, [state, pending, router]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" />
          Agregar movimiento
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Registrar movimiento</DialogTitle>
          <DialogDescription>Para {clientName} · el saldo se recalcula automáticamente.</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
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
              max={type === "payment" ? currentDebt : undefined}
              step="0.01"
              required
            />
            {type === "payment" ? (
              <p className="text-xs text-muted-foreground">
                Máximo {formatCurrency(currentDebt)} — lo que {clientName} debe hoy.
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
            <Button type="submit" disabled={pending}>
              {pending ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
