"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Broom, ChevronDown, ChevronRight, Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ShareActions } from "@/components/dashboard/share-actions";
import { ExchangeRateBalanceDisplay } from "@/components/exchange-rate-balance-display";
import { useTour } from "@/components/dashboard/tour-context";
import { useIsMobile } from "@/hooks/use-mobile";
import { track } from "@/lib/mixpanel";
import type { CreditScoreResult } from "@/lib/credit-score";
import type { OwnerRateContext } from "@/lib/exchange-rate/owner-rate";
import { combinedBalanceUsd } from "@/lib/exchange-rate/convert";
import { formatBalanceSummary } from "@/lib/exchange-rate/movement-display";
import { formatDate, formatDocumentId } from "@/lib/format";
import {
  CLIENT_STATUS_BADGE_CLASS,
  CLIENT_STATUS_DESCRIPTION,
  CLIENT_STATUS_LABEL,
  CREDIT_SCORE_TIER_BADGE_CLASS,
  MALA_PAGA_BADGE_CLASS,
  getClientStatus,
  type ClientStatus,
  type ClientSummary,
} from "@/lib/types";

const STATUS_OPTIONS: { value: ClientStatus | "todos"; label: string }[] = [
  { value: "todos", label: "Todos los estados" },
  { value: "sin_deuda", label: CLIENT_STATUS_LABEL.sin_deuda },
  { value: "a_favor", label: CLIENT_STATUS_LABEL.a_favor },
  { value: "dentro_del_plazo", label: CLIENT_STATUS_LABEL.dentro_del_plazo },
  { value: "plazo_vencido", label: CLIENT_STATUS_LABEL.plazo_vencido },
  { value: "sin_plazo", label: CLIENT_STATUS_LABEL.sin_plazo },
  { value: "critico", label: CLIENT_STATUS_LABEL.critico },
];

