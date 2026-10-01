import type { ExtractedMovement } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────
// LÍNEAS SIN CLIENTE, Y LÍNEAS SIN MONTO — CT-25
//
// Una página de libreta casi nunca empieza por el principio. Los primeros
// renglones vienen de la hoja anterior, así que no llevan nombre encima: el
// nombre está en la página de antes. Y un renglón con el monto en 0 no suele
// significar "nada": significa "apuntado y todavía sin precio".
//
// Hasta el 2026-10-01 `/api/extract` tiraba las dos cosas en la misma línea
// (`m.client_name && m.amount > 0`), sin decirlo. Medido ese día con una
// libreta escrita a mano: 2 movimientos leídos de 5, $35 de deuda real fuera, y
// la pantalla diciendo "Listo · 2 movimientos" como si la página tuviera dos.
//
// Ahora salen las dos y se resuelven aquí, que es donde hay una persona
// mirando. Las reglas son pocas y todas tienen la misma forma: NINGUNA de estas
// líneas se sube sin que alguien la haya tocado, y ninguna se pierde por no
// tocarla.
//
// Vive en `lib/` y no dentro del componente para poder probarlo desde Node:
// decide sobre deuda de una persona, igual que la línea de ajuste.

// Una línea suelta es la que no sabe de quién es. El nombre vacío lo pone
// `parseExtractionResponse` cuando el modelo devuelve "" — se le pide
// explícitamente en el prompt, en vez de dejar que se invente el nombre de más
// abajo, que es lo que hacía antes de que nadie se lo dijera.
export function esLineaSuelta(m: Pick<ExtractedMovement, "client_name">): boolean {
  return (m.client_name ?? "").trim() === "";
}

// Un renglón sin monto. Se mira APARTE del nombre: puede estar sin asignar y
// sin precio a la vez, y resolver una no resuelve la otra.
export function esLineaSinMonto(m: Pick<ExtractedMovement, "amount">): boolean {
  return !Number.isFinite(m.amount) || m.amount <= 0;
}

export function separarLineasSueltas<T extends Pick<ExtractedMovement, "client_name">>(
  movimientos: T[],
): { sueltas: T[]; conCliente: T[] } {
  const sueltas: T[] = [];
  const conCliente: T[] = [];
  for (const m of movimientos) (esLineaSuelta(m) ? sueltas : conCliente).push(m);
  return { sueltas, conCliente };
}

export type NombreDisponible = {
  nombre: string;
  // De dónde sale, para poder decirlo en el menú. El dueño necesita distinguir
  // "este nombre está en las fotos que acabas de subir" de "este lo tienes
  // guardado desde hace meses": son dos motivos distintos para elegirlo.
  origen: "libreta" | "sevenz";
};

// Los nombres que se le ofrecen al dueño, en el orden en que le sirven.
//
// PRIMERO LOS DE LA LIBRETA, porque son los que tiene delante: la línea suelta
// casi siempre es de alguien que aparece dos renglones más abajo, o en otra de
// las fotos de la misma tanda. Después los que ya tiene en Sevenz, que es el
// caso de la página que continúa una libreta vieja.
//
// Se comparan en minúsculas y sin espacios de sobra —la misma clave que usa
// toda la revisión— para que "Carmen Rojas" y "carmen rojas " no salgan dos
// veces; se enseña la primera grafía vista, que es la de la foto.
export function nombresParaAsignar({
  movimientos,
  clientesDeSevenz,
}: {
  movimientos: Pick<ExtractedMovement, "client_name">[];
  clientesDeSevenz: { name: string }[];
}): NombreDisponible[] {
  const vistos = new Set<string>();
  const salida: NombreDisponible[] = [];

  for (const m of movimientos) {
    const nombre = (m.client_name ?? "").trim();
    if (!nombre) continue;
    const clave = nombre.toLowerCase();
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    salida.push({ nombre, origen: "libreta" });
  }

  for (const c of clientesDeSevenz) {
    const nombre = (c.name ?? "").trim();
    if (!nombre) continue;
    const clave = nombre.toLowerCase();
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    salida.push({ nombre, origen: "sevenz" });
  }

  return salida;
}

