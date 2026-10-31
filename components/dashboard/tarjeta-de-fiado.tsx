"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { formatBs } from "@/lib/exchange-rate/format";
import { Fecha } from "@/components/fecha";
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
// LA FORMA DE LA TARJETA, EXPORTADA Y NO COPIADA.
//
// Desde el 2026-10-20 hay una segunda: `TarjetaDeAbono`, en
// `tarjeta-de-abono.tsx`, para la lista de abonos que enseña el detalle de un
// fiado. El dueño las pidió con el mismo patrón —*«mismo patrón como abono
// muestra los fiados»*— y dos cadenas de clases iguales escritas en dos
// archivos es exactamente como dejan de serlo: alguien ajusta el `rounded` de
// una y nadie se entera de que la otra existe.
export const CLASE_TARJETA =
  "flex w-full items-center justify-between gap-3 rounded-[10px] border px-4 py-2 text-left transition-colors active:bg-muted/60";

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
  // EL CÓDIGO DE SU TRANSACCIÓN. **YA NO SE DIBUJA**: ver el comentario del
  // `return`, abajo. Orden del dueño el 2026-10-24 — ninguna tarjeta lo lleva.
  //
  // SE QUEDA EL CAMPO, no por pereza: lo mandan dos pantallas, la del tendero
  // y la del cliente, y quitarlo obliga a tocar las dos para no ganar nada.
  // Volver a enseñarlo —si algún día se decide— es añadir el pie aquí, sin
  // tocar ninguna consulta.
  transactionCode?: string | null;
};

