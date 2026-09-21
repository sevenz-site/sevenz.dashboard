// Shared between the client upload UI and the /api/extract route. Kept low
// because Gemini's free tier is rate-limited and photos are processed one at
// a time with spacing between them (see app/api/extract/route.ts) — a bigger
// batch would just make imports take proportionally longer.
export const MAX_IMPORT_PHOTOS = 6;

// Los tres pasos de importar, en los dos sitios que lo explican: la hoja
// "Importar" de Cartera y la cabecera de /import.
//
// Una lista y no un párrafo, y con los pasos numerados de verdad: quien no
// está cómodo con el teléfono necesita ver dónde empieza y dónde acaba cada
// cosa. Un párrafo corrido con la misma información se lee como una promesa
// de marketing; tres renglones numerados se leen como instrucciones.
//
// EL PASO 3 NO ES RELLENO. Es el que dice que nada se guarda solo. Se perdió
// un tiempo al resumir esto en una frase, y es justo lo que tranquiliza a
// quien teme que la máquina le escriba cuentas que él no revisó.
//
// "La pantalla del Excel", no "Excel" a secas: el importador solo acepta
// imágenes (`accept="image/*"`), así que quien intente subir su .xlsx no lo
// verá ni en el selector de archivos. Se le dice que fotografíe la pantalla,
// que sí funciona.
//
// Vive aquí, en un módulo neutro, y no en el componente: /import es un Server
// Component, y sacar esto de un módulo "use client" lo obliga a cruzar esa
// frontera.
export const PASOS_IMPORTAR = [
  "Toma una foto de tu libreta del fiado, tu cuaderno o la pantalla del Excel.",
  "Sevenz lee los nombres y los montos de tus clientes.",
  "Revisas, corriges lo que haga falta y guardas todo de una vez.",
] as const;

// Free plan: photos are capped per calendar month (resets on the 1st). Only
// successfully-processed photos count — a failed OCR read doesn't burn quota.
// Pro has no limit.
export const FREE_PLAN_MONTHLY_IMPORT_LIMIT = 5;

// WhatsApp de soporte, sin "+" ni espacios: así lo quiere wa.me. Lo usa el
// diálogo que aparece cuando no se pueden leer los datos del negocio, que sin
// una segunda salida dejaría al dueño pulsando "Recargar" en bucle.
export const SUPPORT_WHATSAPP = "573238130265";
