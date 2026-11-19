"use client";

import { track } from "@/lib/mixpanel";
import { useState } from "react";
import dynamic from "next/dynamic";
import { buttonVariants } from "@/components/ui/button";
import { ExchangeRateLegalDisclaimer } from "@/components/exchange-rate-legal-disclaimer";
import { cn } from "@/lib/utils";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import type { MovementRateContext } from "@/lib/exchange-rate/convert";
import { formatBs } from "@/lib/exchange-rate/format";
import { usePrecioUsdt } from "@/components/dashboard/use-precio-usdt";
import {
  CalculatorSurface,
  RateCalculator,
  type MonedaCalculadora,
} from "@/components/exchange-rate-calculator";

// The calculator itself, and the sheet / floating window that holds it, moved
// to `components/exchange-rate-calculator.tsx` on 2026-11-19 so the client's
// balance link can mount the same one. What stays here is what only the owner
// has: this row on Inicio, the 90-day table, and the `Calculator Used` event.

// react-day-picker weighs ~19 KB gzipped and only matters once someone opens
// this panel and asks to filter by date. Loading it lazily keeps it out of the
// dashboard's initial download entirely — an owner who only ever registers
// fiados never pays for it. ssr:false because the calendar is client-only and
// there is nothing useful to render for it on the server.
const RateHistoryTable = dynamic(
  () => import("@/components/dashboard/rate-history-table").then((m) => m.RateHistoryTable),
  { ssr: false, loading: () => <div className="h-[260px] w-full animate-pulse rounded-lg bg-muted/40" /> },
);

// Always-visible compact strip on the owner's dashboard (7.3 in the design
// doc). Expands to a mini-calculator on tap — pure client-side arithmetic,
// no client selected, no movement created, nothing persisted. Reuses the
// same convertToAllCurrencies() the movement form's live preview is built
// from, not a second copy of the math.
export function ExchangeRateStrip({ rateContext }: { rateContext: MovementRateContext }) {
  // Lifted so the history table's variation column can follow the same choice
  // — the mockup's last column is "Var. USD" or "Var. EUR" depending on which
  // pill is active, not a fixed one.
  const [pair, setPair] = useState<MonedaCalculadora>("USD");
  const [open, setOpen] = useState(false);
  // Se pide al abrir, no al montar la pantalla: la calculadora es a demanda.
  const { precio: usdt, edadSegundos: edadUsdt } = usePrecioUsdt(open);

  // Si el dueño tenía USDT elegido y el precio desaparece, vuelve a dólares en
  // vez de quedarse en una pestaña sin tasa. No puede pasar con el dato vivo
  // —el hook conserva el último precio conocido— pero sí si algún día se
  // monta la calculadora ya abierta y la primera petición falla.
  if (pair === "USDT" && !usdt) setPair("USD");

  // TODA LA FILA ABRE LA CALCULADORA, no solo el botón. Decisión del dueño el
  // 2026-10-08, y el motivo no es comodidad.
  //
  // El botón flotante "Agregar" es una caja fija de 132x56 abajo a la derecha
  // de la VENTANA, así que a cada altura de scroll tapa lo que tenga debajo.
  // A scrollY 0 —la posición en la que se abre la app— tapaba "Calcular"
  // entero: 72px de solape sobre 72 de ancho, y `elementFromPoint` devolvía
  // "Agregar" hasta en su borde izquierdo. El control estaba muerto justo en
  // la primera pantalla.
  //
  // Mover el botón dentro de la tarjeta solo cambia a qué altura ocurre. Que
  // la fila entera sea el disparador resuelve la clase entera: quedan ~200px
  // de superficie a la izquierda, fuera del alcance del flotante, pase lo que
  // pase con el orden de la pantalla.
  const rateInfo = (
    <span className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-sm tabular-nums">
      <span className="flex items-center gap-1.5">
        <CurrencyFlagIcon currency="USD" />
        $1 = {formatBs(rateContext.effectiveRate.usd)}
      </span>
      <span className="flex items-center gap-1.5">
        <CurrencyFlagIcon currency="EUR" />
        €1 = {formatBs(rateContext.effectiveRate.eur)}
      </span>
    </span>
  );

  const calculator = (
    <RateCalculator
      rate={rateContext.effectiveRate}
      usdt={usdt?.ask ?? null}
      edadUsdt={edadUsdt}
      pair={pair}
      onPairChange={setPair}
      rateDate={rateContext.rateDate}
      rateStatus={rateContext.rateStatus}
      rateFetchedAt={rateContext.rateFetchedAt}
    />
  );
  // `span` con el aspecto de un botón, no un `Button`. La fila entera ya es el
  // `<button>`, y un botón dentro de otro es HTML inválido: el navegador lo
  // reescribe como hermanos y el de dentro deja de disparar al de fuera.
  // `buttonVariants` da exactamente las mismas clases, así que no se ve
  // distinto ni se separa del resto de botones el día que cambien.
  const calcularBadge = (
    <span className={cn(buttonVariants({ size: "sm", variant: "outline" }), "pointer-events-none")}>
      Calcular
    </span>
  );

  // Las clases de la fila. Una sola copia para las dos ramas —teléfono y
  // escritorio— porque son la misma tarjeta vista en dos anchos, y dos copias
  // se separan a la primera.
  const filaClase =
    "flex w-full items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-left transition-colors hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none";

  // COUNTED AT EVERY WIDTH since 2026-11-19. Until then only the phone's sheet
  // sent it: the desktop popover's `onOpenChange` was a bare `setOpen`, so an
  // owner opening it on a computer was never counted. Asked when the calculator
  // moved to a shared component, the owner chose to count it: «Sí escritorio
  // también lo cuenta». The series rises from that day because desktop joins
  // it, not because use grew -- the workbook's changelog says so.
  const onOpenChange = (abrir: boolean) => {
    // IS THE CALCULATOR USED? It decides whether it earns its place on Inicio.
    if (abrir) track("Calculator Used", { action: "opened" });
    setOpen(abrir);
  };

  return (
    <CalculatorSurface
      open={open}
      onOpenChange={onOpenChange}
      // Sin `aria-label`: el nombre accesible sale del contenido y queda
      // "$1 = Bs. ... €1 = Bs. ... Calcular" — las tasas y la acción, en
      // ese orden. Un rótulo propio las borraría del anuncio.
      trigger={(mobile) => (
        <button type="button" className={mobile ? filaClase : cn(filaClase, "sm:w-auto")}>
          {rateInfo}
          {calcularBadge}
        </button>
      )}
    >
      {calculator}
      {/* La tabla de 90 días es del BCV. Con USDT elegido se retira: no
          existe un histórico de USDT (eso es `CT-17`), y dejar debajo
          una tabla de tasas oficiales mientras arriba se calcula un
          precio de Binance es el mismo error de categoría que ponerle
          el sello "Tasa BCV". */}
      {pair !== "USDT" ? <RateHistoryTable currency={pair} /> : null}
      <ExchangeRateLegalDisclaimer incluyeUsdt={!!usdt} />
    </CalculatorSurface>
  );
}
