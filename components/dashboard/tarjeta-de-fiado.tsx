"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { formatBs } from "@/lib/exchange-rate/format";
import { formatDate } from "@/lib/format";
import { formatPriceAmount, priceIn, type BolivarRates, type PriceCurrency } from "@/lib/products/price";

// UN FIADO, COMO TARJETA. La misma en los dos sitios que la dibujan.
//
// Nació dentro de la pantalla 1/3 del abono dirigido (frame `1457:16193`) y
// salió de ahí el 2026-10-19, cuando el dueño pidió que el detalle de un abono
// enseñe «el card del fiado al que se le abonó» (frame `1465:18349`). Es
// literalmente la misma tarjeta, con el mismo contenido, y copiarla habría sido
// el principio de que las dos se separen.
//
// LO ÚNICO QUE CAMBIA ENTRE LOS DOS USOS ES A DÓNDE LLEVA, y por eso el destino
// entra como prop en vez de estar escrito dentro:
//
//   · en 1/3 es un enlace, y elegirla avanza el flujo;
//   · en el detalle de un abono es un botón, y pulsarla cambia lo que la ficha
//     enseña por el detalle de ESE fiado, sin salir de donde estabas.
export type FiadoAbierto = {
  movementId: string;
  saleId: string | null;
  fecha: string;
  currency: PriceCurrency | null;
  // Lo que el fiado fue cuando nació.
  amount: number;
  // Y lo que TODAVÍA debe. Las dos, porque no son la misma pregunta: la tarjeta
  // enseña el importe original a la derecha —como lo hace la fila del
  // historial— y «Debe $X» con lo que falta, que es por lo que se elige.
  pending: number;
  plazoDias: number | null;
  cuotas: number | null;
  productos: string[];
  descripcion: string | null;
};

export function TarjetaDeFiado({
  fiado,
  rates,
  href,
  onClick,
}: {
  fiado: FiadoAbierto;
  rates: BolivarRates | null;
  // Uno de los dos, nunca los dos. `href` navega; `onClick` cambia lo que se
  // está mirando sin moverse de sitio.
  href?: string;
  onClick?: () => void;
}) {
  // EL MISMO RÓTULO QUE LA FILA DEL HISTORIAL: «Fiado · lo que se llevó». Si la
  // venta trae productos van ellos; si no, lo que el tendero escribió; y si no
  // hay ninguno de los dos se queda en «Fiado» a secas, que sigue siendo
  // cierto. Los fiados de la libreta importada caen casi siempre en el segundo.
  const detalle = fiado.productos.length > 0 ? fiado.productos.join(", ") : (fiado.descripcion ?? "");
  const titulo = detalle ? `Fiado · ${detalle}` : "Fiado";

  // «Bs. … hoy» CONVIERTE A LA TASA DE HOY, y eso es distinto de lo que hace la
  // fila del historial a propósito: allí se enseñan los bolívares que el
  // tendero TECLEÓ, porque tecleó 900 y leer 899,09 no se explica. Aquí la
  // pregunta es otra —«¿cuánto me llevo hoy si me paga esto?»— y el frame lo
  // dice con esa palabra. Sin tasa, la línea no se dibuja: inventar una
  // conversión es peor que no darla.
  const enBs =
    rates && fiado.currency
      ? priceIn("VES", { amount: fiado.amount, currency: fiado.currency }, rates)?.amount
      : null;

  const clase =
    "flex w-full items-center justify-between gap-3 rounded-[10px] border px-4 py-2 text-left transition-colors active:bg-muted/60";

  const contenido = (
    <>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="truncate text-sm font-medium">{titulo}</span>
        <span className="text-xs text-muted-foreground">{formatDate(fiado.fecha)}</span>
        {/* LO QUE DE VERDAD DECIDE CUÁL SE ELIGE. Va aquí abajo, en el tamaño
            pequeño del frame, pero es la cifra nueva: lo que queda de ESTE
            fiado, no lo que fue. */}
        {/* LA BANDERA PEGADA A CADA CIFRA, en las dos — pedido del dueno el
            2026-10-19: «al igual que las transacciones del historial». Y el
            tamano es el mismo de alli, `size-3.5`, no el de 24 de las
            cabeceras: aqui acompana a un texto de 12 y una bandera grande lo
            dominaria.

            NO ES ADORNO EN UNA BODEGA VENEZOLANA: el mismo cliente puede tener
            un fiado en dolares y otro en euros, y sin bandera lo unico que los
            separa es un simbolo de un caracter al principio del numero. La
            captura del dueno tiene justamente dos fiados de 5,84 seguidos. */}
        <span className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
          {fiado.currency ? (
            <CurrencyFlagIcon currency={fiado.currency} className="size-3.5 shrink-0" />
          ) : null}
          Debe {formatPriceAmount(fiado.pending, fiado.currency ?? "COP")}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <div className="flex flex-col items-end">
          <span className="flex items-center gap-1 text-xs font-medium tabular-nums text-destructive">
            {fiado.currency ? (
              <CurrencyFlagIcon currency={fiado.currency} className="size-3.5 shrink-0" />
            ) : null}
            +{formatPriceAmount(fiado.amount, fiado.currency ?? "COP")}
          </span>
          {enBs != null ? (
            <span className="text-[10px] text-muted-foreground tabular-nums">{formatBs(enBs)} hoy</span>
          ) : null}
        </div>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </div>
    </>
  );

  if (href) {
    return (
      <Link href={href} className={clase}>
        {contenido}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={clase}>
      {contenido}
    </button>
  );
}
