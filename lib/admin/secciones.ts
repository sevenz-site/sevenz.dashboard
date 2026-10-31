// The sections of /admin → Métricas. Shared by the tabs (client) and the page
// (server), so the two cannot disagree about which keys exist: an unknown key
// in the URL falls back to the first section instead of rendering nothing.
export const SECCIONES = [
  { clave: "transacciones", etiqueta: "Transacciones" },
  { clave: "pedidos", etiqueta: "Pedidos" },
  { clave: "clientes", etiqueta: "Clientes y crédito" },
  { clave: "negocios", etiqueta: "Negocios" },
  { clave: "salud", etiqueta: "Salud" },
] as const;

export type Seccion = (typeof SECCIONES)[number]["clave"];

export function seccionDe(valor: string | undefined): Seccion {
  return SECCIONES.find((s) => s.clave === valor)?.clave ?? "transacciones";
}
