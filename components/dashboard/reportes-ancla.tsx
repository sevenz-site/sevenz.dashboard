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
    // `?seccion=` is what a WhatsApp button carries: a fragment does not survive signing in.
    // The browser only scrolls by itself to a fragment, so this one is done here.
    const pedida = params.get("seccion");
    if (pedida && pedida in SECCIONES && SECCIONES[pedida as Seccion].tab === apartado) {
      desplazarA(pedida);
    }

    const ancla = window.location.hash.replace(/^#/, "");
    if (!ancla || !(ancla in SECCIONES)) return;

    const suTab = SECCIONES[ancla as Seccion].tab;
    // YA ESTAMOS DONDE TOCA. La guarda no es cortesía: sin ella esto navegaría
    // a la misma URL en cada render y el desplazamiento del navegador se
    // perdería en cada vuelta.
    if (suTab === apartado) {
      desplazarA(ancla);
      return;
    }

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

// BELOW THE STICKY HEADER, MEASURED. `scroll-mt-28` assumes a collapsed header of 112px, and on
// a phone the header of Reportes keeps its search, tabs and range while scrolling: measured on
// 2026-11-17 at 375px, it ends at 253px, so every block a WhatsApp button opened had its title
// and first figures under it -- «Plazos de pago» included, before any block moved.
//
// AND AGAIN FOR A FEW SECONDS: the assistant fetches its summary after the page renders, and
// the header and the block move while it does, so a block placed right at load ended up 80px
// lower than asked. Each pass corrects by the difference. THE OWNER'S OWN GESTURE STOPS THEM --
// a touch, the wheel, a key --, not a change of `scrollY`: the browser moves `scrollY` by itself
// when content loads above (scroll anchoring), and reading that as him scrolling stopped the
// passes before they did anything (measured on 2026-11-17). A screen that drags him back after
// he started reading would be worse than one that lands a little low.
function desplazarA(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView();
  let parado = false;
  const parar = () => {
    parado = true;
  };
  const gestos = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
  for (const g of gestos) window.addEventListener(g, parar, { once: true, passive: true });
  const corregir = () => {
    if (parado) return;
    const fijos = [...document.querySelectorAll<HTMLElement>("body *")].filter((x) => {
      const c = getComputedStyle(x);
      const r = x.getBoundingClientRect();
      // NOT THE SIDEBAR: on the web it is sticky too, and as tall as the screen; counted as the
      // header it sent every block below the fold (measured at 1280px the same day).
      return (
        (c.position === "sticky" || c.position === "fixed") &&
        r.top <= 1 &&
        r.height > 60 &&
        r.height < window.innerHeight / 2 &&
        r.width > 200
      );
    });
    const tope = Math.max(0, ...fijos.map((x) => x.getBoundingClientRect().bottom));
    const diferencia = el.getBoundingClientRect().top - tope - 12;
    if (Math.abs(diferencia) > 1) window.scrollBy(0, diferencia);
  };
  requestAnimationFrame(corregir);
  for (const ms of [700, 1600, 3000]) window.setTimeout(corregir, ms);
  window.setTimeout(() => {
    for (const g of gestos) window.removeEventListener(g, parar);
  }, 3100);
}
