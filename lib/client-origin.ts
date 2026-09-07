// Which list a client's screen was opened from, carried as `?from=` so the
// back arrow returns there instead of always to Cartera.
//
// A query parameter rather than router history or a stored "last list": the
// page is a server component, so it can read this while rendering and emit the
// correct href in the HTML — no flash of the wrong destination, and the link
// still works on a hard refresh or a shared URL. `history.back()` would have
// been fewer characters and wrong: it walks the browser's stack, so it also
// undoes an in-page navigation and breaks entirely on a link opened directly.
export const CLIENT_ORIGINS = {
  cartera: { href: "/dashboard", label: "Volver a Cartera" },
  clientes: { href: "/clients", label: "Volver a Clientes" },
  malas_pagas: { href: "/malas-pagas", label: "Volver a Malas pagas" },
  papelera: { href: "/papelera", label: "Volver a Papelera" },
} as const;

export type ClientOrigin = keyof typeof CLIENT_ORIGINS;

// `from` arrives from the URL, so it is whatever anyone chose to type. Anything
// unrecognised falls through to the caller's default rather than producing a
// link to nowhere.
export function clientOriginFrom(from: string | undefined) {
  if (!from) return null;
  return from in CLIENT_ORIGINS ? CLIENT_ORIGINS[from as ClientOrigin] : null;
}

export function clientHref(clientId: string, from: ClientOrigin) {
  return `/clients/${clientId}?from=${from}`;
}
