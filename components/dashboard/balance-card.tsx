"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { ChartColumn, Eye, EyeOff } from "lucide-react";
import { HideableBalance } from "@/components/dashboard/hideable-balance";
import { useHiddenBalances } from "@/hooks/use-hidden-balances";
import { cn } from "@/lib/utils";
import { formatLedgerAmount, type LedgerDisplay } from "@/lib/exchange-rate/movement-display";
import type { WeeklyLendingPoint } from "@/lib/lending-charts";
import type { LedgerCurrency } from "@/lib/types";

// The charting library is 368 KB — the second largest thing the app ships —
// and this chart starts closed, so most owners never see it. Loading it on
// demand keeps that weight off every Cartera load instead of spending it on
// a phone that may never open a chart. Same pattern the rate calculator's
// history table already uses.
//
// The placeholder mirrors the real chart's box rather than declaring a height
// of its own, so opening a chart on a phone doesn't shove the rest of the page
// down and then yank it back once the library arrives. It has to be built from
// the same parts — same outer classes, a title-sized line, a 180px plot area —
// because a plain height on this box does nothing: flex-1 in the card's column
// resolves to flex-basis 0 and wins over it. An earlier version set
// style={{height: 250}} and still collapsed to 41px, jumping 208px at 375px
// wide the moment recharts landed.
const WeeklyLendingChart = dynamic(
  () => import("@/components/dashboard/lending-bar-chart").then((m) => m.WeeklyLendingChart),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-w-64 flex-1 flex-col gap-2 rounded-lg border p-4">
        <div className="h-5 w-40 animate-pulse rounded bg-muted" />
        <div className="h-[180px] w-full animate-pulse rounded bg-muted/50" />
      </div>
    ),
  },
);

// Un libro de la cartera: su saldo y el gráfico de esa misma moneda.
export type LedgerTotal = {
  balance: number;
  currency: LedgerCurrency | null;
  chartData: WeeklyLendingPoint[];
  chartTitle?: string;
};

// "Capital por cobrar" — UNA tarjeta, aunque el negocio lleve dos monedas.
//
// ─────────────────────────────────────────────────────────────────────────
// ANTES ERAN DOS TARJETAS, Y POR QUÉ AHORA ES UNA
//
// Hasta el 2026-10-03 un negocio venezolano veía dos tarjetas iguales, USD y
// Euro, una al lado de la otra. El problema no era el sitio que ocupaban: es
// que pedían comparar. Dos cifras del mismo tamaño, con el mismo rótulo y el
// mismo color, obligan a leer las dos para saber cuál es su cartera — y en la
// práctica una de las dos es casi siempre marginal (un par de clientes en
// euros frente a sesenta en dólares).
//
// Decisión del dueño, 2026-10-03: "la mayor grande, la menor en una línea
// pequeña debajo". Así la cifra grande responde sola a "cuánto me deben", y la
// pequeña sigue estando, que es lo que importa cuando un día deja de ser
// marginal.
//
// QUÉ DECIDE CUÁL ES LA MAYOR: lo decide la pantalla, no esta tarjeta, porque
// es ella la que tiene los dos totales. Y en el empate —los dos iguales, con
// el cero-cero como caso normal de un dueño que acaba de registrarse— manda
// USD. No es una preferencia estética: en un negocio venezolano el dólar es el
// libro principal, y un dueño sin ningún fiado todavía tiene que ver la moneda
// en la que va a trabajar, no la otra.
//
// EL OJO TAPA LAS DOS CIFRAS. Media cartera oculta no es cartera oculta: quien
// tapa los montos lo hace porque hay alguien mirando la pantalla.
export function BalanceCard({
  label,
  main,
  secondary,
  ledger,
}: {
  label: string;
  main: LedgerTotal;
  // `null` para un negocio colombiano, que tiene un solo ledger.
  secondary?: LedgerTotal | null;
  ledger: LedgerDisplay | null;
}) {
  const [hidden, toggleHidden] = useHiddenBalances();
  // Closed on both server and client. The previous version defaulted to open
  // on desktop via useIsMobile, which resolves only after hydration — as a
  // conditional render rather than a CSS toggle that would mean the server
  // and the browser producing different markup on a phone.
  const [chartOpen, setChartOpen] = useState(false);

  const iconButton =
    "shrink-0 rounded outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring";

  // Los dos ledgers, para los gráficos. Mientras "Reportes" no exista (Entrega
  // 3), este botón es la ÚNICA forma de llegar a ellos, así que abre los dos y
  // no solo el de la moneda grande: dejar el gráfico de euros inalcanzable
  // sería perder una función por el camino de un cambio de maquetación.
  const ledgers = secondary ? [main, secondary] : [main];

  // La línea pequeña. Se formatea aquí y no con `ExchangeRateBalanceDisplay`
  // porque ese componente pinta DOS líneas —la cifra y su equivalente en
  // bolívares debajo—, y el encargo es una sola.
  const smaller = secondary ? formatLedgerAmount(secondary.balance, secondary.currency, ledger) : null;

  return (
    <div className="flex w-full flex-col gap-2 rounded-lg border bg-muted/30 px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{label}</p>
          <HideableBalance
            balance={main.balance}
            currency={main.currency}
            ledger={ledger}
            showToggle={false}
            mainClassName="text-3xl text-amber-600 dark:text-amber-400"
          />
          {smaller ? (
            <p className="mt-0.5 text-sm tabular-nums text-muted-foreground">
              {hidden ? (
                "••••••"
              ) : (
                <>
                  <span className="font-medium text-foreground">{smaller.primary}</span>
                  {smaller.secondary ? ` · ${smaller.secondary} hoy` : null}
                </>
              )}
            </p>
          ) : null}
          <p className="mt-1 text-xs text-muted-foreground">
            Lo que tus clientes te deben en total, sin descontar nada.
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-center gap-3 pt-1">
          <button
            type="button"
            onClick={toggleHidden}
            aria-label={hidden ? "Mostrar montos" : "Ocultar montos"}
            aria-pressed={!hidden}
            className={cn(iconButton, "text-muted-foreground")}
          >
            {hidden ? (
              <Eye className="size-4" aria-hidden="true" />
            ) : (
              <EyeOff className="size-4" aria-hidden="true" />
            )}
          </button>

          {/* lucide has no crossed-out chart icon, so the state is carried by
              colour and aria-pressed rather than by a second glyph — the same
              information, without inventing an icon that doesn't exist. */}
          <button
            type="button"
            onClick={() => setChartOpen((open) => !open)}
            aria-label={chartOpen ? "Ocultar gráficos" : "Mostrar gráficos"}
            aria-pressed={chartOpen}
            title={chartOpen ? "Ocultar gráficos" : "Mostrar gráficos"}
            className={cn(iconButton, chartOpen ? "text-foreground" : "text-muted-foreground")}
          >
            <ChartColumn className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {chartOpen
        ? ledgers.map((ledger) => (
            <WeeklyLendingChart
              key={ledger.currency ?? "cop"}
              data={ledger.chartData}
              title={ledger.chartTitle}
            />
          ))
        : null}
    </div>
  );
}
