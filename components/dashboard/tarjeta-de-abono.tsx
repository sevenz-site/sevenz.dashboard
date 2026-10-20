"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { CLASE_TARJETA } from "@/components/dashboard/tarjeta-de-fiado";
import { formatBs } from "@/lib/exchange-rate/format";
import { formatDate } from "@/lib/format";
import { formatPriceAmount, priceIn, type BolivarRates, type PriceCurrency } from "@/lib/products/price";

// UN ABONO, COMO TARJETA. El reflejo de `TarjetaDeFiado`.
//
// Encargo del dueño el 2026-10-20: *«Detalle de los fiados también deben
// mostrar la lista de lo que se ha abonado (mismo patrón como abono muestra
// los fiados)»*. Desde el 2026-10-19 el detalle de un abono enseña la tarjeta
// del fiado que pagó; esto es la misma relación leída al revés.
//
// COMPARTE LA FORMA Y NO EL COMPONENTE, y conviene saber por qué se decidió
// así en vez de añadirle un modo a `TarjetaDeFiado`: las dos tarjetas dicen
// cosas distintas en los mismos huecos —una lleva «Debe $X» debajo de la fecha
// y la otra no lleva nada ahí; una suma en rojo y la otra resta en azul— y un
// solo componente con un `if` por cada hueco acaba siendo más difícil de leer
// que dos de veinte líneas. Lo que NO se duplica es la cadena de clases, que
// viene de `CLASE_TARJETA`: es lo único que tiene que seguir siendo idéntico
// para que las dos se vean como la misma cosa.
export type AbonoDirigido = {
  movementId: string;
  fecha: string;
  currency: PriceCurrency | null;
  amount: number;
  descripcion: string | null;
};

export function TarjetaDeAbono({
  abono,
  rates,
  href,
}: {
  abono: AbonoDirigido;
  rates: BolivarRates | null;
  // Siempre navega. A diferencia de la del fiado, esta tarjeta no tiene el uso
  // de «elegir uno» dentro de un flujo, así que no necesita `onClick`.
  href: string;
}) {
  // EL MISMO RÓTULO QUE LA FILA DEL HISTORIAL: «Abono · lo que se escribió».
  // Sin descripción se queda en «Abono» a secas, que sigue siendo cierto --y
  // es el caso de casi todo lo que entra por la libreta.
  //
  // SIN PRODUCTOS, a diferencia de la tarjeta del fiado: un abono no se lleva
  // nada, paga.
  const titulo = abono.descripcion ? `Abono · ${abono.descripcion}` : "Abono";

  // «Bs. … hoy», a la tasa de HOY y no a la del día del abono. Es la misma
  // decisión que la tarjeta del fiado y por la misma razón: la pregunta que
  // contesta esta línea es «cuánto es esto hoy», no «cuánto fue aquel día».
  // Sin tasa no se dibuja: inventar una conversión es peor que no darla.
  const enBs =
    rates && abono.currency
      ? priceIn("VES", { amount: abono.amount, currency: abono.currency }, rates)?.amount
      : null;

  return (
    <Link href={href} className={CLASE_TARJETA}>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="truncate text-sm font-medium">{titulo}</span>
        <span className="text-xs text-muted-foreground">{formatDate(abono.fecha)}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <div className="flex flex-col items-end">
          {/* AZUL Y CON «+» — frame `1479:9456`, nodos `1479:9641` y
              `1479:9700`: `+$00.00` en `#0062fb`.

              LLEVABA «−» Y ERA MÍO. El razonamiento parecía bueno —un abono
              resta de la deuda— pero el frame dibuja «+» en las dos tarjetas,
              igual que la del fiado dentro de un abono (`1465:18552`, en
              rojo). El signo aquí no es el del saldo: es el de la cifra que se
              suma a lo abonado. Lo que distingue a las dos tarjetas es el
              color, no el signo. */}
          <span className="flex items-center gap-1 text-xs font-medium tabular-nums text-blue-600 dark:text-blue-400">
            {abono.currency ? (
              <CurrencyFlagIcon currency={abono.currency} className="size-3.5 shrink-0" />
            ) : null}
            +{formatPriceAmount(abono.amount, abono.currency ?? "COP")}
          </span>
          {enBs != null ? (
            <span className="text-[10px] text-muted-foreground tabular-nums">{formatBs(enBs)} hoy</span>
          ) : null}
        </div>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </div>
    </Link>
  );
}
