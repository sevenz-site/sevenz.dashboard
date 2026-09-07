"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { EyeOff, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ClientCardBody,
  CLIENT_CARD_ROW,
  CLIENT_CARD_SHELL,
} from "@/components/dashboard/client-card";
import { hideClientPermanently, restoreClient } from "@/app/(app)/clients/[id]/actions";
import { formatDate } from "@/lib/format";
import { combinedBalanceUsd } from "@/lib/exchange-rate/convert";
import type { OwnerRateContext } from "@/lib/exchange-rate/owner-rate";
import { formatBalanceSummary } from "@/lib/exchange-rate/movement-display";
import { cn } from "@/lib/utils";
import { getClientStatus, type ClientSummaryAll } from "@/lib/types";
import { track } from "@/lib/mixpanel";

export function PapeleraTable({
  rows,
  rateContext = null,
}: {
  rows: ClientSummaryAll[];
  rateContext?: OwnerRateContext | null;
}) {
  const router = useRouter();
  // The client currently being hidden for good, or null. Held as the row
  // itself rather than a boolean, so the confirmation can name the person
  // without a second lookup.
  const [hiding, setHiding] = useState<ClientSummaryAll | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const ledger = rateContext ? { rate: rateContext.effectiveRate } : null;

  async function handleRestore(row: ClientSummaryAll) {
    setBusyId(row.client_id);
    const result = await restoreClient(row.client_id);
    setBusyId(null);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success(`${row.name} volvió a tu cartera`);
    track("Client Restored", { client_id: row.client_id, source: "papelera" });
    router.refresh();
  }

  async function handleHide() {
    if (!hiding) return;
    const row = hiding;
    setBusyId(row.client_id);
    const result = await hideClientPermanently(row.client_id);
    setBusyId(null);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    setHiding(null);
    toast.success(`${row.name} quedó oculto definitivamente`);
    track("Client Hidden Permanently", { client_id: row.client_id, source: "papelera" });
    router.refresh();
  }

  if (rows.length === 0) {
    return (
      <p className="rounded-[14px] border bg-background px-4 py-6 text-center text-sm text-muted-foreground">
        Tu papelera está vacía.
      </p>
    );
  }

  return (
    <>
      {/* Same card as Cartera, Clientes and Malas pagas — ClientCardBody is
          shared, so the four cannot drift. The wrapper differs: those three
          are a <button>, and this one carries two action buttons inside the
          card, which a <button> cannot legally contain. */}
      <div className="flex flex-col gap-3">
        {rows.map((row) => {
          // Everything here reads the snapshot taken when the client was
          // hidden, not today's ledger. Today's is the same number, but the
          // snapshot is what left the totals, and it is what a report will
          // quote — so the card and the report say the same thing.
          const balance = row.trashed_balance ?? 0;
          const balanceUsd = row.trashed_balance_usd ?? 0;
          const balanceEur = row.trashed_balance_eur ?? 0;
          const judgementBalance = rateContext
            ? combinedBalanceUsd(balanceUsd, balanceEur, rateContext.effectiveRate)
            : balance;
          const status = getClientStatus(
            judgementBalance,
            row.days_since_payment,
            row.oldest_unpaid_charge_at,
            row.oldest_unpaid_charge_plazo_dias,
          );
          const busy = busyId === row.client_id;
          return (
            <div
              key={row.client_id}
              // The whole card opens the client, matching the rows in Cartera
              // and Clientes — on a phone the name alone is a small target,
              // and a card that looks like a row should behave like one.
              className={cn(CLIENT_CARD_SHELL, "flex cursor-pointer flex-col gap-3")}
              role="link"
              tabIndex={0}
              onClick={() => {
                track("Client Details Opened", { client_id: row.client_id, source: "papelera" });
                router.push(`/clients/${row.client_id}`);
              }}
              onKeyDown={(e) => {
                // role="link" rather than a real anchor, because an anchor
                // wrapping the action buttons would make them links too. That
                // trade means the keyboard behaviour has to be supplied here.
                if (e.key !== "Enter" && e.key !== " ") return;
                if (e.target !== e.currentTarget) return;
                e.preventDefault();
                router.push(`/clients/${row.client_id}`);
              }}
            >
              <div className={CLIENT_CARD_ROW}>
                <ClientCardBody
                  name={row.name}
                  documentId={row.document_id}
                  status={status}
                  hasPendingReview={row.has_pending_review}
                  isFlagged={row.is_flagged}
                  balance={balance}
                  balanceUsd={balanceUsd}
                  balanceEur={balanceEur}
                  ledger={ledger}
                  note={
                    row.trashed_at ? `En la papelera desde ${formatDate(row.trashed_at)}` : undefined
                  }
                />
              </div>
              {/* Inside a clickable card, so every click here has to stop
                  before it reaches the card's handler — otherwise Restaurar
                  would also navigate away from the screen that was about to
                  show the result, and Ocultar would open its confirmation on
                  top of a page that is already leaving. */}
              <div className="flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                <Button variant="outline" size="sm" disabled={busy} onClick={() => void handleRestore(row)}>
                  <RotateCcw className="size-4" />
                  Restaurar
                </Button>
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => setHiding(row)}>
                  <EyeOff className="size-4" />
                  Ocultar definitivamente
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <AlertDialog open={hiding !== null} onOpenChange={(open) => (open ? null : setHiding(null))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ocultar a {hiding?.name} definitivamente</AlertDialogTitle>
            <AlertDialogDescription>
              {hiding
                ? `Debe ${formatBalanceSummary(
                    hiding.trashed_balance ?? 0,
                    hiding.trashed_balance_usd ?? 0,
                    hiding.trashed_balance_eur ?? 0,
                    ledger,
                  )}. `
                : null}
              Deja de aparecer también en la Papelera y no vas a poder restaurarlo tú mismo. Su historial no se
              borra y su enlace de saldo sigue funcionando, para que pueda pagarte si algún día vuelve.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyId !== null}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={busyId !== null}
              onClick={(e) => {
                e.preventDefault();
                void handleHide();
              }}
            >
              {busyId !== null ? "Ocultando…" : "Ocultar definitivamente"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
