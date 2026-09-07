"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EyeOff, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
import { hideClientPermanently, restoreClient } from "@/app/(app)/clients/[id]/actions";
import { formatDate } from "@/lib/format";
import { formatBalanceSummary, type LedgerDisplay } from "@/lib/exchange-rate/movement-display";
import { MALA_PAGA_BADGE_CLASS, type ClientSummaryAll } from "@/lib/types";
import { track } from "@/lib/mixpanel";

export function PapeleraTable({ rows, ledger }: { rows: ClientSummaryAll[]; ledger: LedgerDisplay | null }) {
  const router = useRouter();
  // The client currently being hidden for good, or null. Held as the row
  // itself rather than a boolean, so the confirmation can name the person and
  // the amount without a second lookup.
  const [hiding, setHiding] = useState<ClientSummaryAll | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  if (rows.length === 0) {
    return (
      <p className="rounded-lg border bg-muted/30 px-3 py-6 text-center text-sm text-muted-foreground">
        Tu papelera está vacía.
      </p>
    );
  }

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

  return (
    <>
      {/* One card per client rather than a table: this list is read on a phone,
          it is short by nature, and every row carries two actions that need to
          be tappable rather than squeezed into a trailing column. */}
      <ul className="flex flex-col gap-2">
        {rows.map((row) => {
          // The balance frozen when they were hidden, not today's — today's is
          // the same number, but the snapshot is what the totals lost and what
          // a later report will quote.
          const owed = formatBalanceSummary(
            row.trashed_balance ?? 0,
            row.trashed_balance_usd ?? 0,
            row.trashed_balance_eur ?? 0,
            ledger,
          );
          const busy = busyId === row.client_id;
          return (
            <li
              key={row.client_id}
              // The whole card opens the client, matching the rows in Cartera
              // and Clientes — on a phone the name alone is a small target,
              // and a card that looks like a row should behave like one.
              className="flex cursor-pointer flex-col gap-2 rounded-lg border bg-muted/30 px-3 py-2 hover:bg-accent/40"
              onClick={() => {
                track("Client Details Opened", { client_id: row.client_id, source: "papelera" });
                router.push(`/clients/${row.client_id}`);
              }}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link
                    href={`/clients/${row.client_id}`}
                    className="font-medium underline-offset-4 hover:underline"
                    // Kept as a real link so the card is reachable by keyboard
                    // and openable in a new tab. Stopping propagation lets the
                    // anchor navigate on its own instead of the card's handler
                    // pushing the same route a second time.
                    onClick={(e) => e.stopPropagation()}
                  >
                    {row.name}
                  </Link>
                  <p className="text-sm text-muted-foreground">
                    En la papelera desde {row.trashed_at ? formatDate(row.trashed_at) : "—"}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="tabular-nums font-medium">{owed}</span>
                  {row.is_flagged ? (
                    <Badge variant="outline" className={MALA_PAGA_BADGE_CLASS}>
                      Mala paga
                    </Badge>
                  ) : null}
                </div>
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
            </li>
          );
        })}
      </ul>

      <AlertDialog open={hiding !== null} onOpenChange={(open) => (open ? null : setHiding(null))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ocultar a {hiding?.name} definitivamente</AlertDialogTitle>
            <AlertDialogDescription>
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
