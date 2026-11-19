"use client";

import { ChevronRight, CircleDollarSign, Eye, EyeOff, TriangleAlert, Undo2 } from "lucide-react";
import { IconoDeAbono, IconoDeFiado } from "@/components/dashboard/iconos-de-movimiento";
import type { Facturacion } from "@/lib/reports/facturacion";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { ReportesVentasDelDiaSheet } from "@/components/dashboard/reportes-ventas-del-dia-sheet";
import { formatPriceAmount } from "@/lib/products/price";
import { cn } from "@/lib/utils";
import {
  ledgersOfCountry,
  type CierreDelDia,
  type CierreDelMes,
  type FilaDelDia,
  type LibroDelCierre,
  type CierreLedger,
} from "@/lib/reports/cierre-del-mes";

// «CIERRE DEL DÍA» AND «CIERRE DE …», THE TWO CLOSES AT THE TOP OF FACTURACIÓN.
//
// Owner's request of 2026-11-17 (frame 2189:28187): the month close moves from Inventario to
// Facturación, and a day close goes above it. ONE CARD FOR BOTH, because they are the same
// figures over a different span (`calcularCierre`), and two copies would drift the way
// CLAUDE.md's «Un valor visual que sale en más de una pantalla NACE en un componente» warns.
//
// THE MONTH IS STILL WHERE THE `cierre_mensual` BUTTON LANDS. That WhatsApp («Ver mi margen»)
// carries a fixed address Meta approved, `?tab=inventario&seccion=margen`; the Reportes page
// sends that query form to Facturación's `#cierre-del-mes` (`ALIAS_DE_SECCION` in
// `lib/reports/secciones.ts`), so the message and the card keep showing the same figure.
// Frame of the card itself, approved on 2026-11-16: 2170:19145.
//
// THE MONTH IGNORES THE RANGE PICKED ABOVE, and its subtitle says so; the day is TODAY SO FAR
// at the business («Hoy hasta ahora», his answer of 2026-11-17).
//
// «TOTAL VENDIDO» AND THE FOUR TYPES — owner's request of 2026-11-17: «Ventas registradas en
// "Cierre del día" deben incluir todas las transacciones porque es el comportamiento del día,
// también en cierre del mes. Agrega cálculos separados por cada tipo de transacción». The four
// rows are the Facturación cards' arithmetic for the close's span (`cargarFacturacion` with
// `soloTransacciones`), not a second rule: «De contado» is what was collected at the sale,
// «Abonos» what was paid of debts (the first payment of a fiado included), «Fiados» what was
// lent, «Devoluciones» the value that came back. «Total vendido» stays on top because it is the
// figure the `cierre_mensual` WhatsApp states (his answer the same day, «Arriba, "Total
// vendido"»): every sale, cash and credit, minus what came back.
//
// THE EYE IS THE SCREEN'S ONE SWITCH. The frame draws one per block; each toggles the same
// state that hides every amount of the tab, the one that existed before (not remembered
// between visits, on purpose: see `ReportesFacturacion`).

/** The four types of the close's span: the Facturación cards' figures for it. */
export type DesgloseDelCierre = Pick<Facturacion, "ventas" | "abonos" | "fiados" | "devoluciones" | "recuentos">;

export function ReportesCierreDelMes({
  cierre,
  desglose,
  country,
  oculto,
  onAlternarOculto,
}: {
  cierre: CierreDelMes;
  desglose: DesgloseDelCierre | null;
  country: string | null;
  oculto: boolean;
  onAlternarOculto: () => void;
}) {
  return (
    <TarjetaDeCierre
      titulo={`Cierre de ${cierre.mes.monthName}`}
      subtitulo="El mes completo, aunque arriba elijas otra fecha. Ya descuenta las devoluciones."
      vacio={`En ${cierre.mes.monthName} no registraste nada.`}
      libros={cierre.libros}
      desglose={desglose}
      lineasSinCosto={cierre.lineasSinCosto}
      completo={cierre.completo}
      country={country}
      oculto={oculto}
      onAlternarOculto={onAlternarOculto}
      // BELOW 80 % OF LINES WITH A COST, the WhatsApp does not go (spec of `cierre_mensual`).
      avisoDeWhatsapp
      // NO «Descargar» HERE. The card carried one from 2026-11-17 until the owner removed it on
      // 2026-11-19: *«Eliminar botón "Descargar" en la sección de cierre mensual en reportes»*.
      // The month still downloads from «Descargar» in the header («Descargar cierre de …»,
      // `reportes-descargar.tsx`), which he did not ask to remove.
      pie={null}
    />
  );
}

