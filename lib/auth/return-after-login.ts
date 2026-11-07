// WHERE TO LAND AFTER SIGNING IN, when the owner came from a WhatsApp button.
//
// A template's button opens a section of Reportes (owner's decision of 2026-11-06). With no
// session the proxy sends him to /login, and sign-in always ended at /dashboard: he tapped
// «Ver mis cobros» and landed somewhere else, with nothing saying why.
//
// A SHORT COOKIE AND NOT `?next=`. Sign-in has two ends, the password and the second-factor
// code, and a query parameter would have to survive both forms. A cookie is written once by
// the proxy and read by whichever ends it.
//
// ONLY /reportes, ON PURPOSE. A «where to go next» value that accepts any address is the
// classic open redirect: a link to Sevenz that lands on a copy of its login. This one accepts
// one internal prefix and nothing else, whatever the cookie says.

export const RETURN_COOKIE = "sz_return";
export const RETURN_MAX_AGE = 600;

export function safeReturnPath(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.length > 300) return null;
  if (!/^\/reportes(\?[^\\\s]*)?$/.test(value)) return null;
  return value;
}
