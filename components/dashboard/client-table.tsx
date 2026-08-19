"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
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
import { useIsMobile } from "@/hooks/use-mobile";
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

const PAGE_SIZE = 15;

export function ClientTable({ rows }: { rows: ClientSummary[] }) {
  const router = useRouter();
  const tour = useTour();
  const isMobile = useIsMobile();
  const tourDemoActive = tour.step === 2 || tour.step === 2.5;
  const [nameQuery, setNameQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ClientStatus | "todos">("todos");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [page, setPage] = useState(1);

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

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pagedRows = filteredRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // Any filter change invalidates the current page, so always jump back to
  // page 1 rather than risk landing on an empty page of results.
  function updateFilter<T>(setter: (value: T) => void, value: T) {
    setter(value);
    setPage(1);
  }

  if (rows.length === 0 && !tourDemoActive) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
        <p className="text-sm text-muted-foreground">
          Todavía no tienes clientes. Importa tu libreta o registra un movimiento manual.
        </p>
      </div>
    );
  }

  const legendChips = (
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
  );

  const searchInput = (
    <Input
      placeholder="Buscar por nombre"
      value={nameQuery}
      onChange={(e) => updateFilter(setNameQuery, e.target.value)}
      className="w-full sm:w-48"
    />
  );

  const statusSelect = (
    <Select
      value={statusFilter}
      onValueChange={(v) => updateFilter(setStatusFilter, v as ClientStatus | "todos")}
    >
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
  );

  const amountInputs = (
    <>
      <Input
        type="number"
        placeholder="Monto desde"
        value={minAmount}
        onChange={(e) => updateFilter(setMinAmount, e.target.value)}
        className="w-full sm:w-32"
      />
      <Input
        type="number"
        placeholder="Monto hasta"
        value={maxAmount}
        onChange={(e) => updateFilter(setMaxAmount, e.target.value)}
        className="w-full sm:w-32"
      />
    </>
  );

  return (
    <div className="flex flex-col gap-3">
      {/* Desktop: every filter stays in one row, always visible.
          Mobile: only the name search shows by default; the rest sit
          behind a "Más filtros" collapsible so the filter bar doesn't
          eat the whole screen. */}
      {isMobile ? (
        <div className="order-1 flex flex-col gap-2">
          {searchInput}
          <Collapsible>
            <CollapsibleTrigger className="group flex items-center gap-1 self-start text-sm font-medium text-muted-foreground">
              Más filtros
              <ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2">
              <div className="flex flex-wrap items-end gap-2">
                {statusSelect}
                {amountInputs}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      ) : (
        <div className="order-1 flex flex-wrap items-end gap-2">
          {searchInput}
          {statusSelect}
          {amountInputs}
        </div>
      )}

      {/* Desktop: legend stays above the table, always visible (order-2).
          Mobile: legend moves below the table (order-3) and starts
          collapsed, since the full chip list is too heavy for a small
          screen otherwise. */}
      {isMobile ? (
        <Collapsible className="order-3">
          <CollapsibleTrigger className="group flex w-full items-center justify-between rounded-lg border bg-muted/30 px-3 py-2 text-sm font-medium">
            Qué significa cada estado
            <ChevronDown className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">{legendChips}</CollapsibleContent>
        </Collapsible>
      ) : (
        <div className="order-2">{legendChips}</div>
      )}

      <div className="order-2 flex flex-col gap-3 md:order-3">
        {filteredRows.length === 0 && !tourDemoActive ? (
          <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
            <p className="text-sm text-muted-foreground">Ningún cliente coincide con estos filtros.</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Por cobrar</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="hidden md:table-cell">Último abono</TableHead>
                    <TableHead className="hidden text-right md:table-cell">Acciones</TableHead>
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
                          <div>
                            Cliente de ejemplo
                            <Badge variant="outline" className="ml-2 align-middle text-[10px]">
                              ejemplo
                            </Badge>
                          </div>
                          <div className="text-xs font-normal text-muted-foreground">—</div>
                        </TableCell>
                        <TableCell className="tabular-nums">{formatCurrency(0)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={CLIENT_STATUS_BADGE_CLASS.sin_deuda}>
                            {CLIENT_STATUS_LABEL.sin_deuda}
                          </Badge>
                        </TableCell>
                        <TableCell className="hidden text-muted-foreground md:table-cell">—</TableCell>
                        <TableCell className="hidden md:table-cell" />
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
                  {pagedRows.map((row) => {
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
                          <div>
                            {row.name}
                            {row.has_pending_review ? (
                              <Badge variant="outline" className="ml-2 align-middle text-[10px]">
                                revisar
                              </Badge>
                            ) : null}
                          </div>
                          <div className="text-xs font-normal text-muted-foreground">
                            {row.document_id || "—"}
                          </div>
                        </TableCell>
                        <TableCell className="tabular-nums">{formatCurrency(row.balance)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={CLIENT_STATUS_BADGE_CLASS[status]}>
                            {CLIENT_STATUS_LABEL[status]}
                          </Badge>
                        </TableCell>
                        <TableCell className="hidden text-muted-foreground md:table-cell">
                          {row.last_payment_at ? formatDate(row.last_payment_at) : "Nunca"}
                          <span className="ml-1 text-xs">({row.days_since_payment}d)</span>
                        </TableCell>
                        <TableCell className="hidden md:table-cell" onClick={(e) => e.stopPropagation()}>
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
          </>
        )}
      </div>
    </div>
  );
}
