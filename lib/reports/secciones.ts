// ═══════════════════════════════════════════════════════════════════════
// CADA BLOQUE DE REPORTES TIENE SU DIRECCIÓN
//
// Encargo del dueño el 2026-10-28: *«cada sección de reportes dentro del tab
// debe tener su id o dirección para que desde otras partes del app o
// notificaciones de WhatsApp puedan redirigir a esa sección específica dentro
// de cada tab en reportes»*.
//
// ───────────────────────────────────────────────────────────────────────
// POR QUÉ UNA TABLA Y NO UN `id="..."` SUELTO EN CADA `<section>`
//
// Un ancla sirve para dos cosas a la vez: **marcar** el bloque y **apuntar**
// hacia él. Escritas por separado se separan — alguien renombra el `id` de la
// sección y el enlace de la campana sigue apuntando al viejo, que es un enlace
// que no falla: simplemente no desplaza nada, y el tendero aterriza arriba del
// todo sin saber por qué.
//
// Con esta tabla, el ancla y la pestaña a la que pertenece viven juntas, y
// `hrefDeSeccion` es el único sitio que construye la URL. Un ancla que no
// exista aquí no compila.
//
// ───────────────────────────────────────────────────────────────────────
// EL `?tab=` VIAJA SIEMPRE, Y ES LA MITAD QUE SE OLVIDA
//
// Un `#mas-vendidos` a secas no hace nada si la pantalla abre en Facturación:
// el bloque de Inventario no está en el documento, así que el navegador no
// tiene a dónde desplazarse y no avisa. Por eso la pestaña es parte del ancla
// y no un parámetro que quien enlaza tenga que acordarse de añadir.
// ═══════════════════════════════════════════════════════════════════════

import type { Apartado } from "@/lib/reports/apartados";

export const SECCIONES = {
  // ── Facturación ──────────────────────────────────────────────────────
  // The order of the screen since the owner's frame of 2026-11-17 (2189:28237).
  "cierre-del-dia": { tab: "facturacion", titulo: "Cierre del día" },
  "cierre-del-mes": { tab: "facturacion", titulo: "Cierre del mes" },
  // `cartera` KEEPS ITS ADDRESS though the block now reads «Por cobrar» (owner's request of
  // 2026-11-17): the `negocio_resumen` WhatsApp button lands on `seccion=cartera`, an address
  // Meta approved and nobody can edit.
  cartera: { tab: "facturacion", titulo: "Por cobrar" },
  "ventas-de-contado": { tab: "facturacion", titulo: "Ventas de contado" },
  transacciones: { tab: "facturacion", titulo: "Transacciones" },
  abonos: { tab: "facturacion", titulo: "Abonos" },
  fiados: { tab: "facturacion", titulo: "Fiados" },
  devoluciones: { tab: "facturacion", titulo: "Devoluciones" },
  pedidos: { tab: "facturacion", titulo: "Pedidos" },
  "metodos-de-pago": { tab: "facturacion", titulo: "Métodos de pago" },
  plazos: { tab: "facturacion", titulo: "Plazos de pago" },
  "mejores-pagadores": { tab: "facturacion", titulo: "Mejores pagadores" },
  // ── Inventario ───────────────────────────────────────────────────────
  "metricas-inventario": { tab: "inventario", titulo: "Métricas del inventario" },
  margen: { tab: "inventario", titulo: "Margen por producto" },
  "mas-vendidos": { tab: "inventario", titulo: "Más vendidos" },
  "mas-devueltos": { tab: "inventario", titulo: "Más devueltos" },
} as const satisfies Record<string, { tab: Apartado; titulo: string }>;

export type Seccion = keyof typeof SECCIONES;

/**
 * La URL que abre Reportes en la pestaña correcta y desplazado a ese bloque.
 *
 * `extra` son los filtros que quien enlaza quiera fijar --`desde`, `hasta`,
 * `cliente`--. Se mandan tal cual porque la pantalla ya sabe leerlos y
 * validarlos: un rango ilegible cae en el de por defecto en vez de dejar la
 * pantalla en blanco.
 */
export function hrefDeSeccion(
  seccion: Seccion,
  extra?: Record<string, string | undefined>,
): string {
  const q = new URLSearchParams({ tab: SECCIONES[seccion].tab });
  for (const [k, v] of Object.entries(extra ?? {})) if (v) q.set(k, v);
  return `/reportes?${q.toString()}#${seccion}`;
}

// ═══════════════════════════════════════════════════════════════════════
// WHERE A WHATSAPP ADDRESS LANDS WHEN ITS BLOCK MOVED
//
// A template's button URL is approved by Meta and cannot be edited (`lib/whatsapp/destinos.ts`).
// When a block moves, the address stays and the page sends it on. ONLY THE `?seccion=` FORM:
// that is the one only WhatsApp writes (a fragment does not survive signing in); links inside
// the app use `#seccion`, built by `hrefDeSeccion`, and keep meaning what they say.
//
//   · `margen` → `cierre-del-mes`. `cierre_mensual` («Ver mi margen») was pointed at the margin
//     because the month close lived under it; on 2026-11-17 the owner moved the close to
//     Facturación, and the button has to follow the figure its message states.
//   · `transacciones` → `ventas-de-contado`. `ventas_resumen` («Ver mis ventas») landed on a
//     chart of how many things were recorded, never on an amount; owner's decision of
//     2026-11-17 («Ventas de contado»), the closest block to what the message says.
// ═══════════════════════════════════════════════════════════════════════
export const ALIAS_DE_SECCION: Partial<Record<Seccion, Seccion>> = {
  margen: "cierre-del-mes",
  transacciones: "ventas-de-contado",
};
