// WHERE THE CUSTOMER'S LINKS LIVE: the balance link (`/s/...`), the catalogue (`/c/...`)
// and a product (`/c/.../<id>`).
//
// Owner's report of 2026-11-15: *«Cuando dueño de negocio con la app de sevenz instalada
// abre un link de sevenz, bien sea saldo compartido, catálogo o producto, ese link se abre
// dentro de la app de sevenz PWA, eso daña la experiencia, debería abrirse en el navegador
// y no en la app de sevenz, ya que actualmente debe cerrar el app para poder regresar a su
// app como dueño»*.
//
// WHY A SECOND HOST AND NOT A MANIFEST SETTING. On Android an installed app claims every
// link inside its scope, and a scope can only be a path PREFIX. The owner's screens live at
// the root (`/dashboard`, `/clients`, `/productos`...), right beside `/s` and `/c`, so no
// scope can include the first and leave out the second. What Android does not claim is a
// link on ANOTHER host. So when `NEXT_PUBLIC_PUBLIC_LINK_ORIGIN` is set (for example
// `https://cliente.sevenz.site`, the owner's choice of 2026-11-15, a domain of this same
// Vercel project), every link the owner shares is built on it, and `proxy.ts` sends the
// old ones there. The steps to switch it on, in order, are in PL-47 of PENDIENTES.md.
//
// UNSET, NOTHING CHANGES: links are built on the page's own origin, as before. That is
// how it ships until the owner has created the domain, and how dev runs by default.
export function publicLinkOrigin(): string | null {
  const configured = process.env.NEXT_PUBLIC_PUBLIC_LINK_ORIGIN?.trim().replace(/\/+$/, "");
  return configured ? configured : null;
}

// The base for a link the owner is about to share, in the browser.
export function publicLinkBase(): string {
  return publicLinkOrigin() ?? (typeof window !== "undefined" ? window.location.origin : "");
}

// Paths that belong to the public host. The pages, plus the routes those pages call
// without a session (they are listed in `lib/supabase/middleware.ts` as public too).
export function isPublicLinkPath(pathname: string): boolean {
  return (
    pathname.startsWith("/s/") ||
    pathname.startsWith("/c/") ||
    pathname === "/api/share-contact" ||
    pathname === "/api/share-catalog" ||
    pathname === "/api/public-event" ||
    pathname.startsWith("/api/usdt")
  );
}
