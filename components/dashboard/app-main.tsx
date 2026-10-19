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
  const enFlujoDeRegistrar = pathname.startsWith("/ventas/") || pathname === "/clients/nuevo";

  return (
    <main
      className={cn(
        "flex flex-1 flex-col gap-4 p-4 md:pb-4",
        hasBar && enFlujoDeRegistrar && "pb-[calc(var(--nav-bar-h)+env(safe-area-inset-bottom)+2.5rem)]",
        hasBar && !enFlujoDeRegistrar && "pb-[calc(var(--nav-bar-h)+env(safe-area-inset-bottom)+1rem)]",
        !hasBar && enFlujoDeRegistrar && "pb-[calc(env(safe-area-inset-bottom)+2.5rem)]",
        !hasBar && !enFlujoDeRegistrar && "pb-[calc(env(safe-area-inset-bottom)+1rem)]",
      )}
    >
      {children}
    </main>
  );
}
