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
  // FOUR SCREENS DO NOT CARRY THIS BAR AT ANY WIDTH: the ones that brought
  // their own dark header instead.
  //
  // Inicio got one on 2026-10-03 (`HomeHeader`: brand, menu, Notificaciones)
  // and Clientes, Malas pagas and Papelera on 2026-10-04 (`ScreenHeader`: back
  // arrow, title, subtitle, search, filters). Leaving this bar on top of either
  // would be two bars, and on Inicio the brand twice.
  //
  // At EVERY width, not only on a phone, unlike the list below: their dark
  // header is not a phone-sized substitute, it is the header.
  //
  // Whoever removes one of those two components has to remove its route from
  // here in the same change, or that screen is left with no header at all.
  const bringsItsOwnDarkHeader =
    pathname === "/dashboard" ||
    pathname === "/clients" ||
    pathname.startsWith("/malas-pagas") ||
    pathname.startsWith("/papelera");

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
    pathname.startsWith("/clients/") ||
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
