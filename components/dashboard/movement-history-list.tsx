"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { MovementDetailPopover } from "@/components/dashboard/movement-detail-popover";
import { formatDate } from "@/lib/format";
import { formatLedgerAmount, type LedgerDisplay } from "@/lib/exchange-rate/movement-display";
import type { Movement } from "@/lib/types";

const PAGE_SIZE = 10;

export function MovementHistoryList({
  movements,
  photoUrls,
  ledger = null,
}: {
  movements: Movement[];
  photoUrls: Record<string, string>;
  // null = plain COP ledger — see MovementDetailPopover.
  ledger?: LedgerDisplay | null;
}) {
  const [page, setPage] = useState(1);

  if (movements.length === 0) {
    return <p className="text-sm text-muted-foreground">Todavía no hay movimientos.</p>;
  }

  const pageCount = Math.max(1, Math.ceil(movements.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pagedMovements = movements.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col divide-y rounded-lg border">
        {pagedMovements.map((m) => {
          const amount = formatLedgerAmount(m.amount, m.currency, ledger);
          const balance = formatLedgerAmount(m.running_balance, m.currency, ledger);

          return (
          <li key={m.id}>
            <MovementDetailPopover
              movementId={m.id}
              type={m.type}
              amount={m.amount}
              currency={m.currency}
              description={m.description}
              plazoDias={m.plazo_dias}
              createdAt={m.created_at}
              runningBalance={m.running_balance}
              photoUrl={m.photo_path ? (photoUrls[m.photo_path] ?? null) : null}
              entryCurrency={m.entry_currency}
              entryAmount={m.entry_amount}
              exchangeRateUsed={m.exchange_rate_used}
              officialBcvRateAtTime={m.official_bcv_rate_at_time}
              rateModeUsed={m.rate_mode_used}
              ledger={ledger}
            >
              <button
                type="button"
                className="flex w-full flex-wrap items-center justify-between gap-3 p-3 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {m.type === "charge" ? "Fiado" : "Abono"}
                    {m.description ? ` · ${m.description}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(m.created_at)}
                    {m.source === "photo_import" ? " · de libreta" : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">Por cobrar {balance.primary}</p>
                </div>
                <div className="flex items-center gap-2">
                  <div
                    className={`flex flex-col items-end tabular-nums text-sm font-medium ${m.type === "charge" ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}`}
                  >
                    <span>
                      {m.type === "charge" ? "+" : "-"}
                      {amount.primary}
                    </span>
                    {amount.secondary ? (
                      <span className="font-normal text-muted-foreground">{amount.secondary}</span>
                    ) : null}
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </div>
              </button>
            </MovementDetailPopover>
          </li>
          );
        })}
      </ul>

      {pageCount > 1 ? (
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                href="#"
                text="Anterior"
                onClick={(e) => {
                  e.preventDefault();
                  if (safePage > 1) setPage(safePage - 1);
                }}
                className={safePage <= 1 ? "pointer-events-none opacity-50" : undefined}
              />
            </PaginationItem>
            <PaginationItem>
              <span className="px-2 text-sm text-muted-foreground">
                Página {safePage} de {pageCount}
              </span>
            </PaginationItem>
            <PaginationItem>
              <PaginationNext
                href="#"
                text="Siguiente"
                onClick={(e) => {
                  e.preventDefault();
                  if (safePage < pageCount) setPage(safePage + 1);
                }}
                className={safePage >= pageCount ? "pointer-events-none opacity-50" : undefined}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      ) : null}
    </div>
  );
}
