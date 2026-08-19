"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye } from "lucide-react";
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
import { ShareActions } from "@/components/dashboard/share-actions";
import { useTour } from "@/components/dashboard/tour-context";
import { formatCurrency, formatDate } from "@/lib/format";
import {
  CLIENT_STATUS_BADGE_CLASS,
  CLIENT_STATUS_DESCRIPTION,
  CLIENT_STATUS_LABEL,
  getClientStatus,
  type ClientStatus,
  type ClientSummary,
} from "@/lib/types";

const STATUS_OPTIONS: { value: ClientStatus | "todos"; label: string }[] = [
  { value: "todos", label: "Todos los estados" },
  { value: "sin_deuda", label: CLIENT_STATUS_LABEL.sin_deuda },
  { value: "a_favor", label: CLIENT_STATUS_LABEL.a_favor },
  { value: "dentro_del_plazo", label: CLIENT_STATUS_LABEL.dentro_del_plazo },
  { value: "plazo_vencido", label: CLIENT_STATUS_LABEL.plazo_vencido },
  { value: "sin_plazo", label: CLIENT_STATUS_LABEL.sin_plazo },
  { value: "critico", label: CLIENT_STATUS_LABEL.critico },
];

export function ClientTable({ rows }: { rows: ClientSummary[] }) {
  const router = useRouter();
  const tour = useTour();
  const tourDemoActive = tour.step === 2 || tour.step === 2.5;
  const [nameQuery, setNameQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ClientStatus | "todos">("todos");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");

  const filteredRows = useMemo(() => {
    const query = nameQuery.trim().toLowerCase();
    const min = minAmount.trim() ? Number(minAmount) : null;
    const max = maxAmount.trim() ? Number(maxAmount) : null;

    return rows.filter((row) => {
      if (query && !row.name.toLowerCase().includes(query)) return false;
      if (statusFilter !== "todos") {
        const status = getClientStatus(
          row.balance,
          row.days_since_payment,
          row.oldest_unpaid_charge_at,
          row.oldest_unpaid_charge_plazo_dias,
        );
        if (status !== statusFilter) return false;
      }
      if (min !== null && !Number.isNaN(min) && row.balance < min) return false;
      if (max !== null && !Number.isNaN(max) && row.balance > max) return false;
      return true;
    });
  }, [rows, nameQuery, statusFilter, minAmount, maxAmount]);

  if (rows.length === 0 && !tourDemoActive) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
        <p className="text-sm text-muted-foreground">
          Todavía no tienes clientes. Importa tu libreta o registra un movimiento manual.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <Input
          placeholder="Buscar por nombre"
          value={nameQuery}
          onChange={(e) => setNameQuery(e.target.value)}
          className="w-full sm:w-48"
        />
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as ClientStatus | "todos")}>
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="number"
          placeholder="Monto desde"
          value={minAmount}
          onChange={(e) => setMinAmount(e.target.value)}
          className="w-full sm:w-32"
        />
        <Input
          type="number"
          placeholder="Monto hasta"
          value={maxAmount}
          onChange={(e) => setMaxAmount(e.target.value)}
          className="w-full sm:w-32"
        />
      </div>

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

      {filteredRows.length === 0 && !tourDemoActive ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">Ningún cliente coincide con estos filtros.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Por cobrar</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Último abono</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tourDemoActive ? (
                <>
                  <TableRow
                    data-tour="demo-client-row"
                    className="cursor-pointer bg-accent/40"
                    onClick={() => {
                      if (tour.step === 2) tour.advance();
                    }}
                  >
                    <TableCell className="font-medium">
                      Cliente de ejemplo
                      <Badge variant="outline" className="ml-2 align-middle text-[10px]">
                        ejemplo
                      </Badge>
                    </TableCell>
                    <TableCell className="tabular-nums">{formatCurrency(0)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={CLIENT_STATUS_BADGE_CLASS.sin_deuda}>
                        {CLIENT_STATUS_LABEL.sin_deuda}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">—</TableCell>
                    <TableCell />
                  </TableRow>
                  {tour.step === 2.5 ? (
                    <TableRow className="bg-accent/20">
                      <TableCell colSpan={5}>
                        <div className="flex items-center justify-between py-1">
                          <span className="text-sm text-muted-foreground">
                            Detalle de Cliente de ejemplo
                          </span>
                          <Button
                            type="button"
                            size="sm"
                            data-tour="demo-add-movement-button"
                            onClick={() => tour.advance()}
                          >
                            + Agregar movimiento
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </>
              ) : null}
              {filteredRows.map((row) => {
                const status = getClientStatus(
                  row.balance,
                  row.days_since_payment,
                  row.oldest_unpaid_charge_at,
                  row.oldest_unpaid_charge_plazo_dias,
                );
                return (
                  <TableRow
                    key={row.client_id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/clients/${row.client_id}`)}
                  >
                    <TableCell className="font-medium">
                      {row.name}
                      {row.has_pending_review ? (
                        <Badge variant="outline" className="ml-2 align-middle text-[10px]">
                          revisar
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="tabular-nums">{formatCurrency(row.balance)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={CLIENT_STATUS_BADGE_CLASS[status]}>
                        {CLIENT_STATUS_LABEL[status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.last_payment_at ? formatDate(row.last_payment_at) : "Nunca"}
                      <span className="ml-1 text-xs">({row.days_since_payment}d)</span>
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" asChild title="Ver más">
                          <Link href={`/clients/${row.client_id}`}>
                            <Eye className="size-4" />
                          </Link>
                        </Button>
                        <ShareActions
                          clientId={row.client_id}
                          clientName={row.name}
                          whatsapp={row.whatsapp}
                          balance={row.balance}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
