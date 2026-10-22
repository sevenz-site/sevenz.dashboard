import { formatBs } from "@/lib/exchange-rate/format";
import { formatCantidad } from "@/lib/products/cantidad";
import { formatPriceAmount, priceIn, type BolivarRates, type PriceCurrency } from "@/lib/products/price";

// THE SALE SUMMARY, DRAWN AS A PICTURE -- frame `1389:8595`.
//
// Owner's request, 2026-10-18: «el botón compartir debe abrir la modal nativa
// para compartir la imagen del resumen, igual que se comparte la imagen de la
// orden de compra pero con la información de esta transacción».
//
// ===========================================================================
// A SECOND FILE AND NOT A SECOND MODE OF `dibujarRecibo`
//
// `lib/cart/recibo-imagen.ts` draws what a BUYER asked for: their contact
// details, the products, the total. This draws what a SALE left behind: what
// was collected, what is still owed, the old debt and the new total. Neither
// the rows nor the readers are the same, and the overlap is the three or four
// lines of canvas plumbing at the bottom of each file.
//
// Generalising the other one would have put six conditionals inside a
// function whose header comment explains why every step is the way it is. Two
// drawings sharing a technique can both be read; one drawing with two modes
// cannot.
//
// ===========================================================================
// EVERY STEP IS SYNCHRONOUS, AND THAT IS THE WHOLE DESIGN
//
// iOS blocks `navigator.share()` when it is not reached from a user gesture,
// and an `await` before it breaks that chain -- this codebase already lost the
// `wa.me` popup to exactly that rule. So nothing here awaits:
//
//   * `canvas.toDataURL()` is synchronous, unlike `toBlob()`;
//   * the data URL is turned into bytes with `atob`, also synchronous;
//   * the green tick is drawn with arcs and lines instead of being loaded,
//     and the flags and the logo are decoded at import time and simply
//     skipped if they are not ready yet.
//
// ===========================================================================
// NO NEW DEPENDENCY, ON PURPOSE
//
// `html2canvas` would render the real DOM and look identical for free.
// CLAUDE.md requires `new-api-risk-review` before any new dependency, and
// that review would be weighing a whole rendering library against a summary
// made of six kinds of line.
//
// THE PRICE OF DRAWING IT BY HAND is that this file and the screen can drift
// apart. They are kept together by formatting through the same
// `formatPriceAmount`, `formatCantidad`, `formatBs` and `priceIn`: the
// figures cannot disagree, only the layout can.

export type BloqueDeResumen = {
  currency: PriceCurrency;
  lineas: { name: string; quantity: number; total: number }[];
  total: number;
  cobrado: number;
  debe: number;
  deudaAntigua: number | null;
};

// LO QUE SE ABONÓ, para la imagen de la pantalla de éxito del abono dirigido.
//
// Es la MISMA imagen que la de una venta salvo por su tarjeta central: mismo
// visto verde, misma ficha del comprador, mismo logo y mismo pie antifraude. Un
// segundo dibujante para repetir cuatro quintas partes de este fichero es cómo
// acaban divergiendo el margen, el radio y la escala — y con ellos, dos recibos
// del mismo negocio que no se parecen.
export type AbonoDelResumen = {
  currency: PriceCurrency;
  // Lo que quedó anotado, en la moneda del fiado.
  abonado: number;
  // Los bolívares que el tendero TECLEÓ, si pagó así. `null` si no.
  //
  // Tecleados y no convertidos, por la misma razón que la fila del historial:
  // escribió 900 y leer 899,09 no se explica, aunque sea cierto.
  entregadoBs: number | null;
  // Lo que ese cliente sigue debiendo en esa moneda DESPUÉS del abono. Cero
  // cuando quedó saldado, y entonces la tarjeta lo dice con palabras.
  deuda: number;
};

