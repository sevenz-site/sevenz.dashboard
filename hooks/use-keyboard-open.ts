"use client";

import { useEffect, useState } from "react";

// ¿ESTÁ EL TECLADO DEL TELÉFONO LEVANTADO?
//
// Lo miran las dos barras que se pegan al borde inferior: la de navegación
// (`mobile-nav.tsx`) y la de botones del flujo de registrar
// (`sticky-actions.tsx`). Con el teclado abierto se quedan flotando encima de
// él y tapan el campo que el tendero está rellenando.
//
// ===========================================================================
// LA PRIMERA VERSIÓN NO FUNCIONABA EN ANDROID, Y NADIE SE ENTERÓ
//
// Medía `visualViewport.height < window.innerHeight * 0.75`. Eso vale en iOS,
// que NO redimensiona la página al abrir el teclado: lo superpone, así que el
// viewport visual encoge mientras el de maquetación no, y la diferencia entre
// los dos es la señal.
//
// EN ANDROID EL NAVEGADOR SUELE REDIMENSIONAR LOS DOS. `innerHeight` encoge
// con el teclado, así que la proporción se queda cerca de 1 y la condición no
// se cumple nunca. La barra no se escondía jamás.
//
// Y ESTUVO ROTO MESES SIN QUE SE NOTARA, porque las pantallas donde se habría
// visto —la ficha de un cliente, el asistente de venta— esconden la barra de
// navegación por otros motivos. Solo apareció cuando una segunda barra empezó
// a usar el mismo hook en una pantalla que sí la enseña. El dueño lo reportó
// dos veces: la primera lo tapé sin saberlo añadiendo la señal del buscador
// —que es un evento de foco y sí funciona— y la segunda, con los botones del
// alta encima del teclado, ya no había dónde esconderlo.
//
// ===========================================================================
// DOS SEÑALES, Y LA QUE MANDA ES EL FOCO
//
// 1. HAY UN CAMPO DE TEXTO CON EL FOCO. Es lo que de verdad significa «el
//    teclado está arriba», no depende de cómo redimensione cada navegador, y
//    es un evento y no una medida. Es la que resuelve el caso.
//
// 2. EL VIEWPORT VISUAL ENCOGIÓ mucho respecto al máximo que se ha visto. Se
//    queda como red de seguridad para lo que el foco no ve — un teclado que
//    sigue abierto tras cerrar un diálogo, por ejemplo. Compara contra el
//    máximo y no contra `innerHeight`, que es justo el error de la primera
//    versión.
//
// SOLO EN PANTALLAS TÁCTILES (`pointer: coarse`). En un escritorio con teclado
// físico no hay nada que tape, y esconder la barra cada vez que alguien hace
// clic en un campo sería un parpadeo constante.
export function useKeyboardOpen() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // `matchMedia` puede no existir en entornos de prueba. Sin él se asume
    // escritorio, que es el lado seguro: la barra se queda.
    const tactil = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    if (!tactil) return;

    // QUÉ CUENTA COMO CAMPO DE TEXTO. Un `select` abre una rueda y no un
    // teclado; una casilla y un botón, nada. Si la barra se escondiera con
    // ellos, desaparecería al tocar el selector de documento o el prefijo del
    // teléfono, que es justo cuando el tendero quiere ver dónde está.
    const SIN_TECLADO = [
      "button",
      "checkbox",
      "color",
      "file",
      "hidden",
      "image",
      "radio",
      "range",
      "reset",
      "submit",
    ];
    const esCampoDeTexto = (el: Element | null): boolean => {
      if (!(el instanceof HTMLElement)) return false;
      if (el.isContentEditable) return true;
      if (el instanceof HTMLTextAreaElement) return true;
      if (el instanceof HTMLInputElement) return !SIN_TECLADO.includes(el.type);
      return false;
    };

    const vv = window.visualViewport;
    // El alto más grande visto. Arranca con el de ahora y solo crece: cuando
    // el teclado sube, el visual encoge por debajo de él.
    let maximo = vv?.height ?? window.innerHeight;

    let conFoco = esCampoDeTexto(document.activeElement);
    let encogido = false;
    const recalcular = () => setOpen(conFoco || encogido);

    const alCambiarElFoco = () => {
      // EN `focusout` EL `activeElement` TODAVÍA NO SE HA ACTUALIZADO: durante
      // ese evento sigue siendo el que pierde el foco, o ya es `body` aunque
      // el siguiente campo esté a punto de recibirlo. Esperar un tick deja que
      // se asiente, y de paso evita que la barra parpadee al saltar de un
      // campo al siguiente.
      setTimeout(() => {
        conFoco = esCampoDeTexto(document.activeElement);
        recalcular();
      }, 0);
    };

    const alRedimensionar = () => {
      if (!vv) return;
      if (vv.height > maximo) maximo = vv.height;
      // 150px de margen: por debajo de eso lo que cambia es la barra del
      // navegador al desplazarse, no un teclado.
      encogido = maximo - vv.height > 150;
      recalcular();
    };

    // Al girar el teléfono el máximo anterior ya no significa nada.
    const alGirar = () => {
      maximo = vv?.height ?? window.innerHeight;
      encogido = false;
      recalcular();
    };

    document.addEventListener("focusin", alCambiarElFoco);
    document.addEventListener("focusout", alCambiarElFoco);
    vv?.addEventListener("resize", alRedimensionar);
    window.addEventListener("orientationchange", alGirar);
    recalcular();

    return () => {
      document.removeEventListener("focusin", alCambiarElFoco);
      document.removeEventListener("focusout", alCambiarElFoco);
      vv?.removeEventListener("resize", alRedimensionar);
      window.removeEventListener("orientationchange", alGirar);
    };
  }, []);

  return open;
}
