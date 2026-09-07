"use client";

import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatLedgerAmount, type LedgerDisplay } from "@/lib/exchange-rate/movement-display";
import { formatDocumentId } from "@/lib/format";
import {
  CLIENT_STATUS_BADGE_CLASS,
  CLIENT_STATUS_LABEL,
  MALA_PAGA_BADGE_CLASS,
  type ClientStatus,
} from "@/lib/types";

// Compact-card-only palette for the left status bar — the status itself is
// a CLIENT_STATUS_BADGE_CLASS chip, same as the table, and the bar now
// matches that chip's own color family (a pill's background color doesn't
// translate directly to a 3px stripe, so this is its own map, not a literal
// reuse of the chip classes) rather than diverging for dentro_del_plazo.
const CLIENT_STATUS_ACCENT_CLASS: Record<ClientStatus, string> = {
  sin_deuda: "bg-muted-foreground/30",
  a_favor: "bg-emerald-500",
  dentro_del_plazo: "bg-sky-500",
  plazo_vencido: "bg-amber-500",
  sin_plazo: "bg-amber-500",
  critico: "bg-red-500",
};

// The phone card used for a client wherever one is listed — Cartera, Clientes,
// Malas pagas and Papelera. Extracted from client-table.tsx so the four stay
// identical: the styling here is finely tuned (the name's min-width, the
// document's max-width, which element gives way when all three compete for one
// row) and a second copy of it would drift on the first change.
//
// The shell and the row are separate classes because the wrapper is the
// caller's. Clientes wraps this in a <button>; Papelera needs action buttons
// inside the same card, and a <button> inside a <button> is invalid HTML, so
// it uses a div and stacks this row above its own actions.
export const CLIENT_CARD_SHELL =
  "w-full rounded-[14px] border bg-background px-4 py-3.5 text-left transition-colors active:bg-accent";
export const CLIENT_CARD_ROW = "flex items-center gap-3.5";

export function ClientCardBody({
  name,
  documentId,
  status,
  hasPendingReview = false,
  isFlagged,
  balance,
  balanceUsd,
  balanceEur,
  ledger,
  note,
}: {
  name: string;
  documentId: string | null;
  status: ClientStatus;
  hasPendingReview?: boolean;
  isFlagged: boolean;
  // A CO owner's debt is `balance` (COP); a VE owner's is the two independent
  // per-currency balances, which are never summed. `ledger` non-null is what
  // says which of the two this owner is.
  balance: number;
  balanceUsd: number;
  balanceEur: number;
  ledger: LedgerDisplay | null;
  // An extra muted line under the badges. Papelera puts the hiding date here;
  // the other three screens pass nothing.
  note?: React.ReactNode;
}) {
  const usd = formatLedgerAmount(balanceUsd, "USD", ledger);
  const eur = formatLedgerAmount(balanceEur, "EUR", ledger);
  const cop = formatLedgerAmount(balance, null, null);

  return (
    <>
      <span
        aria-hidden="true"
        className={`w-[3px] shrink-0 self-stretch rounded-full ${CLIENT_STATUS_ACCENT_CLASS[status]}`}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className="min-w-[64px] flex-1 truncate text-[15.5px] font-semibold tracking-[-0.01em] text-foreground">
            {name}
          </span>
          {hasPendingReview ? (
            <Badge variant="outline" className="shrink-0 align-middle text-[10px]">
              revisar
            </Badge>
          ) : null}
          {/* Bounded and shrinkable, not shrink-0 — a long name plus a real
              document number plus the (rare) "revisar" badge all competing for
              one row would otherwise leave the name crushed to a couple of
              letters, since everything else marked shrink-0 pushes 100% of the
              squeeze onto the one flexible item. The name's own min-w-[64px]
              is what actually protects it — this cap just means the document
              is what gives way first, not the name. */}
          <span className="min-w-0 max-w-10 shrink truncate font-mono text-[11.5px] text-muted-foreground">
            · {formatDocumentId(documentId)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Badge variant="outline" className={CLIENT_STATUS_BADGE_CLASS[status]}>
            {CLIENT_STATUS_LABEL[status]}
          </Badge>
          {isFlagged ? (
            <Badge variant="outline" className={MALA_PAGA_BADGE_CLASS}>
              Mala paga
            </Badge>
          ) : null}
        </div>
        {note ? <p className="text-[11.5px] text-muted-foreground">{note}</p> : null}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5">
        {ledger ? (
          <>
            <p className="flex items-baseline gap-1">
              <span className="text-[18px] font-semibold tracking-[-0.01em] text-foreground tabular-nums">
                {usd.primary}
              </span>
              <span className="text-[11px] font-medium text-muted-foreground">USD</span>
            </p>
            <p className="flex items-baseline gap-1">
              <span className="text-[18px] font-semibold tracking-[-0.01em] text-foreground tabular-nums">
                {eur.primary}
              </span>
              <span className="text-[11px] font-medium text-muted-foreground">EUR</span>
            </p>
          </>
        ) : (
          <p className="flex items-baseline gap-1">
            <span className="text-[18px] font-semibold tracking-[-0.01em] text-foreground tabular-nums">
              {cop.primary}
            </span>
          </p>
        )}
      </div>
      <ChevronRight className="size-[17px] shrink-0 text-muted-foreground/60" aria-hidden="true" />
    </>
  );
}