export type DatosDelResumen = {
  // CUÁNDO PASÓ, YA FORMATEADO POR QUIEN LLAMA.
  //
  // Encargo del dueño el 2026-10-22: *«Las pantallas de transacciones
  // realizadas con éxito no tienen fecha, tampoco los png que se comparten»*.
  //
  // Llega como cadena y aquí no se formatea nada, por la misma razón que la
  // tarjeta de la calculadora: la fecha tiene que ser LA MISMA que la pantalla
  // está enseñando detrás, y dos formateadores para la misma cifra es como se
  // separan la imagen y lo que el tendero ve.
  //
  // Y SOBRE TODO porque este fichero corre en el navegador, donde `Intl` sin
  // zona usa la del teléfono. Quien llama la resuelve en la zona del NEGOCIO
  // con `formatReceiptDateTime`, que es lo único correcto en un recibo.
  //
  // `null` no dibuja la línea: una imagen sin fecha es peor que una con una
  // fecha inventada, pero mucho mejor que una con la fecha equivocada.
  fecha?: string | null;
  // `null` en una venta de mostrador: ahi no hay a quien nombrar, asi que la
  // tarjeta no se dibuja. Ver el comentario de la pantalla.
  comprador: { nombre: string; documento: string; telefono: string } | null;
  bloques: BloqueDeResumen[];
  rates: BolivarRates | null;
  // Cuando viene, se dibuja ESTO en vez de las tarjetas por moneda, y el título
  // cambia. Un abono no tiene líneas de producto ni total de compra: tiene lo
  // que pagó y lo que le queda.
  abono?: AbonoDelResumen | null;
};

const NOMBRE_MONEDA: Record<string, string> = {
  USD: "Dólares",
  EUR: "Euros",
  USDT: "USDT",
  COP: "Pesos",
  VES: "Bolívares",
};

// 3x AT 360 WIDE, same as the order receipt and for the same reason: these
// pictures travel through WhatsApp, which re-compresses them, and a summary
// that is mostly 12px text turns to mush at 2x after two rounds of that.
const ESCALA = 3;
const ANCHO = 360 * ESCALA;
const MARGEN = 16 * ESCALA;
// 10, not the receipt's 12: the frame's cards are `rounded-[10px]`.
const RADIO = 10 * ESCALA;

// COLOURS ARE LITERAL HERE AND THAT IS NOT AN OVERSIGHT. A picture has no
// theme: it will be looked at inside somebody else's chat, on a device whose
// dark mode has nothing to do with ours. The page's tokens would resolve to
// whatever the viewer's browser felt like at the moment of drawing, which is
// how a receipt ends up as white text on a white background.
const TINTA = "#1c1b1f";
const TENUE = "#9a9a9a";
const LINEA = "#e5e5e5";
const VERDE = "#059669";
const FONDO = "#ffffff";

