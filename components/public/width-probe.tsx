"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

// ===========================================================================
// SONDA DE ANCHO — TEMPORAL, SOLO PARA DIAGNOSTICAR, Y HAY QUE QUITARLA
// ===========================================================================
//
// Se enciende con `?diag=1` en cualquier pantalla del catálogo público y
// escribe arriba del todo lo que mide el navegador de verdad: el ancho de la
// ventana, el del documento, y QUÉ elemento se sale por la derecha.
//
// POR QUÉ EXISTE. El 2026-10-17 el dueño reportó scroll horizontal en el
// comprobante. Lo arreglé una vez —`w-full` en seis contenedores, un fallo
// real— y siguió pasando en su teléfono. Después medí el sitio DESPLEGADO con
// sus mismos datos, a 320, 360, 375 y 412 px, con el texto agrandado hasta
// 26px: cero desbordamiento, siempre. Su teléfono lo tiene y el mío no.
//
// Y LO QUE LLEVABA DOS RONDAS FALLANDO ERA EL MÉTODO, no la hipótesis: estaba
// deduciendo anchos de una fotografía. Una fotografía no dice `scrollWidth`.
// Esto sí, y lo dice desde el aparato donde ocurre, que es el único sitio
// donde la respuesta existe.
//
// CÓMO SE QUITA, y que nadie se la encuentre dentro de seis meses: borrar
// este archivo y su montaje en `app/c/[token]/layout.tsx`. Está anotada en
// `../docs/PENDIENTES.md`. No se queda «por si acaso» — código de diagnóstico
// que sobrevive a su diagnóstico es código que nadie entiende después.
//
// NO ESTORBA A NADIE SIN EL PARÁMETRO: sin `?diag=1` devuelve `null` y ni se
// monta. Un cliente no puede verla por accidente.
export function WidthProbe() {
  const params = useSearchParams();
  const encendida = params.get("diag") === "1";
  const [info, setInfo] = useState<string[]>([]);

  useEffect(() => {
    if (!encendida) return;

    const medir = () => {
      const doc = document.documentElement;
      const vw = doc.clientWidth;
      const sw = doc.scrollWidth;

      // LOS QUE SE SALEN POR LA DERECHA **Y NADIE LOS RECORTA**.
      //
      // El filtro del recorte no es un detalle: sin él, la primera versión de
      // esta sonda ya señalaba como culpable la marca de agua de la cabecera
      // —un `img` al 130 % que llega a 431px— cuando su `<header>` la recorta
      // con `overflow-hidden` y no desborda nada. Una sonda que acusa a un
      // inocente es peor que ninguna sonda: manda a arreglar lo que no está
      // roto, que es exactamente el rato que esto viene a ahorrar.
      const loRecortanArriba = (el: HTMLElement) => {
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          const ox = getComputedStyle(p).overflowX;
          if (ox === "hidden" || ox === "auto" || ox === "scroll" || ox === "clip") return true;
        }
        return false;
      };
      const fuera = [...document.querySelectorAll<HTMLElement>("body *")]
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ el, r }) => r.width > 0 && r.right > vw + 1 && !loRecortanArriba(el))
        .sort((a, b) => b.r.right - a.r.right)
        .slice(0, 3)
        .map(({ el, r }) => {
          const clase = String(el.className || "").slice(0, 38);
          return `${el.tagName.toLowerCase()} →${Math.round(r.right)} ${clase}`;
        });

      setInfo([
        `ventana ${vw} · documento ${sw} · ${sw > vw ? `DESBORDA ${sw - vw}px` : "no desborda"}`,
        `zoom ${(window.visualViewport?.scale ?? 1).toFixed(2)} · dpr ${window.devicePixelRatio}`,
        ...(fuera.length ? fuera : ["nada se sale sin estar recortado"]),
      ]);
    };

    medir();
    const t = setInterval(medir, 700);
    window.addEventListener("resize", medir);
    window.visualViewport?.addEventListener("resize", medir);
    return () => {
      clearInterval(t);
      window.removeEventListener("resize", medir);
      window.visualViewport?.removeEventListener("resize", medir);
    };
  }, [encendida]);

  if (!encendida) return null;

  return (
    <div
      // `left-0 w-screen` y no `inset-x-0`: si la página se desborda, un panel
      // que dependa del ancho del padre se desborda con ella y deja de ser
      // legible justo cuando hace falta.
      className="fixed top-0 left-0 z-[100] w-screen bg-black/90 px-2 py-1 font-mono text-[11px] leading-tight text-lime-300"
    >
      {info.map((l) => (
        <div key={l} className="break-all">
          {l}
        </div>
      ))}
    </div>
  );
}
