"use client";

import { Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import type { ExtractedMovement } from "@/lib/types";
import type { ReviewRow } from "@/lib/reconcile";

export function ImportReviewTable({
  rows,
  onUpdate,
  onRemove,
  existingClients,
}: {
  rows: ReviewRow[];
  onUpdate: (index: number, patch: Partial<ExtractedMovement>) => void;
  onRemove: (index: number) => void;
  existingClients: { id: string; name: string }[];
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
            <TableHead className="min-w-[10rem]">Cliente</TableHead>
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
              <TableCell>
                <Input
                  list="known-clients"
                  value={row.client_name}
                  onChange={(e) => onUpdate(index, { client_name: e.target.value })}
                />
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
              <TableCell>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  className="w-28"
                  value={row.amount}
                  onChange={(e) => onUpdate(index, { amount: Number(e.target.value) || 0 })}
                />
              </TableCell>
              <TableCell>
                <Input
                  value={row.description ?? ""}
                  onChange={(e) => onUpdate(index, { description: e.target.value || null })}
                />
              </TableCell>
              <TableCell className="tabular-nums">{formatCurrency(row.computed_balance)}</TableCell>
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
