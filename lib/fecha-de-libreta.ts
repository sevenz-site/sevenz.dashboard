import { formatDate } from "@/lib/format";

// ─────────────────────────────────────────────────────────────────────────
// LA FECHA QUE LA IA LEYÓ EN LA PÁGINA
//
// Vive aquí y no dentro del componente que la pinta por una razón concreta: es
// lógica pura que decide un dato de DINERO, y dentro de un archivo `"use
// client"` con JSX no se puede probar desde Node. Se movió el 2026-09-30 al
// escribir `qa/bordes-subir-libreta.mjs`.
//
// Desde la migración 076 el movimiento se guarda con esta fecha, si la hay. Y
// `created_at` no es decoración en `movements`: decide el saldo corrido —el
// trigger y `recalc_client_running_balance` recorren la cadena ordenada por
// él— y la mora, porque `get_oldest_unpaid_charge` sale de esa misma cadena.

function alMediodia(anio: number, mes: number, dia: number): Date | null {
  const d = new Date(anio, mes - 1, dia, 12);
  // `new Date(2026, 1, 30)` no falla: se desborda a marzo. Se comprueba que
  // salga lo que entró, o un "30/2" acabaría guardado como 2 de marzo.
  return d.getFullYear() === anio && d.getMonth() === mes - 1 && d.getDate() === dia ? d : null;
}

// El día leído, como Date local. Null si no hay nada parseable.
//
// UN "2026-08-30" SUELTO ES UTC, Y AQUÍ ESO RESTA UN DÍA.
// `new Date("2026-08-30")` es medianoche UTC; en Venezuela (UTC-4) sale el 29.
// Medido en dev el 2026-09-29: la libreta decía 30 y la pantalla decía 29. Una
// fecha escrita a mano en un cuaderno es un DÍA, sin hora y sin zona.
//
// Y se construye AL MEDIODÍA, no a medianoche. Ese Date acaba viajando al
// servidor como instante UTC: a medianoche local, cualquier zona lo devuelve al
// día anterior en cuanto alguien lo lea desde otro sitio. Al mediodía hay doce
// horas de margen por cada lado, que cubre el planeta entero.
export function diaLeido(date: string | null): Date | null {
  const bruto = date?.trim();
  if (!bruto) return null;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(bruto);
  if (iso) return alMediodia(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  // RESPALDO PARA "30/8/2026" Y "30-8-26".
  //
  // El prompt de `/api/extract` pide ISO, pero un modelo puede desobedecer y en
  // una libreta venezolana la fecha se escribe así. Sin esto, `new Date()` lo
  // interpreta a la americana —mes/día— o devuelve NaN, y la fecha se perdía en
  // silencio: el campo salía vacío y el movimiento se guardaba con la de hoy.
  //
  // DÍA PRIMERO, que es como se escribe en Venezuela y Colombia. Con "8/3" no
  // hay forma de saberlo y se elige lo que acierta en este mercado.
  const suelto = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})$/.exec(bruto);
  if (suelto) {
    const anio = Number(suelto[3]);
    return alMediodia(anio < 100 ? 2000 + anio : anio, Number(suelto[2]), Number(suelto[1]));
  }

  const d = new Date(bruto);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(12, 0, 0, 0);
  return d;
}

// Lo que se enseña. Si la IA escribió algo que no es una fecha —"lunes"— se
// enseña tal cual: mejor eso que nada, y el dueño ve que hay que corregirlo.
export function fechaDeLaLibreta(date: string | null): string | null {
  const bruto = date?.trim();
  if (!bruto) return null;
  const d = diaLeido(date);
  return d ? formatDate(d.toISOString()) : bruto;
}

// Lo que va en un `<input type="date">`, que solo entiende "YYYY-MM-DD".
export function valorDeInputFecha(date: string | null): string {
  const d = diaLeido(date);
  if (!d) return "";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// Lo que se manda al servidor. Null cuando no hay fecha que valga: entonces la
// migración 076 usa la de la subida.
export function isoDeLaFecha(date: string | null): string | null {
  return diaLeido(date)?.toISOString() ?? null;
}
