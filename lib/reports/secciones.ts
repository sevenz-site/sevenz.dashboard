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
  cartera: { tab: "facturacion", titulo: "Cartera" },
  transacciones: { tab: "facturacion", titulo: "Transacciones" },
  plazos: { tab: "facturacion", titulo: "Plazos de pago" },
  "mejores-pagadores": { tab: "facturacion", titulo: "Mejores pagadores" },
  // ── Inventario ───────────────────────────────────────────────────────
  "metricas-inventario": { tab: "inventario", titulo: "Métricas del inventario" },
  margen: { tab: "inventario", titulo: "Margen por producto" },
  "mas-vendidos": { tab: "inventario", titulo: "Más vendidos" },
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
