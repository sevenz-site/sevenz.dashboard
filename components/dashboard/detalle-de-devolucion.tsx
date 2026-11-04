import Link from "next/link";
import { ChevronRight, Undo2 } from "lucide-react";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { Fila, Grupo, NOMBRE_DE_MONEDA } from "@/components/dashboard/detail-rows";
import { FilaDeTotal } from "@/components/dashboard/fila-de-total";
import { Fecha } from "@/components/fecha";
import { formatLedgerAmount, type LedgerDisplay } from "@/lib/exchange-rate/movement-display";
import type { ReturnSummary } from "@/lib/returns/read";
import type { LedgerCurrency } from "@/lib/types";

// THE DETAIL OF A RETURN, shared by both faces (owner's decision of 2026-11-03:
// «Con variante», same screen, no actions on the client's). No frame: the rows
// follow the anatomy of the abono's detail, and the report says so.
//
// THE FIGURE IS THE VALUE OF WHAT CAME BACK, not the ledger amount: part of it
// may have been handed back in cash, which never touches `movements`. Then
// «¿Qué se hizo con el dinero?» accounts for every cent of it.

export type ReturnFiadoLine = {
  movementId: string;
  amount: number;
  title: string;
  href: string | null;
};

export function DetalleDeDevolucion({
  createdAt,
  devolucion,
  currency,
  ledger,
  runningBalance,
  fiadoHref,
  ventaHref = null,
  otherFiados,
}: {
  createdAt: string;
  devolucion: ReturnSummary;
  currency: LedgerCurrency | null;
  ledger: LedgerDisplay | null;
  // The book after the whole return, the same figure as its row's foot.
  runningBalance: number;
  fiadoHref: string | null;
  // Only a return of a sale paid in full: it has no fiado to link back to.
  ventaHref?: string | null;
  otherFiados: ReturnFiadoLine[];
}) {
  const money = (n: number) => formatLedgerAmount(n, currency, ledger).primary;
  const balance = formatLedgerAmount(Math.abs(runningBalance), currency, ledger);

  return (
    <dl className="flex flex-col gap-4">
      <Grupo>
        <Fila nombre="Fecha"><Fecha iso={createdAt} /></Fila>
        <Fila nombre="Tipo">
          <span className="inline-flex items-center gap-1.5">
            Devolución
            <Undo2 className="size-4 text-muted-foreground" aria-hidden="true" />
          </span>
        </Fila>
      </Grupo>

      <div className="flex flex-col gap-1.5 rounded-[10px] border p-2.5">
        <p className="py-2 text-sm leading-5">
          {`Resumen de devolución${currency ? ` en ${NOMBRE_DE_MONEDA[currency]}` : ""}`}
        </p>

        <div className="flex items-baseline justify-between gap-4 py-1">
          <span className="min-w-0 break-words text-xs leading-4 text-muted-foreground">
            {devolucion.product_name}
          </span>
          <span className="shrink-0 text-sm leading-5 tabular-nums">
            {devolucion.quantity} × {money(devolucion.unit_price)}
          </span>
        </div>

        <div className="flex items-center justify-between gap-4 border-y py-4">
          <span className="text-xs leading-4 text-muted-foreground">Valor devuelto</span>
          <span className="inline-flex items-center gap-1 text-base font-semibold tabular-nums">
            {money(devolucion.amount)}
            {currency ? <CurrencyFlagIcon currency={currency} className="size-4" /> : null}
          </span>
        </div>

        {ventaHref ? <Linea rotulo="Compra de contado" cifra="" href={ventaHref} /> : null}

        <p className="pt-1 text-xs leading-4 text-muted-foreground">¿Qué se hizo con el dinero?</p>

        {devolucion.to_own > 0 ? (
          <Linea rotulo="Rebajó su fiado" cifra={money(devolucion.to_own)} href={fiadoHref} />
        ) : null}
        {otherFiados.map((f) => (
          <Linea key={f.movementId} rotulo={`Abonó a ${f.title}`} cifra={money(f.amount)} href={f.href} />
        ))}
        {devolucion.to_credit > 0 ? <Linea rotulo="Saldo a favor" cifra={money(devolucion.to_credit)} /> : null}
        {devolucion.to_cash > 0 ? <Linea rotulo="Efectivo devuelto" cifra={money(devolucion.to_cash)} /> : null}

        <FilaDeTotal
          rotulo="Total por cobrar"
          cifra={balance.primary}
          bolivares={balance.secondary ? `${balance.secondary} hoy` : null}
          moneda={currency}
          tono={runningBalance > 0 ? "debe" : runningBalance < 0 ? "a_favor" : "neutro"}
          aFavor={runningBalance < 0}
        />
      </div>
    </dl>
  );
}

function Linea({ rotulo, cifra, href = null }: { rotulo: string; cifra: string; href?: string | null }) {
  const cuerpo = (
    <>
      <span className="min-w-0 truncate text-sm leading-5">{rotulo}</span>
      <span className="flex shrink-0 items-center gap-2">
        <span className="text-sm leading-5 tabular-nums">{cifra}</span>
        {href ? <ChevronRight className="size-5 text-muted-foreground" aria-hidden="true" /> : null}
      </span>
    </>
  );
  return href ? (
    <Link href={href} className="flex items-center justify-between gap-3 py-1.5 active:bg-muted/60">
      {cuerpo}
    </Link>
  ) : (
    <div className="flex items-center justify-between gap-3 py-1.5">{cuerpo}</div>
  );
}
