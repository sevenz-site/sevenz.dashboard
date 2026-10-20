"use client";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

// Several screens get a contextual bar of their own — a "← back" row, or a
// whole dark header — so this one would be a second bar competing for the
// ~110px a phone can least afford. The two lists below say which, and they are
// not the same list: one hides this bar everywhere, the other only on a phone.
//
// The route check has to happen in the browser (usePathname), but the
// breakpoint is CSS, so nothing flashes: the server and the client agree on
// the pathname, and the media query is applied before the first paint.
//
// Consequence worth knowing: below sm on one of these screens,
// Notificaciones is only reachable after going back to Cartera. Ayuda lives
// in the sidebar menu now, so it isn't affected by this at all.
export function AppHeader({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // FIVE SCREENS DO NOT CARRY THIS BAR AT ANY WIDTH: the ones that brought
  // their own dark header instead.
  //
  // Inicio got one on 2026-10-03 (`HomeHeader`: brand, menu, Notificaciones),
  // Clientes, Malas pagas and Papelera on 2026-10-04 (`ScreenHeader`: back
  // arrow, title, subtitle, search, filters), and the client detail the same
  // day (`ClientDetailHeader`: back arrow, ⋮, photo, name, contact data and
  // the WhatsApp button). Leaving this bar on top of any of them would be two
  // bars, and on Inicio the brand twice.
  //
  // At EVERY width, not only on a phone, unlike the list below: their dark
  // header is not a phone-sized substitute, it is the header.
  //
  // The client detail moved up from that list on 2026-10-04. Until then it had
  // a `sm:static` back row and got this bar from sm up; its dark header now
  // carries the ⋮ menu and the back arrow at every width, so a second bar
  // above it would just be a second bar.
  //
  // Whoever removes one of those three components has to remove its route from
  // here in the same change, or that screen is left with no header at all.
  const bringsItsOwnDarkHeader =
    pathname === "/dashboard" ||
    pathname === "/clients" ||
    pathname.startsWith("/clients/") ||
    pathname.startsWith("/malas-pagas") ||
    pathname.startsWith("/papelera") ||
    // Catálogo, desde el 2026-10-10. Se añadió tarde: la pantalla salió el día
    // anterior con `ScreenHeader` y SIN tocar esta lista, así que pintaba las
    // dos barras — exactamente lo que el comentario de abajo cuenta que le
    // pasó a `/papelera`. Lo reportó el dueño como «te inventaste un header
    // blanco».
    //
    // Es la clase de fallo que no se ve escribiendo la pantalla: la barra de
    // más la pone OTRO componente, y el que escribe la pantalla nueva no tiene
    // ninguna razón para abrir este archivo.
    pathname.startsWith("/productos") ||
    // ── Y LOS FLUJOS DE PANTALLA COMPLETA, desde el 2026-10-18 ──────
    //
    // `/ventas/nueva` (frames `1389:8329` y siguientes) no trae una cabecera
    // OSCURA sino una clara —flecha, titulo, progreso— pero el efecto es el
    // mismo y por eso entra en esta lista y no en `hasOwnBar`: es su cabecera
    // a TODAS las anchuras, no una version de telefono. Dejar esta barra
    // encima daria dos filas de navegacion y la marca repetida.
    //
    // `/clients/nuevo` ya estaba cubierto por `startsWith("/clients/")` de
    // arriba, por suerte y no por diseno.
    //
    // ESTO SE ESCAPO AL CONSTRUIR LA PANTALLA, que es literalmente lo que
    // avisa el comentario de `/productos` unas lineas mas arriba. Van tres
    // veces: papelera, catalogo, y ahora la venta.
    pathname.startsWith("/ventas") ||
    // ── Y VAN CUATRO: `/abonos`, el 2026-10-19 ──────────────────────
    //
    // El flujo del abono dirigido son tres pasos con su propia cabecera clara
    // —flecha, titulo, progreso—, igual que el de venta. Salio con esta barra
    // encima y el dueno lo reporto con una captura, rodeada en rojo: «agregaste
    // nuevamente un header que no estaba en el frame, SIEMPRE lo agregas».
    //
    // CUATRO VECES EL MISMO FALLO, y el comentario de arriba ya lo contaba. La
    // razon es la que el de `/productos` explica y que sigue siendo cierta: la
    // barra de mas la pone ESTE archivo, y quien escribe una pantalla nueva no
    // tiene ninguna razon para abrirlo. Por eso el 2026-10-19 dejo de ser un
    // comentario y paso a `CLAUDE.md`: toda pantalla nueva entra aqui ANTES de
    // escribirse, no despues de que alguien la vea doble.
    pathname.startsWith("/abonos");

  // Screens that do not need this bar on a phone, for either of two reasons:
  // most carry their own contextual "← back" row, and `/reportes` carries
  // nothing but is fully served by the bottom bar — it is one of the bar's own
  // destinations, so there is nowhere to go back to, and the bar also carries
  // "Menú". From sm up they all get it back, because there is room for both
  // and from md up there is no bottom bar at all.
  //
  // Any new screen that copies the "-mx-4 -mt-4 … sm:hidden" back-arrow row
  // belongs in this list too. /papelera shipped without it and rendered both
  // bars on a phone — the copied comment says "replaces the app header", but
  // nothing enforces it from that end.
  const hasOwnBar =
    pathname.startsWith("/import") ||
    pathname.startsWith("/profile") ||
    pathname.startsWith("/notificaciones") ||
    pathname === "/reportes";

  return (
    <header
      className={cn(
        // sticky + bg-background: sin el fondo, el contenido se ve por
        // debajo al hacer scroll. z-20 la pone sobre la página y por debajo
        // de diálogos y sheets, que viven en z-50.
        "sticky top-0 z-20 h-14 shrink-0 items-center gap-2 border-b bg-background px-4",
        bringsItsOwnDarkHeader ? "hidden" : hasOwnBar ? "hidden sm:flex" : "flex",
      )}
    >
      {children}
    </header>
  );
}
