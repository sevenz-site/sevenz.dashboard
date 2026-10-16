import { formatBs } from "@/lib/exchange-rate/format";
import { formatCantidad } from "@/lib/products/cantidad";
import { formatPriceAmount, priceIn, type BolivarRates, type PriceCurrency } from "@/lib/products/price";

// THE ORDER SUMMARY, DRAWN AS A PICTURE.
//
// Owner's decision, 2026-10-15: «Compartir» sends an image instead of text,
// "para evitar que se edite el texto del mensaje en whatsApp".
//
// ===========================================================================
// WHAT IT ACTUALLY BUYS, BECAUSE IT IS NOT WHAT IT SOUNDS LIKE
//
// An image does not prevent tampering. Anybody can screenshot it, crop it, or
// simply type whatever they like instead of sharing at all. What it buys is
// that the HONEST path produces something that cannot be altered by accident
// or by casually editing a WhatsApp draft before sending it.
//
// The real protection is elsewhere and already exists: the order is stored
// server-side the moment it is placed, and the shopkeeper opens THAT. Nothing
// the buyer forwards is evidence of anything. Said plainly to the owner on the
// day, so nobody later mistakes this picture for a guarantee.
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
//   * no image is loaded from anywhere -- the green tick is drawn with arcs
//     and lines instead of a logo file, precisely so there is nothing to wait
//     for.
//
// The cost is a picture with no brand mark. The alternative was loading a
// `<img>`, which means a promise, which means iOS silently refusing to open
// the share sheet on the device most of these customers use.
//
// ===========================================================================
// NO NEW DEPENDENCY, ON PURPOSE
//
// `html2canvas` and friends would render the real DOM and look identical for
// free. CLAUDE.md requires `new-api-risk-review` before any new dependency,
// and the review would be weighing a whole rendering library against a
// receipt made of eleven kinds of line. Canvas by hand costs more code once
// and nothing afterwards.
//
// THE PRICE OF DRAWING IT BY HAND is that this file and the screen can drift
// apart. They are kept together by both formatting through the same
// `formatPriceAmount`, `formatCantidad` and `formatBs`: the numbers cannot
// disagree, only the layout can.

type Bloque = {
  currency: PriceCurrency;
  items: { name: string; quantity: number; unitPrice: number; total: number }[];
  total: number;
};

export type DatosDelRecibo = {
  businessName: string;
  comprador: { nombre: string; documento: string; telefono: string };
  resumen: Bloque[];
  rates: BolivarRates | null;
};

const NOMBRE_MONEDA: Record<string, string> = {
  USD: "Dólares",
  EUR: "Euros",
  USDT: "USDT",
  COP: "Pesos",
  VES: "Bolívares",
};

// 3x A 360 DE ANCHO. Three, not two: these pictures get forwarded through
// WhatsApp, which re-compresses them, and a receipt that is mostly small text
// turns to mush at 2x once it has been through that twice.
const ESCALA = 3;
const ANCHO = 360 * ESCALA;
const MARGEN = 16 * ESCALA;
const RADIO = 12 * ESCALA;

// COLOURS ARE LITERAL HERE AND THAT IS NOT AN OVERSIGHT. A picture has no
// theme: it will be looked at inside somebody else's chat, on a device whose
// dark mode has nothing to do with ours. The page's tokens would resolve to
// whatever the viewer's browser felt like at the moment of drawing, which is
// how a receipt ends up as white text on a white background in a screenshot.
const TINTA = "#171717";
const TENUE = "#737373";
const LINEA = "#e5e5e5";
const VERDE = "#059669";
const FONDO = "#ffffff";
const TARJETA = "#ffffff";

