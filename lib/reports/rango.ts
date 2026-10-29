// ═══════════════════════════════════════════════════════════════════════
// EL RANGO DE FECHAS DE REPORTES
//
// Encargo del dueño el 2026-10-27: *«Cambiar filtros 7 días y 30 días por
// "Fecha". Al seleccionarlo abre date picker para filtrar por fecha»*.
//
// ───────────────────────────────────────────────────────────────────────
// QUÉ SE VA Y QUÉ LO SUSTITUYE
//
// `?periodo=7d|30d` deja de existir y en su sitio van `?desde=` y `?hasta=`,
// en `YYYY-MM-DD`. El parámetro viejo SE SIGUE LEYENDO --ver `rangoDe`--
// porque esa URL es compartible y alguien puede tenerla guardada: sin eso, un
// enlace de ayer abriría el informe con otro periodo y sin decir nada.
//
// ───────────────────────────────────────────────────────────────────────
// POR DEFECTO, LOS ÚLTIMOS 30 DÍAS
//
// Es lo que el subtítulo del frame promete --«durante los últimos 30 días»--
// y lo que el tendero ve antes de tocar nada.
//
// ───────────────────────────────────────────────────────────────────────
// LAS FECHAS SE INTERPRETAN EN LA ZONA DEL NAVEGADOR, no en UTC
//
// `new Date("2026-10-27")` es MEDIANOCHE UTC, que en Caracas son las 20:00 del
// día anterior. Un rango construido así se come medio día por cada punta y el
// tendero ve menos ventas de las que hizo, sin ningún error de por medio. Por
// eso se parte la cadena a mano y se construye con el constructor de partes,
// que sí es local.

const DIA_MS = 24 * 60 * 60 * 1000;
export const DIAS_POR_DEFECTO = 30;

export type Rango = { desde: Date; hasta: Date };

