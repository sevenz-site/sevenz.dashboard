import type { FactsForTheModel } from "@/lib/reports/assistant/facts";

// WHERE EACH RECOMMENDATION OF THE ASSISTANT LEADS — owner's request of 2026-11-17 (frame
// 2189:28630): «Agregar botón link que redirija a lo mencionado en recomendaciones del
// asistente». The frame writes «Ver clientes» and «Ver productos» after each one.
//
// A CLOSED LIST, NOT A URL. The model (or the fallback) names one of these keys and the screen
// builds the address: a model that wrote URLs could send the owner anywhere, and a key that is
// not here is dropped by `validarNota`. Each key is also checked against the facts, so «Ver
// clientes» under «los 9 clientes en estado crítico» exists only when there are critical
// clients to see.
//
// EACH LINK OPENS THE SAME LIST THE SCREEN ALREADY HAS, with `?abrir=`: the sheet behind the
// «Críticos» card, behind «Por agotarse»… Same rule, same count as the sentence's figure,
// because both come from the same loaders.

export const ENLACES = {
  criticos: { etiqueta: "Ver clientes", href: "/reportes?tab=facturacion&seccion=plazos&abrir=criticos" },
  vencido: { etiqueta: "Ver clientes", href: "/reportes?tab=facturacion&seccion=plazos&abrir=vencido" },
  "malas-pagas": { etiqueta: "Ver clientes", href: "/reportes?tab=facturacion&seccion=plazos&abrir=malasPagas" },
  "por-agotarse": {
    etiqueta: "Ver productos",
    href: "/reportes?tab=inventario&seccion=metricas-inventario&abrir=por-agotarse",
  },
  agotadas: { etiqueta: "Ver productos", href: "/reportes?tab=inventario&seccion=metricas-inventario&abrir=agotadas" },
  pedidos: { etiqueta: "Ver pedidos", href: "/productos/ordenes" },
  "mejores-pagadores": { etiqueta: "Ver clientes", href: "/reportes?tab=facturacion&seccion=mejores-pagadores" },
} as const;

export type Enlace = keyof typeof ENLACES;

/** Whether the facts back a link: no «Ver clientes» to an empty list. */
export function enlaceRespaldado(e: Enlace, f: FactsForTheModel): boolean {
  switch (e) {
    case "criticos":
      return f.clients.critical > 0;
    case "vencido":
      return f.clients.overdue > 0;
    case "malas-pagas":
      return f.clients.flagged > 0;
    case "por-agotarse":
      return f.stock.bestSellersRunningLow > 0;
    case "agotadas":
      return f.stock.outOfStock > 0;
    case "pedidos":
      return f.unhandledOrders > 0;
    case "mejores-pagadores":
      return f.dormantGoodPayers > 0;
  }
}

/** A stored or generated key, or null when it is not one of the list. */
export function comoEnlace(v: unknown): Enlace | null {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(ENLACES, v) ? (v as Enlace) : null;
}
