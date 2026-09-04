"use client";

import { useEffect, useMemo, useState } from "react";
import type { LedgerCurrency } from "@/lib/types";
import { es } from "date-fns/locale";
import type { DateRange } from "react-day-picker";
import { CalendarIcon, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getRateHistory, type RateHistoryPoint } from "@/lib/exchange-rate/rate-history";
import { cn } from "@/lib/utils";

const HISTORY_DAYS = 90;

const MONTH_ABBR = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

// The API hands back "YYYY-MM-DD" strings; appending the time keeps them
// parsed in local time. Without it they would be read as UTC and every date
// would shift a day back for a Venezuelan or Colombian owner.
function parseYmd(ymd: string): Date {
  return new Date(`${ymd}T00:00:00`);
}

function toYmd(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function formatDate(ymd: string): string {
  const d = parseYmd(ymd);
  return `${d.getDate()} ${MONTH_ABBR[d.getMonth()]} ${d.getFullYear()}`;
}

const bs = new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Same formatter shape for the percentage: toFixed() would render "0.36" with
// an English decimal point right next to "2,85" with a Spanish comma, in the
// same cell.
const pct = new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Row = RateHistoryPoint & {
  // Day-over-day change, always computed against the previous day in the
  // FULL series rather than the filtered view — otherwise the first visible
  // row would read as "no change" purely because of where the filter starts.
  deltaUsd: number | null;
  deltaUsdPct: number | null;
  deltaEur: number | null;
  deltaEurPct: number | null;
};

type State = { status: "loading" } | { status: "error" } | { status: "ready"; rows: Row[] };

function buildRows(data: RateHistoryPoint[]): Row[] {
  return data.map((point, i) => {
    const prev = i > 0 ? data[i - 1] : null;
    if (!prev) return { ...point, deltaUsd: null, deltaUsdPct: null, deltaEur: null, deltaEurPct: null };
    const deltaUsd = point.usd - prev.usd;
    const deltaEur = point.eur - prev.eur;
    return {
      ...point,
      deltaUsd,
      deltaUsdPct: (deltaUsd / prev.usd) * 100,
      deltaEur,
      deltaEurPct: (deltaEur / prev.eur) * 100,
    };
  });
}

function DeltaCell({ row, currency }: { row: Row; currency: LedgerCurrency }) {
  // Which currency's day-over-day move this column shows follows the pill in
  // the calculator above — an owner looking at euros wants the euro's swing.
  const delta = currency === "USD" ? row.deltaUsd : row.deltaEur;
  const pctValue = currency === "USD" ? row.deltaUsdPct : row.deltaEurPct;
  if (delta === null || pctValue === null) {
    return <span className="text-muted-foreground">—</span>;
  }
  // Rounded before comparing: a change of 0.004 Bs. displays as "0,00", and
  // painting that green would claim a rise the number on screen doesn't show.
  const rounded = Number(delta.toFixed(2));
  const sign = rounded > 0 ? "+" : "";
  return (
    <span
      className={cn(
        "tabular-nums",
        rounded > 0 && "text-emerald-600",
        rounded < 0 && "text-destructive",
        rounded === 0 && "text-muted-foreground",
      )}
    >
      {/* The unit is what makes this readable: without it "+2,85 (+0,36%)"
          reads as two percentages, since the neighbouring columns all carry
          "Bs." and this one didn't. */}
      {sign}Bs. {bs.format(rounded)}{" "}
      {/* Both readings need 363px and a phone gives the panel 308, so the
          percentage is the one that drops: the bolívar amount is what an
          owner says out loud, and a percentage alone would leave them doing
          the arithmetic the column exists to save them. It also means the
          phone shows "+Bs. 2,85" with no % anywhere near it — the exact
          misreading that started this. */}
      <span className="hidden text-xs opacity-70 sm:inline">
        ({sign}
        {pct.format(pctValue)}%)
      </span>
    </span>
  );
}

export function RateHistoryTable({ currency = "USD" }: { currency?: LedgerCurrency }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [range, setRange] = useState<DateRange | undefined>();
  const [filterOpen, setFilterOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getRateHistory()
      .then((data) => {
        if (!cancelled) setState({ status: "ready", rows: buildRows(data) });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Bounds the calendar to the window the data actually covers. Letting an
  // owner pick March 2019 and land on an empty table is worse than not
  // offering the month at all.
  const { earliest, latest } = useMemo(() => {
    const today = new Date();
    const from = new Date();
    from.setDate(today.getDate() - (HISTORY_DAYS - 1));
    return { earliest: from, latest: today };
  }, []);

  const visible = useMemo(() => {
    if (state.status !== "ready") return [];
    // Newest first — the rate an owner came to check is today's, not the one
    // from three months ago.
    const rows = [...state.rows].reverse();
    if (!range?.from) return rows;
    const from = toYmd(range.from);
    const to = toYmd(range.to ?? range.from);
    return rows.filter((r) => r.date >= from && r.date <= to);
  }, [state, range]);

  if (state.status === "loading") {
    return <div className="h-[260px] w-full animate-pulse rounded-lg bg-muted/40" />;
  }

  if (state.status === "error") {
    return (
      <p className="text-xs text-muted-foreground">
        No pudimos cargar el histórico de tasas en este momento.
      </p>
    );
  }

  const filtered = Boolean(range?.from);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">
          Tasa BCV — {filtered ? `${visible.length} de ${state.rows.length} días` : "últimos 90 días"}
        </p>
        <div className="flex items-center gap-1">
          {filtered ? (
            <Button variant="ghost" size="sm" onClick={() => setRange(undefined)}>
              Limpiar
            </Button>
          ) : null}
          <Button variant="outline" size="sm" onClick={() => setFilterOpen((open) => !open)}>
            <CalendarIcon className="size-4" />
            Filtrar por fecha
            <ChevronDown className={cn("size-4 transition-transform", filterOpen && "rotate-180")} />
          </Button>
        </div>
      </div>

      {/* Inline rather than inside a Popover on purpose: this whole panel
          already lives in a Popover (desktop) or a Drawer (mobile), and a
          nested overlay portals outside its parent — clicking a day would
          dismiss the panel underneath it. */}
      <Collapsible open={filterOpen} onOpenChange={setFilterOpen}>
        <CollapsibleContent>
          <div className="flex justify-center rounded-lg border">
            <Calendar
              mode="range"
              selected={range}
              onSelect={setRange}
              locale={es}
              defaultMonth={latest}
              startMonth={earliest}
              endMonth={latest}
              disabled={{ before: earliest, after: latest }}
            />
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* min-w-0 is what actually makes overflow-auto work here: a flex child
          defaults to min-width:auto, so without it the box refuses to shrink
          below the table's natural width and pushes the whole panel sideways
          instead of scrolling inside itself. */}
      <div className="max-h-[280px] min-w-0 overflow-auto rounded-lg border">
        <Table className="text-xs [&_td]:px-1.5 [&_td]:py-1.5 [&_th]:px-1.5">
          <TableHeader className="sticky top-0 z-10 bg-background">
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead className="text-right whitespace-nowrap">Dólar BCV</TableHead>
              <TableHead className="text-right whitespace-nowrap">Euro BCV</TableHead>
              <TableHead className="text-right whitespace-nowrap">
                {/* With the percentage hidden, this header becomes the widest
                    thing in its column again, so it has to shrink too — one
                    without the other still overflows. */}
                <span className="sm:hidden">Var. {currency}</span>
                <span className="hidden sm:inline">Variación {currency}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  No hay tasas publicadas en esas fechas.
                </TableCell>
              </TableRow>
            ) : (
              visible.map((row) => (
                <TableRow key={row.date}>
                  <TableCell className="whitespace-nowrap">{formatDate(row.date)}</TableCell>
                  <TableCell className="text-right tabular-nums whitespace-nowrap">Bs. {bs.format(row.usd)}</TableCell>
                  <TableCell className="text-right tabular-nums whitespace-nowrap">Bs. {bs.format(row.eur)}</TableCell>
                  <TableCell className="text-right">
                    <DeltaCell row={row} currency={currency} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
