"use client";

import { useRouter } from "next/navigation";
import {
  ClientCardBody,
  clientCardShell,
  CLIENT_CARD_INNER,
  CLIENT_CARD_ROW,
} from "@/components/dashboard/client-card";
import { track } from "@/lib/mixpanel";
import { clientHref } from "@/lib/client-origin";
import { combinedBalanceUsd } from "@/lib/exchange-rate/convert";
import { cn } from "@/lib/utils";
import { getClientStatus, type ClientSummary } from "@/lib/types";
import type { LedgerDisplay } from "@/lib/exchange-rate/movement-display";
import type { OwnerRateContext } from "@/lib/exchange-rate/owner-rate";

// THE FILTERED CLIENT'S CARD, above their metrics on `/reportes`.
//
// Asked for on 2026-10-04, and the reason is the one the screen was missing: a
// shopkeeper who filters the charts to Petra and sees something worth acting on
// had no way to reach Petra from here. The numbers answered "how is she doing"
// and then left you to find her again through another screen.
//
// It is the SAME card as every list — `ClientCardBody` and the same shell — so
// it carries the same status colour, the same badges and the same chevron, and
// it behaves like the rows the owner already knows how to tap.
export function ReporteClienteCard({
  row,
  ledger,
  rateContext,
}: {
  row: ClientSummary;
  ledger: LedgerDisplay | null;
  rateContext: OwnerRateContext | null;
}) {
  const router = useRouter();

  // The same figure the lists judge by: a VE shop's two ledgers combined at the
  // current rate, a CO shop's single balance. Computed here rather than taken
  // from `useClientFilters` because this screen has no filter state — it has
  // one client, picked from the URL.
  const judgement = rateContext
    ? combinedBalanceUsd(Number(row.balance_usd), Number(row.balance_eur), rateContext.effectiveRate)
    : Number(row.balance);

  const status = getClientStatus(
    judgement,
    row.days_since_payment,
    row.oldest_unpaid_charge_at,
    row.oldest_unpaid_charge_plazo_dias,
  );

  return (
    <button
      type="button"
      onClick={() => {
        track("Client Details Opened", { client_id: row.client_id, source: "reportes" });
        router.push(clientHref(row.client_id, "reportes"));
      }}
      className={clientCardShell(status)}
    >
      <div className={cn(CLIENT_CARD_INNER, CLIENT_CARD_ROW)}>
        <ClientCardBody
          name={row.name}
          documentId={row.document_id}
          status={status}
          hasPendingReview={row.has_pending_review}
          isFlagged={row.is_flagged}
          balance={Number(row.balance)}
          balanceUsd={Number(row.balance_usd)}
          balanceEur={Number(row.balance_eur)}
          ledger={ledger}
        />
      </div>
    </button>
  );
}
