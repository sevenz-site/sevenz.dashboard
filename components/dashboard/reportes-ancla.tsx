"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SECCIONES, type Seccion } from "@/lib/reports/secciones";

// ═══════════════════════════════════════════════════════════════════════
// UN ANCLA SOLA TIENE QUE BASTAR
//
// Encargo del dueño el 2026-10-28: *«cada sección de reportes dentro del tab
// debe tener su id o dirección para que desde otras partes del app o
// notificaciones de WhatsApp puedan redirigir a esa sección específica»*.
//
// `hrefDeSeccion` construye siempre la URL completa --con su `?tab=`-- así que
// todo lo que enlace desde dentro de la app funciona. Esto es para lo de
// FUERA: un enlace en un WhatsApp lo escribe una plantilla aprobada por Meta,
// vive meses, y lo va a teclear o recortar alguien. Si llega
// `/reportes#mas-vendidos` a secas, la pestaña que abre es Facturación, el
// bloque de Inventario NO ESTÁ en el documento, y el navegador no tiene a
// dónde desplazarse.
//
// Y NO AVISA. Medido el 2026-10-28: `scrollY` se queda en 0 y la pantalla
// abre arriba del todo, exactamente igual que si el enlace no llevara ancla.
// El tendero no ve un error: ve que el enlace «no hizo nada».
//
// ───────────────────────────────────────────────────────────────────────
// POR QUÉ ESTO NO LO PUEDE HACER EL SERVIDOR
//
// **El fragmento de una URL nunca se manda al servidor.** `#mas-vendidos` no
// sale del navegador, así que la página no puede leerlo para elegir pestaña.
// Tiene que ser un componente de cliente, y por eso existe este fichero.
//
// ───────────────────────────────────────────────────────────────────────
// QUÉ HACE, Y QUÉ NO
//
// Solo corrige la PESTAÑA cuando el ancla pertenece a otra. Si ya es la
// correcta no toca nada: el navegador desplaza solo, que es lo que ya hace
// bien. Un ancla desconocida se ignora en silencio -- una URL vieja o mal
// tecleada no puede dejar la pantalla en blanco.
// ═══════════════════════════════════════════════════════════════════════

export function ReportesAncla({ apartado }: { apartado: string }) {
  const router = useRouter();
  const params = useSearchParams();

  useEffect(() => {
    const ancla = window.location.hash.replace(/^#/, "");
    if (!ancla || !(ancla in SECCIONES)) return;

    const suTab = SECCIONES[ancla as Seccion].tab;
    // YA ESTAMOS DONDE TOCA. La guarda no es cortesía: sin ella esto navegaría
    // a la misma URL en cada render y el desplazamiento del navegador se
    // perdería en cada vuelta.
    if (suTab === apartado) return;

    const siguiente = new URLSearchParams(params.toString());
    siguiente.set("tab", suTab);
    // `replace` Y NO `push`: la URL sin pestaña es la misma pantalla mal
    // resuelta, no un paso atrás al que el tendero quiera volver. Con `push`,
    // la flecha de atrás lo devolvería aquí y esto volvería a corregirla --
    // un botón de atrás que no retrocede.
    router.replace(`/reportes?${siguiente.toString()}#${ancla}`);
  }, [apartado, params, router]);

  return null;
}
