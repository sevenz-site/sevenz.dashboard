"use client";

import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
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
import { formatCurrency } from "@/lib/format";
import { formatDisplayCurrency } from "@/lib/exchange-rate/format";
import type { ExtractedMovement, LedgerCurrency } from "@/lib/types";
import type { ReviewRow } from "@/lib/reconcile";
import { DocumentIdInput } from "@/components/dashboard/document-id-input";
import type { OwnerCountry } from "@/lib/types";

// Los mismos dos decimales que formatDisplayCurrency, sin símbolo de moneda.
const SIN_MONEDA = new Intl.NumberFormat("es-VE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function ImportReviewTable({
  rows,
  country,
  onUpdate,
  onRemove,
  existingClients,
  showCurrency,
  sharedClientActive,
  isLinked,
  onToggleLinked,
}: {
  rows: ReviewRow[];
  // Decides the document prefix: "V-" in Venezuela, none in Colombia.
  country: OwnerCountry;
  onUpdate: (index: number, patch: Partial<ExtractedMovement>) => void;
  onRemove: (index: number) => void;
  existingClients: { id: string; name: string }[];
  // False for a CO owner, whose ledger has no currency dimension.
  showCurrency: boolean;
  // True while "todas las filas son del mismo cliente" is ticked, which adds a
  // per-row checkbox: a page usually holds one client but can mix, so the
  // shared value is a default any row can refuse.
  sharedClientActive: boolean;
  // Whether this row is still taking the shared client. A linked row shows the
  // shared name and document as plain text — editing them per row would
  // silently contradict the field above the table. An opted-out row gets its
  // own inputs back, holding whatever was read from the photo.
  isLinked: (rowId: string) => boolean;
  onToggleLinked: (rowId: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <datalist id="known-clients">
        {existingClients.map((c) => (
          <option key={c.id} value={c.name} />
        ))}
      </datalist>
      {/* Márgenes de celda a 6px en vez de los 8 de serie, y solo aquí. Son
          siete columnas de campos editables, así que cada 2px de gutter se
          multiplica por catorce bordes: 28px de scroll menos. No se toca
          `components/ui/table.tsx` — el resto de las tablas del app no tiene
          este problema y no debe pagar por él. */}
      <Table className="[&_td]:px-1.5 [&_th]:px-1.5">
        <TableHeader>
          <TableRow>
            {sharedClientActive ? (
              <TableHead className="w-20 whitespace-nowrap">Vincular</TableHead>
            ) : null}
            <TableHead className="min-w-[7.5rem]">Cliente</TableHead>
            <TableHead className="w-[8.5rem]">Documento</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Monto</TableHead>
            <TableHead className="min-w-[7.5rem]">Detalle</TableHead>
            <TableHead>Saldo</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => (
            <TableRow key={row.rowId} className={row.needs_review ? "bg-amber-50 dark:bg-amber-950/20" : undefined}>
              {sharedClientActive ? (
                <TableCell>
                  <Checkbox
                    checked={isLinked(row.rowId)}
                    onCheckedChange={() => onToggleLinked(row.rowId)}
                    aria-label={`Usar el cliente compartido para la fila de ${row.client_name}`}
                  />
                </TableCell>
              ) : null}
              <TableCell>
                {sharedClientActive && isLinked(row.rowId) ? (
                  <span className="text-sm whitespace-nowrap text-muted-foreground">
                    {row.client_name}
                  </span>
                ) : (
                  <Input
                    list="known-clients"
                    value={row.client_name}
                    onChange={(e) => onUpdate(index, { client_name: e.target.value })}
                  />
                )}
              </TableCell>
              <TableCell>
                {(sharedClientActive && isLinked(row.rowId)) || !row.needs_document_id ? (
                  <span className="text-sm whitespace-nowrap text-muted-foreground">
                    {row.document_id}
                  </span>
                ) : (
                  <DocumentIdInput
                    id={`import-document-${index}`}
                    country={country}
                    value={row.document_id ?? ""}
                    onChange={(next) => onUpdate(index, { document_id: next || null })}
                    invalid={!row.document_id?.trim()}
                  />
                )}
              </TableCell>
              <TableCell>
                <Select
                  value={row.type}
                  onValueChange={(v) => onUpdate(index, { type: v as "charge" | "payment" })}
                >
                  <SelectTrigger className="w-[5.5rem]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="charge">Cargo</SelectItem>
                    <SelectItem value="payment">Abono</SelectItem>
                  </SelectContent>
                </Select>
              </TableCell>
              {/* Currency sits with the amount rather than in its own column:
                  it is a property of that number, and on a phone an extra
                  column is one more thing to scroll past to reach it. */}
              <TableCell>
                <div className="flex items-center gap-1.5">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    className="w-20"
                    value={row.amount}
                    onChange={(e) => onUpdate(index, { amount: Number(e.target.value) || 0 })}
                  />
                  {/* Sin moneda no se muestra ninguna, en vez de enseñar USD
                      sin haberlo guardado: la fila diría "USD" mientras el
                      servidor responde que no sabe en qué moneda está. El
                      selector se ensancha solo mientras está vacío, y vuelve a
                      su tamaño en cuanto hay una elegida — que es lo normal
                      tras pulsar "Todo en USD/EUR". */}
                  {showCurrency ? (
                    <Select
                      value={row.currency ?? undefined}
                      onValueChange={(v) => onUpdate(index, { currency: v as LedgerCurrency })}
                    >
                      <SelectTrigger
                        className={row.currency ? "w-[4.25rem]" : "w-[6.5rem]"}
                        aria-label={`Moneda de ${row.client_name}`}
                      >
                        <SelectValue placeholder="Moneda" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="USD">USD</SelectItem>
                        <SelectItem value="EUR">EUR</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : null}
                </div>
              </TableCell>
              <TableCell>
                <Input
                  value={row.description ?? ""}
                  onChange={(e) => onUpdate(index, { description: e.target.value || null })}
                />
              </TableCell>
              {/* The running total is per currency, so on a mixed libreta a
                  bare number would be ambiguous. formatCurrency is hardcoded to
                  COP and renders "$" — appending "EUR" to it produced
                  "$ 20,00 EUR", a dollar sign contradicting a euro code. Same
                  helper the client table and the movement detail use, so a
                  euro reads "€20,00" here exactly as it does everywhere else. */}
              {/* Y mientras un negocio venezolano no haya elegido moneda, el
                  total va sin símbolo. formatCurrency está fijado a COP, así
                  que usarlo aquí pintaría el saldo de una libreta venezolana
                  con el signo colombiano — la misma mentira que acabamos de
                  quitar del selector, en la columna de al lado. La cifra es
                  cierta; lo que aún no se sabe es en qué moneda está. */}
              <TableCell className="tabular-nums whitespace-nowrap">
                {row.currency
                  ? formatDisplayCurrency(row.computed_balance, row.currency)
                  : showCurrency
                    ? SIN_MONEDA.format(row.computed_balance)
                    : formatCurrency(row.computed_balance)}
              </TableCell>
              <TableCell>
                <Button variant="ghost" size="icon" onClick={() => onRemove(index)}>
                  <Trash2 className="size-4" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
