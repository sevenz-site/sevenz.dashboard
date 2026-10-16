// LAS SUGERENCIAS DE PROVEEDOR, COMO FUNCIÓN PURA.
//
// Vive aquí y no dentro de `SupplierField` por una razón concreta: es la única
// parte del campo que puede equivocarse en silencio, y dentro de un componente
// de React no la prueba nadie. La pantalla pone el input y la lista; esto pone
// la única regla que importa.
//
// LA REGLA, Y POR QUÉ ES ASÍ. El dueño pidió el autocompletado el 2026-10-14
// con un propósito único: que el segundo producto del mismo proveedor NO cree
// una variante nueva del nombre. Todo lo de abajo sale de eso.

export const MAXIMO_SUGERENCIAS = 6;

/**
 * Los proveedores distintos de una lista que puede traer repetidos, espacios
 * sobrantes y la misma palabra con distinta caja.
 *
 * DEDUPLICA IGNORANDO LA CAJA PERO DEVUELVE EL ORIGINAL. Si el tendero
 * escribió «Makro» y después «MAKRO», es el mismo sitio y la lista debe
 * ofrecer uno solo — pero escrito como él lo escribe, no en una forma
 * normalizada que él nunca tecleó. Cuál de los dos gana da igual mientras sea
 * estable: gana el primero por orden alfabético, que es el orden en que salen.
 */
export function proveedoresUnicos(valores: readonly (string | null)[]): string[] {
  const vistos = new Map<string, string>();
  for (const v of valores) {
    const limpio = (v ?? "").trim();
    if (limpio === "") continue;
    const clave = limpio.toLowerCase();
    if (!vistos.has(clave)) vistos.set(clave, limpio);
  }
  return [...vistos.values()].sort((a, b) => a.localeCompare(b, "es"));
}

/**
 * Qué sugerir para lo que el tendero lleva escrito.
 *
 * TRES DECISIONES, Y LAS TRES SE PUEDEN ROMPER SIN QUE SE NOTE:
 *
 * 1. **Busca ignorando la caja.** Es el motivo entero de que esto exista: si
 *    teclear «makro» no ofreciera «Makro», el autocompletado fallaría justo en
 *    el caso para el que se pidió y crearía la variante que venía a evitar.
 *
 * 2. **Con el campo vacío ofrece todo.** Es el tendero que compra siempre en
 *    los mismos dos sitios: toca el campo y elige, sin teclear.
 *
 * 3. **No sugiere lo que ya está escrito entero.** Ofrecerle «Makro» a quien
 *    acaba de escribir «Makro» es una fila que no hace nada y que además tapa
 *    el botón de guardar en un teléfono. Se compara ignorando la caja, así que
 *    tampoco se sugiere a quien escribió «MAKRO».
 */
export function sugerenciasDeProveedor(
  valores: readonly (string | null)[],
  escrito: string,
): string[] {
  const q = escrito.trim().toLowerCase();
  const unicos = proveedoresUnicos(valores);
  const base = q === "" ? unicos : unicos.filter((s) => s.toLowerCase().includes(q));
  return base.filter((s) => s.toLowerCase() !== q).slice(0, MAXIMO_SUGERENCIAS);
}
