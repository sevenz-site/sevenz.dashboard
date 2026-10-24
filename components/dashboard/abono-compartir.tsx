"use client";

import { Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { dibujarResumenDeAbono, type AbonoDelResumen } from "@/lib/sales/resumen-imagen";
import { formatBs } from "@/lib/exchange-rate/format";
import { formatPriceAmount, type BolivarRates } from "@/lib/products/price";

// Los mismos nombres que la imagen y la pantalla. Tres sitios diciendo
// «Dólares» es menos malo que uno diciendo «USD» en el recibo del cliente.
const NOMBRE: Record<string, string> = {
  USD: "Dólares",
  EUR: "Euros",
  USDT: "USDT",
  COP: "Pesos",
  VES: "Bolívares",
};

// «COMPARTIR» EN LA PANTALLA DE ÉXITO DEL ABONO.
//
// Pedido del dueño el 2026-10-19 y elegido por él entre las dos formas
// posibles: la imagen PNG, la misma que comparte el resumen de una venta, y no
// el camino corto de mandar texto.
//
// ===========================================================================
// SIN UN SOLO `await` ANTES DE `navigator.share`
//
// iOS bloquea la hoja cuando la llamada no viene de un gesto, y un `await`
// rompe esa cadena — este repo ya perdió así el `wa.me`. Por eso
// `dibujarResumenDeAbono` es síncrona de principio a fin y esta función no es
// `async`. Es la misma anatomía que `venta-resumen.tsx`, copiada a propósito.
//
// TRES CAMINOS, EN ESTE ORDEN, y cada uno por un sitio real:
//
//   1. Hoja nativa con el fichero -> el teléfono, que es donde pasa esto.
//   2. Descargar el PNG -> un escritorio sin `canShare({files})`, que es
//      Firefox y buena parte de Chrome en Windows.
//   3. El texto -> si el dibujo falla. Un canvas puede no estar disponible, y
//      quedarse sin compartir nada por eso sería peor que compartir texto.
export function AbonoCompartir({
  comprador,
  abono,
  rates,
  fecha,
}: {
  comprador: { nombre: string; documento: string; telefono: string };
  abono: AbonoDelResumen;
  rates: BolivarRates | null;
  // CUÁNDO PASÓ, YA FORMATEADO EN EL SERVIDOR y en la zona del negocio.
  //
  // No se formatea aquí aunque este componente tenga el ISO a mano: esto corre
  // en el teléfono del tendero, y `Intl` sin zona usaría la suya. Normalmente
  // coincide; de viaje, o con el móvil mal puesto, no. Un recibo con la fecha
  // de otro país es peor que uno sin fecha.
  fecha: string | null;
  // Para que la pantalla que lo monta pueda anclarlo al fondo. Ver allí por
  // qué hace falta y por qué el `pb` de `app-main` no bastaba.
}) {
  function compartir() {
    const blob = dibujarResumenDeAbono({ comprador, abono, rates, fecha });

    if (blob != null) {
      const fichero = new File([blob], "abono-sevenz.png", { type: "image/png" });
      if (navigator.canShare?.({ files: [fichero] })) {
        // Cerrar la hoja la rechaza. Eso es el tendero decidiendo no mandarlo,
        // no un fallo, así que no lleva aviso.
        void navigator.share({ files: [fichero] }).catch(() => {});
        return;
      }
      const url = URL.createObjectURL(blob);
      const enlace = document.createElement("a");
      enlace.href = url;
      enlace.download = "abono-sevenz.png";
      enlace.click();
      // Revocar en el mismo tick cancela la descarga en algunos navegadores.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast.success("Resumen descargado");
      return;
    }

    const texto = textoDelAbono(comprador.nombre, abono, fecha);
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
    <Button
      type="button"
      variant="outline"
      onClick={compartir}
      className="h-10 w-full gap-2 text-base font-semibold"
    >
      <Share2 className="size-5" aria-hidden="true" />
      Compartir
    </Button>
  );
}

// El respaldo en texto. Dice lo mismo que la imagen y en el mismo orden, para
// que quien lo reciba por este camino no lea una cuenta distinta.
function textoDelAbono(nombre: string, a: AbonoDelResumen, fecha: string | null): string {
  const lineas = [`Abono de ${nombre}`];
  // LA FECHA TAMBIÉN EN EL RESPALDO DE TEXTO. Es el camino por el que se
  // comparte cuando el dibujo falla, y dejarlo sin fecha haría que el recibo
  // dijera una cosa u otra según cómo se compartiera.
  if (fecha) lineas.push(fecha);
  // EL BILLETE PRIMERO, igual que la imagen. Solo cuando se repartió entre
  // varios libros; con uno, la línea «Entregó» de más abajo ya lo dice.
  if (a.billeteBs != null) lineas.push(`Abonó: ${formatBs(a.billeteBs)}`);
  // UN BLOQUE POR LIBRO Y EN EL ORDEN QUE TRAE. Antes había UNO, el del libro
  // por el que se entró, así que un reparto que cruzaba monedas se compartía
  // a medias por este camino igual que por el de la imagen.
  for (const l of a.libros) {
    const moneda = NOMBRE[l.currency] ?? l.currency;
    lineas.push(
      l.abonadoBs != null
        ? `Abonó en ${moneda}: ${formatBs(l.abonadoBs)} (${formatPriceAmount(l.abonado, l.currency)})`
        : `Abonó en ${moneda}: ${formatPriceAmount(l.abonado, l.currency)}`,
    );
    if (a.entregadoBs != null) lineas.push(`Entregó: ${formatBs(a.entregadoBs)}`);
    lineas.push(
      l.deuda > 0.005
        ? `Deuda total en ${moneda}: ${formatPriceAmount(l.deuda, l.currency)}`
        : `Sin deuda en ${moneda}`,
    );
  }
  return lineas.join("\n");
}
