"use client";

import { useMemo, useState } from "react";
import { Broom, ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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

// El estado de filtros y los chips que lo tocan, compartidos por las cuatro
// listas de clientes — Cartera, Clientes, Malas pagas y Papelera — para que no
// se separen: quien aprende los filtros en una pantalla los encuentra iguales
// en la siguiente.
//
// El bloque "Más filtros" que vivía aquí se retiró el 2026-09-20: los mismos
// controles viven ahora dentro de la hoja de búsqueda
// (`client-search-sheet.tsx`), que es el único buscador de la app. Se borró en
// vez de dejarlo sin usar porque dos bloques de filtros sobre el mismo estado
// es exactamente como vuelven a separarse.

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

// ─────────────────────────────────────────────────────────────────────────
// The same three filters as chips. Los usan las dos formas del buscador:
// ClientSearchInline en Clientes, Malas pagas y Papelera, y ClientFilterChipsRow
// en Cartera, que los saca del contexto porque allí el campo y los chips viven
// en sitios distintos del documento.
//
// WHY THEY LIVE HERE and not in their own file: they read STATUS_OPTIONS and
// SORT_OPTIONS, and drive the exact same ClientFilterState as <ClientFilters>
// above. Two files would be two lists of statuses, and the day someone adds a
// status to one the other keeps filtering by the old set — silently, because
// nothing would fail.
//
// Only the presentation is new. No filtering logic is duplicated: everything
// still goes through useClientFilters, which is already proven on four
// screens.
function FilterChip({
  label,
  active,
  children,
}: {
  label: string;
  active: boolean;
  // A function when picking an option should dismiss the popover — the chip
  // hands it `close`. A plain node when it should stay open: "Monto" holds two
  // inputs, and closing on the first keystroke would make the second
  // unreachable.
  children: React.ReactNode | ((close: () => void) => React.ReactNode);
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {/* Not `size="sm"`: a chip is a filter control, not a labelled action,
            so the 40px button rule does not apply — same escape hatch the
            design system already grants to `xs`.

            shrink-0 because the row scrolls horizontally: without it flex
            squeezes every chip to fit and the labels — which are the whole
            point, since they carry the active value — get clipped instead. */}
        <Button
          type="button"
          variant="outline"
          size="sm"
          // The active state carries in colour AND in the label below, never
          // colour alone: on a phone in sunlight a subtle border change is
          // invisible, and the label is what tells you the list is filtered.
          className={`shrink-0 ${active ? "border-foreground font-medium" : ""}`}
        >
          {label}
          <ChevronDown className="size-4 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64">
        {typeof children === "function" ? children(() => setOpen(false)) : children}
      </PopoverContent>
    </Popover>
  );
}

export function ClientFilterChips({
  filters,
  className,
}: {
  filters: ClientFilterState;
  className?: string;
}) {
  const c = filters.controls;

  const sortLabel = SORT_OPTIONS.find((o) => o.value === c.sortBy)?.label;
  const statusLabel = STATUS_OPTIONS.find((o) => o.value === c.statusFilter)?.label;

  // "Monto" says what it is filtering by, not just that it is filtering.
  // "1.000–5.000" answers the question the owner actually has; a coloured
  // border does not.
  const amountActive = Boolean(c.minAmount || c.maxAmount);
  const amountLabel = !amountActive
    ? "Monto"
    : c.minAmount && c.maxAmount
      ? `${c.minAmount}–${c.maxAmount}`
      : c.minAmount
        ? `Desde ${c.minAmount}`
        : `Hasta ${c.maxAmount}`;

  return (
    // overflow-x-auto so four chips never push the sheet sideways on a narrow
    // phone; they scroll within their own row instead.
    <div className={`flex items-center gap-2 overflow-x-auto pb-1 ${className ?? ""}`}>
      <FilterChip label={c.sortBy === "nombre" ? "Ordenar por" : (sortLabel ?? "Ordenar por")} active={c.sortBy !== "nombre"}>
        {(close) => (
          <div className="flex flex-col gap-1">
            {SORT_OPTIONS.map((opt) => (
              <Button
                key={opt.value}
                type="button"
                variant={c.sortBy === opt.value ? "secondary" : "ghost"}
                size="sm"
                className="justify-start"
                onClick={() => {
                  c.setSortBy(opt.value);
                  close();
                }}
              >
                {opt.label}
              </Button>
            ))}
          </div>
        )}
      </FilterChip>

      <FilterChip
        label={c.statusFilter === "todos" ? "Estado" : (statusLabel ?? "Estado")}
        active={c.statusFilter !== "todos"}
      >
        {(close) => (
          <div className="flex flex-col gap-1">
            {STATUS_OPTIONS.map((opt) => (
              <Button
                key={opt.value}
                type="button"
                variant={c.statusFilter === opt.value ? "secondary" : "ghost"}
                size="sm"
                className="justify-start"
                onClick={() => {
                  c.setStatusFilter(opt.value);
                  close();
                }}
              >
                {opt.label}
              </Button>
            ))}
          </div>
        )}
      </FilterChip>

      <FilterChip label={amountLabel} active={amountActive}>
        <div className="flex flex-col gap-2">
          <Input
            type="number"
            inputMode="numeric"
            placeholder="Monto desde"
            value={c.minAmount}
            onChange={(e) => c.setMinAmount(e.target.value)}
          />
          <Input
            type="number"
            inputMode="numeric"
            placeholder="Monto hasta"
            value={c.maxAmount}
            onChange={(e) => c.setMaxAmount(e.target.value)}
          />
        </div>
      </FilterChip>

      {filters.hasActiveFilters ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="shrink-0 text-muted-foreground"
          onClick={filters.clearFilters}
        >
          <Broom className="size-4" />
          Limpiar
        </Button>
      ) : null}
    </div>
  );
}
