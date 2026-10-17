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
import {
  MovementTypeFilter,
  type TipoFiltro,
} from "@/components/dashboard/movement-type-filter";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { formatDate, truncateText } from "@/lib/format";
import { formatLedgerAmount, type LedgerDisplay } from "@/lib/exchange-rate/movement-display";
import { formatBs } from "@/lib/exchange-rate/format";
import { getBalanceLabel } from "@/lib/types";
import type { DatosParaCompartir } from "@/lib/share-balance";
import type { ExchangeRateMode, LedgerCurrency, MovementCurrencyCode } from "@/lib/types";

type SharedMovement = {
  id: string;
  type: "charge" | "payment";
  amount: number;
  currency: LedgerCurrency | null;
  description: string | null;
  running_balance: number;
  needs_review: boolean;
  plazo_dias: number | null;
  created_at: string;
  rate_mode_used: ExchangeRateMode | null;
  exchange_rate_used: number | null;
  official_bcv_rate_at_time: number | null;
  entry_currency: MovementCurrencyCode | null;
  entry_amount: number | null;
  rate_usd_at_time: number | null;
  rate_eur_at_time: number | null;
};

const PAGE_SIZE = 10;


// EL FILTRO POR TIPO, pedido por el dueño el 2026-10-16: "Todos", "Fiado" y
// "Abono", a la derecha del rótulo "Historial". Gemelo del de la lista del
// tendero (`components/dashboard/movement-history-list.tsx`), y en dos copias
// a propósito: esta lista es la que ve el CLIENTE, con sus propios tipos y su
// propio contrato de datos, y juntarlas obligaría a una sola forma para dos
// pantallas que ya se han separado antes.


export function MovementHistoryList({
  movements,
  ledger = null,
  compartir = null,
  titulo = null,
}: {
  movements: SharedMovement[];
  ledger?: LedgerDisplay | null;
  // Aqui el enlace sale de la direccion que el cliente ya tiene abierta: pedir
  // uno al servidor solo responde a un dueño con sesion.
  compartir?: DatosParaCompartir | null;
  // El rótulo de la sección, para poder poner el filtro a su derecha.
  titulo?: React.ReactNode;
}) {
  const [page, setPage] = useState(1);
  const [tipo, setTipo] = useState<TipoFiltro>("todos");

  const visibles = tipo === "todos" ? movements : movements.filter((m) => m.type === tipo);

  // La cabecera se pinta siempre: un filtro que no deja nada no puede
  // llevarse por delante el control que sirve para deshacerlo.
  const cabecera = titulo ? (
    <div className="flex items-center justify-between gap-3">
      {titulo}
      {movements.length > 0 ? <MovementTypeFilter tipo={tipo} setTipo={setTipo} /> : null}
    </div>
  ) : null;

  if (movements.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        {cabecera}
        <p className="text-sm text-muted-foreground">Todavía no hay movimientos.</p>
      </div>
    );
  }

  if (visibles.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        {cabecera}
        <p className="text-sm text-muted-foreground">
          No tienes {tipo === "charge" ? "fiados" : "abonos"} en este historial.
        </p>
      </div>
    );
  }

  const pageCount = Math.max(1, Math.ceil(visibles.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pagedMovements = visibles.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div className="flex flex-col gap-3">
      {cabecera}
      <ul className="flex flex-col divide-y rounded-lg border">
        {pagedMovements.map((m) => {
          const amount = formatLedgerAmount(m.amount, m.currency, ledger);
          // Lo mismo que en la lista del dueño, y por un motivo que aqui pesa
          // mas: el cliente y el comercio tienen que ver EL MISMO numero. Si el
          // dueño anota Bs. 900 y el cliente abre su enlace y lee 899,09, eso
          // es justo la discusion que esta app existe para evitar.
          const bsTecleados =
            m.entry_currency === "VES" && m.entry_amount != null ? formatBs(Number(m.entry_amount)) : null;
          const balance = formatLedgerAmount(m.running_balance, m.currency, ledger);

          return (
          <li key={m.id}>
            <MovementDetailPopover
              type={m.type}
              amount={m.amount}
              currency={m.currency}
              description={m.description}
              plazoDias={m.plazo_dias}
              createdAt={m.created_at}
              runningBalance={m.running_balance}
              balanceLabel={getBalanceLabel(m.running_balance)}
              entryCurrency={m.entry_currency}
              entryAmount={m.entry_amount}
              exchangeRateUsed={m.exchange_rate_used}
              ledger={ledger}
              compartir={compartir}
            >
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {truncateText(
                      `${m.type === "charge" ? "Fiado" : "Abono"}${m.description ? ` · ${m.description}` : ""}`,
                      34,
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">{formatDate(m.created_at)}</p>
                  {/* LA BANDERA EN LAS DOS CIFRAS DE LA FILA, desde el
                      2026-10-16, por instrucción del dueño, y en esta
                      pantalla pesa más que en la del tendero: quien la lee es
                      el cliente, que no lleva dos libros en la cabeza y ve
                      "$" y "€" alternándose en su propio historial sin más
                      pista que el símbolo.

                      Solo cuando la moneda existe. `null` es un negocio
                      colombiano, donde no hay dos libros que separar. */}
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    {m.currency ? (
                      <CurrencyFlagIcon currency={m.currency} className="size-3.5 shrink-0" />
                    ) : null}
                    {getBalanceLabel(m.running_balance)} {balance.primary}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <div
                    className={`flex flex-col items-end tabular-nums text-sm font-medium ${m.type === "charge" ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}`}
                  >
                    <span className="flex items-center gap-1">
                      {m.currency ? (
                        <CurrencyFlagIcon currency={m.currency} className="size-3.5 shrink-0" />
                      ) : null}
                      {m.type === "charge" ? "+" : "-"}
                      {amount.primary}
                    </span>
                    {bsTecleados ?? amount.secondary ? (
                      <span className="font-normal text-muted-foreground">
                        {bsTecleados ?? amount.secondary}
                      </span>
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
