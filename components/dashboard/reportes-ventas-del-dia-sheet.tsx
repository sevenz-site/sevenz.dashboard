"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { track } from "@/lib/mixpanel";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { EmptyState } from "@/components/dashboard/empty-state";
import { SearchField } from "@/components/dashboard/client-search-sheet";
import { foldForSearch } from "@/lib/search/fold";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { formatPriceAmount } from "@/lib/products/price";
import { cn } from "@/lib/utils";
import type { FilaDelDia } from "@/lib/reports/cierre-del-mes";

// WHAT «VER TODO» OPENS IN «CIERRE DEL DÍA»: TODAY'S SALES, ONE ROW PER SALE.
//
// Owner's request of 2026-11-17 («Agregué nuevo botón "Ver todos" y al seleccionarlo abre
// componente sheet con historial de productos vendidos»), and his answer to the shape the
// same day: «Por venta». THERE IS NO FRAME FOR THIS SHEET: it follows the other sheets of
// Reportes (`reportes-plazos-sheet.tsx`), and its frame is drawn for his approval afterwards.
//
// EVERY TRANSACTION OF THE DAY, one row each: the sales (one per sale and book), the abonos,
// the fiados written without a sale and the returns, in red and negative. Each row opens its
// detail.
//
// THE TYPE ON TOP, THE CLIENT BELOW (owner's request of 2026-11-17: «el label "Mostrador"
// cambiar por el tipo de transacción», and the client «En la segunda línea»), with the type in
// the colour its Facturación card already uses. And «Buscar cliente» over the list, his request
// the same day, the same `foldForSearch` as every search box of the app.

export function ReportesVentasDelDiaSheet({
  filas,
  etiqueta,
  oculto,
  children,
}: {
  filas: FilaDelDia[];
  etiqueta: string;
  oculto: boolean;
  children: React.ReactNode;
}) {
  const [abierta, setAbierta] = useState(false);
  const [query, setQuery] = useState("");
  const visibles = useMemo(() => {
    const q = foldForSearch(query.trim());
    return q ? filas.filter((f) => foldForSearch(f.cliente).includes(q)) : filas;
  }, [filas, query]);

  return (
    <Sheet
      open={abierta}
      onOpenChange={(abrir) => {
        if (abrir) track("Report Sheet Opened", { hoja: "Cierre del día" });
        setAbierta(abrir);
      }}
    >
      <SheetTrigger asChild>{children}</SheetTrigger>
      {/* `svh`, not `vh`: see the same note in `reportes-plazos-sheet.tsx` (iPhone toolbar). */}
      <SheetContent side="bottom" className="flex max-h-[90svh] flex-col rounded-t-xl">
        <SheetHeader>
          <SheetTitle>Ventas de hoy</SheetTitle>
          <p className="text-sm text-muted-foreground">{etiqueta}</p>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 pb-6">
          {filas.length > 0 ? (
            <SearchField value={query} onChange={setQuery} placeholder="Buscar cliente" />
          ) : null}
          {filas.length === 0 ? (
            <EmptyState title="Hoy no registraste nada" subtitle="Aquí aparecerá cada venta, abono, fiado y devolución del día." />
          ) : visibles.length === 0 ? (
            <EmptyState title={`No encontramos a «${query.trim()}»`} subtitle="Revisa el nombre." />
          ) : (
            visibles.map((f) => (
              <Link
                key={f.clave}
                href={f.href}
                onClick={() => setAbierta(false)}
                className="flex items-center gap-3 rounded-[10px] border px-3 py-2.5 transition-colors active:bg-accent"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className={cn("truncate text-sm font-medium", COLOR_DEL_TIPO[f.tipo])}>{f.tipo}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      <CurrencyFlagIcon currency={f.libro} className="size-4" />
                      <span
                        className={cn(
                          "text-sm tabular-nums",
                          f.total < 0 ? "text-destructive" : "",
                        )}
                      >
                        {oculto ? "•••••" : formatPriceAmount(f.total, f.libro)}
                      </span>
                    </span>
                  </div>
                  <span className="truncate text-xs text-muted-foreground">
                    {hora(f.cuando)} · {f.cliente}
                  </span>
                  <span className="line-clamp-2 text-xs text-muted-foreground">{f.detalle}</span>
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// The colour each type already has on its Facturación card and in the Transacciones legend.
const COLOR_DEL_TIPO: Record<FilaDelDia["tipo"], string> = {
  "De contado": "text-brand-sales",
  Abono: "text-sky-600",
  Fiado: "text-destructive",
  Devolución: "text-warning",
};

/** «9:11 a. m.», in the phone's own clock: the owner's phone is where the business is. */
function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-VE", { hour: "numeric", minute: "2-digit" });
}
