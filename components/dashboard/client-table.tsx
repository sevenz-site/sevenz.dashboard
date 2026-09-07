"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ShareActions } from "@/components/dashboard/share-actions";
import {
  ClientCardBody,
  CLIENT_CARD_ROW,
  CLIENT_CARD_SHELL,
} from "@/components/dashboard/client-card";
import {
  ClientFilters,
  ClientStatusLegend,
  useClientFilters,
} from "@/components/dashboard/client-filters";
import { ExchangeRateBalanceDisplay } from "@/components/exchange-rate-balance-display";
import { useTour } from "@/components/dashboard/tour-context";
import { cn } from "@/lib/utils";
import { track } from "@/lib/mixpanel";
import type { CreditScoreResult } from "@/lib/credit-score";
import type { OwnerRateContext } from "@/lib/exchange-rate/owner-rate";
import { formatBalanceSummary } from "@/lib/exchange-rate/movement-display";
import { clientHref } from "@/lib/client-origin";
import { formatDate, formatDocumentId } from "@/lib/format";
import {
  CLIENT_STATUS_BADGE_CLASS,
  CLIENT_STATUS_LABEL,
  CREDIT_SCORE_TIER_BADGE_CLASS,
  MALA_PAGA_BADGE_CLASS,
  getClientStatus,
  type ClientSummary,
} from "@/lib/types";

const PAGE_SIZE = 15;

