"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ArrowDownLeft, ArrowUpRight, ImageOff, Undo2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { Fila, Grupo, NOMBRE_DE_MONEDA } from "@/components/dashboard/detail-rows";
import { restoreMovement } from "@/app/(app)/dashboard/actions";
import type { NotificationItem } from "@/app/(app)/actions";
import { formatCurrency, formatDateTime, formatPlazoDias } from "@/lib/format";
import { formatBs, formatDisplayCurrency, formatRateEquivalence } from "@/lib/exchange-rate/format";
import type { MovementCurrencyCode } from "@/lib/types";
import { avisarCuentaPausada } from "@/lib/cuenta-pausada";
import { useGuardiaDeCuentaPausada } from "@/components/dashboard/cuenta-pausada";

type MovementDeletedNotification = Extract<NotificationItem, { kind: "movement_deleted" }>;

export function MovementDeletionDialog({
  notification,
  open,
  onOpenChange,
  onRestored,
}: {
  notification: MovementDeletedNotification | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRestored: (id: string) => void;
}) {
  const router = useRouter();
  const [restoring, setRestoring] = useState(false);
  // Cuenta pausada: restaurar un movimiento cambia saldos.
  const guardia = useGuardiaDeCuentaPausada();

  if (!notification) return null;

  const { currency, entryCurrency, entryAmount, exchangeRateUsed } = notification;

  // FORMATEAR CON LA MONEDA DEL MOVIMIENTO, no con la del país vecino.
  //
  // Aquí estaba el fallo. Esta ficha llamaba a formatCurrency —el formateador
  // de PESOS COLOMBIANOS— para cualquier movimiento de cualquier negocio, así
  // que un cargo de 45 euros se leía "$ 45,00": un euro con signo de dólar,
  // justo en la pantalla donde el dueño decide si lo restaura. En dólares el
  // fallo se disfrazaba —"$ 1,08" contra el "$1.08" del resto de la app— y por
  // eso llevaba ahí desde el principio sin que nadie lo viera.
  //
  // La causa de verdad no era el formateo sino el dato: la notificación no
  // traía `currency`, así que esta ficha no podía acertar aunque quisiera.
  //
  // Y NO formatLedgerAmount, que es lo primero que probé: ese ayudante cae en
  // formatCurrency cuando no recibe la tasa de HOY, así que llamarlo desde
  // aquí —donde no hay tasa de hoy que pasarle— habría vuelto a pintar los
  // euros con signo de dólar. El mismo fallo por otra puerta.
  //
  // Y aquí no hace falta la tasa de hoy: este saldo está congelado en el
  // instante del borrado, y traducirlo a los bolívares de hoy mezclaría dos
  // momentos en una sola cifra.
  const enSuMoneda = (n: number) =>
    currency ? formatDisplayCurrency(n, currency) : formatCurrency(n);

  const montoGuardado = enSuMoneda(notification.amount);
  const saldo = enSuMoneda(notification.runningBalance);

  const monedaRegistrada: MovementCurrencyCode | null = currency ? (entryCurrency ?? currency) : null;

  // Lo que el dueño tecleó. Un movimiento escrito como Bs. 900 tiene que seguir
  // diciendo Bs. 900 aquí: si al borrarlo solo se ve "$1,08", el dueño no
  // reconoce el movimiento que está a punto de restaurar.
  const monto =
    monedaRegistrada === "VES" && entryAmount != null ? formatBs(entryAmount) : montoGuardado;

  // La otra cara, con la tasa SELLADA en el movimiento. Misma regla que la
  // ficha del historial, y por el mismo motivo: monto por tasa tiene que dar el
  // equivalente, o quien rehaga la cuenta creerá que la app se equivocó.
  const equivalente =
    currency && exchangeRateUsed != null
      ? monedaRegistrada === "VES"
        ? { texto: montoGuardado, moneda: currency as MovementCurrencyCode }
        : { texto: formatBs(notification.amount * exchangeRateUsed), moneda: "VES" as MovementCurrencyCode }
      : null;

  const tasa =
    currency && exchangeRateUsed != null ? formatRateEquivalence(currency, exchangeRateUsed) : null;

  const colorSaldo =
    notification.runningBalance > 0
      ? "text-destructive"
      : notification.runningBalance < 0
        ? "text-money-in"
        : "";

  async function handleRestore() {
    if (guardia()) return;
    setRestoring(true);
    const result = await restoreMovement(notification!.movementId);
    setRestoring(false);
    if (result.error) {
      if (!avisarCuentaPausada(result.error)) toast.error(result.error);
      return;
    }
    toast.success("Movimiento restaurado");
    onRestored(notification!.id);
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Movimiento eliminado</DialogTitle>
        </DialogHeader>

        {/* Mismos tres grupos y el mismo aire que la ficha del historial. Es el
            mismo movimiento visto desde otra pantalla; que se lea distinto solo
            obliga a aprenderlo dos veces. */}
        <dl className="flex flex-col gap-4">
          <Grupo>
            <Fila nombre="Cliente">{notification.clientName}</Fila>
            <Fila nombre="Fecha">{formatDateTime(notification.movementCreatedAt)}</Fila>
            <Fila nombre="Tipo">
              <span className="inline-flex items-center gap-1.5">
                {notification.type === "charge" ? "Cargo (fía)" : "Abono (paga)"}
                {notification.type === "charge" ? (
                  <ArrowUpRight className="size-3.5 text-destructive" aria-hidden />
                ) : (
                  <ArrowDownLeft className="size-3.5 text-money-in" aria-hidden />
                )}
              </span>
            </Fila>
            {monedaRegistrada ? (
              <Fila nombre="Moneda registrada">
                <span className="inline-flex items-center gap-1.5">
                  {NOMBRE_DE_MONEDA[monedaRegistrada]}
                  <CurrencyFlagIcon currency={monedaRegistrada} />
                </span>
              </Fila>
            ) : null}
          </Grupo>

          <Grupo>
            <Fila nombre="Monto">
              <span className="tabular-nums">{monto}</span>
            </Fila>
            {tasa ? (
              <Fila nombre="Tasa del día">
                <span className="tabular-nums">{tasa}</span>
              </Fila>
            ) : null}
            {equivalente ? (
              <Fila nombre="Equivalente">
                <span className="inline-flex items-center gap-1.5 tabular-nums">
                  {equivalente.texto}
                  <CurrencyFlagIcon currency={equivalente.moneda} />
                </span>
              </Fila>
            ) : null}
          </Grupo>

          <Grupo>
            <Fila nombre="Plazo de pago">{formatPlazoDias(notification.plazoDias)}</Fila>
            <Fila nombre="Detalle">
              <span className="break-words">{notification.description || "—"}</span>
            </Fila>
            <dt className="text-xs leading-5 text-muted-foreground">Foto</dt>
            <dd>
              {notification.photoUrl ? (
                <a href={notification.photoUrl} target="_blank" rel="noopener noreferrer">
                  <Image
                    src={notification.photoUrl}
                    alt="Foto del movimiento"
                    width={640}
                    height={360}
                    unoptimized
                    className="h-40 w-full rounded-lg border object-cover"
                  />
                </a>
              ) : (
                <div className="flex h-24 w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed bg-muted/40 text-muted-foreground">
                  <ImageOff className="size-5" aria-hidden />
                  <span className="text-xs">Sin foto adjunta</span>
                </div>
              )}
            </dd>
          </Grupo>

          <Grupo>
            <Fila nombre="Eliminado">{formatDateTime(notification.occurredAt)}</Fila>
          </Grupo>
        </dl>

        {/* "en ese momento" y no a secas: este saldo esta congelado en el
            instante del borrado. recalc_client_running_balance solo reescribe
            las filas vivas, asi que sigue diciendo lo que se debia entonces —
            no lo que se debe ahora. */}
        <div className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">Por cobrar (en ese momento)</span>
            <span className={`text-2xl font-semibold tabular-nums ${colorSaldo}`}>{saldo}</span>
          </div>
          {currency ? (
            <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
              {NOMBRE_DE_MONEDA[currency]}
              <CurrencyFlagIcon currency={currency} />
            </span>
          ) : null}
        </div>

        <DialogFooter>
          {notification.restored ? (
            <p className="text-sm font-medium text-money-in">Este movimiento ya fue restaurado.</p>
          ) : (
            <Button type="button" onClick={handleRestore} disabled={restoring} className="w-full">
              <Undo2 className="size-4" />
              {restoring ? "Restaurando..." : "Restaurar"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
