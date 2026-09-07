"use client";

import { useMemo, useState } from "react";
import { Broom, ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useIsMobile } from "@/hooks/use-mobile";
import { combinedBalanceUsd } from "@/lib/exchange-rate/convert";
import type { OwnerRateContext } from "@/lib/exchange-rate/owner-rate";
import {
  CLIENT_STATUS_BADGE_CLASS,
  CLIENT_STATUS_DESCRIPTION,
  CLIENT_STATUS_LABEL,
  getClientStatus,
  type ClientStatus,
  type ClientSummary,
} from "@/lib/types";

// The search + "Más filtros" block used above every list of clients —
// Cartera, Clientes, Malas pagas and Papelera. Extracted from
// client-table.tsx so the four cannot drift: an owner who learns the filters
// on one screen should find the same ones, in the same order, on the next.

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
export type SortOption = "nombre" | "monto_desc" | "monto_asc" | "atraso";

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "nombre", label: "Orden alfabético" },
  { value: "monto_desc", label: "Monto: mayor a menor" },
  { value: "monto_asc", label: "Monto: menor a mayor" },
  { value: "atraso", label: "Más atrasados primero" },
];

// Which three numbers a row is filtered and sorted by. Defaults to the live
// ledger; Papelera passes the snapshot taken when the client was hidden, so
// its filters agree with the amounts printed on its own cards.
export type RowBalances = { cop: number; usd: number; eur: number };

const liveBalances = (row: ClientSummary): RowBalances => ({
  cop: row.balance,
  usd: row.balance_usd,
  eur: row.balance_eur,
});

// What <ClientFilters> needs, and no more. Written out rather than derived
// with ReturnType<typeof useClientFilters>, because that would pin the hook's
// row type to ClientSummary and reject Papelera's ClientSummaryAll rows — the
// filter UI does not care what shape the rows are.
export type ClientFilterState = {
  hasActiveFilters: boolean;
  clearFilters: () => void;
  controls: {
    nameQuery: string;
    setNameQuery: (v: string) => void;
    statusFilter: ClientStatus | "todos";
    setStatusFilter: (v: ClientStatus | "todos") => void;
    minAmount: string;
    setMinAmount: (v: string) => void;
    maxAmount: string;
    setMaxAmount: (v: string) => void;
    sortBy: SortOption;
    setSortBy: (v: SortOption) => void;
  };
};

export function useClientFilters<T extends ClientSummary>(
  rows: T[],
  rateContext: OwnerRateContext | null,
  options?: {
    balancesOf?: (row: T) => RowBalances;
    // Called on every filter change. ClientTable uses it to jump back to page
    // 1, since a filter change invalidates whatever page you were on.
    onFilterChange?: () => void;
  },
) {
  const [nameQuery, setNameQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ClientStatus | "todos">("todos");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("nombre");

  const balancesOf = options?.balancesOf ?? (liveBalances as (row: T) => RowBalances);
  const onFilterChange = options?.onFilterChange;

  // Status and the amount filter need ONE number per client even though a VE
  // owner may have two independent balances — combined to USD, matching the
  // "uno solo, combinado" decision for status/mora/score.
  const judgementBalance = (row: T) => {
    const b = balancesOf(row);
    return rateContext ? combinedBalanceUsd(b.usd, b.eur, rateContext.effectiveRate) : b.cop;
  };

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

  function update<V>(setter: (value: V) => void, value: V) {
    setter(value);
    onFilterChange?.();
  }

  // Sorting is deliberately absent from both: it is a view preference, not a
  // filter that hides rows, and "Limpiar filtros" should not silently throw
  // away the order the owner chose.
  const hasActiveFilters =
    nameQuery.trim() !== "" || statusFilter !== "todos" || minAmount.trim() !== "" || maxAmount.trim() !== "";

  function clearFilters() {
    setNameQuery("");
    setStatusFilter("todos");
    setMinAmount("");
    setMaxAmount("");
    onFilterChange?.();
  }

  return {
    sortedRows,
    judgementBalance,
    hasActiveFilters,
    clearFilters,
    controls: {
      nameQuery,
      setNameQuery: (v: string) => update(setNameQuery, v),
      statusFilter,
      setStatusFilter: (v: ClientStatus | "todos") => update(setStatusFilter, v),
      minAmount,
      setMinAmount: (v: string) => update(setMinAmount, v),
      maxAmount,
      setMaxAmount: (v: string) => update(setMaxAmount, v),
      sortBy,
      setSortBy: (v: SortOption) => update(setSortBy, v),
    },
  };
}

export function ClientFilters({
  filters,
  className,
}: {
  filters: ClientFilterState;
  className?: string;
}) {
  const isMobile = useIsMobile();
  // Shared between the mobile and desktop legend triggers below — only one of
  // the two ever renders at a time (isMobile picks the branch), so a single
  // piece of state is enough for both.
  const [legendOpen, setLegendOpen] = useState(false);
  const c = filters.controls;

  const searchInput = (
    <Input
      placeholder="Buscar por nombre o documento"
      value={c.nameQuery}
      onChange={(e) => c.setNameQuery(e.target.value)}
      className="w-full sm:w-48"
    />
  );

  const statusSelect = (
    <Select value={c.statusFilter} onValueChange={(v) => c.setStatusFilter(v as ClientStatus | "todos")}>
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

  const sortSelect = (
    <Select value={c.sortBy} onValueChange={(v) => c.setSortBy(v as SortOption)}>
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
        value={c.minAmount}
        onChange={(e) => c.setMinAmount(e.target.value)}
        className="w-full sm:w-32"
      />
      <Input
        type="number"
        placeholder="Monto hasta"
        value={c.maxAmount}
        onChange={(e) => c.setMaxAmount(e.target.value)}
        className="w-full sm:w-32"
      />
    </>
  );

  // Only rendered once at least one filter has a non-default value — an owner
  // with a clean list shouldn't see a button with nothing to clear.
  const clearFiltersButton = filters.hasActiveFilters ? (
    <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={filters.clearFilters}>
      <Broom className="size-4" />
      Limpiar filtros
    </Button>
  ) : null;

  // Desktop: every filter stays in one row, always visible, with the legend
  // trigger right-aligned at the end of that same row — its content still
  // expands full-width below the whole row, not just under the trigger.
  // Mobile: only the name search shows by default; the rest sit behind a
  // "Más filtros" collapsible, and the legend is its own standalone trigger.
  if (isMobile) {
    return (
      <div className={className}>
        <div className="flex flex-col gap-2">
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
      </div>
    );
  }

  return (
    <Collapsible open={legendOpen} onOpenChange={setLegendOpen} className={className}>
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
      <CollapsibleContent className="pt-2">
        <LegendChips />
      </CollapsibleContent>
    </Collapsible>
  );
}

function LegendChips() {
  return (
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
}

// The phone's standalone "Qué significa cada estado" panel. Separate from
// ClientFilters because on a phone it belongs *below* the list, not with the
// filters — ClientTable renders it after the cards. Renders nothing above sm,
// where the legend lives inside the filter row instead.
export function ClientStatusLegend({ className }: { className?: string }) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  if (!isMobile) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={className}>
      <CollapsibleTrigger className="group flex w-full items-center justify-between rounded-lg border bg-muted/30 px-3 py-2 text-sm font-medium">
        Qué significa cada estado
        <ChevronDown className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">
        <LegendChips />
      </CollapsibleContent>
    </Collapsible>
  );
}