export function TarjetaDeFiado({
  fiado,
  rates,
  href,
  onClick,
  mostrarPendiente = true,
  conChevron,
  cifra,
}: {
  fiado: FiadoAbierto;
  rates: BolivarRates | null;
  // «Debe $X» SE CALLA CUANDO NO SE PUEDE CALCULAR.
  //
  // Esa cifra sale de `get_open_charges_for_client`, que reparte los abonos
  // distinguiendo los dirigidos de los que la cola FIFO aplicó. La pantalla del
  // cliente no puede llamarla —hace falta el id del cliente y la clave anon no
  // lo tiene—, así que allí llega `pending: 0`. Dibujarlo sería decirle a
  // alguien que un fiado vivo está saldado, que es peor que no decir nada.
  mostrarPendiente?: boolean;
  // Uno de los dos, nunca los dos. `href` navega; `onClick` cambia lo que se
  // está mirando sin moverse de sitio.
  href?: string;
  onClick?: () => void;
  // ── ¿HAY «›»? ──────────────────────────────────────────────────────
  //
  // Se dibujaba SIEMPRE, incluso donde la tarjeta no abría nada: en la lista
  // de «Así se reparte el pago» y en la hoja de «Repartir abono» no llevaba
  // ni `href` ni `onClick`, así que la flecha prometía una pantalla que no
  // existía. El dueño lo reportó el 2026-10-23 señalando la de la hoja.
  //
  // OBLIGATORIA Y SIN VALOR POR DEFECTO, igual que `conAcciones` en
  // `tarjeta-de-abono.tsx` y por lo que allí costó: un `= true` devolvería la
  // flecha en silencio el día que alguien monte esta tarjeta en un sitio
  // nuevo y no se acuerde de pasarla. Así no compila.
  //
  // NO SE DEDUCE DE `href`, y se probó: en la hoja la tarjeta SÍ navega —al
  // detalle de la transacción— y aun así va sin flecha, porque la fila ya
  // lleva un botón «Pagar» al lado. Dos señales de «aquí se toca» en la misma
  // fila, apuntando a sitios distintos, es justo lo que confunde.
  conChevron: boolean;
  // ── QUÉ CIFRA VA EN ROJO: LO QUE FUE, O LO QUE QUEDA ───────────────
  //
  // `original` es `amount`, el fiado tal como nació. `pendiente` es lo que
  // TODAVÍA debe. No son la misma pregunta y esta tarjeta se usa en sitios
  // que hacen una u otra.
  //
  // POR QUÉ HIZO FALTA, el 2026-10-23: en la hoja del abono la tarjeta
  // enseñaba las dos a la vez —«Debe €15.95» abajo a la izquierda y «−€25.00»
  // en grande a la derecha— y al pulsar «Pagar» el flujo ofrecía 15,95. El
  // dueño lo reportó así: *«Estoy seleccionando un abono de 25 euros pero al
  // seleccionarlo me dice que es de 15.95»*. Dos cifras del mismo fiado en la
  // misma tarjeta, y la grande no era la que mandaba.
  //
  // OBLIGATORIA Y SIN VALOR POR DEFECTO, por lo mismo que `conChevron`: un
  // `= "original"` elegiría en silencio por quien monte esta tarjeta en un
  // sitio nuevo, y la cifra equivocada aquí no se ve rara — se ve como otro
  // número perfectamente creíble.
  cifra: "original" | "pendiente";
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
  // LA CIFRA EN ROJO, UNA SOLA VEZ: la convierte a bolívares y la pinta el
  // mismo valor. Separarlas es cómo se acaba enseñando una cifra en su moneda
  // y la equivalencia de otra debajo.
  const enRojo = cifra === "pendiente" ? fiado.pending : fiado.amount;

  const enBs =
    rates && fiado.currency
      ? priceIn("VES", { amount: enRojo, currency: fiado.currency }, rates)?.amount
      : null;

  const clase = CLASE_TARJETA;

  const contenido = (
    <>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="truncate text-sm font-medium">{titulo}</span>
        <span className="text-xs text-muted-foreground"><Fecha iso={fiado.fecha} /></span>
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
        {mostrarPendiente ? (
          <span className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
            {fiado.currency ? (
              <CurrencyFlagIcon currency={fiado.currency} className="size-3.5 shrink-0" />
            ) : null}
            Debe {formatPriceAmount(fiado.pending, fiado.currency ?? "COP")}
          </span>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <div className="flex flex-col items-end">
          <span className="flex items-center gap-1 text-xs font-medium tabular-nums text-destructive">
            {fiado.currency ? (
              <CurrencyFlagIcon currency={fiado.currency} className="size-3.5 shrink-0" />
            ) : null}
            {/* ── «−» PORQUE ES UN FIADO ───────────────────────────────────
                Regla del dueño del 2026-10-22, repetida el 2026-10-23 al ver
                esta misma tarjeta: *«en el historial los fiados se ven con
                signo negativo pero en registrar abono se ven con saldo
                positivo, revisa que en todo el app sea consistente: abonos y
                de contados con "+", fiados con "-"»*.

                EL SIGNO ES EL DEL DINERO DEL TENDERO, no el de la deuda del
                cliente: un fiado es mercancía que sale sin cobrar, un abono es
                dinero que entra. Por eso el fiado va en rojo Y con menos, y
                esta tarjeta llevaba el color bien y el signo al revés.

                DESPLAZA UNA DECISIÓN TOMADA DESDE UN FRAME. `tarjeta-de-abono`
                documenta que el frame `1465:18552` dibuja «+» en rojo también
                en la tarjeta del fiado, y por eso esta la llevaba. La regla de
                consistencia gana: un mismo fiado no puede salir con «+» en una
                pantalla y con «−» en otra, que es exactamente lo que el dueño
                vio. */}
            -{formatPriceAmount(enRojo, fiado.currency ?? "COP")}
          </span>
          {enBs != null ? (
            <span className="text-[10px] text-muted-foreground tabular-nums">{formatBs(enBs)} hoy</span>
          ) : null}
        </div>
        {conChevron ? (
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : null}
      </div>
    </>
  );

  // ═══════════════════════════════════════════════════════════════════════
  // NINGUNA TARJETA LLEVA EL CÓDIGO. ES UN PATRÓN, NO UNA PANTALLA
  //
  // Orden del dueño el 2026-10-24: *«TODOS LOS CARD COMO PATRÓN DE DISEÑO
  // ELIMINA EL CÓDIGO DE LA TRANSACCIÓN DE LOS CARDS»*. Lo dijo enfadado y con
  // razón: unas horas antes se había quitado de `TarjetaDeAbono` y aquí se
  // había dejado, así que el mismo dato salía en unas tarjetas y en otras no
  // — que es peor que salir en todas.
  //
  // DÓNDE VIVE AHORA, para que nadie lo dé por perdido: en la CABECERA de la
  // ficha de cada transacción (`CodigoDeTransaccion`), en las dos pantallas de
  // «¡Transacción registrada con éxito!» y en el PNG que se comparte. Una
  // tarjeta es un índice que lleva a esa ficha; el código es de la ficha.
  //
  // Y EL BUSCADOR NO SE ENTERA: busca sobre el dato, no sobre lo que la
  // tarjeta dibuja, así que teclear un código sigue encontrando sus filas.
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
