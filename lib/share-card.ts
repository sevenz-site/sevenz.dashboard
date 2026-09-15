// La tarjeta que se comparte desde la calculadora, dibujada en un canvas.
//
// POR QUÉ UNA IMAGEN Y NO TEXTO. Lo que se comparte acaba en un WhatsApp, y ahí
// el texto plano "$1.00 = Bs. 832,49" no lo respalda nadie: cualquiera lo
// escribe. Una tarjeta con la marca y la fecha se reconoce de un vistazo y dice
// de dónde salió el número.
//
// SIN ENLACE DENTRO, a petición y con razón: un mensaje que se reenvía llevando
// una URL es exactamente la forma que copia un estafador, cambiando el dominio
// por uno parecido. La tarjeta lleva "Sevenz.site" IMPRESO — se lee, no se
// pulsa, y no hay nada que suplantar.
//
// SIN LIBRERÍAS. html2canvas y compañía pesan cientos de kilobytes y traen su
// propio motor de maquetación para acabar dibujando cuatro líneas de texto y
// tres imágenes. El canvas del navegador hace esto sin añadir nada.

export type LadoDeLaTarjeta = {
  // "$ 1.00 Dólares" — ya formateado por quien llama, con el mismo formateador
  // que usa la pantalla. Aquí no se formatea nada: dos formateadores para la
  // misma cifra es como se separan la imagen y lo que el dueño está viendo.
  texto: string;
  // La ruta de la bandera dentro de /public.
  bandera: string;
};

export type DatosDeLaTarjeta = {
  izquierda: LadoDeLaTarjeta;
  derecha: LadoDeLaTarjeta;
  // "Tasa BCV del 4 sept. · consultada 3:14 p. m."
  pie: string;
};

// El negro de la tarjeta oscura de la calculadora, --primary en claro. Va en
// hexadecimal y no en oklch porque canvas no acepta oklch en todos los
// navegadores que nos importan, y un fillStyle que no se entiende se ignora en
// silencio: la tarjeta saldría con el fondo negro por defecto y nadie se
// enteraría hasta verla compartida.
const FONDO = "#171717";
const TINTA = "#fafafa";
const TINTA_TENUE = "rgba(250, 250, 250, 0.65)";
// El gris del logo en el archivo. Se cambia por blanco al vuelo porque sobre la
// tarjeta oscura no se vería; el punto naranja se queda como está.
const GRIS_DEL_LOGO = "#272727";

// Medidas en puntos, no en píxeles. Se multiplican por ESCALA al final para que
// la imagen salga nítida en una pantalla de teléfono sin tener que escribir
// cada número dos veces.
const ANCHO = 600;
const ALTO = 232;
const MARGEN = 32;
const ESCALA = 2;

// Cargar una imagen y esperar a que esté DECODIFICADA, no solo cargada.
// drawImage con una imagen a medio decodificar pinta un hueco sin quejarse.
function cargarImagen(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// El logo, repintado de blanco. Se lee el SVG como texto y se le cambia el gris
// por blanco antes de convertirlo en imagen — es la única forma de recolorear
// una parte de un SVG y dejar el punto naranja intacto; un tinte con
// globalCompositeOperation pintaría también el punto.
//
// Si algo falla —el archivo no está, el gris ya no es ese— se devuelve null y
// la tarjeta sale sin logo. Peor, pero entera: una tasa mal compartida es peor
// que una tasa compartida sin logo.
async function cargarLogoBlanco(): Promise<HTMLImageElement | null> {
  try {
    const respuesta = await fetch("/logo.svg");
    if (!respuesta.ok) return null;
    const svg = (await respuesta.text()).replaceAll(GRIS_DEL_LOGO, TINTA);
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const img = await cargarImagen(url);
    URL.revokeObjectURL(url);
    return img;
  } catch {
    return null;
  }
}

// Una bandera redonda, como en la app.
function dibujarBandera(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  diametro: number,
) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + diametro / 2, y + diametro / 2, diametro / 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(img, x, y, diametro, diametro);
  ctx.restore();
}