// Alphabetical is the default: an owner looking for a specific person scans
// by name, which is why the search box is the one filter always visible.
// The two amount orders answer the other common question — "quién me debe
// más" — without needing the Monto desde/hasta inputs. "atraso" reproduces
// what this table used to render before any sort control existed (the page
// query's own `order("days_since_payment", desc)`), so an owner who used
// the top of the list as their "who to chase today" view doesn't lose it.
type SortOption = "nombre" | "monto_desc" | "monto_asc" | "atraso";

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "nombre", label: "Orden alfabético" },
  { value: "monto_desc", label: "Monto: mayor a menor" },
  { value: "monto_asc", label: "Monto: menor a mayor" },
  { value: "atraso", label: "Más atrasados primero" },
];

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
  const isMobile = useIsMobile();
  const tourDemoActive = tour.step === 2 || tour.step === 2.5;
  const [nameQuery, setNameQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ClientStatus | "todos">("todos");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("nombre");
  const [page, setPage] = useState(1);
  // Shared between the mobile and desktop legend triggers below — only one
  // of the two ever renders at a time (isMobile picks the branch), so a
  // single piece of state is enough for both.
  const [legendOpen, setLegendOpen] = useState(false);
  const ledger = rateContext ? { rate: rateContext.effectiveRate } : null;

  // Status and the amount filter need ONE number per client even though a VE
  // owner may have two independent balances — combined to USD, matching the
  // "uno solo, combinado" decision for status/mora/score.
  const judgementBalance = (row: ClientSummary) =>
    rateContext ? combinedBalanceUsd(row.balance_usd, row.balance_eur, rateContext.effectiveRate) : row.balance;

  const filteredRows = useMemo(() => {
    const query = nameQuery.trim().toLowerCase();
    const min = minAmount.trim() ? Number(minAmount) : null;
    const max = maxAmount.trim() ? Number(maxAmount) : null;

    return rows.filter((row) => {
      if (query) {
        const matchesName = row.name.toLowerCase().includes(query);
        const matchesDocument = row.document_id?.toLowerCase().includes(query) ?? false;
        if (!matchesName && !matchesDocument) return false;
      }
      const balance = judgementBalance(row);
      if (statusFilter !== "todos") {
        const status = getClientStatus(
          balance,
          row.days_since_payment,
          row.oldest_unpaid_charge_at,
          row.oldest_unpaid_charge_plazo_dias,
        );
        if (status !== statusFilter) return false;
      }
      if (min !== null && !Number.isNaN(min) && balance < min) return false;
      if (max !== null && !Number.isNaN(max) && balance > max) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, nameQuery, statusFilter, minAmount, maxAmount, rateContext]);

  const sortedRows = useMemo(() => {
    const sorted = [...filteredRows];
    if (sortBy === "nombre") {
      // Spanish collation with sensitivity "base" so "Angélica" and
      // "Angelica" land next to each other instead of the accented one
      // being sorted away from its twin.
      sorted.sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }));
    } else if (sortBy === "atraso") {
      sorted.sort((a, b) => b.days_since_payment - a.days_since_payment);
    } else {
      // Same combined-to-USD figure the status and amount filters use, so a
      // VE owner's two ledgers order as one number rather than by whichever
      // currency happens to be bigger.
      const direction = sortBy === "monto_asc" ? 1 : -1;
      sorted.sort((a, b) => (judgementBalance(a) - judgementBalance(b)) * direction);
    }
    return sorted;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredRows, sortBy, rateContext]);

  const pageCount = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pagedRows = sortedRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // Any filter change invalidates the current page, so always jump back to
  // page 1 rather than risk landing on an empty page of results.
  function updateFilter<T>(setter: (value: T) => void, value: T) {
    setter(value);
    setPage(1);
  }

  const hasActiveFilters =
    nameQuery.trim() !== "" || statusFilter !== "todos" || minAmount.trim() !== "" || maxAmount.trim() !== "";

  function clearFilters() {
    setNameQuery("");
    setStatusFilter("todos");
    setMinAmount("");
    setMaxAmount("");
    setPage(1);
  }

  if (rows.length === 0 && !tourDemoActive) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }

  const legendChips = (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
      {STATUS_OPTIONS.filter((opt) => opt.value !== "todos").map((opt) => {
        const status = opt.value as ClientStatus;
        return (
          <Badge key={status} variant="outline" className={CLIENT_STATUS_BADGE_CLASS[status]}>
            <span className="font-semibold">{CLIENT_STATUS_LABEL[status]}</span>
            <span className="font-normal">: {CLIENT_STATUS_DESCRIPTION[status]}</span>
          </Badge>
        );
      })}
    </div>
  );

  const searchInput = (
    <Input
      placeholder="Buscar por nombre o documento"
      value={nameQuery}
      onChange={(e) => updateFilter(setNameQuery, e.target.value)}
      className="w-full sm:w-48"
    />
  );

  const statusSelect = (
    <Select
      value={statusFilter}
      onValueChange={(v) => updateFilter(setStatusFilter, v as ClientStatus | "todos")}
    >
      <SelectTrigger className="w-full sm:w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {STATUS_OPTIONS.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  // Deliberately not part of hasActiveFilters / clearFilters: sorting is a
  // view preference, not a filter that hides rows. "Limpiar filtros"
  // shouldn't silently throw away the order the owner chose.
  const sortSelect = (
    <Select value={sortBy} onValueChange={(v) => updateFilter(setSortBy, v as SortOption)}>
      <SelectTrigger className="w-full sm:w-52" aria-label="Ordenar por">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {SORT_OPTIONS.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            Ordenar por: {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const amountInputs = (
    <>
      <Input
        type="number"
        placeholder="Monto desde"
        value={minAmount}
        onChange={(e) => updateFilter(setMinAmount, e.target.value)}
        className="w-full sm:w-32"
      />
      <Input
        type="number"
        placeholder="Monto hasta"
        value={maxAmount}
        onChange={(e) => updateFilter(setMaxAmount, e.target.value)}
        className="w-full sm:w-32"
      />
    </>
  );

  // Only rendered once at least one filter has a non-default value — an
  // owner with a clean/default table shouldn't see a button with nothing
  // to clear.
  const clearFiltersButton = hasActiveFilters ? (
    <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={clearFilters}>
      <Broom className="size-4" />
      Limpiar filtros
    </Button>
  ) : null;

  return (
    <div className="flex flex-col gap-3">
      {/* Desktop: every filter stays in one row, always visible, with the
          legend trigger right-aligned at the end of that same row — its
          content still expands full-width below the whole row, not just
          under the trigger. Mobile: only the name search shows by default;
          the rest sit behind a "Más filtros" collapsible, and the legend
          stays its own standalone trigger below the table (order-3). */}
      {isMobile ? (
        <>
          <div className="order-1 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">{searchInput}</div>
              {clearFiltersButton}
            </div>
            <Collapsible>
              <CollapsibleTrigger className="group flex items-center gap-1 self-start text-sm font-medium text-muted-foreground">
                Más filtros
                <ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2">
                <div className="flex flex-wrap items-end gap-2">
                  {sortSelect}
                  {statusSelect}
                  {amountInputs}
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
          <Collapsible open={legendOpen} onOpenChange={setLegendOpen} className="order-3">
            <CollapsibleTrigger className="group flex w-full items-center justify-between rounded-lg border bg-muted/30 px-3 py-2 text-sm font-medium">
              Qué significa cada estado
              <ChevronDown className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2">{legendChips}</CollapsibleContent>
          </Collapsible>
        </>
      ) : (
        <Collapsible open={legendOpen} onOpenChange={setLegendOpen} className="order-1">
          <div className="flex flex-wrap items-end gap-2">
            {searchInput}
            {sortSelect}
            {statusSelect}
            {amountInputs}
            {clearFiltersButton}
            <CollapsibleTrigger className="group ml-auto flex items-center gap-1 text-sm font-medium text-muted-foreground">
              Qué significa cada estado
              <ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />
            </CollapsibleTrigger>
          </div>
          <CollapsibleContent className="pt-2">{legendChips}</CollapsibleContent>
        </Collapsible>
      )}

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
                      router.push(`/clients/${row.client_id}`);
                    }}
                    className="flex w-full flex-col gap-1 rounded-lg border bg-muted/30 px-3 py-2 text-left transition-colors active:bg-accent"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="min-w-0 flex-1 text-lg font-semibold">
                        {row.name}
                        {row.has_pending_review ? (
                          <Badge variant="outline" className="ml-2 align-middle text-[10px]">
                            revisar
                          </Badge>
                        ) : null}
                      </p>
                      <ChevronRight className="mt-1 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <p className="truncate text-sm text-muted-foreground">
                        Documento: {formatDocumentId(row.document_id)}
                      </p>
                      <div className="flex flex-wrap gap-x-6 gap-y-1">
                        {rateContext ? (
                          <>
                            <div>
                              <p className="text-xs text-muted-foreground">Por cobrar USD</p>
                              <ExchangeRateBalanceDisplay
                                balance={row.balance_usd}
                                currency="USD"
                                ledger={ledger}
                                size="sm"
                                showSecondary={false}
                                mainClassName="text-base"
                              />
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Por cobrar EUR</p>
                              <ExchangeRateBalanceDisplay
                                balance={row.balance_eur}
                                currency="EUR"
                                ledger={ledger}
                                size="sm"
                                showSecondary={false}
                                mainClassName="text-base"
                              />
                            </div>
                          </>
                        ) : (
                          <div>
                            <p className="text-xs text-muted-foreground">Por cobrar</p>
                            <ExchangeRateBalanceDisplay
                              balance={row.balance}
                              currency={null}
                              ledger={null}
                              size="sm"
                              mainClassName="text-base"
                            />
                          </div>
                        )}
                      </div>
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
                    </div>
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
                          router.push(`/clients/${row.client_id}`);
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
                                href={`/clients/${row.client_id}`}
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
    </div>
  );
}
