"use client";

import { Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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

export function ImportReviewTable({
  rows,
  onUpdate,
  onRemove,
  existingClients,
  showCurrency,
  sharedClientActive,
  isLinked,
  onToggleLinked,
}: {
  rows: ReviewRow[];
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
      <Table>
        <TableHeader>
          <TableRow>
            {sharedClientActive ? (
              <TableHead className="w-[6.5rem] whitespace-nowrap">Mismo cliente</TableHead>
            ) : null}
            <TableHead className="min-w-[10rem]">Cliente</TableHead>
            <TableHead>Cédula/documento</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Monto</TableHead>
            <TableHead className="min-w-[10rem]">Detalle</TableHead>
            <TableHead>Saldo calculado</TableHead>
            <TableHead>Estado</TableHead>
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
                  <Input
                    placeholder="Requerida"
                    className={row.document_id?.trim() ? undefined : "border-destructive"}
                    value={row.document_id ?? ""}
                    onChange={(e) => onUpdate(index, { document_id: e.target.value || null })}
                  />
                )}
              </TableCell>
              <TableCell>
                <Select
                  value={row.type}
                  onValueChange={(v) => onUpdate(index, { type: v as "charge" | "payment" })}
                >
                  <SelectTrigger className="w-32">
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
                    className="w-24"
                    value={row.amount}
                    onChange={(e) => onUpdate(index, { amount: Number(e.target.value) || 0 })}
                  />
                  {showCurrency ? (
                    <Select
                      value={row.currency ?? "USD"}
                      onValueChange={(v) => onUpdate(index, { currency: v as LedgerCurrency })}
                    >
                      <SelectTrigger className="w-[4.5rem]" aria-label={`Moneda de ${row.client_name}`}>
                        <SelectValue />
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
              <TableCell className="tabular-nums whitespace-nowrap">
                {row.currency
                  ? formatDisplayCurrency(row.computed_balance, row.currency)
                  : formatCurrency(row.computed_balance)}
              </TableCell>
              <TableCell>
                {row.needs_review ? (
                  <Badge variant="destructive">Revisar</Badge>
                ) : (
                  <Badge variant="secondary">OK</Badge>
                )}
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
