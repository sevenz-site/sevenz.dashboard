// Shared between the client upload UI and the /api/extract route. Kept low
// because Gemini's free tier is rate-limited and photos are processed one at
// a time with spacing between them (see app/api/extract/route.ts) — a bigger
// batch would just make imports take proportionally longer.
export const MAX_IMPORT_PHOTOS = 6;

// Free plan: photos are capped per calendar month (resets on the 1st). Only
// successfully-processed photos count — a failed OCR read doesn't burn quota.
// Pro has no limit.
export const FREE_PLAN_MONTHLY_IMPORT_LIMIT = 5;

// WhatsApp de soporte, sin "+" ni espacios: así lo quiere wa.me. Lo usa el
// diálogo que aparece cuando no se pueden leer los datos del negocio, que sin
// una segunda salida dejaría al dueño pulsando "Recargar" en bucle.
export const SUPPORT_WHATSAPP = "573238130265";