/** `2026-10-27` -> ese día a las 00:00 LOCALES. `null` si no es una fecha. */
export function deISO(valor: string | undefined | null): Date | null {
  if (!valor) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Una fecha a `YYYY-MM-DD` con sus partes LOCALES, nunca con `toISOString`. */
export function aISO(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function inicioDelDia(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function finDelDia(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

/**
 * El rango que la pantalla debe pintar, a partir de lo que trae la URL.
 *
 * SIEMPRE DEVUELVE UN RANGO VÁLIDO. Un parámetro ilegible, invertido o
 * absurdo cae en el de por defecto en vez de dejar la pantalla en blanco: esta
 * URL se comparte y se teclea, y un informe no vale una pantalla caída.
 */
/**
 * ⚠️ RESUELVE EN LA ZONA DE QUIEN EJECUTA, Y ESO ESTÁ ABIERTO
 *
 * `inicioDelDia` y `finDelDia` usan los constructores locales, así que la
 * ventana depende del huso del proceso. En un componente de servidor eso es
 * el huso del SERVIDOR, que en Vercel es UTC -- no el del negocio.
 *
 * QUIÉN SÍ LO HACE BIEN: el fichero descargable, que resuelve con
 * `zona-del-negocio.ts` a partir de `owners.country`. Su cabecera explica por
 * qué: *«En pantalla eso desplaza unas barras. En un fichero que se guarda y
 * se discute, es una cifra que no se puede defender»*.
 *
 * CONSECUENCIA PRÁCTICA: la pantalla y el CSV pueden cubrir ventanas que se
 * diferencian hasta en cinco horas por cada punta. No se ha cerrado porque
 * arreglarlo pide que la pantalla conozca el país antes de resolver el rango,
 * y hoy lo lee después.
 */
export function rangoDe(
  params: { desde?: string; hasta?: string; periodo?: string },
  ahora: Date = new Date(),
): Rango {
  const porDefecto = (dias: number): Rango => ({
    desde: inicioDelDia(new Date(ahora.getTime() - (dias - 1) * DIA_MS)),
    hasta: finDelDia(ahora),
  });

  // EL `?periodo=` VIEJO SIGUE VALIENDO, para no romper un enlace guardado.
  if (!params.desde && !params.hasta) {
    if (params.periodo === "7d") return porDefecto(7);
    return porDefecto(DIAS_POR_DEFECTO);
  }

  const a = deISO(params.desde);
  const b = deISO(params.hasta);
  if (!a && !b) return porDefecto(DIAS_POR_DEFECTO);

  // UNA SOLA PUNTA ES UN SOLO DÍA, que es lo que un calendario de rango
  // devuelve en cuanto se toca la primera fecha. Enseñar el informe de ese día
  // mientras se elige la segunda es mejor que no enseñar nada.
  const desde = inicioDelDia(a ?? b!);
  const hasta = finDelDia(b ?? a!);

  // INVERTIDO SE DA LA VUELTA en vez de devolver vacío: es lo que pasa cuando
  // alguien edita la URL a mano, y el resultado sería un informe de cero días
  // indistinguible de un negocio sin ventas.
  if (desde.getTime() > hasta.getTime()) {
    return { desde: inicioDelDia(hasta), hasta: finDelDia(desde) };
  }
  return { desde, hasta };
}

/** Cuántos días cubre el rango, contando los dos extremos. */
export function diasDelRango({ desde, hasta }: Rango): number {
  return Math.max(1, Math.round((finDelDia(hasta).getTime() - inicioDelDia(desde).getTime()) / DIA_MS));
}

const MES_CORTO = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

const corto = (d: Date) => `${d.getDate()} ${MES_CORTO[d.getMonth()]}`;

/**
 * «del 28 sep al 27 oct», para el subtítulo y para el chip.
 *
 * ───────────────────────────────────────────────────────────────────────
 * SE CALCULA UNA SOLA VEZ, EN EL SERVIDOR, Y VIAJA COMO TEXTO
 *
 * Hasta el 2026-10-29 esta función se llamaba DOS veces: en `page.tsx` --un
 * componente de servidor-- para el subtítulo, y otra vez dentro de
 * `reportes-fecha.tsx`, que es de CLIENTE, para el chip.
 *
 * Y eso no es solo trabajo repetido: `Rango` son dos `Date`, que cruzan la
 * frontera serializados como instantes UTC y se reviven en el NAVEGADOR. Las
 * dos llamadas usan `getDate()`, así que la del servidor lee la fecha en la
 * zona del servidor y la del cliente en la del navegador. Cuando no coinciden
 * --y no tienen por qué: el proceso de Node puede arrancar con otra `TZ`--
 * **el chip y el subtítulo dicen rangos distintos de la misma pantalla**.
 *
 * Es el fallo que el dueño reportó dos veces: pulsaba «Hoy» y el chip seguía
 * diciendo «del 28 oct al 29 oct». No se pudo reproducir con las dos zonas
 * iguales, que es exactamente lo que se espera de un fallo así.
 *
 * Ahora `page.tsx` lo calcula y se lo pasa al chip ya escrito. Una sola
 * respuesta, imposible de contradecir.
 *
 * ───────────────────────────────────────────────────────────────────────
 * «HOY» EN VEZ DE LA FECHA, cuando el rango es el día corriente
 *
 * Pedido por el dueño el 2026-10-29 como la salida al fallo de arriba:
 * *«si puedes cambiar el label por "Hoy"»*. Y es mejor rótulo aunque el
 * fallo no existiera: el atajo se llama «Hoy» y el chip debe confirmar lo
 * que se acaba de pulsar, no obligar a comprobar la fecha mentalmente.
 */
export function textoDelRango(r: Rango, ahora: Date = new Date()): string {
  if (aISO(r.desde) === aISO(r.hasta)) {
    return aISO(r.desde) === aISO(ahora) ? "hoy" : `el ${corto(r.desde)}`;
  }
  return `del ${corto(r.desde)} al ${corto(r.hasta)}`;
}

/**
 * Lo mismo, pero para el CHIP del filtro, que no es una frase.
 *
 * SON DOS TEXTOS PORQUE SE LEEN EN DOS SITIOS DISTINTOS. El subtítulo los
 * encaja en una oración --«Comportamiento de clientes y productos hoy»-- y el
 * chip va suelto, así que no lleva ni artículo ni minúscula inicial: «Hoy»,
 * «29 oct», «del 30 sep al 29 oct». Es lo que el dueño pidió el 2026-10-29
 * como salida: *«muestra solo la fecha de hoy "00 sept"»*.
 *
 * SALEN DE LA MISMA COMPARACIÓN, así que no pueden decir días distintos.
 */
export function etiquetaDelRango(r: Rango, ahora: Date = new Date()): string {
  if (aISO(r.desde) === aISO(r.hasta)) {
    return aISO(r.desde) === aISO(ahora) ? "Hoy" : corto(r.desde);
  }
  return `del ${corto(r.desde)} al ${corto(r.hasta)}`;
}
