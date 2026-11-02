// Toasts on "Mi negocio" open at the TOP of the screen.
//
// Since 2026-11-02 "Guardar cambios" is pinned to the bottom (StickyActions),
// which is exactly where Sonner draws its toasts on a phone. Measured that day
// at 375px: the "Cambios guardados" toast spans y 743–796 and the button
// y 732–772, and a tap on the button landed on the toast — a second save
// within those seconds silently did nothing. Found while testing the logo
// fix that day: a second save after uploading a logo never reached the server.
//
// Every toast this screen raises takes these options, so they all agree.
// Other screens with a pinned bar keep the default: they navigate away after
// their action, so the toast never sits over a button someone needs next.
export const PROFILE_TOAST = { position: "top-center" } as const;