export function ReportesCierreDelDia({
  cierre,
  desglose,
  ventas,
  country,
  oculto,
  onAlternarOculto,
}: {
  cierre: CierreDelDia;
  desglose: DesgloseDelCierre | null;
  ventas: FilaDelDia[];
  country: string | null;
  oculto: boolean;
  onAlternarOculto: () => void;
}) {
  return (
    <TarjetaDeCierre
      titulo="Cierre del día"
      subtitulo={cierre.dia.etiqueta}
      vacio="Hoy no registraste nada."
      libros={cierre.libros}
      desglose={desglose}
      lineasSinCosto={cierre.lineasSinCosto}
      completo={cierre.completo}
      country={country}
      oculto={oculto}
      onAlternarOculto={onAlternarOculto}
      avisoDeWhatsapp={false}
      pie={
        <ReportesVentasDelDiaSheet filas={ventas} etiqueta={cierre.dia.etiqueta} oculto={oculto}>
          <button type="button" className="flex items-center gap-0.5 text-xs">
            Ver todo
            <ChevronRight className="size-4" aria-hidden />
          </button>
        </ReportesVentasDelDiaSheet>
      }
    />
  );
}

function TarjetaDeCierre({
  titulo,
  subtitulo,
  vacio,
  libros: porLibro,
  desglose,
  lineasSinCosto,
  completo,
  country,
  oculto,
  onAlternarOculto,
  avisoDeWhatsapp,
  pie,
}: {
  titulo: string;
  subtitulo: string;
  vacio: string;
  libros: Partial<Record<CierreLedger, LibroDelCierre>>;
  desglose: DesgloseDelCierre | null;
  lineasSinCosto: number;
  completo: boolean;
  country: string | null;
  oculto: boolean;
  onAlternarOculto: () => void;
  avisoDeWhatsapp: boolean;
  pie: React.ReactNode;
}) {
  // A book is drawn when anything happened in it: a day of abonos only is still a day.
  const conActividad = (l: CierreLedger) =>
    Number(porLibro[l]?.ventas ?? 0) > 0 ||
    Object.values(desglose?.recuentos[l] ?? {}).some((n) => n > 0);
  const libros = ledgersOfCountry(country).filter(conActividad);
  const conVentas = libros.filter((l) => Number(porLibro[l]?.ventas ?? 0) > 0);
  const monto = (n: number, l: CierreLedger) => (oculto ? "•••••" : formatPriceAmount(n, l));

  return (
    <div className="flex flex-col gap-3 rounded-[10px] border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-sm font-medium">{titulo}</p>
          <p className="text-xs text-muted-foreground">{subtitulo}</p>
        </div>
        <BotonDelOjo oculto={oculto} onClick={onAlternarOculto} />
      </div>

      {libros.length === 0 ? (
        <p className="text-sm">{vacio}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {/* «VENTAS REGISTRADAS»: «Total vendido» first, the figure of the WhatsApp, then the
              four types. One block per book; on the web the types sit four across. */}
          <Cifra rotulo="Ventas registradas">
            <div className="flex flex-col gap-3">
              {libros.map((l) => (
                <div key={l} className="flex flex-col gap-1.5">
                  <span className="flex items-center gap-1.5">
                    <CurrencyFlagIcon currency={l} className="size-4 shrink-0" />
                    <span className="text-xs text-muted-foreground">Total vendido</span>
                    <span className="text-sm font-medium tabular-nums">
                      {monto(Number(porLibro[l]?.vendido ?? 0), l)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      · {porLibro[l]?.ventas ?? 0} {porLibro[l]?.ventas === 1 ? "venta" : "ventas"}
                    </span>
                  </span>
                  {desglose ? (
                    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                      {TIPOS.map((t) => (
                        <FilaDeTipo
                          key={t.clave}
                          rotulo={t.rotulo}
                          icono={t.icono}
                          valor={monto(Number(desglose[t.monto][l] ?? 0), l)}
                          cuenta={desglose.recuentos[l]?.[t.clave] ?? 0}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </Cifra>
          {/* The profit and the products without cost, side by side from `md`. */}
          <div className="flex flex-col gap-3 md:flex-row md:gap-10">
          <Cifra rotulo="Ganancia estimada">
            {conVentas.length === 0 ? (
              <span className="text-sm text-muted-foreground">Sin ventas, sin ganancia.</span>
            ) : null}
            {conVentas.map((l) => {
              const g = porLibro[l]!.ganancia;
              // No line of this book carries a cost: the profit is unknown, not zero.
              if (porLibro[l]!.conCosto === 0) {
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
                      !oculto && g < 0 ? "text-destructive" : "text-green-700 dark:text-green-500",
                    )}
                  >
                    {monto(g, l)}
                  </span>
                </span>
              );
            })}
          </Cifra>
          <Cifra rotulo="Productos vendidos sin costo" pie="No entran en la ganancia.">
            <span className="text-sm font-medium tabular-nums">{lineasSinCosto}</span>
          </Cifra>
          </div>
        </div>
      )}

      {avisoDeWhatsapp && libros.length > 0 && !completo ? (
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

      {/* The frame puts the action at the right of the card's last line. The day's «Ver todo»
          stays even with no sales: its sheet then says so. The month has no action since
          2026-11-19, and an empty row would only add space under the card. */}
      {pie ? <div className="flex justify-end">{pie}</div> : null}
    </div>
  );
}

/** The crossed eye of the frame (node 1502:10315), the one switch that hides the amounts. */
export function BotonDelOjo({ oculto, onClick }: { oculto: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={oculto}
      aria-label={oculto ? "Mostrar importes" : "Ocultar importes"}
      className="-m-2 shrink-0 rounded-md p-2 text-muted-foreground transition-colors hover:text-foreground"
    >
      {oculto ? <Eye className="size-6" /> : <EyeOff className="size-6" />}
    </button>
  );
}

// The four types, in the order of the Transacciones legend, with the icons and colours their
// Facturación cards already use (owner's request of 2026-11-17: keep those colours).
const TIPOS = [
  {
    clave: "contado",
    monto: "ventas",
    rotulo: "De contado",
    icono: <CircleDollarSign className="size-4 text-brand-sales" aria-hidden />,
  },
  { clave: "abono", monto: "abonos", rotulo: "Abonos", icono: <IconoDeAbono className="size-4 text-sky-600" aria-hidden /> },
  { clave: "fiado", monto: "fiados", rotulo: "Fiados", icono: <IconoDeFiado className="size-4 text-destructive" aria-hidden /> },
  {
    clave: "devolucion",
    monto: "devoluciones",
    rotulo: "Devoluciones",
    icono: <Undo2 className="size-4 text-warning" aria-hidden />,
  },
] as const;

function FilaDeTipo({
  rotulo,
  icono,
  valor,
  cuenta,
}: {
  rotulo: string;
  icono: React.ReactNode;
  valor: string;
  cuenta: number;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border px-2.5 py-2">
      <span className="flex items-center justify-between gap-1 text-xs text-muted-foreground">
        {rotulo}
        {icono}
      </span>
      <span className="text-sm tabular-nums">{valor}</span>
      <span className="text-xs text-muted-foreground">· {cuenta}</span>
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