// Devuelve un PNG, o null si el navegador no puede dibujarlo. Null no es un
// fallo que haya que anunciar: quien llama se queda con el texto de siempre.
export async function tarjetaDeTasa(datos: DatosDeLaTarjeta): Promise<File | null> {
  if (typeof document === "undefined") return null;

  const canvas = document.createElement("canvas");
  canvas.width = ANCHO * ESCALA;
  canvas.height = ALTO * ESCALA;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(ESCALA, ESCALA);

  // Sin esperar a las fuentes, la primera tarjeta sale en Times New Roman: el
  // canvas dibuja con lo que haya cargado en ese instante, no con lo que la
  // hoja de estilos pida.
  try {
    await document.fonts.ready;
  } catch {
    // Navegador sin la API de fuentes. Se dibuja igual con la de respaldo.
  }

  const [logo, banderaIzq, banderaDer] = await Promise.all([
    cargarLogoBlanco(),
    cargarImagen(datos.izquierda.bandera),
    cargarImagen(datos.derecha.bandera),
  ]);

  // Fondo redondeado.
  ctx.fillStyle = FONDO;
  ctx.beginPath();
  ctx.roundRect(0, 0, ANCHO, ALTO, 28);
  ctx.fill();

  const familia = '"Geist", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

  // Cabecera: el logo a la izquierda, el dominio a la derecha.
  if (logo) {
    const alto = 34;
    ctx.drawImage(logo, MARGEN, MARGEN, (alto * logo.width) / logo.height, alto);
  }
  ctx.fillStyle = TINTA_TENUE;
  ctx.font = `500 16px ${familia}`;
  ctx.textAlign = "right";
  ctx.textBaseline = "top";
  ctx.fillText("Sevenz.site", ANCHO - MARGEN, MARGEN + 8);

  // La línea de la conversión. Se mide pieza a pieza para centrarla de verdad:
  // con las banderas dentro, el ancho no es el del texto.
  const DIAMETRO = 30;
  const HUECO = 10;
  ctx.font = `600 34px ${familia}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  const anchoIzq = ctx.measureText(datos.izquierda.texto).width;
  const anchoDer = ctx.measureText(datos.derecha.texto).width;
  const anchoIgual = ctx.measureText(" = ").width;
  const total =
    (banderaIzq ? DIAMETRO + HUECO : 0) +
    anchoIzq +
    anchoIgual +
    (banderaDer ? DIAMETRO + HUECO : 0) +
    anchoDer;

  // Si la cifra es larguísima no se deja salir del marco: se encoge la fuente
  // hasta que quepa. Un número recortado en una imagen que habla de dinero es
  // el peor resultado posible de este botón.
  const disponible = ANCHO - MARGEN * 2;
  if (total > disponible) {
    const tamaño = Math.max(18, Math.floor(34 * (disponible / total)));
    ctx.font = `600 ${tamaño}px ${familia}`;
  }

  const anchoFinal =
    (banderaIzq ? DIAMETRO + HUECO : 0) +
    ctx.measureText(datos.izquierda.texto).width +
    ctx.measureText(" = ").width +
    (banderaDer ? DIAMETRO + HUECO : 0) +
    ctx.measureText(datos.derecha.texto).width;

  const y = 132;
  let x = (ANCHO - anchoFinal) / 2;

  if (banderaIzq) {
    dibujarBandera(ctx, banderaIzq, x, y - DIAMETRO / 2, DIAMETRO);
    x += DIAMETRO + HUECO;
  }
  ctx.fillStyle = TINTA;
  ctx.fillText(datos.izquierda.texto, x, y);
  x += ctx.measureText(datos.izquierda.texto).width;

  ctx.fillStyle = TINTA_TENUE;
  ctx.fillText(" = ", x, y);
  x += ctx.measureText(" = ").width;

  if (banderaDer) {
    dibujarBandera(ctx, banderaDer, x, y - DIAMETRO / 2, DIAMETRO);
    x += DIAMETRO + HUECO;
  }
  ctx.fillStyle = TINTA;
  ctx.fillText(datos.derecha.texto, x, y);

  // El pie: de cuándo es la tasa y cuándo la leímos.
  ctx.fillStyle = TINTA_TENUE;
  ctx.font = `400 15px ${familia}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(datos.pie, ANCHO / 2, ALTO - MARGEN - 2);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return null;
  return new File([blob], "sevenz-tasa-bcv.png", { type: "image/png" });
}

// ¿Puede este navegador mandar una imagen por el menú de compartir?
//
// canShare({ files }) y no solo navigator.share: Firefox no lo hace nunca, y
// varios escritorios tienen share pero rechazan archivos. Preguntarlo antes es
// lo que permite caer al texto sin que al dueño le salte un error.
export function puedeCompartirArchivos(archivos: File[]): boolean {
  if (typeof navigator === "undefined" || !navigator.canShare || !navigator.share) return false;
  try {
    return navigator.canShare({ files: archivos });
  } catch {
    return false;
  }
}
