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
  // Screens that carry their own contextual bar on a phone: a client, the
  // Clientes list, Malas pagas, Importar cartera, and Mi negocio. All of
  // these replace this header below sm rather than stacking a second bar
  // on top of it.
  const hasOwnBar =
    pathname.startsWith("/clients/") ||
    pathname === "/clients" ||
    pathname.startsWith("/malas-pagas") ||
    pathname.startsWith("/import") ||
    pathname.startsWith("/profile");

  return (
    <header
      className={cn(
        "h-14 shrink-0 items-center gap-2 border-b px-4",
        hasOwnBar ? "hidden sm:flex" : "flex",
      )}
    >
      {children}
    </header>
  );
}
