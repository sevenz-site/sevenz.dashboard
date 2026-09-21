"use client";

import { TriangleAlert } from "lucide-react";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { toBs, type MovementRateContext } from "@/lib/exchange-rate/convert";
import { formatBs, formatDisplayCurrency } from "@/lib/exchange-rate/format";
import { formatCurrency } from "@/lib/format";
import type { LedgerCurrency } from "@/lib/types";
import type { ReviewRow } from "@/lib/reconcile";

// El resumen de antes de guardar una libreta entera.
//
// Sustituye a la columna "Saldo" de la tabla, que se quitó el 2026-09-20. Ese
// número no era, como parecía, "lo que suma esto que estoy importando": era el
// saldo CORRIDO de cada cliente, arrancando de lo que ya debía en Sevenz
// (`seedBalance` en lib/reconcile.ts). Con Pedro debiendo $100 de antes y una
// página que le fía $35, la columna decía $135, no $35 — y repetido en cada
// fila, veinticinco veces, para una cifra que solo importa una vez: al final.
//
// Así que aquí se dicen las DOS cosas, que son preguntas distintas:
//
//   1. Cuánto suma esta libreta. El neto de la tanda, por moneda. Es la que se
//      corresponde con "Monto a registrar" del alta de movimiento, y por eso
//      lleva su misma anatomía: etiqueta pequeña, cifra grande, bolívares
//      debajo, moneda con bandera a la derecha.
//   2. Cómo queda cada cliente. El saldo final, que es lo que la columna decía.
//
// Y EL AVISO DE LO QUE NO CUADRA. Gemini también lee el saldo escrito a mano
// en la libreta; cuando no coincide con el que calcula Sevenz, la fila sale
// ámbar. Mientras existió la columna, el dueño podía ver por qué. Sin ella el
// color no explica nada, así que la cuenta se dice aquí con palabras, en el
// único momento en que todavía se puede volver atrás.

type Neto = { moneda: LedgerCurrency | null; total: number };

// El neto de la tanda, por moneda. Un fiado suma y un abono resta, que es el
// mismo signo con el que entrarán en la base.
function netoPorMoneda(rows: ReviewRow[]): Neto[] {
  const acc = new Map<string, Neto>();
  for (const r of rows) {
    const clave = r.currency ?? "COP";
    const previo = acc.get(clave) ?? { moneda: r.currency, total: 0 };
    previo.total += r.type === "charge" ? r.amount : -r.amount;
    acc.set(clave, previo);
  }
  return [...acc.values()].filter((n) => n.total !== 0);
}

// Cómo queda cada cliente. `computed_balance` ya viene corrido por
// (cliente, moneda), así que el de la ÚLTIMA fila de ese par es el final: no
// hay que volver a sumar nada, y volver a sumarlo aquí sería una segunda
// implementación de la misma cuenta, libre de discrepar con la de reconcile.
function saldoFinalPorCliente(rows: ReviewRow[]) {
  const acc = new Map<string, { nombre: string; moneda: LedgerCurrency | null; saldo: number }>();
  for (const r of rows) {
    acc.set(`${r.client_name.trim().toLowerCase()}|${r.currency ?? "COP"}`, {
      nombre: r.client_name.trim(),
      moneda: r.currency,
      saldo: r.computed_balance,
    });
  }
  return [...acc.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

function importe(monto: number, moneda: LedgerCurrency | null): string {
  return moneda ? formatDisplayCurrency(monto, moneda) : formatCurrency(monto);
}

export function ResumenImportacion({
  rows,
  rateContext,
}: {
  rows: ReviewRow[];
  // Null en un negocio colombiano, y también en uno venezolano antes de que
  // haya tasa: entonces no se pinta la línea de bolívares y ya. Nunca se
  // inventa una tasa para poder enseñar la conversión.
  rateContext: MovementRateContext | null;
}) {
  const netos = netoPorMoneda(rows);
  const porCliente = saldoFinalPorCliente(rows);
  const sinCuadrar = rows.filter((r) => r.needs_review).length;
  const tasa = rateContext?.effectiveRate;

  return (
    <div className="flex flex-col gap-3">
      {netos.map((n) => {
        // Rojo si la libreta deja más deuda, verde si en neto el cliente pagó.
        // Mismo par de colores que el resumen del alta de movimiento, porque
        // significan lo mismo: sale dinero / entra dinero.
        const sube = n.total > 0;
        const bs = n.moneda && tasa ? toBs(Math.abs(n.total), n.moneda, tasa) : null;
        return (
          <div
            key={n.moneda ?? "COP"}
            className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left"
          >
            <div className="flex min-w-0 flex-col">
              <span className="text-xs text-muted-foreground">
                {sube ? "Fiado a registrar" : "Abono a registrar"}
              </span>
              <span
                className={`text-2xl font-semibold tabular-nums ${
                  sube ? "text-destructive" : "text-money-in"
                }`}
              >
                {importe(Math.abs(n.total), n.moneda)}
              </span>
              {bs !== null ? (
                <span className="text-xs text-muted-foreground">≈ {formatBs(bs)}</span>
              ) : null}
            </div>
            {n.moneda ? (
              <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                {n.moneda === "USD" ? "Dólares" : "Euros"}
                <CurrencyFlagIcon currency={n.moneda} />
              </span>
            ) : null}
          </div>
        );
      })}

      {/* Cómo queda cada uno. Con scroll propio y no recortada a "y 6 más":
          una libreta de ocho clientes no puede enseñar cinco y esconder tres
          justo en la pantalla donde se comprueba que están todos. */}
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Cómo queda cada cliente</span>
        <ul className="max-h-40 divide-y overflow-y-auto rounded-lg border text-sm">
          {porCliente.map((c) => (
            <li
              key={`${c.nombre}|${c.moneda ?? "COP"}`}
              className="flex items-center justify-between gap-3 px-3 py-1.5 text-left"
            >
              <span className="truncate">{c.nombre}</span>
              <span className="shrink-0 tabular-nums">{importe(c.saldo, c.moneda)}</span>
            </li>
          ))}
        </ul>
      </div>

      {sinCuadrar > 0 ? (
        <p className="flex items-start gap-1.5 text-left text-sm text-amber-700 dark:text-amber-500">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            {sinCuadrar === 1
              ? "1 fila no cuadra con el saldo escrito en tu libreta."
              : `${sinCuadrar} filas no cuadran con el saldo escrito en tu libreta.`}{" "}
            Están marcadas en la tabla. Puedes guardar igual y corregirlas después.
          </span>
        </p>
      ) : null}
    </div>
  );
}
