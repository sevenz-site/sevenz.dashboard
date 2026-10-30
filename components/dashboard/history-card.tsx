import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { ChipDeEstado, type EstadoDelChip } from "@/components/dashboard/chip-de-estado";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { formatLedgerAmount, type LedgerDisplay } from "@/lib/exchange-rate/movement-display";
import { formatDateLong } from "@/lib/format";
import type { PriceCurrency } from "@/lib/products/price";
import type { LedgerCurrency } from "@/lib/types";

// ONE CARD OF THE TRANSACTION HISTORY -- frames `1861:15468` (abono),
// `1861:15490` (fiado) and `1861:15513` (de contado), owner's request of
// 2026-10-30: users found the cards crowded and hard to read.
//
// ===========================================================================
// ONE COMPONENT FOR BOTH HISTORIES, AND THAT IS THE POINT OF THIS FILE
//
// The owner's list (`components/dashboard/movement-history-list.tsx`) and the
// client's (`components/public/movement-history-list.tsx`) each drew their
// cards with hand-copied classes. CLAUDE.md asks for anything shown on two
// screens to be born in one component, and these two are the case it was
// written for: the client's screen has to look like the shopkeeper's, and two
// copies drift without anyone noticing. The lists keep what is really theirs
// -- where the data comes from and where a card links to -- and hand the
// drawing to this.
//
// ===========================================================================
// WHAT LEFT, AND WHY IT IS NOT LOST
//
// THE BOLIVAR EQUIVALENCES ARE GONE FROM EVERY CARD: the line under the amount
// («Bs. … Al día del abono» / «… hoy») and the one under «Por cobrar». Owner's
// decision of 2026-10-30. They still live where the owner asked them to: in
// each transaction's detail, one tap away.
//
// AN ABONO NO LONGER NAMES THE FIADO IT PAID. It said «Abono · Lapicero»
// since frame `1548:11049` (2026-10-22). The new frame writes «Abono» alone,
// and with a split payment there is no single fiado to name anyway -- the
// detail lists them.
//
// ===========================================================================
// THE FRAME'S MEASUREMENTS, AND THE ONE PLACE THIS DEPARTS FROM THEM
//
// Padding 8/8/8/12, gap ~6px, radius 10, 14px regular title, 12px date, the
// flag AFTER the amount (it was before it until today), «Por cobrar» at 16
// semibold over a dividing line. A cash sale's amount is 16 semibold and the
// other two are 14 regular, as the frames draw them: a cash sale has no
// second tier, so its one figure carries the card.
//
// THE RIGHT COLUMN DOES NOT HAVE THE FRAME'S 120px CAP. With it, a large
// amount at 16px («+$12.345,67» plus flag and chevron) is wider than 120 and
// would be clipped. A clipped amount is the one thing this card cannot do, so
// the column keeps its natural width and the TITLE is what truncates.
export type HistoryCardKind = "fiado" | "abono" | "contado";

const LABEL: Record<HistoryCardKind, string> = {
  fiado: "Fiado",
  abono: "Abono",
  contado: "De contado",
};

export function HistoryCard({
  kind,
  productos = [],
  createdAt,
  amount,
  currency,
  ledger,
  href,
  porCobrar = null,
  chip = null,
}: {
  kind: HistoryCardKind;
  // The products in the title, «Fiado • Lapicero • Boxer». Ignored for an
  // abono: the frame titles it «Abono» and nothing else.
  productos?: string[];
  createdAt: string;
  amount: number;
  // `null` is a Colombian business: one book, no flag.
  currency: LedgerCurrency | null;
  ledger: LedgerDisplay | null;
  // `null` draws the card without link and without chevron -- the account sheet
  // of `client-account-sheet.tsx`, where leaving would lose a sale in memory.
  href: string | null;
  // The book's balance after this transaction, already signed. `null` draws no
  // second tier, which is every cash sale.
  porCobrar?: number | null;
  chip?: EstadoDelChip | null;
}) {
  const nombres = kind === "abono" ? [] : productos.filter(Boolean);
  const titulo = [LABEL[kind], ...nombres].join(" • ");

  const monto = formatLedgerAmount(amount, currency, ledger).primary;
  // THE SIGN FOLLOWS THE TILL, NOT THE DEBT -- owner's correction of
  // 2026-10-22: abonos and sales «+», fiados «-». Green what comes in, red what
  // goes out, so the sign and the colour say the same thing.
  const signo = kind === "fiado" ? "-" : "+";
  const estiloMonto =
    kind === "fiado"
      ? "text-sm text-destructive"
      : kind === "abono"
        ? "text-sm text-money-in"
        : "text-base font-semibold text-money-in";

  // A BALANCE IN THE CLIENT'S FAVOUR IS NOT WRITTEN WITH A MINUS: the figure
  // goes absolute and the «A favor» chip says whose it is (2026-10-23).
  const pie =
    porCobrar == null ? null : formatLedgerAmount(Math.abs(porCobrar), currency, ledger).primary;

  const contenido = (
    <>
      <div className="flex w-full items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="truncate text-sm leading-5">{titulo}</p>
          <p className="text-xs leading-4 text-muted-foreground">{formatDateLong(createdAt)}</p>
        </div>
        <div className={`flex shrink-0 items-center ${kind === "fiado" ? "gap-2" : "gap-1"}`}>
          <span className={`flex items-center gap-1 whitespace-nowrap tabular-nums ${estiloMonto}`}>
            {signo}
            {monto}
            {currency ? (
              <CurrencyFlagIcon currency={currency as PriceCurrency} className="size-4 shrink-0" />
            ) : null}
          </span>
          {href ? <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : null}
        </div>
      </div>

      {pie ? (
        <div className="flex w-full items-start justify-between gap-3 border-t pt-2">
          <span className="text-sm leading-5 text-muted-foreground">Por cobrar</span>
          <span className="flex flex-col items-end gap-0.5">
            <span className="flex items-center gap-1 whitespace-nowrap text-base font-semibold tabular-nums">
              {pie}
              {currency ? (
                <CurrencyFlagIcon currency={currency as PriceCurrency} className="size-4 shrink-0" />
              ) : null}
            </span>
            {chip ? <ChipDeEstado estado={chip} /> : null}
          </span>
        </div>
      ) : null}
    </>
  );

  const base = "flex w-full flex-col gap-1.5 py-2 pr-2 pl-3 text-left";
  return (
    <li className="overflow-hidden rounded-[10px] border">
      {href ? (
        <Link
          href={href}
          className={`${base} hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset`}
        >
          {contenido}
        </Link>
      ) : (
        <div className={base}>{contenido}</div>
      )}
    </li>
  );
}
