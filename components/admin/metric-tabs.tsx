"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { SECCIONES, type Seccion } from "@/lib/admin/secciones";

// THE SECTIONS OF /admin → Métricas, one per flow. The owner's request of
// 2026-10-31: «podríamos separar esas métricas por funcionalidad o flujo para
// organizar mejor el dashboard».
//
// SAME BEHAVIOUR AS `reportes-tabs.tsx`, and that is the point of copying its
// rules rather than its look: the section lives in the URL (`?seccion=`), so
// the server only loads what that section shows, the back button works, and
// every other filter -- dates, currency, businesses -- survives the switch.
// Losing the date range on a tab change would quietly change every figure.
//
// Not the same component: Reportes' tabs are drawn for the dark header of the
// owner's app, and /admin is a light internal panel. The behaviour is shared;
// the paint is not.
export function MetricTabs({ activa }: { activa: Seccion }) {
  const pathname = usePathname();
  const params = useSearchParams();

  return (
    <div
      role="tablist"
      aria-label="Secciones de métricas"
      className="flex w-full items-center gap-1 overflow-x-auto rounded-lg bg-muted p-1"
    >
      {SECCIONES.map((s) => {
        const siguiente = new URLSearchParams(params.toString());
        siguiente.set("seccion", s.clave);
        const seleccionada = s.clave === activa;
        return (
          <Link
            key={s.clave}
            href={`${pathname}?${siguiente.toString()}`}
            scroll={false}
            role="tab"
            aria-selected={seleccionada}
            className={cn(
              "flex h-9 shrink-0 items-center justify-center rounded-md px-3 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
              seleccionada
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {s.etiqueta}
          </Link>
        );
      })}
    </div>
  );
}
