"use client";

import Link from "next/link";
import { CheckCircle2, Share2, User } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { dibujarResumenDeVenta } from "@/lib/sales/resumen-imagen";
import { formatBs } from "@/lib/exchange-rate/format";
import { formatCantidad } from "@/lib/products/cantidad";
import { formatPriceAmount, priceIn, type BolivarRates } from "@/lib/products/price";
import type { BloqueDelResumen, CompradorDelResumen } from "@/app/(app)/ventas/actions";

// LO QUE LA VENTA DEJÓ -- frame `1389:8595`.
//
// Encargo del dueño, 2026-10-18: «Al completar el pago se debe mostrar
// resumen de la compra».
//
// ===========================================================================
// ES UNA PANTALLA CON URL, NO EL QUINTO PASO DEL ASISTENTE
//
// Dibujarlo dentro de `NuevaVenta` habría sido menos código: las cifras ya
// están en memoria al terminar de guardar. Se descartó por lo que pasa
// después de ese instante -- el tendero recarga, le dan al botón de atrás, o
// vuelve media hora más tarde a enseñárselo al cliente. Un resumen que vive
// en el estado de React se queda en blanco en los tres casos, y este es justo
// el que se enseña.
//
// Por eso también se vuelve a leer de la base en vez de recibir el resultado
// de `registrarVenta`: ver el comentario de `resumenDeVenta`.
//
// ===========================================================================
// LA BARRA DE ABAJO SÍ SALE AQUÍ, Y EN EL ASISTENTE NO
//
// El frame la dibuja, y tiene sentido: el asistente es un flujo a medias del
// que no se sale sin tirar el carrito, y esto es el final -- el tendero ya
// terminó y lo siguiente que hace es irse a otro sitio. `mobile-nav.tsx`
// distingue las dos con `/ventas/nueva`, y el botón flotante «Registrar»
// sigue escondido: empezar otra venta encima del resumen de la anterior no es
// lo que el frame ofrece.
export function VentaResumen({
  comprador,
  bloques,
  rates,
  fecha,
}: {
  comprador: CompradorDelResumen | null;
  bloques: BloqueDelResumen[];
  rates: BolivarRates | null;
  // CUÁNDO SE HIZO, YA FORMATEADA EN EL SERVIDOR y en la zona del negocio.
  // No se formatea aquí aunque fuera fácil: esto corre en el teléfono del
  // tendero y `Intl` sin zona usaría la suya.
  fecha: string;
}) {
  // SIN UN SOLO `await` ANTES DE `navigator.share`, y es deliberado: iOS
  // bloquea la hoja cuando la llamada no viene de un gesto, y un `await`
  // rompe esa cadena -- este repo ya perdió así el `wa.me`. Por eso
  // `dibujarResumenDeVenta` es síncrona de principio a fin y esta función no
  // es `async`.
  //
  // TRES CAMINOS, EN ESTE ORDEN, los mismos que el recibo del carrito y cada
  // uno por un sitio real:
  //
  //   1. Hoja nativa con el fichero -> el teléfono, que es donde pasa esto.
  //   2. Descargar el PNG -> un escritorio sin `canShare({files})`, que es
  //      Firefox y buena parte de Chrome en Windows.
  //   3. El texto -> si el dibujo falla. Un canvas puede no estar disponible,
  //      y quedarse sin compartir nada por eso sería peor que compartir texto.
  function compartir() {
    const blob = dibujarResumenDeVenta({ comprador, bloques, rates, fecha });

    if (blob != null) {
      const fichero = new File([blob], "venta-sevenz.png", { type: "image/png" });
      if (navigator.canShare?.({ files: [fichero] })) {
        // Cerrar la hoja la rechaza. Eso es el tendero decidiendo no mandarlo,
        // no un fallo, así que no lleva aviso.
        void navigator.share({ files: [fichero] }).catch(() => {});
        return;
      }
      const url = URL.createObjectURL(blob);
      const enlace = document.createElement("a");
      enlace.href = url;
      enlace.download = "venta-sevenz.png";
      enlace.click();
      // Revocar en el mismo tick cancela la descarga en algunos navegadores.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast.success("Resumen descargado");
      return;
    }

    const texto = textoDelResumen(comprador, bloques);
    if (navigator.share) {
      void navigator.share({ text: texto }).catch(() => {});
      return;
    }
    void navigator.clipboard
      .writeText(texto)
      .then(() => toast.success("Resumen copiado"))
      .catch(() => toast.error("No pudimos copiar el resumen"));
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col">
      <div className="flex flex-col items-center justify-center gap-3.5 pt-10 pb-2">
        <CheckCircle2 className="size-20 text-emerald-600" aria-hidden="true" />
        {/* 20px REGULAR, no semibold: lo dice el frame y es la diferencia
            entre un aviso y una celebración. El tendero va a leer esto
            cincuenta veces al día. */}
        <h1 className="text-center text-xl leading-7 font-normal">
          ¡Transacción registrada con éxito!
        </h1>
        {/* LA FECHA, DEBAJO DEL TÍTULO Y EN TENUE — misma posición que en el
            PNG que se comparte desde aquí, para que la imagen y la pantalla se
            lean igual. `-mt-2` porque el contenedor ya pone `gap-3.5` y la
            fecha pertenece al título, no es un bloque aparte. */}
        <p className="-mt-2 text-center text-sm text-muted-foreground">{fecha}</p>
      </div>

      {/* NI `p-4` NI `py-4`: los 16px laterales y los 40 de abajo los pone
          `AppMain`. Poner los laterales otra vez dejaba el flujo con 32, y el
          de abajo converti­a los 40 en 56. */}
      <div className="flex flex-col gap-4 pt-4">
        <div className="flex flex-col gap-4">
          {/* DATOS DEL COMPRADOR, primero de todo — frame `1414:12447`.
              Añadida el 2026-10-18, el día después de la primera versión.

              POR QUÉ ARRIBA Y NO AL FINAL: esta pantalla se le enseña al
              cliente, y lo primero que comprueba cualquiera cuando le ponen
              una cuenta delante es que sea la suya. Las cifras solo importan
              después de eso.

              NO SALE EN UNA VENTA DE MOSTRADOR, porque ahí no hay a quién
              nombrar. Una tarjeta con tres rayas sería peor que ninguna: dice
              que faltan datos de alguien, cuando lo cierto es que no hay
              alguien. */}
          {comprador ? <TarjetaDelComprador comprador={comprador} /> : null}

          {bloques.map((b) => (
            <TarjetaDeMoneda key={b.currency} bloque={b} rates={rates} />
          ))}
        </div>

        <Button
          type="button"
          variant="outline"
          onClick={compartir}
          className="w-full gap-2 text-base font-semibold"
        >
          <Share2 className="size-5" aria-hidden="true" /> Compartir
        </Button>

        {/* «VER ‹NOMBRE›», DEBAJO DE «COMPARTIR». Pedido por el dueño el
            2026-10-19.

            AQUÍ SÍ NAVEGA, y en el paso 4 del asistente el botón del mismo
            nombre abre una hoja. No es una incoherencia: allí hay una venta a
            medias en memoria y salir la tira entera. Aquí la venta YA está
            guardada, así que no hay nada que perder — y es justo lo que el
            tendero quiere hacer después de cobrar: ver cómo quedó la cuenta.

            NO SALE EN UNA VENTA DE MOSTRADOR, por la misma condición que la
            tarjeta «Datos del comprador»: `comprador` es `null` y no hay
            cuenta que abrir. Por eso el id vive DENTRO de `comprador` y no
            suelto — así las dos cosas aparecen y desaparecen juntas sin que
            haya que repetir la condición en dos sitios.

            MISMO `variant="outline"` QUE «COMPARTIR», sin inventar una
            jerarquía que el dueño no pidió: lo que lo lee como secundario es
            el orden, no un peso distinto. Sin icono, porque el de «Compartir»
            está ahí para la acción nativa y dos iconos seguidos compiten. */}
        {comprador ? (
          <Button asChild variant="outline" className="w-full text-base font-semibold">
            <Link href={`/clients/${comprador.id}`}>Ver {comprador.nombre}</Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function TarjetaDelComprador({ comprador }: { comprador: CompradorDelResumen }) {
  return (
    <section className="flex flex-col rounded-[10px] border p-4">
      <div className="flex items-center justify-between gap-2 pt-2 pb-4">
        <h2 className="text-base font-semibold">Datos del comprador</h2>
        <User className="size-6 shrink-0" aria-hidden="true" />
      </div>
      <div className="flex flex-col gap-2 pb-3">
        <Dato etiqueta="Nombre y apellido" valor={comprador.nombre} />
        <Dato etiqueta="Documento" valor={comprador.documento} />
        <Dato etiqueta="Teléfono" valor={comprador.telefono} />
      </div>
    </section>
  );
}

// Rótulo tenue a la izquierda con su ancho fijo, valor a la derecha y más
// grande: el frame le da 12px apagados al rótulo y 14px de tinta al dato,
// porque lo que se comprueba es el dato y la etiqueta solo dice qué es.
function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-[124px] shrink-0 text-xs text-muted-foreground">{etiqueta}</span>
      <span className="min-w-0 flex-1 text-right text-sm break-words">{valor}</span>
    </div>
  );
}

function TarjetaDeMoneda({ bloque, rates }: { bloque: BloqueDelResumen; rates: BolivarRates | null }) {
  const nombre = NOMBRE_MONEDA[bloque.currency] ?? bloque.currency;
  const hayDeuda = bloque.debe > 0.005;
  const totalDeuda = bloque.debe + (bloque.deudaAntigua ?? 0);
  const enBs =
    rates && hayDeuda
      ? priceIn("VES", { amount: totalDeuda, currency: bloque.currency }, rates).amount
      : null;

  return (
    <section className="flex flex-col rounded-[10px] border p-4">
      <div className="flex items-center justify-between gap-2 pt-2 pb-4">
        <h2 className="text-base font-semibold">Resumen de compra en {nombre}</h2>
        <CurrencyFlagIcon currency={bloque.currency} className="size-6 shrink-0" />
      </div>

      <table className="w-full text-xs">
        <thead>
          <tr>
            <th className="w-[124px] pb-2 text-left font-normal">Producto</th>
            <th className="pb-2 text-right font-normal">Cantidad</th>
            <th className="pb-2 text-right font-normal">Por pagar</th>
          </tr>
        </thead>
        <tbody>
          {bloque.lineas.map((l, i) => (
            <tr key={`${l.name}-${i}`}>
              {/* `break-words` Y NO `truncate`: el nombre completo es lo que
                  el cliente reconoce de lo que se llevó, y una fila de dos
                  líneas se lee bien. La imagen sí recorta, porque allí la
                  cantidad y el monto van en la misma línea obligatoriamente. */}
              <td className="w-[124px] py-1 pr-2 break-words">{l.name}</td>
              <td className="py-1 text-right tabular-nums">{formatCantidad(l.quantity)}</td>
              <td className="py-1 text-right tabular-nums">
                {formatPriceAmount(l.total, bloque.currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <Fila
        etiqueta={`Total en ${nombre}`}
        valor={formatPriceAmount(bloque.total, bloque.currency)}
      />

      {bloque.cobrado > 0 ? (
        <Fila
          // «Pago de contado» cuando la venta queda saldada y «Abonó en X»
          // cuando además queda debiendo. Son las dos tarjetas del frame: la
          // primera cierra la cuenta, la segunda es un abono a una deuda que
          // sigue viva, y llamarlas igual borraría esa diferencia justo donde
          // el cliente la mira.
          etiqueta={hayDeuda ? `Abonó en ${nombre}` : "Pago de contado"}
          valor={formatPriceAmount(bloque.cobrado, bloque.currency)}
        />
      ) : null}

      {hayDeuda ? (
        <div className="flex flex-col gap-2 border-t pt-3">
          <div className="flex items-center justify-between gap-1 text-xs">
            <span>Debe (esta venta)</span>
            <span className="tabular-nums">{formatPriceAmount(bloque.debe, bloque.currency)}</span>
          </div>

          {/* SOLO CUANDO HAY CUENTA QUE MIRAR. En una venta de mostrador no
              hay cliente, así que no hay deuda anterior ni forma de saberla —
              y una fila que dijera «Deuda antigua: $0,00» afirmaría algo que
              nadie ha comprobado. */}
          {bloque.deudaAntigua != null ? (
            <div className="flex items-center justify-between gap-1 text-xs">
              <span>Deuda antigua</span>
              <span className="tabular-nums">
                {formatPriceAmount(bloque.deudaAntigua, bloque.currency)}
              </span>
            </div>
          ) : null}

          <div className="flex items-start justify-between gap-1">
            <span className="text-base font-semibold">Deuda total</span>
            <span className="flex flex-col items-end gap-1">
              <span className="text-base font-semibold tabular-nums">
                {formatPriceAmount(totalDeuda, bloque.currency)}
              </span>
              {enBs != null ? (
                <span className="text-xs tabular-nums text-muted-foreground">{formatBs(enBs)}</span>
              ) : null}
            </span>
          </div>
        </div>
      ) : null}
    </section>
  );
}

// Cada total del frame va en su propia franja, separada por una línea que
// cruza la tarjeta entera.
function Fila({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="flex items-center justify-between gap-1 border-t py-3 text-xs">
      <span>{etiqueta}</span>
      <span className="tabular-nums">{valor}</span>
    </div>
  );
}

const NOMBRE_MONEDA: Record<string, string> = {
  USD: "Dólares",
  EUR: "Euros",
  USDT: "USDT",
  COP: "Pesos",
  VES: "Bolívares",
};

// EL RESPALDO DE TEXTO, para cuando el canvas no está disponible. No es el
// camino bueno —el dueño pidió imagen «para evitar que se edite el texto»—
// pero quedarse sin compartir nada sería peor que compartir algo editable.
function textoDelResumen(
  comprador: CompradorDelResumen | null,
  bloques: BloqueDelResumen[],
): string {
  const lineas = ["Transacción registrada"];
  if (comprador) {
    lineas.push(
      comprador.nombre,
      `Documento: ${comprador.documento}`,
      `Teléfono: ${comprador.telefono}`,
    );
  }
  for (const b of bloques) {
    const nombre = NOMBRE_MONEDA[b.currency] ?? b.currency;
    lineas.push("", `Resumen de compra en ${nombre}`);
    for (const l of b.lineas) {
      lineas.push(
        `· ${l.name} x${formatCantidad(l.quantity)} — ${formatPriceAmount(l.total, b.currency)}`,
      );
    }
    lineas.push(`Total en ${nombre}: ${formatPriceAmount(b.total, b.currency)}`);
    if (b.cobrado > 0) {
      lineas.push(
        `${b.debe > 0.005 ? `Abonó en ${nombre}` : "Pago de contado"}: ${formatPriceAmount(b.cobrado, b.currency)}`,
      );
    }
    if (b.debe > 0.005) {
      lineas.push(`Debe (esta venta): ${formatPriceAmount(b.debe, b.currency)}`);
      if (b.deudaAntigua != null) {
        lineas.push(`Deuda antigua: ${formatPriceAmount(b.deudaAntigua, b.currency)}`);
      }
      lineas.push(
        `Deuda total: ${formatPriceAmount(b.debe + (b.deudaAntigua ?? 0), b.currency)}`,
      );
    }
  }
  lineas.push(
    "",
    "Sevenz no pide códigos ni pagos vía WhatsApp ni a través de llamadas. Pagos y abonos deben hacerse directamente con el dueño del comercio.",
  );
  return lineas.join("\n");
}
