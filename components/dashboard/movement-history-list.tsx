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
import { FilterChip } from "@/components/dashboard/client-filters";
import { Button } from "@/components/ui/button";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { formatDate, truncateText } from "@/lib/format";
import { formatLedgerAmount, type LedgerDisplay } from "@/lib/exchange-rate/movement-display";
import { formatBs } from "@/lib/exchange-rate/format";
import type { Movement } from "@/lib/types";
import type { DatosParaCompartir } from "@/lib/share-balance";

const PAGE_SIZE = 10;


// EL FILTRO POR TIPO, pedido por el dueño el 2026-10-16: "Todos", "Fiado" y
// "Abono", a la derecha del rótulo "Historial".
//
// EL RÓTULO ENTRA COMO PROP y no se escribe aquí. Las dos pantallas que usan
// esta lista lo titulan distinto y con tipografías distintas —"Historial de
// movimientos" en 20px en la ficha del tendero, "Historial" en 14px gris en
// la del cliente—, así que el componente coloca el chip a su derecha sin
// decidir cómo se ve el título.
//
// EL CHIP VIVE AQUÍ Y NO EN LA PÁGINA porque el estado es suyo: la lista es
// la que filtra y la que pagina, y las dos cosas tienen que moverse juntas.
// Un chip en la página sería otra vez dos hermanos compartiendo estado.
const TIPOS = [
  { value: "todos", label: "Todos" },
  { value: "charge", label: "Fiado" },
  { value: "payment", label: "Abono" },
] as const;

type TipoFiltro = (typeof TIPOS)[number]["value"];

function FiltroDeTipo({
  tipo,
  setTipo,
}: {
  tipo: TipoFiltro;
  setTipo: (v: TipoFiltro) => void;
}) {
  const etiqueta = TIPOS.find((t) => t.value === tipo)?.label ?? "Todos";
  return (
    <FilterChip label={tipo === "todos" ? "Tipo" : etiqueta} active={tipo !== "todos"}>
      {(close) => (
        <div className="flex flex-col gap-1">
          {TIPOS.map((opt) => (
            <Button
              key={opt.value}
              type="button"
              variant={tipo === opt.value ? "secondary" : "ghost"}
              size="sm"
              className="justify-start"
              onClick={() => {
                setTipo(opt.value);
                close();
              }}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      )}
    </FilterChip>
  );
}

export function MovementHistoryList({
  movements,
  photoUrls,
  ledger = null,
  compartir = null,
  titulo = null,
}: {
  movements: Movement[];
  photoUrls: Record<string, string>;
  // Con que comparte la ficha de cada movimiento — el mismo enlace y el mismo
  // mensaje que "Compartir enlace" del perfil. Ver lib/share-balance.ts.
  compartir?: DatosParaCompartir | null;
  // null = plain COP ledger — see MovementDetailPopover.
  ledger?: LedgerDisplay | null;
  // El rótulo de la sección, para poder poner el filtro a su derecha. Ver el
  // comentario de `FiltroDeTipo`.
  titulo?: React.ReactNode;
}) {
  const [page, setPage] = useState(1);
  const [tipo, setTipo] = useState<TipoFiltro>("todos");

  const visibles = tipo === "todos" ? movements : movements.filter((m) => m.type === tipo);

  // LA CABECERA SE PINTA SIEMPRE, incluso sin un solo movimiento. Si
  // desapareciera con la lista, un filtro que no deja nada se llevaría por
  // delante el único control que sirve para deshacerlo.
  const cabecera = titulo ? (
    <div className="flex items-center justify-between gap-3">
      {titulo}
      {movements.length > 0 ? <FiltroDeTipo tipo={tipo} setTipo={setTipo} /> : null}
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

  // "No hay de ese tipo" no es "no hay ninguno", y la segunda frase sería
  // falsa con la lista entera a un toque de distancia.
  if (visibles.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        {cabecera}
        <p className="text-sm text-muted-foreground">
          Este cliente no tiene {tipo === "charge" ? "fiados" : "abonos"} registrados.
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
          // Si el movimiento se escribió en bolívares, la línea de abajo dice
          // ESOS bolívares y no lo que vale hoy la deuda.
          //
          // Tenía el cálculo de hoy, y era defendible: esa columna responde
          // "cuánto vale ahora" en todas las filas por igual. Pero el dueño
          // tecleó 900 y leía 899,09 — los 91 céntimos del redondeo, correctos
          // y sin explicación a la vista. La consistencia que yo protegía era
          // de cómo se calcula el número, no de lo que significa, y para quien
          // mira la lista lo segundo pesa mas.
          const bsTecleados =
            m.entry_currency === "VES" && m.entry_amount != null ? formatBs(Number(m.entry_amount)) : null;
          const balance = formatLedgerAmount(m.running_balance, m.currency, ledger);

          return (
          <li key={m.id}>
            <MovementDetailPopover
              movementId={m.id}
              type={m.type}
              amount={m.amount}
              currency={m.currency}
              description={m.description}
              ownerNote={m.owner_note}
              plazoDias={m.plazo_dias}
              cuotas={m.cuotas}
              createdAt={m.created_at}
              runningBalance={m.running_balance}
              photoUrl={m.photo_path ? (photoUrls[m.photo_path] ?? null) : null}
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
                  <p className="text-xs text-muted-foreground">
                    {formatDate(m.created_at)}
                    {m.source === "photo_import" ? " · de libreta" : ""}
                  </p>
                  {/* LA BANDERA EN LAS DOS CIFRAS DE LA FILA, desde el
                      2026-10-16, por instrucción del dueño. Esta lista es
                      donde más falta hacía: en una cartera venezolana las
                      filas en dólares y en euros se alternan, y lo único que
                      las distinguía era el símbolo — "$" y "€" pegados a un
                      número, que es justo el par que se confunde de un
                      vistazo.

                      Solo cuando la moneda existe. `null` es un negocio
                      colombiano, donde no hay dos libros que separar y una
                      bandera repetida en cada fila sería ruido. */}
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    {m.currency ? <CurrencyFlagIcon currency={m.currency} className="size-3.5 shrink-0" /> : null}
                    Por cobrar {balance.primary}
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
