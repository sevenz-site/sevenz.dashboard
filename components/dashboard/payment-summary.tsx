import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { IconoDeAbono } from "@/components/dashboard/iconos-de-movimiento";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { ChipDeEstado } from "@/components/dashboard/chip-de-estado";
import { NOMBRE_DE_MONEDA } from "@/components/dashboard/detail-rows";
import { formatBs } from "@/lib/exchange-rate/format";
import { formatLedgerAmount, type LedgerDisplay } from "@/lib/exchange-rate/movement-display";
import { formatDate } from "@/lib/format";
import { estadosDelFiado, type EstadoDelPlazo } from "@/lib/estado-del-plazo";
import type { PriceCurrency } from "@/lib/products/price";
import type { LedgerCurrency, MovementCurrencyCode } from "@/lib/types";

// «RESUMEN DE ABONO» -- screen «Abono V9», frame `1864:15646`, section
// `1864:15660`. Owner's request of 2026-10-30: an abono split across several
// fiados is ONE transaction, so its detail shows the whole split.
//
// ===========================================================================
// WHAT THE FRAME CHANGED, ALL OF IT FOR EVERY ABONO
//
// It replaces the boxed summary of frame `1580:11677` for every abono, split or
// not -- one layout, so a single abono is just a split with one row:
//
//   · NO BOX. The section is separated by a top border, its title is 16
//     semibold, and «Tipo» moves INSIDE it, right under the title.
//   · «Abonó a fiado» (one row with the fiado's products) becomes «Fiados a
//     los que abonó», one row per fiado: the fiado's date, how this part of the
//     payment arrived against that fiado's term, the part, and its bolivars.
//   · NO «Total por cobrar» AND NO PLAZO TABLE. The owner removed them from the
//     frame on 2026-10-30 while this was being built (read twice: present at
//     the first read of `1864:15660`, gone at the second). Both made sense for
//     ONE fiado -- they were that fiado's -- and mean nothing for four. The
//     book's balance is still on the history card and on the client's page.
//
// ===========================================================================
// THE CHIP ON «Abonó»: ONLY WHEN THERE IS ONE FIADO
//
// Owner's answer of 2026-10-30, asked with the case on the table: with four
// fiados, one part can arrive on time and another late, so a single chip on the
// total would summarise something that has no single answer. A split shows no
// chip there; each row carries its own. A single abono keeps the chip it had.
//
// THE ROW'S DATE IS THE FIADO'S, not the abono's (also asked): all the rows of
// a split share the abono's date, so that date would identify nothing. The
// grey «Al día de la compra» chip of the frame's first row is a sample copied
// from the fiado's «Abonos relacionados» list and is not drawn here.
//
// ===========================================================================
// THE BOLIVARS ARE THE TYPED ONES WHEN THERE ARE ANY
//
// CLAUDE.md, «SIEMPRE MANDA EL MONTO QUE TECLEÓ EL TENDERO»: each line of a
// split stores the bolivars typed for it (`entry_amount`), and those are what
// each row shows. The total is their sum, which is the bill itself:
// `registrarAbonoRepartido` refuses a split whose parts do not add up to it.
// Only a line with no typed bolivars falls back to `amount × sealed rate`.

export type PaymentLine = {
  movementId: string;
  amount: number;
  entryCurrency: MovementCurrencyCode | null;
  entryAmount: number | null;
  exchangeRateUsed: number | null;
  // The fiado this line paid. `null` with `fiadoDeleted` false is an abono the
  // FIFO queue spread over the whole balance (everything before migration
  // `126`); with `fiadoDeleted` true, it was directed and that fiado is gone.
  fiado: {
    fecha: string;
    plazoDias: number | null;
    cuotas: number | null;
    amount: number;
  } | null;
  fiadoDeleted: boolean;
  hrefDelFiado: string | null;
};

function bolivaresDeLaLinea(l: PaymentLine): number | null {
  if (l.entryCurrency === "VES" && l.entryAmount != null) return l.entryAmount;
  if (l.exchangeRateUsed != null) return l.amount * l.exchangeRateUsed;
  return null;
}

// How this line arrived against its fiado's term -- the same function and the
// same inputs the old single-abono chip used, so nothing changes for one row.
function estadoDeLaLinea(l: PaymentLine, fechaDelAbono: string): EstadoDelPlazo | null {
  if (!l.fiado || l.fiado.plazoDias == null) return null;
  return (
    estadosDelFiado({
      createdAt: l.fiado.fecha,
      plazoDias: l.fiado.plazoDias,
      cuotas: l.fiado.cuotas ?? 1,
      amount: l.fiado.amount,
      abonos: [{ fecha: fechaDelAbono, amount: l.amount }],
    }).abonos[0] ?? null
  );
}

