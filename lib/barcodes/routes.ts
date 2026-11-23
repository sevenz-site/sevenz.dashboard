// WHERE A GUN SCAN OPENS THE SCANNER'S SHEETS (CT-182).
//
// Owner's decision of 2026-11-23: «en todas las pantallas donde ya se ve el botón
// "Registrar"». On a phone that is the floating button; on a computer, the «Registrar»
// button of Inicio, Clientes and Malas pagas. This list is the screens that carry one of
// them; anywhere else a burst is still taken out of the field (the guard is always on) and
// simply does nothing.
//
// THE SALE AND AN ORDER'S «Detalle del pedido» ARE NOT HERE: each takes scans itself, into
// its cart or its order (continuous mode).
//
// A SCREEN THAT GAINS «Registrar» LATER HAS TO BE ADDED HERE: the button lives in other
// files (mobile-nav.tsx, register-button.tsx) and nothing links them to this list.
// `/productos` since 2026-11-23: the catalogue got its scan button, with the same sheets as
// Inicio (owner's choice that day), so the gun does there what the button does.
const EXACT = new Set(["/dashboard", "/clients", "/malas-pagas", "/notificaciones", "/papelera", "/productos"]);

export function gunOpensSheetsOn(pathname: string): boolean {
  return EXACT.has(pathname);
}
