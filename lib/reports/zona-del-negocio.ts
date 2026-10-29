import type { OwnerCountry } from "@/lib/types";
import { zonaDelNegocio } from "@/lib/format";

// ═══════════════════════════════════════════════════════════════════════
// EL RANGO DE UN FICHERO SE RESUELVE EN LA ZONA DEL NEGOCIO
//
// ───────────────────────────────────────────────────────────────────────
// POR QUÉ NO SIRVE `lib/reports/rango.ts` PARA ESTO
//
// Aquel archivo es correcto para lo que hace y dice de sí mismo que
// interpreta las fechas **en la zona de quien lo ejecuta**. Y resulta que
// `/reportes/page.tsx` lo ejecuta en un componente de SERVIDOR: en Vercel eso
// es UTC, no la zona del navegador y no la del negocio. Un dueño colombiano
// que pide «desde el 1 de octubre» recibe `2026-10-01T00:00Z`, que en Bogotá
// son las 7 de la tarde del 30 de septiembre.
//
// En pantalla eso desplaza unas barras. En un fichero que se guarda y se
// discute, es una cifra que no se puede defender.
//
// ───────────────────────────────────────────────────────────────────────
// POR DESPLAZAMIENTO FIJO Y NO CON `Intl`, Y ESO TIENE FECHA DE CADUCIDAD
//
// Se construye el instante con la cadena `…T00:00:00.000-04:00`, que es exacta
// y auditable de un vistazo. Vale porque **ninguno de los dos países cambia la
// hora**: Venezuela no observa horario de verano y su último cambio de
// desplazamiento fue el 2016-05-01; Colombia lleva en −05:00 desde 1993. O sea
// que ninguna fila de esta base se escribió bajo otro desplazamiento.
//
// EL DÍA QUE SEVENZ OPERE EN UN TERCER PAÍS CON HORARIO DE VERANO, esto deja
// de valer y hay que pasar a resolver el desplazamiento por fecha. Está escrito
// aquí para que ese día se encuentre.
//
// Para RENDERIZAR cada fila se usa `zonaDelNegocio` + `Intl`, que es lo que ya
// usan los recibos: así la hora de una fila del fichero y la del comprobante
// que el cliente tiene en el teléfono dicen lo mismo.
//
// ───────────────────────────────────────────────────────────────────────
// EL FIN DEL RANGO ES «EL DÍA SIGUIENTE A LAS 00:00, EXCLUIDO»
//
// Y no `23:59:59.999`. Las dos formas incluyen el día final, pero la segunda
// deja fuera el último milisegundo, y ahí puede caer un movimiento. Con
// `>= desde` y `< hastaExclusivo` la línea de tiempo queda PARTIDA: ninguna
// fila cae en los dos lados ni en ninguno, ni siquiera dos movimientos que
// compartan la marca de tiempo al milisegundo.
// ═══════════════════════════════════════════════════════════════════════

const DESPLAZAMIENTO: Record<OwnerCountry, string> = {
  VE: "-04:00",
  CO: "-05:00",
};

export type VentanaDelNegocio = {
  /** Primer instante del rango, inclusive. */
  desdeUtc: string;
  /** Primer instante FUERA del rango. Nunca se incluye. */
  hastaExclusivoUtc: string;
  /** `America/Caracas` o `America/Bogota`, para formatear cada fila. */
  zona: string;
  /** `-04:00` o `-05:00`, para imprimirlo en la cabecera del fichero. */
  desplazamiento: string;
};

const SOLO_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * `2026-10-01` + `2026-10-27` + `VE` -> los dos instantes UTC que delimitan
 * esos días completos en Caracas.
 *
 * Devuelve `null` si alguna fecha no es una fecha, si están invertidas o si
 * el rango es absurdamente largo. **No adivina nada**: un fichero cuyo rango
 * se adivinó es peor que ningún fichero, y quien lo reciba no puede
 * distinguirlos.
 */
export function ventanaDelNegocio(
  desde: string | null | undefined,
  hasta: string | null | undefined,
  country: OwnerCountry,
  // El tope existe para que la ventana que se lee tenga un techo conocido; la
  // nota del archivo de exportación explica por qué eso importa.
  maxDias = 400,
): VentanaDelNegocio | null {
  const a = SOLO_FECHA.exec((desde ?? "").trim());
  const b = SOLO_FECHA.exec((hasta ?? "").trim());
  if (!a || !b) return null;

  const off = DESPLAZAMIENTO[country];
  const inicio = new Date(`${a[0]}T00:00:00.000${off}`);
  // El día siguiente al final, a las 00:00. Se calcula sumando 24h al inicio
  // del día final, que es correcto sin horario de verano -- la condición que
  // la cabecera de este archivo ya pone por escrito.
  const finDelDiaFinal = new Date(`${b[0]}T00:00:00.000${off}`);
  const fin = new Date(finDelDiaFinal.getTime() + 24 * 60 * 60 * 1000);

  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fin.getTime())) return null;
  // INVERTIDO SE RECHAZA, no se da la vuelta. `rangoDe` sí lo da la vuelta, y
  // ahí es lo correcto: una pantalla no puede quedarse en blanco por una URL
  // mal teclada. Un fichero sí puede no existir, y es mejor que exista con el
  // rango que nadie pidió.
  if (fin.getTime() <= inicio.getTime()) return null;
  if (fin.getTime() - inicio.getTime() > maxDias * 24 * 60 * 60 * 1000) return null;

  return {
    desdeUtc: inicio.toISOString(),
    hastaExclusivoUtc: fin.toISOString(),
    zona: zonaDelNegocio(country),
    desplazamiento: off,
  };
}
