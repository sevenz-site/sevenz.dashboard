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
 * Cómo se compara un nombre de proveedor con lo que se teclea.
 *
 * SIN CAJA Y SIN TILDES. Lo segundo lo pidió el dueño el 2026-10-20 con el
 * caso exacto: *«hay un proveedor de nombre "Éxito", pero al escribir "Ex" no
 * me aparece»*. Y es el fallo peor posible para este campo, porque el
 * autocompletado existe justo para que el segundo producto del mismo
 * proveedor no cree una variante nueva del nombre: quien escribe «Exito» sin
 * tilde no ve «Éxito», lo da por nuevo, y acaba con dos proveedores que son
 * el mismo. El campo producía precisamente lo que venía a evitar.
 *
 * NO ES UN CASO RARO EN ESPAÑOL NI EN UN TELÉFONO. Escribir una tilde en el
 * teclado del móvil pide mantener la tecla pulsada y elegir, así que el
 * nombre acentuado se teclea sin tilde la mayoría de las veces.
 *
 * `NFD` separa cada letra de su tilde y el rango `̀-ͯ` es el de
 * esas marcas sueltas, así que «Éxito» queda en «exito». La ñ sobrevive
 * entera porque no es una letra con marca: es su propia letra, y «Peñalver»
 * sigue necesitando su ñ, que es lo correcto — no son el mismo nombre.
 */
function normalizar(v: string): string {
  return v
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * Qué sugerir para lo que el tendero lleva escrito.
 *
 * TRES DECISIONES, Y LAS TRES SE PUEDEN ROMPER SIN QUE SE NOTE:
 *
 * 1. **Busca ignorando la caja Y las tildes**, por lo que explica `normalizar`
 *    justo arriba.
 *
 * 2. **Con el campo vacío no ofrece nada.** Decisión del dueño el 2026-10-20:
 *    *«los proveedores deben verse solo al escribir»*. Y REVIERTE lo que este
 *    archivo decidió el 2026-10-14, que era lo contrario — ofrecer todo al
 *    tocar el campo, pensando en el tendero que compra siempre en los mismos
 *    dos sitios. La razón vieja se queda escrita porque sigue siendo cierta y
 *    es lo que se cede: ese tendero ahora teclea una letra.
 *
 *    Lo que compra el cambio: la lista salía sola al enfocar y, en un
 *    teléfono, empujaba hacia abajo todo lo que venía después del campo antes
 *    de que nadie hubiera pedido nada. Un desplegable que aparece sin que lo
 *    llamen se lee como un error de la pantalla.
 *
 * 3. **No sugiere lo que ya está escrito entero.** Ofrecerle «Makro» a quien
 *    acaba de escribir «Makro» es una fila que no hace nada y que además tapa
 *    el botón de guardar en un teléfono. Se compara normalizado, así que
 *    tampoco se sugiere a quien escribió «MAKRO» ni «Exito» ante «Éxito».
 */
export function sugerenciasDeProveedor(
  valores: readonly (string | null)[],
  escrito: string,
): string[] {
  const q = normalizar(escrito);
  if (q === "") return [];
  return proveedoresUnicos(valores)
    .filter((s) => normalizar(s).includes(q))
    .filter((s) => normalizar(s) !== q)
    .slice(0, MAXIMO_SUGERENCIAS);
}