const FUENTE = `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
const fuente = (px: number, peso = "400") => `${peso} ${px * ESCALA}px ${FUENTE}`;

// THE IMAGES ARE DECODED AT IMPORT TIME, NOT WHILE DRAWING -- the same trick
// as the order receipt, and for the same reason: `drawImage` only works with
// an already-decoded image, and there is no `await` available here. By the
// time the shopkeeper reaches this screen and taps «Compartir», seconds have
// passed, not milliseconds.
//
// IF ONE IS NOT READY IT IS SIMPLY NOT DRAWN. The worst case is a summary
// without a flag -- never a half-drawn one and never a wait. That is what
// makes this an optimisation instead of a dependency.
const IMAGENES: Partial<Record<string, HTMLImageElement>> = {};

function precargar(clave: string, src: string) {
  if (typeof window === "undefined") return;
  const img = new window.Image();
  img.src = src;
  IMAGENES[clave] = img;
}

// The five the ledger can reach, plus the logo. COP is here from the start:
// leaving it out is what made the public catalogue render a flagless,
// `src`-less image for Colombian shops on 2026-10-16.
precargar("USD", "/flag-usd.svg");
precargar("EUR", "/flag-eur.svg");
precargar("COP", "/flag-cop.svg");
precargar("VES", "/flag-ves.svg");
precargar("USDT", "/flag-usdt.svg");
precargar("logo", "/logo-primary.svg");

function dibujarSiLista(
  ctx: CanvasRenderingContext2D | null,
  clave: string,
  x: number,
  y: number,
  ancho: number,
  alto: number,
): boolean {
  const img = IMAGENES[clave];
  if (img == null || !img.complete || img.naturalWidth === 0) return false;
  if (ctx) ctx.drawImage(img, x, y, ancho, alto);
  return true;
}

function envolver(ctx: CanvasRenderingContext2D, texto: string, ancho: number): string[] {
  const palabras = texto.split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return [""];
  const lineas: string[] = [];
  let actual = palabras[0];
  for (const palabra of palabras.slice(1)) {
    const intento = `${actual} ${palabra}`;
    if (ctx.measureText(intento).width <= ancho) actual = intento;
    else {
      lineas.push(actual);
      actual = palabra;
    }
  }
  lineas.push(actual);
  return lineas;
}

// A NAME THAT DOES NOT FIT IS CUT WITH AN ELLIPSIS, not wrapped: a product row
// carries a quantity and an amount to its right, and a wrapped name would push
// them out of line. The full name is in the sale the shopkeeper opens.
function recortar(ctx: CanvasRenderingContext2D, texto: string, ancho: number): string {
  if (ctx.measureText(texto).width <= ancho) return texto;
  let corto = texto;
  while (corto.length > 1 && ctx.measureText(`${corto}…`).width > ancho) {
    corto = corto.slice(0, -1);
  }
  return `${corto}…`;
}

function tarjeta(ctx: CanvasRenderingContext2D, y: number, alto: number) {
  ctx.strokeStyle = LINEA;
  ctx.lineWidth = 1 * ESCALA;
  ctx.beginPath();
  ctx.roundRect(MARGEN, y, ANCHO - MARGEN * 2, alto, RADIO);
  ctx.stroke();
}

/**
 * Draws the summary and hands back the PNG bytes. Synchronous end to end.
 *
 * `recorrer` runs the identical layout against a throwaway context first, to
 * find the height before the real canvas exists. Two passes instead of
 * guessing: a canvas sized by guesswork either clips the last total or leaves
 * a white strip under it, and which one happens depends on how many products
 * were sold.
 */
export function dibujarResumenDeVenta(datos: DatosDelResumen): Blob | null {
  return dibujar(datos);
}

/**
 * The same picture for the directed abono's success screen -- owner's request
 * of 2026-10-19, who chose the PNG over sharing plain text.
 *
 * It is a separate entry point and not a flag the caller sets, because the two
 * screens are two different things and the name is what says which one you are
 * getting. What they share is `recorrer`, so the header, the buyer card, the
 * logo and the anti-fraud footer can never drift apart.
 */
export function dibujarResumenDeAbono(datos: {
  comprador: DatosDelResumen["comprador"];
  abono: AbonoDelResumen;
  rates: BolivarRates | null;
  fecha?: string | null;
}): Blob | null {
  // `bloques` vacío a propósito: un abono no tiene tarjetas por moneda, y
  // pasar las dos cosas dibujaría un recibo con dos resúmenes distintos.
  return dibujar({
    comprador: datos.comprador,
    bloques: [],
    rates: datos.rates,
    abono: datos.abono,
    fecha: datos.fecha,
  });
}

function dibujar(datos: DatosDelResumen): Blob | null {
  try {
    const alto = recorrer(null, datos);
    const canvas = document.createElement("canvas");
    canvas.width = ANCHO;
    canvas.height = alto;
    const ctx = canvas.getContext("2d");
    if (ctx == null) return null;
    recorrer(ctx, datos);
    return desdeDataUrl(canvas.toDataURL("image/png"));
  } catch {
    // A summary that cannot be drawn must never break the screen that is
    // telling the shopkeeper his sale went through. The caller falls back to
    // sharing text.
    return null;
  }
}

// ONE FUNCTION FOR MEASURING AND FOR DRAWING, with the context nullable.
// Keeping two in step by hand is how the second one quietly stops matching: a
// row added to the drawing and forgotten in the measuring clips the picture,
// and the clipping only shows up with the right number of products.
function recorrer(ctx: CanvasRenderingContext2D | null, datos: DatosDelResumen): number {
  const medidor = ctx ?? medirCon();
  const centro = ANCHO / 2;
  let y = 0;

  if (ctx) {
    ctx.fillStyle = FONDO;
    ctx.fillRect(0, 0, ANCHO, 99999);
    ctx.textBaseline = "alphabetic";
  }

  y += 28 * ESCALA;

  // ── El visto verde, dibujado y no cargado ─────────────────────────────
  //
  // EL CENTRO ES `y + r`, NO `y`. La primera versión del recibo del carrito
  // midió la marca desde `y` y le salió un círculo cruzado por una raya -- el
  // símbolo de «prohibido», encima de un texto que dice que todo fue bien.
  // Las tres coordenadas parecen razonables hasta que se comparan con el
  // centro correcto, así que se copia el arreglo y no el error.
  const r = 24 * ESCALA;
  if (ctx) {
    const cy = y + r;
    ctx.strokeStyle = VERDE;
    ctx.lineWidth = 3.5 * ESCALA;
    ctx.beginPath();
    ctx.arc(centro, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(centro - r * 0.4, cy + r * 0.02);
    ctx.lineTo(centro - r * 0.12, cy + r * 0.3);
    ctx.lineTo(centro + r * 0.42, cy - r * 0.32);
    ctx.stroke();
    ctx.lineCap = "butt";
  }
  y += r * 2 + 20 * ESCALA;

  if (ctx) {
    ctx.font = fuente(17);
    ctx.fillStyle = TINTA;
    ctx.textAlign = "center";
    ctx.fillText(
      datos.abono ? "¡Abono registrado con éxito!" : "¡Transacción registrada con éxito!",
      centro,
      y,
    );
  }
  y += 10 * ESCALA;

  // ── CUÁNDO PASÓ ──────────────────────────────────────────────────────
  //
  // DEBAJO DEL TÍTULO Y EN TENUE, que es donde la mira quien recibe la imagen
  // en un chat: lo primero es «salió bien» y lo segundo «¿cuándo?». Ponerla
  // abajo, con el pie, la dejaría a la altura del texto legal, que es donde
  // deja de leerse.
  //
  // LA ALTURA SE SUMA AUNQUE NO HAYA `ctx`, porque `recorrer` mide y dibuja
  // con la misma función: sumarla solo al dibujar recortaría la imagen por
  // abajo exactamente la altura de esta línea.
  if (datos.fecha) {
    y += 18 * ESCALA;
    if (ctx) {
      ctx.font = fuente(13);
      ctx.fillStyle = TENUE;
      ctx.fillText(datos.fecha, centro, y);
    }
  }

  if (ctx) ctx.textAlign = "left";
  y += 24 * ESCALA;

  // ── Datos del comprador ─────────────────────────────────────
  //
  // Frame `1414:12570`, del 2026-10-18. La primera versión de esta imagen
  // ponía el nombre del cliente suelto bajo el título; ahora va en su tarjeta,
  // con el documento y el teléfono, igual que en la pantalla.
  //
  // POR QUÉ LA IMAGEN NECESITA LOS TRES y no solo el nombre: esto acaba en un
  // chat, reenviado, abierto días después. Dos clientes se llaman igual; su
  // cédula no.
  if (datos.comprador) {
    const inicioFicha = y;
    const xIzqFicha = MARGEN + 16 * ESCALA;
    const xDerFicha = ANCHO - MARGEN - 16 * ESCALA;

    let fy = y + 30 * ESCALA;
    if (ctx) {
      ctx.font = fuente(16, "600");
      ctx.fillStyle = TINTA;
      ctx.fillText("Datos del comprador", xIzqFicha, fy);
    }
    fy += 22 * ESCALA;

    const filas: [string, string][] = [
      ["Nombre y apellido", datos.comprador.nombre],
      ["Documento", datos.comprador.documento],
      ["Teléfono", datos.comprador.telefono],
    ];
    for (const [etiqueta, valor] of filas) {
      medidor.font = fuente(14);
      // El valor se recorta y la etiqueta no: la etiqueta es fija y corta, y
      // el nombre de un cliente puede ser cualquier cosa. Lo que no puede es
      // montarse encima de su propio rótulo.
      const corto = recortar(medidor, valor, xDerFicha - xIzqFicha - 90 * ESCALA);
      if (ctx) {
        ctx.font = fuente(12);
        ctx.fillStyle = TENUE;
        ctx.fillText(etiqueta, xIzqFicha, fy);
        ctx.font = fuente(14);
        ctx.fillStyle = TINTA;
        ctx.textAlign = "right";
        ctx.fillText(corto, xDerFicha, fy);
        ctx.textAlign = "left";
      }
      fy += 20 * ESCALA;
    }

    const altoFicha = fy - inicioFicha + 8 * ESCALA;
    if (ctx) tarjeta(ctx, inicioFicha, altoFicha);
    y = inicioFicha + altoFicha + 16 * ESCALA;
  }

  // ── LA TARJETA DEL ABONO, cuando esto es el recibo de un pago ─────────
  //
  // Las mismas tres piezas que la pantalla de éxito, en el mismo orden:
  // «Abonó en X», los bolívares entregados si pagó así, y en qué queda la
  // cuenta. Y la misma regla para el cero: no se escribe «$0,00», se dice que
  // no debe nada, que es lo que el cliente va a leer en su chat.
  if (datos.abono) {
    const a = datos.abono;
    const nombre = NOMBRE_MONEDA[a.currency] ?? a.currency;
    const hayDeuda = a.deuda > 0.005;
    const deudaEnBs =
      datos.rates && hayDeuda && a.currency !== "VES"
        ? priceIn("VES", { amount: a.deuda, currency: a.currency }, datos.rates)?.amount ?? null
        : null;

    const inicio = y;
    const xIzq = MARGEN + 16 * ESCALA;
    const xDer = ANCHO - MARGEN - 16 * ESCALA;

    let by = y + 30 * ESCALA;
    if (ctx) {
      ctx.font = fuente(16, "600");
      ctx.fillStyle = TINTA;
      ctx.fillText(`Resumen de transacción en ${nombre}`, xIzq, by);
    }
    const lado = 20 * ESCALA;
    dibujarSiLista(ctx, a.currency, xDer - lado, by - lado + 3 * ESCALA, lado, lado);
    by += 24 * ESCALA;

    const fila = (etiqueta: string, valor: string, peso = "400", px = 12) => {
      if (!ctx) return;
      ctx.font = fuente(px, peso);
      ctx.fillStyle = TINTA;
      ctx.fillText(etiqueta, xIzq, by);
      ctx.textAlign = "right";
      ctx.fillText(valor, xDer, by);
      ctx.textAlign = "left";
    };

    const separar = () => {
      by += 2 * ESCALA;
      if (ctx) {
        ctx.strokeStyle = LINEA;
        ctx.lineWidth = 1 * ESCALA;
        ctx.beginPath();
        ctx.moveTo(MARGEN, by);
        ctx.lineTo(ANCHO - MARGEN, by);
        ctx.stroke();
      }
      by += 16 * ESCALA;
    };

    fila(`Abonó en ${nombre}`, formatPriceAmount(a.abonado, a.currency));
    by += 18 * ESCALA;

    if (a.entregadoBs != null) {
      fila("Entregó", formatBs(a.entregadoBs));
      by += 18 * ESCALA;
    }

    by += 4 * ESCALA;
    separar();
    fila("Deuda total", hayDeuda ? formatPriceAmount(a.deuda, a.currency) : "Sin deuda", "600", 16);

    if (deudaEnBs != null) {
      by += 16 * ESCALA;
      if (ctx) {
        ctx.font = fuente(12);
        ctx.fillStyle = TENUE;
        ctx.textAlign = "right";
        ctx.fillText(`${formatBs(deudaEnBs)} hoy`, xDer, by);
        ctx.textAlign = "left";
      }
    }

    const alto = by - inicio + 14 * ESCALA;
    if (ctx) tarjeta(ctx, inicio, alto);
    y = inicio + alto + 16 * ESCALA;
  }

  // ── Una tarjeta por moneda ────────────────────────────────────────────
  for (const b of datos.bloques) {
    const hayDeuda = b.debe > 0.005;
    const totalDeuda = b.debe + (b.deudaAntigua ?? 0);
    const enBs =
      datos.rates && hayDeuda && b.currency !== "VES"
        ? priceIn("VES", { amount: totalDeuda, currency: b.currency }, datos.rates).amount
        : null;

    // EL BORDE DE LA TARJETA SE DIBUJA AL FINAL, cuando ya se sabe dónde
    // terminó el contenido. La primera versión sumaba las filas en una
    // expresión aparte para poder pintarlo primero, y se quedó doce píxeles
    // corta: la última fila de la tarjeta de euros salió montada sobre su
    // propio borde. Era la duplicación de la que avisa el comentario de
    // `recorrer`, metida dentro de la función que existe para evitarla.
    //
    // Se puede pintar después porque la tarjeta es solo un trazo: no rellena
    // nada, así que no tapa el texto que ya está debajo.
    const inicio = y;

    const xIzq = MARGEN + 16 * ESCALA;
    const xDer = ANCHO - MARGEN - 16 * ESCALA;
    const xCant = xDer - 72 * ESCALA;
    const nombre = NOMBRE_MONEDA[b.currency] ?? b.currency;

    let by = y + 30 * ESCALA;
    if (ctx) {
      ctx.font = fuente(16, "600");
      ctx.fillStyle = TINTA;
      ctx.fillText(`Resumen de compra en ${nombre}`, xIzq, by);
    }
    // LA BANDERA A LA DERECHA, 24px en el frame. Se dibuja desde el mismo
    // fichero que usa `CurrencyFlagIcon` en la pantalla, no con arcos a mano:
    // dos dibujos de la misma bandera se separan el día que una se retoque.
    const lado = 20 * ESCALA;
    dibujarSiLista(ctx, b.currency, xDer - lado, by - lado + 3 * ESCALA, lado, lado);
    by += 18 * ESCALA;

    if (ctx) {
      ctx.font = fuente(12);
      ctx.fillStyle = TINTA;
      ctx.fillText("Producto", xIzq, by);
      ctx.textAlign = "right";
      ctx.fillText("Cantidad", xCant, by);
      ctx.fillText("Por pagar", xDer, by);
      ctx.textAlign = "left";
    }
    by += 18 * ESCALA;

    for (const l of b.lineas) {
      medidor.font = fuente(12);
      const corto = recortar(medidor, l.name, xCant - xIzq - 40 * ESCALA);
      if (ctx) {
        ctx.font = fuente(12);
        ctx.fillStyle = TINTA;
        ctx.fillText(corto, xIzq, by);
        ctx.textAlign = "right";
        ctx.fillText(formatCantidad(l.quantity), xCant, by);
        ctx.fillText(formatPriceAmount(l.total, b.currency), xDer, by);
        ctx.textAlign = "left";
      }
      by += 18 * ESCALA;
    }

    // Cada sección del frame va separada por una línea completa, no por aire.
    const separar = () => {
      by += 2 * ESCALA;
      if (ctx) {
        ctx.strokeStyle = LINEA;
        ctx.lineWidth = 1 * ESCALA;
        ctx.beginPath();
        ctx.moveTo(MARGEN, by);
        ctx.lineTo(ANCHO - MARGEN, by);
        ctx.stroke();
      }
      by += 16 * ESCALA;
    };

    const fila = (etiqueta: string, valor: string, peso = "400", px = 12) => {
      if (!ctx) return;
      ctx.font = fuente(px, peso);
      ctx.fillStyle = TINTA;
      ctx.fillText(etiqueta, xIzq, by);
      ctx.textAlign = "right";
      ctx.fillText(valor, xDer, by);
      ctx.textAlign = "left";
    };

    // Cuatro, no doce: al salir del bucle `by` ya está una línea entera por
    // debajo de la última base, así que el `pb-[12px]` del frame ya está
    // pagado y sumarlo otra vez abre un hueco del tamaño de una fila.
    by += 4 * ESCALA;
    separar();
    fila(`Total en ${nombre}`, formatPriceAmount(b.total, b.currency));
    by += 10 * ESCALA;

    if (b.cobrado > 0) {
      separar();
      // «Pago de contado» cuando la venta queda saldada y «Abonó en X» cuando
      // además queda debiendo: lo primero cierra la cuenta, lo segundo es un
      // abono a una deuda viva. Es el mismo par que el frame dibuja en sus dos
      // tarjetas, y que la pantalla usa.
      fila(
        hayDeuda ? `Abonó en ${nombre}` : "Pago de contado",
        formatPriceAmount(b.cobrado, b.currency),
      );
      by += 10 * ESCALA;
    }

    if (hayDeuda) {
      separar();
      fila("Debe (esta venta)", formatPriceAmount(b.debe, b.currency));
      by += 18 * ESCALA;

      if (b.deudaAntigua != null) {
        fila("Deuda antigua", formatPriceAmount(b.deudaAntigua, b.currency));
        by += 18 * ESCALA;
      }

      by += 4 * ESCALA;
      fila("Deuda total", formatPriceAmount(totalDeuda, b.currency), "600", 16);

      if (enBs != null) {
        by += 16 * ESCALA;
        if (ctx) {
          ctx.font = fuente(12);
          ctx.fillStyle = TENUE;
          ctx.textAlign = "right";
          ctx.fillText(formatBs(enBs), xDer, by);
          ctx.textAlign = "left";
        }
      }
    }

    // `by` es la BASE de la última línea escrita, así que la tarjeta se cierra
    // 14 por debajo: 4 para los rabos de las letras y 10 del `p-[16px]` del
    // frame, que en una base no se mide igual que en una caja.
    const alto = by - inicio + 14 * ESCALA;
    if (ctx) tarjeta(ctx, inicio, alto);
    y = inicio + alto + 16 * ESCALA;
  }

  // ── La marca y el pie antifraude ─────────────────────────────
  //
  // ESTÁN EN EL FRAME DE LA IMAGEN Y NO EN EL DE LA PANTALLA, y la diferencia
  // es el sitio donde se mira cada una: la pantalla la mira el tendero dentro
  // de Sevenz, y esto es un fichero hecho para reenviarse — acaba en un chat
  // donde no se ve nada más nuestro, que es exactamente la situación para la
  // que existe el aviso. Un mensaje sobre dinero, con cifras y sin firma, es
  // lo que manda quien nos imita.
  //
  // EL NOMBRE DEL NEGOCIO ESTUVO AQUÍ UN DÍA Y SE FUE. Lo puse copiando el
  // recibo del carrito, que sí lo lleva; el dueño preguntó de dónde salía al
  // ver «Secuence» —su `owners.business_name` en dev— debajo del logo. No
  // estaba en ningún frame. Queda escrito porque la razón por la que el
  // recibo del carrito sí lo lleva sigue siendo buena ALLÍ: ese lo manda un
  // COMPRADOR que quizá no recuerda a qué tienda pidió. Este lo manda el
  // tendero a su propio cliente, por su propio chat.
  y += 18 * ESCALA;
  // 111 x 40 en el frame; la relación del fichero es 1186:428, así que se fija
  // el alto y el ancho se calcula — escribir los dos números sueltos es cómo
  // el logo sale aplastado el día que se cambie el archivo.
  const altoLogo = 22 * ESCALA;
  const anchoLogo = altoLogo * (1186 / 428);
  if (dibujarSiLista(ctx, "logo", centro - anchoLogo / 2, y, anchoLogo, altoLogo)) {
    y += altoLogo + 12 * ESCALA;
  }

  const pie =
    "Sevenz no pide códigos ni pagos vía WhatsApp ni a través de llamadas. " +
    "Pagos y abonos deben hacerse directamente con el dueño del comercio.";
  medidor.font = fuente(12);
  for (const linea of envolver(medidor, pie, ANCHO - MARGEN * 2 - 16 * ESCALA)) {
    y += 16 * ESCALA;
    if (ctx) {
      ctx.font = fuente(12);
      ctx.fillStyle = TENUE;
      ctx.textAlign = "center";
      ctx.fillText(linea, centro, y);
      ctx.textAlign = "left";
    }
  }

  // SUBRAYADO A MANO, porque un canvas no tiene `text-decoration`. Se mide el
  // texto y se traza la línea debajo; sin eso la dirección queda igual que el
  // aviso de arriba y deja de leerse como el sitio al que se puede ir a
  // comprobar que Sevenz existe, que es su único trabajo aquí.
  y += 30 * ESCALA;
  if (ctx) {
    const dominio = "sevenz.site";
    ctx.font = fuente(12);
    ctx.fillStyle = TENUE;
    ctx.textAlign = "center";
    ctx.fillText(dominio, centro, y);
    ctx.textAlign = "left";
    const anchoDominio = ctx.measureText(dominio).width;
    ctx.strokeStyle = TENUE;
    ctx.lineWidth = 1 * ESCALA;
    ctx.beginPath();
    ctx.moveTo(centro - anchoDominio / 2, y + 2 * ESCALA);
    ctx.lineTo(centro + anchoDominio / 2, y + 2 * ESCALA);
    ctx.stroke();
  }

  return y + 24 * ESCALA;
}

function medirCon(): CanvasRenderingContext2D {
  const canvas = document.createElement("canvas");
  canvas.width = ANCHO;
  canvas.height = 10;
  const ctx = canvas.getContext("2d");
  if (ctx == null) throw new Error("sin canvas");
  return ctx;
}

// SYNCHRONOUS ON PURPOSE. `canvas.toBlob()` is the obvious API and it is a
// callback, which means a promise, which means the share sheet never opens on
// an iPhone. `toDataURL` plus `atob` does the same job without yielding.
function desdeDataUrl(dataUrl: string): Blob {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);
  return new Blob([bytes], { type: "image/png" });
}
