"use client";

import { Receipt } from "lucide-react";
import type { TransactionSearchResult } from "@/app/(app)/dashboard/search-transactions";

// THE LIST OF TRANSACTIONS THAT MATCH A CODE, under the client results of
// Inicio's search box. Same row anatomy as `ClientResultList` -- one tappable
// line inside a border -- so the two groups read as one dropdown.
//
// WHAT A ROW SAYS, and why it is not more: the code, what kind of transaction it
// is, and whose. That is enough to tell «the one I meant» from a near miss
// without a second screen. An amount would need the ledger's currency and rate
// logic repeated here, and a date would need the owner's timezone; neither is
// what decides whether this is the right hit.
const KIND: Record<TransactionSearchResult["kind"], string> = {
  fiado: "Fiado",
  abono: "Abono",
  venta: "Venta de contado",
};

export function TransactionResultList({
  results,
  onSelect,
}: {
  results: TransactionSearchResult[];
  onSelect: (result: TransactionSearchResult) => void;
}) {
  if (results.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      <p className="px-3 pt-2 text-xs text-muted-foreground">Transacciones</p>
      <ul className="flex flex-col divide-y rounded-md border">
        {results.map((r) => (
          <li key={r.code}>
            <button
              type="button"
              // The field loses focus on mousedown and unmounts this list
              // before the click lands; see `ClientResultList`.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onSelect(r)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
            >
              <Receipt className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="shrink-0 font-mono font-medium">{r.code}</span>
              <span className="truncate text-muted-foreground">
                {KIND[r.kind]} · {r.clientName}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