// Asignar es escribir el nombre en ESA fila y en ninguna otra. Por `uid` y no
// por posición, por lo mismo que `updateMovement`: el detalle de un cliente
// recibe solo sus filas y con índices la edición aterriza en otra persona.
//
// Un nombre en blanco la devuelve a "sin cliente" en vez de dejarla asignada a
// nadie: es la forma de deshacer sin tener que borrar la línea.
export function asignarLineaSuelta<T extends ExtractedMovement>(
  movimientos: T[],
  uid: string,
  nombre: string,
): T[] {
  const limpio = nombre.trim();
  return movimientos.map((m) => (m.uid === uid ? { ...m, client_name: limpio } : m));
}

// Asignar TODAS las sueltas de una vez al mismo nombre. Es el caso corriente:
// los renglones huérfanos de una página son del mismo cliente, el de la hoja
// anterior, y pedirlos uno a uno sería trabajo repetido sin ninguna decisión
// nueva dentro.
// `excluir` son los `uid` que NO se tocan: los renglones que el dueño ya había
// quitado. Sin esto, "asignar las 3" resucitaría con nombre puesto una línea que
// acababa de descartar a mano — deshacer una decisión que nadie pidió deshacer,
// que es la misma regla que sigue `recuperarCliente`.
export function asignarTodasLasSueltas<T extends ExtractedMovement>(
  movimientos: T[],
  nombre: string,
  excluir: ReadonlySet<string> = new Set(),
): T[] {
  const limpio = nombre.trim();
  if (!limpio) return movimientos;
  return movimientos.map((m) =>
    esLineaSuelta(m) && !(m.uid && excluir.has(m.uid)) ? { ...m, client_name: limpio } : m,
  );
}

export type PendientesDeResolver = {
  sinCliente: number;
  sinMonto: number;
};

// Lo que queda por resolver antes de poder subir NADA. Cuenta sobre los
// renglones vivos —los quitados ya están resueltos: el dueño los descartó— y
// por eso quien llama pasa la lista sin ellos.
//
// Se devuelven los dos números por separado en vez de un booleano porque el
// aviso los dice: "2 líneas sin cliente" y "1 línea sin monto" son dos cosas
// que se arreglan en sitios distintos de la pantalla.
export function pendientesDeResolver(
  movimientosVivos: Pick<ExtractedMovement, "client_name" | "amount">[],
): PendientesDeResolver {
  return {
    sinCliente: movimientosVivos.filter(esLineaSuelta).length,
    sinMonto: movimientosVivos.filter((m) => !esLineaSuelta(m) && esLineaSinMonto(m)).length,
  };
}

// El texto del bloqueo, o null si no hay nada que resolver.
//
// BLOQUEA LA TANDA ENTERA, no al cliente: una línea sin cliente no pertenece a
// ninguna tarjeta todavía, así que no hay dónde enseñar el aviso salvo arriba.
// Y dejar subir al resto mientras cuelgan sin asignar es exactamente cómo se
// pierden: el dueño sube, la pantalla se vacía, y nadie vuelve a por ellas.
// EL REMEDIO QUE SE NOMBRA ES EL QUE SIRVE. La primera versión listaba los tres
// siempre —"asígnalas a un cliente, escribe el monto o quítalas"— y con una sola
// línea sin monto decía "asígnalas a un cliente", que no es lo que hay que
// hacer. Visto en dev el 2026-10-01, en la misma tanda en que se escribió.
export function motivoDeLineasPendientes(p: PendientesDeResolver): string | null {
  const unaSola = p.sinCliente + p.sinMonto === 1;
  const quitarla = unaSola ? "quítala" : "quítalas";

  if (p.sinCliente > 0 && p.sinMonto > 0) {
    return (
      `Tienes ${contar(p.sinCliente, "línea sin cliente", "líneas sin cliente")} y ` +
      `${contar(p.sinMonto, "línea sin monto", "líneas sin monto")}. ` +
      `Asigna las primeras a un cliente, escribe el monto de las otras, o quítalas antes de subir.`
    );
  }
  if (p.sinCliente > 0) {
    return (
      `Tienes ${contar(p.sinCliente, "línea sin cliente", "líneas sin cliente")}. ` +
      `${unaSola ? "Dinos de quién es" : "Dinos de quién son"} o ${quitarla} antes de subir.`
    );
  }
  if (p.sinMonto > 0) {
    return (
      `Tienes ${contar(p.sinMonto, "línea sin monto", "líneas sin monto")}. ` +
      `Escribe ${unaSola ? "el monto" : "los montos"} o ${quitarla} antes de subir.`
    );
  }
  return null;
}

function contar(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}