const FUENTE = `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
const fuente = (px: number, peso = "400") => `${peso} ${px * ESCALA}px ${FUENTE}`;

// LAS IMÁGENES SE PRECARGAN AL IMPORTAR, NO AL DIBUJAR.
//
// El recibo tiene que dibujarse sin un solo `await` -- ver la cabecera -- y
// `drawImage` solo funciona con una imagen ya decodificada. La salida es
// empezar a decodificarlas cuando el módulo se carga, que es cuando el cliente
// abre la pantalla del carrito: para cuando pulse «Compartir» han pasado
// segundos, no milisegundos.
//
// SI ALGUNA NO ESTÁ LISTA, NO SE DIBUJA Y YA. `dibujarSiLista` lo comprueba
// con `complete` y `naturalWidth`, así que el peor caso es un recibo sin
// bandera -- nunca un recibo a medias ni una espera. Esa es la razón de que
// esto sea una optimización y no una dependencia.
//
// Son del mismo origen, así que no «manchan» el canvas y `toDataURL` sigue
// funcionando. Un fichero de otro dominio lo rompería entero.
const IMAGENES: Partial<Record<string, HTMLImageElement>> = {};

function precargar(clave: string, src: string) {
  if (typeof window === "undefined") return;
  const img = new window.Image();
  img.src = src;
  IMAGENES[clave] = img;
}

precargar("USD", "/flag-usd.svg");
precargar("EUR", "/flag-eur.svg");
precargar("USDT", "/flag-usdt.svg");
precargar("VES", "/flag-ves.svg");
// COP WAS MISSING HERE TOO, until 2026-10-16. The label map above already
// knew `COP: "Pesos"`, so the receipt named the currency correctly and drew
// no flag beside it -- only for Colombian shops, and only on the one image a
// client keeps and forwards. Same omission as `CurrencyFlagIcon`, found the
// same day by walking CT-74. Two lists of flags is one too many; they are
// left separate because this one is a canvas preload and that one is a
// component, but a currency added to either belongs in both.
precargar("COP", "/flag-cop.svg");
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
// has a quantity and an amount on its right, and a wrapped name would push
// them out of line. The full name is in the order the shopkeeper opens.
function recortar(ctx: CanvasRenderingContext2D, texto: string, ancho: number): string {
  if (ctx.measureText(texto).width <= ancho) return texto;
  let corto = texto;
  while (corto.length > 1 && ctx.measureText(`${corto}…`).width > ancho) {
    corto = corto.slice(0, -1);
  }
  return `${corto}…`;
}

function tarjeta(ctx: CanvasRenderingContext2D, y: number, alto: number) {
  ctx.fillStyle = TARJETA;
  ctx.strokeStyle = LINEA;
  ctx.lineWidth = 1 * ESCALA;
  ctx.beginPath();
  ctx.roundRect(MARGEN, y, ANCHO - MARGEN * 2, alto, RADIO);
  ctx.fill();
  ctx.stroke();
}

/**
 * Draws the receipt and hands back the PNG bytes. Synchronous from end to end.
 *
 * `medir` runs the identical layout against a throwaway context to find the
 * height before the real canvas exists. Two passes instead of guessing: a
 * canvas sized by guesswork either clips the last total or leaves a white
 * strip under it, and which one happens depends on how many products were
 * ordered.
 */
export function dibujarRecibo(datos: DatosDelRecibo): Blob | null {
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
    // A receipt that cannot be drawn must never break the screen that is
    // telling the customer their order went through. The caller falls back to
    // sharing text.
    return null;
  }
}

// ONE FUNCTION FOR MEASURING AND FOR DRAWING, with the context nullable.
// Keeping two in step by hand is how the second one quietly stops matching: a
// row added to the drawing and forgotten in the measuring clips the picture,
// and the clipping only shows up with the right number of products.
function recorrer(ctx: CanvasRenderingContext2D | null, datos: DatosDelRecibo): number {
  const medidor = ctx ?? medirCon();
  let y = 0;

  if (ctx) {
    ctx.fillStyle = FONDO;
    ctx.fillRect(0, 0, ANCHO, 99999);
    ctx.textBaseline = "alphabetic";
  }

  y += 28 * ESCALA;

  // ── El tick verde, dibujado y no cargado ──────────────────────────────
  const centro = ANCHO / 2;
  const r = 20 * ESCALA;
  if (ctx) {
    // EL CENTRO ES `y + r`, NO `y`, y la primera versión lo confundió. Con la
    // marca medida desde `y`, su último punto caía 1,3 radios por encima del
    // centro — fuera del círculo — así que el dibujo salía como un círculo
    // cruzado por una raya: el símbolo de «prohibido», encima de un texto que
    // dice que el pedido se registró. Lo cazó mirar la imagen; leer el código
    // no, porque las tres coordenadas parecen razonables hasta que se
    // comparan con el centro correcto.
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
  y += r * 2 + 18 * ESCALA;

  medidor.font = fuente(17, "600");
  if (ctx) {
    ctx.fillStyle = TINTA;
    ctx.textAlign = "center";
    ctx.fillText("Tu pedido quedó registrado", centro, y);
  }
  y += 10 * ESCALA;

  if (datos.businessName.trim() !== "") {
    y += 14 * ESCALA;
    medidor.font = fuente(12);
    if (ctx) {
      ctx.fillStyle = TENUE;
      ctx.fillText(datos.businessName, centro, y);
    }
  }
  if (ctx) ctx.textAlign = "left";
  y += 22 * ESCALA;

  // ── Datos del comprador ───────────────────────────────────────────────
  const filas: [string, string][] = [
    ["Nombre y apellido", datos.comprador.nombre],
    ["Documento", datos.comprador.documento],
    ["Teléfono", datos.comprador.telefono],
  ];
  const altoComprador = 20 * ESCALA + 22 * ESCALA + filas.length * 20 * ESCALA;
  if (ctx) tarjeta(ctx, y, altoComprador);

  let cy = y + 24 * ESCALA;
  medidor.font = fuente(14, "600");
  if (ctx) {
    ctx.fillStyle = TINTA;
    ctx.fillText("Datos del comprador", MARGEN + 14 * ESCALA, cy);
  }
  cy += 22 * ESCALA;
  for (const [etiqueta, valor] of filas) {
    medidor.font = fuente(12);
    if (ctx) {
      ctx.fillStyle = TENUE;
      ctx.textAlign = "left";
      ctx.fillText(etiqueta, MARGEN + 14 * ESCALA, cy);
      ctx.fillStyle = TINTA;
      ctx.textAlign = "right";
      ctx.font = fuente(12, "500");
      ctx.fillText(valor, ANCHO - MARGEN - 14 * ESCALA, cy);
      ctx.textAlign = "left";
    }
    cy += 20 * ESCALA;
  }
  y += altoComprador + 12 * ESCALA;

  // ── Un bloque por moneda ──────────────────────────────────────────────
  for (const bloque of datos.resumen) {
    const enBs =
      datos.rates && bloque.currency !== "VES"
        ? priceIn("VES", { amount: bloque.total, currency: bloque.currency }, datos.rates).amount
        : null;

    const altoBloque =
      24 * ESCALA + 22 * ESCALA + 18 * ESCALA + bloque.items.length * 19 * ESCALA + 14 * ESCALA +
      (enBs != null ? 32 * ESCALA : 22 * ESCALA);
    if (ctx) tarjeta(ctx, y, altoBloque);

    let by = y + 24 * ESCALA;
    const nombre = NOMBRE_MONEDA[bloque.currency] ?? bloque.currency;
    medidor.font = fuente(14, "600");
    if (ctx) {
      ctx.fillStyle = TINTA;
      ctx.fillText(`Resumen de compra en ${nombre}`, MARGEN + 14 * ESCALA, by);
    }
    // LA BANDERA A LA DERECHA, como la pantalla y como el frame. A petición
    // del dueño el 2026-10-15: la imagen le faltaba frente al diseño.
    //
    // Se dibuja desde la misma fuente que usa la pantalla (`/flag-usd.svg` y
    // compañía), no con arcos a mano: así no hay dos dibujos de la misma
    // bandera que puedan separarse el día que una se retoque.
    const ladoBandera = 16 * ESCALA;
    dibujarSiLista(
      ctx,
      bloque.currency,
      ANCHO - MARGEN - 14 * ESCALA - ladoBandera,
      by - ladoBandera + 2 * ESCALA,
      ladoBandera,
      ladoBandera,
    );
    by += 22 * ESCALA;

    const xIzq = MARGEN + 14 * ESCALA;
    const xDer = ANCHO - MARGEN - 14 * ESCALA;
    const xCant = xDer - 78 * ESCALA;

    medidor.font = fuente(11);
    if (ctx) {
      ctx.fillStyle = TENUE;
      ctx.fillText("Producto", xIzq, by);
      ctx.textAlign = "right";
      ctx.fillText("Cantidad", xCant, by);
      ctx.fillText("Por pagar", xDer, by);
      ctx.textAlign = "left";
    }
    by += 18 * ESCALA;

    for (const item of bloque.items) {
      medidor.font = fuente(12);
      const nombreCorto = recortar(medidor, item.name, xCant - xIzq - 50 * ESCALA);
      if (ctx) {
        ctx.font = fuente(12);
        ctx.fillStyle = TINTA;
        ctx.fillText(nombreCorto, xIzq, by);
        ctx.textAlign = "right";
        ctx.fillText(formatCantidad(item.quantity), xCant, by);
        ctx.fillText(formatPriceAmount(item.total, bloque.currency), xDer, by);
        ctx.textAlign = "left";
      }
      by += 19 * ESCALA;
    }

    by += 2 * ESCALA;
    if (ctx) {
      ctx.strokeStyle = LINEA;
      ctx.lineWidth = 1 * ESCALA;
      ctx.beginPath();
      ctx.moveTo(xIzq, by);
      ctx.lineTo(xDer, by);
      ctx.stroke();
    }
    by += 18 * ESCALA;

    if (ctx) {
      ctx.font = fuente(13, "600");
      ctx.fillStyle = TINTA;
      ctx.fillText(`Total en ${nombre}`, xIzq, by);
      ctx.textAlign = "right";
      ctx.font = fuente(15, "700");
      ctx.fillText(formatPriceAmount(bloque.total, bloque.currency), xDer, by);
      ctx.textAlign = "left";
    }
    if (enBs != null) {
      by += 15 * ESCALA;
      if (ctx) {
        ctx.font = fuente(11);
        ctx.fillStyle = TENUE;
        ctx.textAlign = "right";
        ctx.fillText(formatBs(enBs), xDer, by);
        ctx.textAlign = "left";
      }
    }

    y += altoBloque + 12 * ESCALA;
  }

  // ── El pie antifraude, el mismo que la pantalla ───────────────────────
  //
  // IT TRAVELS WITH THE PICTURE AND THAT IS THE POINT. This receipt is made to
  // be forwarded, so it ends up in chats where nothing else of ours is
  // visible -- which is exactly the situation the warning exists for. A
  // receipt about money with no warning teaches that Sevenz messages
  // sometimes come without one, and that is the gap somebody impersonating us
  // walks through.
  // EL LOGO ENCIMA DEL AVISO. A petición del dueño el 2026-10-15, y no es
  // adorno: esta imagen está hecha para reenviarse, así que acaba en chats
  // donde no se ve nada más nuestro. Sin la marca, un recibo sobre dinero es
  // una captura cualquiera; con ella, el aviso de abajo dice quién lo firma.
  //
  // RELACIÓN 1186:428, la del fichero. Calcularla a partir del propio SVG en
  // vez de escribir dos números sueltos es lo que evita que el logo salga
  // aplastado el día que se cambie el archivo.
  y += 18 * ESCALA;
  const altoLogo = 18 * ESCALA;
  const anchoLogo = altoLogo * (1186 / 428);
  if (dibujarSiLista(ctx, "logo", centro - anchoLogo / 2, y, anchoLogo, altoLogo)) {
    y += altoLogo + 10 * ESCALA;
  }

  const pie =
    "Sevenz no pide códigos ni pagos vía WhatsApp ni a través de llamadas. " +
    "Pagos y abonos deben hacerse directamente con el dueño del comercio.";
  medidor.font = fuente(10);
  const lineasPie = envolver(medidor, pie, ANCHO - MARGEN * 2 - 20 * ESCALA);
  for (const linea of lineasPie) {
    y += 14 * ESCALA;
    if (ctx) {
      ctx.font = fuente(10);
      ctx.fillStyle = TENUE;
      ctx.textAlign = "center";
      ctx.fillText(linea, centro, y);
      ctx.textAlign = "left";
    }
  }

  // Y LA DIRECCIÓN DEBAJO, con su salto. Es lo único del recibo que le dice a
  // quien lo recibe de segunda mano dónde comprobar que Sevenz existe.
  y += 20 * ESCALA;
  if (ctx) {
    ctx.font = fuente(10, "500");
    ctx.fillStyle = TENUE;
    ctx.textAlign = "center";
    ctx.fillText("sevenz.site", centro, y);
    ctx.textAlign = "left";
  }

  return y + 22 * ESCALA;
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
