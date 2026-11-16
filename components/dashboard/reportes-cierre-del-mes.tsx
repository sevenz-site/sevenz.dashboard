import { TriangleAlert } from "lucide-react";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { formatPriceAmount } from "@/lib/products/price";
import { cn } from "@/lib/utils";
import { ledgersOfCountry, type CierreDelMes } from "@/lib/reports/cierre-del-mes";

// «CIERRE DE …»: LAST CLOSED MONTH, UNDER «MARGEN POR PRODUCTO».
//
// It exists so the `cierre_mensual` WhatsApp's button («Ver mi margen», a fixed address Meta
// approved, `?tab=inventario&seccion=margen`) lands on the figure the message said. Before it,
// that section only showed the margin written in each product's sheet, and the message's
// «Ganancia estimada» was nowhere on screen. Owner's decision of 2026-11-16 («Añadir la
// ganancia a Reportes»); frame approved by him the same day: Figma, «Propuesta · Cierre del mes
// en Reportes (cierre_mensual)», node 2170:19145.
//
// THE MONTH IGNORES THE RANGE PICKED ABOVE, on purpose, and the subtitle says so: Reportes
// opens on «últimos 30 días», and a card that followed it would show a different figure from
// the message that sent him here. Same computation as the message (`cargarCierreDelMes`), so
// the two cannot disagree.

export function ReportesCierreDelMes({
  cierre,
  country,
}: {
  cierre: CierreDelMes;
  country: string | null;
}) {
  const libros = ledgersOfCountry(country).filter((l) => Number(cierre.libros[l]?.ventas ?? 0) > 0);

  return (
    <div className="flex flex-col gap-3 rounded-[10px] border p-3">
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-medium">Cierre de {cierre.mes.monthName}</p>
        <p className="text-xs text-muted-foreground">
          El mes completo, aunque arriba elijas otra fecha. Ya descuenta las devoluciones.
        </p>
      </div>

      {libros.length === 0 ? (
        <p className="text-sm">En {cierre.mes.monthName} no registraste ventas.</p>
      ) : (
        // A column on the phone; the three side by side from `md`, the web frame.
        <div className="flex flex-col gap-3 md:flex-row md:gap-10">
          <Cifra rotulo="Ventas registradas">
            {libros.map((l) => {
              const b = cierre.libros[l]!;
              return (
                <span key={l} className="flex items-center gap-1.5">
                  <CurrencyFlagIcon currency={l} className="size-4 shrink-0" />
                  <span className="text-sm font-medium tabular-nums">{formatPriceAmount(b.vendido, l)}</span>
                  <span className="text-xs text-muted-foreground">
                    · {b.ventas} {b.ventas === 1 ? "venta" : "ventas"}
                  </span>
                </span>
              );
            })}
          </Cifra>
          <Cifra rotulo="Ganancia estimada">
            {libros.map((l) => {
              const g = cierre.libros[l]!.ganancia;
              // No line of this book carries a cost: the profit is unknown, not zero.
              if (cierre.libros[l]!.conCosto === 0) {
                return (
                  <span key={l} className="flex items-center gap-1.5">
                    <CurrencyFlagIcon currency={l} className="size-4 shrink-0" />
                    <span className="text-2xl text-muted-foreground">—</span>
                  </span>
                );
              }
              return (
                <span key={l} className="flex items-center gap-1.5">
                  <CurrencyFlagIcon currency={l} className="size-4 shrink-0" />
                  <span
                    className={cn(
                      "text-2xl tabular-nums",
                      // A loss stays red and keeps its sign: it is the figure he most needs.
                      g < 0 ? "text-destructive" : "text-green-700 dark:text-green-500",
                    )}
                  >
                    {formatPriceAmount(g, l)}
                  </span>
                </span>
              );
            })}
          </Cifra>
          <Cifra rotulo="Productos vendidos sin costo" pie="No entran en la ganancia.">
            <span className="text-sm font-medium tabular-nums">{cierre.lineasSinCosto}</span>
          </Cifra>
        </div>
      )}

      {/* BELOW 80 % OF LINES WITH A COST, the WhatsApp does not go (spec of `cierre_mensual`).
          Saying so here is what tells the owner why that month's close never arrived. */}
      {libros.length > 0 && !cierre.completo ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-500">
          <TriangleAlert className="mt-px size-4 shrink-0" aria-hidden />
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="font-semibold">Menos del 80 % de lo vendido tiene costo.</p>
            <p>
              Esta ganancia está incompleta y no te llegará por WhatsApp. Escribe el costo en la ficha de
              cada producto.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Cifra({ rotulo, pie, children }: { rotulo: string; pie?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs">{rotulo}</span>
      {children}
      {pie ? <span className="text-xs text-muted-foreground">{pie}</span> : null}
    </div>
  );
}
