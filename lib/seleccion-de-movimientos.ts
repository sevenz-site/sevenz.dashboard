// ─────────────────────────────────────────────────────────────────────────
// SELECCIÓN MÚLTIPLE DE MOVIMIENTOS — CT-21
//
// Vive aquí y no en el componente por lo mismo que `estado-de-tarjeta.ts`: es
// lógica que decide qué se borra y a qué moneda, y dentro de un archivo
// `"use client"` con JSX no se puede probar desde Node.
//
// ─────────────────────────────────────────────────────────────────────────
// LA SELECCIÓN SE PODA SOLA, Y ESA ES LA PARTE QUE IMPORTA
//
// Un `Set` de ids que nadie limpia se convierte en una lista de fantasmas: se
// seleccionan seis movimientos, se eliminan, se deshace, se edita, y el
// contador acaba diciendo "4 seleccionados" cuando en pantalla no hay ninguno
// marcado. Peor: el botón de eliminar actuaría sobre ids que ya no existen, y
// la cuenta que el dueño lee no sería la que se va a ejecutar.
//
// Así que la selección NO es estado independiente: se filtra contra lo que hay
// vivo en pantalla en cada render. Si una fila desaparece —eliminada, renombrada
// a otro cliente, deshecha— sale de la selección sin que nadie se acuerde de
// quitarla.
export function podarSeleccion(seleccion: Set<string>, vivos: Iterable<string>): Set<string> {
  const presentes = new Set(vivos);
  const salida = new Set<string>();
  for (const id of seleccion) if (presentes.has(id)) salida.add(id);
  return salida;
}

// Marca o desmarca. Devuelve un `Set` nuevo: el estado de React no se muta, y
// uno mutado in situ no provocaría el render que enciende el pie.
export function alternar(seleccion: Set<string>, rowId: string): Set<string> {
  const salida = new Set(seleccion);
  if (salida.has(rowId)) salida.delete(rowId);
  else salida.add(rowId);
  return salida;
}

// Lo que dice el contador. Aquí y no en el componente porque el número y la
// palabra tienen que concordar, y una plantilla con un `s` pegado a mano acaba
// diciendo "1 movimientos".
//
// "Movimientos" y no "transacciones", que es lo que ponía el diseño entregado
// el 2026-10-02: queda justo debajo de un título que dice "Movimientos" y
// encima de un botón que dice "Eliminar movimientos", y tres palabras para la
// misma cosa en diez centímetros es una de más.
export function textoDeSeleccion(cuantos: number): string {
  return cuantos === 1 ? "1 movimiento seleccionado" : `${cuantos} movimientos seleccionados`;
}

// Lo que dice el botón de eliminar. Lleva el número porque es destructivo: un
// botón que dice solo "Eliminar movimientos" no deja comprobar, antes de
// pulsarlo, que se van a ir los tres que se querían y no los cuatro que había
// marcados de antes.
export function textoDeEliminar(cuantos: number): string {
  return cuantos === 1 ? "Eliminar 1 movimiento" : `Eliminar ${cuantos} movimientos`;
}

// Lo que dice cada radio de moneda. Cambia con el estado PORQUE hace dos cosas
// distintas, y esa es la decisión del usuario del 2026-10-02: con selección
// actúa sobre los seleccionados, sin ella sobre todos los del cliente. El mismo
// control haciendo dos cosas con la misma etiqueta sería la trampa; la etiqueta
// dice cuál de las dos está armada ahora.
export function textoDeMoneda(nombre: string, seleccionados: number): string {
  return seleccionados > 0 ? `${seleccionados} a ${nombre}` : `Todo ${nombre}`;
}
