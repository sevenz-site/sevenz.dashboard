// LOS TRES APARTADOS DE REPORTES, sin nada de cliente dentro.
//
// VIVEN AQUÍ Y NO EN `reportes-tabs.tsx` porque ese fichero lleva
// `"use client"`, y la página --que es de servidor-- necesita `apartadoDe`
// para saber qué datos cargar. Llamar a una función exportada desde un módulo
// de cliente desde el servidor no falla al compilar: falla EN PANTALLA, con
// «Attempted to call apartadoDe() from the server but apartadoDe is on the
// client». Medido el 2026-10-27, que es como se descubrió.
export const APARTADOS = [
  { clave: "facturacion", etiqueta: "Facturación" },
  { clave: "inventario", etiqueta: "Inventario" },
  { clave: "proveedores", etiqueta: "Proveedores" },
] as const;

export type Apartado = (typeof APARTADOS)[number]["clave"];

export function apartadoDe(valor: string | undefined): Apartado {
  // Cualquier cosa que no sea uno de los tres cae en el primero en vez de
  // romper: este parámetro va en una URL que el dueño puede compartir o
  // teclear mal, y un informe no vale una pantalla caída.
  return APARTADOS.some((a) => a.clave === valor) ? (valor as Apartado) : "facturacion";
}