export function PaymentSummary({
  createdAt,
  currency,
  ledger,
  lines,
}: {
  createdAt: string;
  currency: LedgerCurrency | null;
  ledger: LedgerDisplay | null;
  lines: PaymentLine[];
}) {
  // ── LAS FILAS POR LA FECHA DEL FIADO, DEL MÁS VIEJO AL MÁS NUEVO ─────
  //
  // Llegan en el orden en que se escribieron las líneas, que no le dice nada a
  // quien lee: medido en dev el 2026-10-30, un reparto salía «27 oct, 30 sept,
  // 28 oct, 29 oct». Es el mismo orden que el dueño pidió el 2026-10-21 para
  // los abonos dentro de un fiado —*«la más antigua arriba y la más nueva
  // abajo»*— y el mismo en que el reparto los paga. Sin fiado, al final.
  lines = [...lines].sort((a, b) =>
    a.fiado && b.fiado ? a.fiado.fecha.localeCompare(b.fiado.fecha) : a.fiado ? -1 : b.fiado ? 1 : 0,
  );
  const total = Math.round(lines.reduce((sum, l) => sum + l.amount, 0) * 100) / 100;
  // Bolivars only where the business has them: a Colombian book is `null`.
  const bsPorLinea = currency ? lines.map(bolivaresDeLaLinea) : lines.map(() => null);
  const bsTotal =
    currency && bsPorLinea.every((b) => b != null)
      ? Math.round(bsPorLinea.reduce<number>((sum, b) => sum + (b ?? 0), 0) * 100) / 100
      : null;
  const chipArriba = lines.length === 1 ? estadoDeLaLinea(lines[0], createdAt) : null;
  const flag = currency ? (
    <CurrencyFlagIcon currency={currency as PriceCurrency} className="size-4 shrink-0" />
  ) : null;

  return (
    <section className="flex flex-col border-t py-2.5">
      <h2 className="py-2 text-base font-semibold">
        {`Resumen de abono${currency ? ` en ${NOMBRE_DE_MONEDA[currency]}` : ""}`}
      </h2>

      <div className="flex items-center gap-1 py-2">
        <span className="flex-1 text-xs leading-4 text-muted-foreground">Tipo</span>
        <span className="text-sm">Abono</span>
        <IconoDeAbono className="size-4 text-money-in" aria-hidden />
      </div>

      <div className="flex items-center justify-between gap-4 border-y py-4">
        <span className="flex flex-col items-start gap-1">
          <span className="text-xs leading-4 text-muted-foreground">Abonó</span>
          {chipArriba ? <ChipDeEstado estado={chipArriba} /> : null}
        </span>
        <span className="flex flex-col items-end gap-1">
          <span className="flex items-center gap-1 text-base font-semibold tabular-nums text-money-in">
            +{formatLedgerAmount(total, currency, ledger).primary}
            {flag}
          </span>
          {bsTotal != null ? (
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatBs(bsTotal)} al día del abono
            </span>
          ) : null}
        </span>
      </div>

      <p className="py-2 text-xs leading-4 text-muted-foreground">Fiados a los que abonó</p>
      <ul className="flex flex-col">
        {lines.map((l, i) => {
          const estado = estadoDeLaLinea(l, createdAt);
          const bs = bsPorLinea[i];
          const izquierda = l.fiado ? (
            <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
              <span className="text-sm">{formatDate(l.fiado.fecha)}</span>
              {estado ? <ChipDeEstado estado={estado} /> : null}
            </span>
          ) : (
            // Without a fiado, the same two sentences the old single row used:
            // the second matters because that money still comes off the
            // balance and nobody sees it unless it is said here.
            <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
              <span className="text-sm">
                {l.fiadoDeleted ? "Un fiado que se eliminó" : "Repartido al saldo total"}
              </span>
              {l.fiadoDeleted ? (
                <span className="text-xs text-muted-foreground">
                  Este abono sigue descontándose del saldo
                </span>
              ) : null}
            </span>
          );
          const derecha = (
            <span className="flex flex-col items-end">
              <span className="flex items-center gap-1 text-sm tabular-nums text-money-in">
                +{formatLedgerAmount(l.amount, currency, ledger).primary}
                {flag}
              </span>
              {bs != null ? (
                <span className="text-[10px] font-medium text-muted-foreground tabular-nums">
                  {formatBs(bs)} al día del abono
                </span>
              ) : null}
            </span>
          );
          const clase = `flex items-center gap-2 py-4 ${i > 0 ? "border-t" : ""}`;
          return (
            <li key={l.movementId}>
              {l.fiado && l.hrefDelFiado ? (
                <Link href={l.hrefDelFiado} className={`${clase} transition-colors active:bg-muted/60`}>
                  {izquierda}
                  {derecha}
                  <ChevronRight className="size-6 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              ) : (
                <div className={clase}>
                  {izquierda}
                  {derecha}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
