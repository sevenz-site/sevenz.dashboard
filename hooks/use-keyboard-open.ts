"use client";

import { useEffect, useState } from "react";

// ¿ESTÁ EL TECLADO DEL TELÉFONO TAPANDO LA PANTALLA?
//
// Lo miran las dos barras que se pegan al borde inferior: la de navegación
// (`mobile-nav.tsx`) y la de botones del flujo de registrar
// (`sticky-actions.tsx`). Con el teclado abierto se quedan flotando encima de
// él y tapan el campo que el tendero está rellenando.
//
// ===========================================================================
// TRES VERSIONES EN DOS DÍAS, Y LAS DOS PRIMERAS FALLARON EN SENTIDOS OPUESTOS
//
// 1. MEDÍA `vv.height < window.innerHeight * 0.75`. Vale en iOS, que superpone
//    el teclado y encoge solo el viewport visual. NO vale en Android, donde el
//    navegador suele redimensionar LOS DOS: la proporción se queda cerca de 1
//    y no se cumplía nunca. La barra no se escondía jamás.
//
// 2. MIRABA SI HABÍA UN CAMPO DE TEXTO CON EL FOCO. Resolvió lo de esconderla
//    y rompió lo contrario: **el foco sobrevive al teclado**. El tendero
//    termina de escribir la cédula, cierra el teclado con el botón de atrás, y
//    el campo sigue enfocado — así que el botón para continuar no volvía. Lo
//    reportó el dueño con una captura donde se ve la barra de Android abajo,
//    el campo con su anillo gris, y ningún botón. Una pantalla muerta.
//
// 3. LA DE AHORA MIDE EL VIEWPORT, que es lo que de verdad significa «hay un
//    teclado tapando», pero contra la referencia correcta.
//
// ===========================================================================
// LA REFERENCIA ES EL ALTO CON EL TECLADO ABAJO, NO `innerHeight`
//
// Ese es el arreglo entero. `window.innerHeight` encoge con el teclado en
// Android, así que compararse con él es compararse consigo mismo. Lo que no
// cambia es el alto que tenía la ventana ANTES de que el teclado subiera.
//
// Y ESE ALTO SE RECALIBRA CON EL FOCO, que aquí sí es la herramienta correcta:
// sin ningún campo de texto enfocado el teclado está abajo con seguridad, así
// que la altura de ese momento es una referencia buena. El foco ya no DECIDE
// nada — solo dice cuándo se puede volver a medir el suelo.
//
// Con eso, los dos casos que fallaron salen bien:
//
//   · Android que redimensiona los dos viewports -> la altura cae 300px por
//     debajo de la referencia y se detecta igual que en iOS.
//   · Teclado cerrado con el campo aún enfocado -> la altura VUELVE a la
//     referencia, la diferencia baja de 150 y la barra reaparece.
//
// SOLO EN PANTALLAS TÁCTILES (`pointer: coarse`). En un escritorio no hay
// teclado que tape nada.
export function useKeyboardOpen() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // `matchMedia` puede no existir en entornos de prueba. Sin él se asume
    // escritorio, que es el lado seguro: la barra se queda.
    const tactil = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    if (!tactil) return;

    const vv = window.visualViewport;
    // SIN `visualViewport` NO HAY MEDIDA Y LA BARRA SE QUEDA. Una barra que
    // sobra es cosmético; una que falta deja al tendero sin el botón que
    // cierra la venta, que es justo el fallo que esta versión viene a
    // arreglar.
    if (!vv) return;

    // QUÉ CUENTA COMO CAMPO DE TEXTO. Solo sirve para saber cuándo recalibrar:
    // un `select` abre una rueda y no un teclado, así que con él enfocado la
    // altura de ese momento sigue siendo buena referencia.
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
    const hayCampoDeTexto = (): boolean => {
      const el = document.activeElement;
      if (!(el instanceof HTMLElement)) return false;
      if (el.isContentEditable) return true;
      if (el instanceof HTMLTextAreaElement) return true;
      if (el instanceof HTMLInputElement) return !SIN_TECLADO.includes(el.type);
      return false;
    };

    // El alto de la ventana con el teclado abajo.
    let referencia = vv.height;

    const medir = () => {
      const alto = vv.height;
      if (!hayCampoDeTexto()) {
        // Sin campo enfocado el teclado está abajo: esta altura es la buena.
        referencia = alto;
        setOpen(false);
        return;
      }
      // Con un campo enfocado la altura puede haber bajado por el teclado...
      // o no, si el tendero lo cerró a mano. 150px de margen: por debajo de
      // eso lo que cambia es la barra del navegador al desplazarse, no un
      // teclado, que ocupa 250 o más.
      if (alto > referencia) referencia = alto;

      // ── LA SEGUNDA SEÑAL, Y NO SOBRA ─────────────────────────────────
      //
      // `referencia` es memoria: vale lo que valiera la ventana la última vez
      // que no había nada enfocado. Si la pantalla NACE con el teclado ya
      // arriba —o con el viewport todavía sin estabilizar tras navegar— esa
      // memoria se graba mal, y como solo crece, el hook se queda ciego para
      // el resto de la vida de esa pantalla.
      //
      // Es lo que el dueño reportó el 2026-10-21 llegando al formulario desde
      // el botón «Pagar» del detalle de un fiado: una NAVEGACIÓN, no un
      // cambio de paso. Ya lo había reportado el 2026-10-18 y el 2026-10-20,
      // y las dos veces se arregló la pantalla sin tocar esto.
      //
      // ESTA NO TIENE MEMORIA. En iOS el teclado se superpone: el viewport
      // VISUAL (`vv.height`) encoge y el de MAQUETACIÓN
      // (`documentElement.clientHeight`) no. Esa diferencia es el teclado,
      // medida en el instante, sin depender de nada anterior.
      //
      // En los Android que redimensionan los dos, esta señal da 0 y manda la
      // de la referencia — que allí sí funciona, porque la ventana entera
      // cambia de tamaño y `window.resize` llega.
      //
      // SE PREGUNTA POR CUALQUIERA DE LAS DOS, no por las dos a la vez: cada
      // una cubre el sistema donde la otra no ve nada.
      const layout = document.documentElement.clientHeight;
      const tapadoPorSuperposicion = layout - alto > 150;

      setOpen(referencia - alto > 150 || tapadoPorSuperposicion);
    };

    // EN `focusout` EL `activeElement` TODAVÍA NO SE HA ACTUALIZADO: durante
    // ese evento sigue siendo el que pierde el foco, o ya es `body` aunque el
    // siguiente campo esté a punto de recibirlo. Un tick lo deja asentarse.
    const medirDespues = () => setTimeout(medir, 0);

    // Al girar el teléfono la referencia anterior ya no significa nada.
    const alGirar = () => {
      referencia = vv.height;
      setOpen(false);
    };

    vv.addEventListener("resize", medir);
    // `window.resize` ADEMÁS, porque en los Android que redimensionan el
    // viewport de maquetación es el que llega primero -- y a veces el único.
    window.addEventListener("resize", medir);
    document.addEventListener("focusin", medirDespues);
    document.addEventListener("focusout", medirDespues);
    window.addEventListener("orientationchange", alGirar);
    medir();

    return () => {
      vv.removeEventListener("resize", medir);
      window.removeEventListener("resize", medir);
      document.removeEventListener("focusin", medirDespues);
      document.removeEventListener("focusout", medirDespues);
      window.removeEventListener("orientationchange", alGirar);
    };
  }, []);

  return open;
}
