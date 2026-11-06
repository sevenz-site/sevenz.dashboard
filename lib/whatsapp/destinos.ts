import { SECCIONES, type Seccion } from "@/lib/reports/secciones";

// WHERE EACH TEMPLATE'S BUTTON GOES. Owner's decision of 2026-11-06: to the section of Reportes
// that backs the figure, not to the home page. With several figures in one message the first
// one wins, and the order of the lines is the order he validated: por cobrar, plazos vencidos,
// por vencer.
//
// THESE ADDRESSES ARE APPROVED BY META AND CANNOT BE EDITED. Rename a section and the button
// keeps opening the tab without reaching it, with no error anywhere; the fix is a new template
// and its wait. `qa:destinos-plantillas` fails if a destination stops existing, and CLAUDE.md
// asks every change to Reportes to come through here first.
//
// `seccion` AND NOT `#seccion`: a fragment does not survive signing in, because the browser
// never sends it to the server. `ReportesAncla` reads either.
//
// `periodo=7d` because the message says «últimos 7 días» and Reportes opens on 30 by default:
// otherwise the owner taps a figure and reads a different one.

export const APP_URL = "https://app.sevenz.site";

export const DESTINO_DE_PLANTILLA: Record<string, { seccion: Seccion; periodo?: "7d" } | "inicio"> = {
  negocio_resumen: { seccion: "cartera", periodo: "7d" },
  ventas_resumen: { seccion: "transacciones", periodo: "7d" },
  atencion_cobros: { seccion: "plazos" },
  atencion_negocio: { seccion: "plazos" },
  atencion_productos: { seccion: "metricas-inventario" },
  cierre_mensual: { seccion: "margen" },
  cuenta_lista: "inicio",
  primera_semana: "inicio",
  negocio_estado: "inicio",
  prueba_por_vencer: "inicio",
};

export function urlDelBoton(plantilla: string): string | null {
  const destino = DESTINO_DE_PLANTILLA[plantilla];
  if (!destino) return null;
  if (destino === "inicio") return APP_URL;
  const q = new URLSearchParams({ tab: SECCIONES[destino.seccion].tab, seccion: destino.seccion });
  if (destino.periodo) q.set("periodo", destino.periodo);
  return `${APP_URL}/reportes?${q.toString()}`;
}
