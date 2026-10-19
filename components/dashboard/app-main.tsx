"use client";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useRevisionEnCurso } from "@/components/import/revision-en-curso";

// Wraps <main> purely so the bottom padding can follow whether MobileNav
// actually renders. That reservation is unconditional by design — the bar
// unmounts while a dialog or the keyboard is open, and a padding that came
// and went with it would make the page jump underneath the owner. But
// MobileNav renders nothing at all on a client's own screen, so there the
// reserved strip is permanent dead air below the content.
//
// Same predicate as MobileNav's, trailing slash included: /clients (the list)
// keeps its bar, only /clients/<id> loses it. If one changes the other has to.
export function AppMain({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Revisando una libreta la barra no está, así que su franja reservada sería
  // aire muerto — y aquí sí puede seguir al estado sin que la página salte
  // debajo del dueño: entrar y salir de la revisión ya cambia la pantalla
  // entera, no es el parpadeo de un diálogo abriéndose.
  const { revisando } = useRevisionEnCurso();

  // EL ASISTENTE DE VENTA TAMPOCO LLEVA BARRA, y hasta el 2026-10-18 esto no
  // lo sabía: `MobileNav` devuelve `null` en `/ventas/nueva` desde que la
  // pantalla existe, y aquí se seguían reservando el alto de una barra que no
  // se dibuja. El resultado eran 80px de aire muerto debajo del botón de cada
  // paso — justo la clase de hueco que este comentario lleva avisando desde
  // que se escribió, y que nadie mide porque un hueco de más no rompe nada.
  //
  // El resumen (`/ventas/<id>`) SÍ la lleva: ver `mobile-nav.tsx`.
  const enAsistenteDeVenta = pathname.startsWith("/ventas/nueva");
  const hasBar = !pathname.startsWith("/clients/") && !enAsistenteDeVenta && !revisando;

  // ── CUÁNTO AIRE DEBAJO DEL ÚLTIMO BOTÓN ────────────────────────────
  //
  // 40px en todo el flujo de registrar, a petición del dueño el 2026-10-18:
  // «para que los botones no queden tan pegados a la parte inferior del
  // teléfono ni el widget». Son 2,5rem, y se miden hasta lo que haya debajo —
  // el filo de la pantalla donde no hay barra, la barra donde la hay.
  //
  // POR QUÉ ES UNA EXCEPCIÓN Y NO EL NUEVO VALOR DE TODA LA APP: en una
  // pantalla de lista los 16px de siempre son correctos, porque lo último no
  // es un botón sino una fila más y el aire de sobra se lee como «se acabó».
  // Aquí lo último SÍ es el botón que cierra la venta, y es el único sitio
  // donde el pulgar tiene que acertar a la primera.
  // LAS CUATRO CLASES VAN ESCRITAS ENTERAS, Y NO ES VERBOSIDAD: Tailwind
  // genera CSS leyendo el texto del fichero, así que una clase compuesta —
  // `pb-[calc(…+${aire})]` — no existe en la hoja de estilos y el padding
  // simplemente no se aplica. No da error de compilación ni de tipos: la
  // pantalla sale con los botones pegados abajo y parece que el cambio no se
  // hizo.
  // LAS DOS PANTALLAS QUE LLEVAN `StickyActions` NO ENTRAN: su barra de
  // botones trae su propio aire de 40px, y sumarle el de aqui lo doblaria a
  // 80 -- la barra se quedaria flotando a media altura al final del scroll.
  //
  // El resumen de la venta (`/ventas/<id>`) si entra: sus botones no estan en
  // una barra, y su «Compartir» es la ultima cosa de una pagina que se
  // desplaza.
  const conBarraDeBotones =
    pathname.startsWith("/ventas/nueva") || pathname === "/clients/nuevo";
  const enFlujoDeRegistrar = pathname.startsWith("/ventas/") && !conBarraDeBotones;

  return (
    <main
      className={cn(
        "flex flex-1 flex-col gap-4 p-4 md:pb-4",
        // 5.5rem Y NO 2.5 EN EL RESUMEN, desde que recupero el boton flotante
        // el 2026-10-18: ese boton mide 56px y flota a 1rem por encima de la
        // barra, asi que con los 40 de antes se comia «Compartir» -- la unica
        // accion de esa pantalla. 1rem + 56px + un hueco = 5,5rem.
        //
        // El resto de pantallas con flotante conviven con ese solape sobre la
        // ultima fila de una lista, que molesta mucho menos que tapar un
        // boton. Si algun dia estorba alli tambien, la cuenta esta aqui.
        //
        // QUEDAN 2,75px DE SOLAPE y se quedan. Decision del dueno el
        // 2026-10-19: «dejalo como esta».
        //
        // Medido el 2026-10-18 en un resumen CORTO —una sola linea de producto,
        // sin deuda antigua, a 375px— donde la pagina no llega a desplazarse:
        // ahi el boton flotante muerde 2,75px del borde superior de
        // «Compartir». Con cualquier resumen mas largo no pasa, porque la
        // pagina se desplaza y el `pb` hace su trabajo.
        //
        // POR QUE NO SE PERSIGUE: cerrarlo pide que el `pb` sepa si la pagina
        // se desplaza o no, que es un calculo en tiempo de ejecucion, con su
        // observador y su reflow, para 2,75px que no tapan ni el texto ni el
        // area tocable del boton. Si alguna vez un tendero reporta que no
        // puede darle a «Compartir», el numero a subir es este 5.5rem.
        hasBar && enFlujoDeRegistrar && "pb-[calc(var(--nav-bar-h)+env(safe-area-inset-bottom)+5.5rem)]",
        hasBar && !enFlujoDeRegistrar && "pb-[calc(var(--nav-bar-h)+env(safe-area-inset-bottom)+1rem)]",
        !hasBar && enFlujoDeRegistrar && "pb-[calc(env(safe-area-inset-bottom)+2.5rem)]",
        // CON BARRA DE BOTONES, NI UN PIXEL DE MAS. Solo el area segura del
        // iPhone, porque la barra se pega al borde y su propio `pb` ya pone
        // los 40. Con el `1rem` de la rama de abajo el hueco salia de 56, que
        // es lo que se midio en pantalla antes de poner esta linea.
        !hasBar && conBarraDeBotones && "pb-[env(safe-area-inset-bottom)]",
        !hasBar && !enFlujoDeRegistrar && !conBarraDeBotones &&
          "pb-[calc(env(safe-area-inset-bottom)+1rem)]",
      )}
    >
      {children}
    </main>
  );
}
