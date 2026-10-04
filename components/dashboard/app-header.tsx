"use client";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

// On a client's screen the phone gets a contextual bar instead — "← Cartera"
// plus the share and message actions — so this header would be a second bar
// competing for the ~110px a phone can least afford. It stays from sm up,
// where there is room for both.
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
  // INICIO DOES NOT CARRY THIS BAR AT ANY WIDTH, and it is the only such case.
  // Since 2026-10-03 its dark header (`HomeHeader`) carries the brand, the menu
  // and Notificaciones itself, at both widths. Leaving this one on top would be
  // the brand twice and two ways into the menu, stacked.
  //
  // Whoever removes `HomeHeader` has to remove this line in the same change, or
  // Inicio is left with no header at all and no way to open the menu.
  const isHome = pathname === "/dashboard";
  // Screens that do not need this bar on a phone. Two different reasons, one
  // list, because the effect is the same:
  //
  //   * most of them carry their own contextual row — a client, the Clientes
  //     list, Malas pagas, Papelera, Subir libreta, Mi negocio, Notificaciones
  //     — and stacking a second bar on top of it costs ~110px of a 667px
  //     screen;
  //   * `/reportes` carries nothing of its own, but the bottom bar serves it
  //     completely: it is one of the bar's own destinations, so there is
  //     nowhere to go "back" to, and since delivery 3 the bar also carries
  //     "Menú". Leaving this header on would put a hamburger in the top bar and
  //     a "Menú" in the bottom one, on the same screen, opening the same sheet.
  //
  // From sm up they all get it back, because there is room for both and from md
  // up there is no bottom bar at all.
  //
  // Any new screen that copies the "-mx-4 -mt-4 … sm:hidden" back-arrow row
  // belongs in this list too. /papelera shipped without it and rendered both
  // bars on a phone — the copied comment says "replaces the app header", but
  // nothing enforces it from that end.
  const hasOwnBar =
    pathname.startsWith("/clients/") ||
    pathname === "/clients" ||
    pathname.startsWith("/malas-pagas") ||
    pathname.startsWith("/papelera") ||
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
        isHome ? "hidden" : hasOwnBar ? "hidden sm:flex" : "flex",
      )}
    >
      {children}
    </header>
  );
}
