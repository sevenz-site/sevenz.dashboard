import type { PriceCurrency } from "@/lib/products/price";

// ═══════════════════════════════════════════════════════════════════════
// RECONOCER LOS IMPORTES DENTRO DE LA FRASE, PARA PONERLES SU BANDERA
//
// SINCE 2026-10-31 THE AMOUNTS ARE MARKED IN SEMIBOLD, NOT FLAGGED -- the
// owner's request; see `ConImportes` in `reportes-asistente.tsx`. The
// currency each amount resolves to is still computed and still tested: it is
// what tells an amount from any other number in the sentence.
//
// Encargo del dueño el 2026-10-30: *«en los saldos del reporte del asistente
// se debe incluir las banderas en los saldos que se mencionan»*. Es la
// costumbre de toda la app -- ninguna cifra de dinero aparece sin decir de qué
// moneda es.
//
// ───────────────────────────────────────────────────────────────────────
// POR QUÉ SE LEE EL TEXTO Y NO SE PREGUNTA AL SERVIDOR
//
// Lo correcto sería que el servidor dijera «este importe es USD», porque él sí
// lo sabe: construyó los hechos. Y no sirve, por una razón de arquitectura y
// no de gusto: la nota **se guarda como texto** y se vuelve a leer de la tabla
// durante el resto del día, cuando los hechos ya no existen. Un camino que
// solo funcionara el primer día no es un camino.
//
// Así que la moneda se deduce de cómo la escribió la propia app, que es
// determinista -- `formatPriceAmount`:
//
//   formatCurrency        → COP → «$ 60.000,00»   (con espacio)
//   formatDisplayCurrency → USD → «$11.852,69»    (pegado)
//                         → EUR → «€5.456,21»
//   formatBs              → VES → «Bs. 10.535,28»
//
// EL ESPACIO ES LO QUE SEPARA UN PESO DE UN DÓLAR, y es tan fino como suena.
// Por eso vive aquí, en una función sola con su suite, y no repartido por un
// componente: el día que `formatCurrency` cambie, lo que se rompe es un
// archivo con pruebas y no una pantalla.
//
// ───────────────────────────────────────────────────────────────────────
// Y SI NO SE RECONOCE, NO PASA NADA
//
// Un importe que no case con ninguno de los cuatro patrones se queda como
// texto normal, sin bandera. Es lo que debe pasar: perder un icono es un
// detalle, y poner la bandera equivocada sobre el dinero de alguien no lo es.
// ═══════════════════════════════════════════════════════════════════════

export type Trozo = { texto: string; moneda: PriceCurrency | null };

// EL ORDEN DE LAS ALTERNATIVAS ES LA LÓGICA. «$ 60.000,00» también casa con el
// patrón del dólar si se prueba primero el del dólar, porque la expresión
// pararía en el `$` y seguiría con el espacio. El peso va antes a propósito.
const IMPORTE = /(Bs\.\s?\d[\d.,]*\d|€\s?\d[\d.,]*\d|\$\s\d[\d.,]*\d|\$\d[\d.,]*\d)/g;

function monedaDe(importe: string): PriceCurrency | null {
  if (importe.startsWith("Bs.")) return "VES";
  if (importe.startsWith("€")) return "EUR";
  // El espacio. Ver la cabecera.
  if (importe.startsWith("$ ")) return "COP";
  if (importe.startsWith("$")) return "USD";
  return null;
}

/**
 * Parte una frase en trozos de texto y trozos de dinero.
 *
 * Devuelve siempre la frase entera: concatenar los `texto` de la salida da la
 * entrada, carácter por carácter. La suite lo comprueba, porque una función
 * que parte texto y se come un trozo lo hace en silencio.
 */
export function partirPorImportes(frase: string): Trozo[] {
  const trozos: Trozo[] = [];
  let ultimo = 0;
  for (const m of frase.matchAll(IMPORTE)) {
    const i = m.index ?? 0;
    if (i > ultimo) trozos.push({ texto: frase.slice(ultimo, i), moneda: null });
    trozos.push({ texto: m[0], moneda: monedaDe(m[0]) });
    ultimo = i + m[0].length;
  }
  if (ultimo < frase.length) trozos.push({ texto: frase.slice(ultimo), moneda: null });
  return trozos;
}