export function ClientTable({
  rows,
  scores,
  rateContext = null,
  emptyMessage = "Todavía no tienes clientes. Importa tu libreta o registra un movimiento manual.",
  source,
}: {
  rows: ClientSummary[];
  scores?: Record<string, CreditScoreResult>;
  // Only present for a country='VE' owner with a rate already fetched —
  // absent (null) means every row renders exactly like today's COP figure.
  rateContext?: OwnerRateContext | null;
  emptyMessage?: string;
  // Which page rendered this table — tags "Client Details Opened" so it's
  // possible to tell regular Cartera lookups apart from Malas Pagas and the
  // standalone Clientes list.
  source: "cartera" | "malas_pagas" | "clientes";
}) {
  const router = useRouter();
  const tour = useTour();
  const tourDemoActive = tour.step === 2 || tour.step === 2.5;
  const [page, setPage] = useState(1);
  const ledger = rateContext ? { rate: rateContext.effectiveRate } : null;

  // Search, sort, status and the amount range all live in the shared filter
  // block, so this screen, Malas pagas, Cartera and Papelera cannot drift.
  // Any filter change invalidates the current page, so always jump back to
  // page 1 rather than risk landing on an empty page of results.
  const filters = useClientFilters(rows, rateContext, { onFilterChange: () => setPage(1) });
  const { sortedRows, judgementBalance } = filters;

  const pageCount = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pagedRows = sortedRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  if (rows.length === 0 && !tourDemoActive) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* order-1 on both breakpoints; on a phone the status legend is split
          off below the list (order-3) instead of riding with the filters. */}
      <ClientFilters filters={filters} className="order-1" />
      <div className="order-2 flex flex-col gap-3 md:order-3">
        {sortedRows.length === 0 && !tourDemoActive ? (
          <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
            <p className="text-sm text-muted-foreground">Ningún cliente coincide con estos filtros.</p>
          </div>
        ) : (
          <>
            {/* Below md the table is stripped to four columns anyway — Puntaje,
                Último abono and Acciones are md-only — so the same four pieces
                of data are shown as cards instead, which read far better on a
                phone than a horizontally scrolling table. md, not sm, so a
                screen either behaves like a phone or doesn't: the bottom nav
                switches at exactly the same width. The tour's demo row isn't
                repeated here — on mobile the tour only runs step 1. */}
            <div className="flex flex-col gap-3 md:hidden">
              {pagedRows.map((row) => {
                const status = getClientStatus(
                  judgementBalance(row),
                  row.days_since_payment,
                  row.oldest_unpaid_charge_at,
                  row.oldest_unpaid_charge_plazo_dias,
                );
                return (
                  <button
                    key={row.client_id}
                    type="button"
                    onClick={() => {
                      track("Client Details Opened", { client_id: row.client_id, source });
                      router.push(clientHref(row.client_id, source));
                    }}
                    className={cn(CLIENT_CARD_SHELL, CLIENT_CARD_ROW)}
                  >
                    <ClientCardBody
                      name={row.name}
                      documentId={row.document_id}
                      status={status}
                      hasPendingReview={row.has_pending_review}
                      isFlagged={row.is_flagged}
                      balance={row.balance}
                      balanceUsd={row.balance_usd}
                      balanceEur={row.balance_eur}
                      ledger={ledger}
                    />
                  </button>
                );
              })}
            </div>

            <div className="hidden overflow-x-auto rounded-lg border md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    {rateContext ? (
                      <>
                        <TableHead>Por cobrar USD</TableHead>
                        <TableHead>Por cobrar EUR</TableHead>
                      </>
                    ) : (
                      <TableHead>Por cobrar</TableHead>
                    )}
                    <TableHead>Estado</TableHead>
                    <TableHead className="hidden md:table-cell">Puntaje</TableHead>
                    <TableHead className="hidden md:table-cell">Último abono</TableHead>
                    <TableHead className="hidden text-right md:table-cell">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tourDemoActive ? (
                    <>
                      <TableRow
                        data-tour="demo-client-row"
                        className="cursor-pointer bg-accent/40"
                        onClick={() => {
                          if (tour.step === 2) tour.advance();
                        }}
                      >
                        <TableCell className="font-medium">
                          <div>
                            Cliente de ejemplo
                            <Badge variant="outline" className="ml-2 align-middle text-[10px]">
                              ejemplo
                            </Badge>
                          </div>
                          <div className="text-xs font-normal text-muted-foreground">—</div>
                        </TableCell>
                        {rateContext ? (
                          <>
                            <TableCell className="tabular-nums">
                              <ExchangeRateBalanceDisplay balance={0} currency="USD" ledger={ledger} size="sm" />
                            </TableCell>
                            <TableCell className="tabular-nums">
                              <ExchangeRateBalanceDisplay balance={0} currency="EUR" ledger={ledger} size="sm" />
                            </TableCell>
                          </>
                        ) : (
                          <TableCell className="tabular-nums">
                            <ExchangeRateBalanceDisplay balance={0} currency={null} ledger={null} size="sm" />
                          </TableCell>
                        )}
                        <TableCell>
                          <Badge variant="outline" className={CLIENT_STATUS_BADGE_CLASS.sin_deuda}>
                            {CLIENT_STATUS_LABEL.sin_deuda}
                          </Badge>
                        </TableCell>
                        <TableCell className="hidden text-muted-foreground md:table-cell">—</TableCell>
                        <TableCell className="hidden text-muted-foreground md:table-cell">—</TableCell>
                        <TableCell className="hidden md:table-cell" />
                      </TableRow>
                      {tour.step === 2.5 ? (
                        <TableRow className="bg-accent/20">
                          <TableCell colSpan={rateContext ? 7 : 6}>
                            <div className="flex items-center justify-between py-1">
                              <span className="text-sm text-muted-foreground">
                                Detalle de Cliente de ejemplo
                              </span>
                              <Button
                                type="button"
                                size="sm"
                                data-tour="demo-add-movement-button"
                                onClick={() => tour.advance()}
                              >
                                + Agregar movimiento
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </>
                  ) : null}
                  {pagedRows.map((row) => {
                    const status = getClientStatus(
                      judgementBalance(row),
                      row.days_since_payment,
                      row.oldest_unpaid_charge_at,
                      row.oldest_unpaid_charge_plazo_dias,
                    );
                    const score = scores?.[row.client_id];
                    return (
                      <TableRow
                        key={row.client_id}
                        className="cursor-pointer"
                        onClick={() => {
                          track("Client Details Opened", { client_id: row.client_id, source });
                          router.push(clientHref(row.client_id, source));
                        }}
                      >
                        <TableCell className="font-medium">
                          <div>
                            {row.name}
                            {row.has_pending_review ? (
                              <Badge variant="outline" className="ml-2 align-middle text-[10px]">
                                revisar
                              </Badge>
                            ) : null}
                          </div>
                          <div className="text-xs font-normal text-muted-foreground">
                            {formatDocumentId(row.document_id)}
                          </div>
                        </TableCell>
                        {rateContext ? (
                          <>
                            <TableCell className="tabular-nums">
                              <ExchangeRateBalanceDisplay
                                balance={row.balance_usd}
                                currency="USD"
                                ledger={ledger}
                                size="sm"
                              />
                            </TableCell>
                            <TableCell className="tabular-nums">
                              <ExchangeRateBalanceDisplay
                                balance={row.balance_eur}
                                currency="EUR"
                                ledger={ledger}
                                size="sm"
                              />
                            </TableCell>
                          </>
                        ) : (
                          <TableCell className="tabular-nums">
                            <ExchangeRateBalanceDisplay balance={row.balance} currency={null} ledger={null} size="sm" />
                          </TableCell>
                        )}
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1">
                            <Badge variant="outline" className={CLIENT_STATUS_BADGE_CLASS[status]}>
                              {CLIENT_STATUS_LABEL[status]}
                            </Badge>
                            {row.is_flagged ? (
                              <Badge variant="outline" className={MALA_PAGA_BADGE_CLASS}>
                                Mala paga
                              </Badge>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          {score ? (
                            <div className="flex items-center gap-1.5">
                              <span className="tabular-nums">{score.score}</span>
                              <Badge variant="outline" className={CREDIT_SCORE_TIER_BADGE_CLASS[score.tier]}>
                                {score.tier}
                              </Badge>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="hidden text-muted-foreground md:table-cell">
                          {row.last_payment_at ? formatDate(row.last_payment_at) : "Nunca"}
                          <span className="ml-1 text-xs">({row.days_since_payment}d)</span>
                        </TableCell>
                        <TableCell className="hidden md:table-cell" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="icon" asChild title="Ver más">
                              <Link
                                href={clientHref(row.client_id, source)}
                                onClick={() =>
                                  track("Client Details Opened", { client_id: row.client_id, source })
                                }
                              >
                                <Eye className="size-4" />
                              </Link>
                            </Button>
                            <ShareActions
                              clientId={row.client_id}
                              clientName={row.name}
                              whatsapp={row.whatsapp}
                              balanceText={formatBalanceSummary(row.balance, row.balance_usd, row.balance_eur, ledger)}
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

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
          </>
        )}
      </div>

      {/* Phone only — above sm the legend rides inside the filter row instead,
          and this renders nothing. */}
      <ClientStatusLegend className="order-3" />
    </div>
  );
}
