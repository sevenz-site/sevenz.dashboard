// WHERE A GUN SCAN OPENS THE SCANNER'S SHEETS (CT-182).
//
// Owner's decision of 2026-11-23: «en todas las pantallas donde ya se ve el botón
// "Registrar"». On a phone that is the floating button; on a computer, the «Registrar»
// button of Inicio, Clientes and Malas pagas. This list is the screens that carry one of
// them; anywhere else a burst is still taken out of the field (the guard is always on) and
// simply does nothing.
//
// THE SALE IS NOT HERE: it takes scans itself, into its cart (continuous mode).
//
// A SCREEN THAT GAINS «Registrar» LATER HAS TO BE ADDED HERE: the button lives in other
// files (mobile-nav.tsx, register-button.tsx) and nothing links them to this list.
const EXACT = new Set(["/dashboard", "/clients", "/malas-pagas", "/notificaciones", "/papelera"]);

export function gunOpensSheetsOn(pathname: string): boolean {
  return EXACT.has(pathname);
}
