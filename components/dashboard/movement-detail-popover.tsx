"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
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
import { Button } from "@/components/ui/button";
import { deleteMovement } from "@/app/(app)/dashboard/actions";
import { formatCurrency, formatDate, formatPlazoDias } from "@/lib/format";
import { formatBs, formatDisplayCurrency, formatRateEquivalence } from "@/lib/exchange-rate/format";
import type { ExchangeRateMode, MovementCurrencyCode, MovementType } from "@/lib/types";

export function MovementDetailPopover({
  movementId,
  type,
  amount,
  description,
  plazoDias,
  createdAt,
  runningBalance,
  balanceLabel = "Por cobrar",
  photoUrl,
  entryCurrency = null,
  entryAmount = null,
  exchangeRateUsed = null,
  officialBcvRateAtTime = null,
  rateModeUsed = null,
  isBsLedger = false,
  children,
}: {
  // Only the owner's dashboard passes this — it's what shows the "Eliminar
  // movimiento" action. The public client page omits it entirely.
  movementId?: string;
  type: MovementType;
  amount: number;
  description: string | null;
  plazoDias: number | null;
  createdAt: string;
  runningBalance: number;
  // Label for the running-balance row — the owner's dashboard says "Por
  // cobrar"; the public client page says "Debe"/"A favor"/"Sin deuda".
  balanceLabel?: string;
  // undefined omits the "Foto" row entirely (e.g. the public share page,
  // which never exposes attachment photos). null means "no photo attached".
  photoUrl?: string | null;
  // Conversion trail — all null for a country='CO' owner and for every
  // movement recorded before the exchange-rate feature existed, in which
  // case none of these rows render at all.
  entryCurrency?: MovementCurrencyCode | null;
  entryAmount?: number | null;
  exchangeRateUsed?: number | null;
  officialBcvRateAtTime?: number | null;
  rateModeUsed?: ExchangeRateMode | null;
  // A VE owner's ledger is denominated in Bs, not COP — this picks which
  // formatter the Monto/balance rows use. Comes from the owner's country,
  // not from this movement, so a legacy movement in a VE owner's history
  // still renders in the same unit as the rest of their ledger.
  isBsLedger?: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Only movements actually entered in a foreign currency carry a
  // conversion worth showing — a Bs-entered movement had no conversion at
  // all, so its rate rows stay hidden rather than showing a rate that was
  // never applied.
  const conversion =
    (entryCurrency === "USD" || entryCurrency === "EUR") &&
    entryAmount != null &&
    exchangeRateUsed != null
      ? { currency: entryCurrency, amount: entryAmount, rate: exchangeRateUsed }
      : null;

  // The objective comparison point, shown to owner and client alike — only
  // meaningful when the business used its own rate (in BCV_AUTO mode the
  // applied rate IS the official one, so a second identical row is noise).
  const officialRate =
    conversion && rateModeUsed === "CUSTOM" && officialBcvRateAtTime != null
      ? officialBcvRateAtTime
      : null;

  const formatLedger = (value: number) => (isBsLedger ? formatBs(value) : formatCurrency(value));

  async function handleDelete() {
    if (!movementId) return;
    setDeleting(true);
    const result = await deleteMovement(movementId);
    setDeleting(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success("Movimiento eliminado");
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Detalle del movimiento</DialogTitle>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
          <dt className="text-muted-foreground">Tipo</dt>
          <dd>{type === "charge" ? "Fiado (cargo)" : "Abono (pago)"}</dd>

          <dt className="text-muted-foreground">Plazo de pago</dt>
          <dd>{formatPlazoDias(plazoDias)}</dd>

          {conversion ? (
            <>
              <dt className="text-muted-foreground">Monto original</dt>
              <dd className="tabular-nums">
                {formatDisplayCurrency(conversion.amount, conversion.currency)} {conversion.currency}
              </dd>

              <dt className="text-muted-foreground">Tasa de cambio</dt>
              <dd className="tabular-nums">
                {formatRateEquivalence(conversion.currency, conversion.rate)}
              </dd>
            </>
          ) : null}

          {officialRate !== null && conversion ? (
            <>
              <dt className="text-muted-foreground">Tasa oficial BCV</dt>
              <dd className="tabular-nums">
                {formatRateEquivalence(conversion.currency, officialRate)}
                <span className="ml-1 text-muted-foreground">(ese día)</span>
              </dd>
            </>
          ) : null}

          <dt className="text-muted-foreground">Monto</dt>
          <dd className="tabular-nums">{formatLedger(amount)}</dd>

          <dt className="text-muted-foreground">Detalle</dt>
          <dd className="truncate">{description || "—"}</dd>

          {photoUrl !== undefined ? (
            <>
              <dt className="text-muted-foreground">Foto</dt>
              <dd>
                {photoUrl ? (
                  <a href={photoUrl} target="_blank" rel="noopener noreferrer">
                    <Image
                      src={photoUrl}
                      alt="Foto del movimiento"
                      width={64}
                      height={64}
                      unoptimized
                      className="size-16 rounded-md border object-cover"
                    />
                  </a>
                ) : (
                  "—"
                )}
              </dd>
            </>
          ) : null}

          <dt className="text-muted-foreground">Fecha</dt>
          <dd>{formatDate(createdAt)}</dd>

          <dt className="text-muted-foreground">{balanceLabel}</dt>
          <dd className="font-medium tabular-nums">{formatLedger(runningBalance)}</dd>
        </dl>

        {movementId ? (
          <AlertDialog>
            <div className="-mt-1 flex border-t pt-2.5">
              <AlertDialogTrigger asChild>
                <Button type="button" variant="destructive" size="icon">
                  <Trash2 className="size-4" />
                  <span className="sr-only">Eliminar movimiento</span>
                </Button>
              </AlertDialogTrigger>
            </div>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Eliminar este movimiento?</AlertDialogTitle>
                <AlertDialogDescription>
                  Se recalculará el saldo de este cliente y el capital por cobrar. Podrás
                  restaurarlo después desde Notificaciones.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={handleDelete} disabled={deleting}>
                  {deleting ? "Eliminando..." : "Eliminar"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
