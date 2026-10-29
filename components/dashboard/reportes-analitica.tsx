"use client";

import { useEffect, useRef } from "react";
import { track } from "@/lib/mixpanel";
import type { Apartado } from "@/lib/reports/apartados";

// ═══════════════════════════════════════════════════════════════════════
// LA ANALÍTICA DE «REPORTES»
//
// Encargo del dueño el 2026-10-29: *«agreguemos todos los eventos que
// propones para la sección de reportes»*.
//
// HASTA HOY NO HABÍA NINGUNO. Reportes es la pantalla más grande que este
// producto ha construido --tres apartados, cinco hojas, dos exportaciones-- y
// no se sabía si alguien la abría.
//
// ───────────────────────────────────────────────────────────────────────
// VAN POR `track` Y NO POR `trackServer`, Y ESO ES DELIBERADO
//
// La regla de iPhone de `CLAUDE.md` dice que lo que importa lo hace el
// servidor, porque el navegador puede no cooperar. Aquí se acepta el riesgo
// por una razón concreta: **estos cuatro miden GESTOS del tendero** --abrir
// una pestaña, cambiar un rango, abrir una hoja-- y un gesto no existe en el
// servidor. `Report Opened` sí podría enviarse al pintar la página, pero
// entonces contaría también las recargas y las vueltas atrás.
//
// Y NO SE PIERDEN COMO SE PERDÍAN: `lib/mixpanel.ts` ya no llama a
// `api.mixpanel.com` desde la página --eso es lo que los bloqueadores de iOS
// tiraban-- sino a `/api/track`, el mismo origen de la app. Lo que queda es
// un suelo, no un recuento exacto, y así hay que presentarlo.
//
// LA DESCARGA ES LA EXCEPCIÓN y no está aquí: se dispara desde el menú, en el
// mismo gesto que abre la ruta, porque es el único de los cuatro que decide
// trabajo caro --ver su propia nota en `reportes-descargar.tsx`--.
// ═══════════════════════════════════════════════════════════════════════

/**
 * ¿CUÁL DE LOS TRES APARTADOS MIRA EL TENDERO?
 *
 * QUÉ CAMBIA CON CADA RESPUESTA, que es lo que separa un evento de una
 * columna que nadie abre:
 *
 *   · Si casi todo es Facturación, los dos apartados nuevos son trabajo que
 *     no se está usando, y lo honesto es dejar de invertir en ellos antes de
 *     construir el «Ordenar por» o el resto del plan.
 *   · Si Inventario pesa, el camino es al revés: la parte B del plan --el
 *     `.xlsx` y el correo-- debería empezar por el inventario y no por la
 *     facturación, que es como está escrita hoy.
 *   · Y si Proveedores no lo abre nadie, su pestaña está ocupando un tercio
 *     de la cabecera para nada. Esa es una decisión de producto que hoy no se
 *     puede tomar porque no hay dato.
 *
 * SE DISPARA UNA VEZ POR APARTADO Y POR MONTAJE, no en cada render ni al
 * cambiar el rango: lo que se mide es «abrió Inventario», no «la pantalla se
 * volvió a pintar». Sin esa guarda, mover el calendario inflaría la cuenta
 * del apartado que estuviera abierto.
 */
export function ReportesAnalitica({ apartado }: { apartado: Apartado }) {
  const ultimo = useRef<Apartado | null>(null);

  useEffect(() => {
    if (ultimo.current === apartado) return;
    ultimo.current = apartado;
    track("Report Opened", { tab: apartado });
  }, [apartado]);

  return null;
}
