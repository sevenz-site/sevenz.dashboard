// Saber si Sevenz se puede instalar en este teléfono, y si conviene ofrecerlo.
//
// La app es instalable desde agosto —manifest, service worker e iconos están
// puestos— y ningún tendero se ha enterado. Android muestra su propio aviso,
// pero es discreto y fácil de ignorar; en iPhone no aparece nunca. Por eso los
// usuarios preguntan por la Play Store: no es que quieran la tienda, es que no
// saben que ya se puede.

const CLAVE = "sevenz:instalar-descartado";
const DIAS = 7 * 24 * 60 * 60 * 1000;
// Dos veces y se acabó. Insistir una vez cubre a quien lo cerró por estar
// ocupado; insistir cinco convierte un aviso útil en algo que se cierra sin
// leer, en una app que se abre todos los días.
const MAX_DESCARTES = 2;

// El evento que Chrome dispara cuando la app cumple los requisitos para
// instalarse. No está en lib.dom: es de Chrome, no del estándar.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let diferido: BeforeInstallPromptEvent | null = null;
const oyentes = new Set<() => void>();

function avisar() {
  for (const o of oyentes) o();
}

// Chrome dispara este evento una sola vez y temprano. Si nadie lo guarda en ese
// momento se pierde, y con él la instalación de un toque — por eso se captura
// desde el layout y no desde la pantalla que muestra el botón.
export function capturarEventoDeInstalacion() {
  if (typeof window === "undefined") return;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    diferido = e as BeforeInstallPromptEvent;
    avisar();
  });
  // Deja de ofrecerse en cuanto se instala, sin esperar a recargar.
  window.addEventListener("appinstalled", () => {
    diferido = null;
    avisar();
  });
}

export function suscribirse(cb: () => void) {
  oyentes.add(cb);
  return () => {
    oyentes.delete(cb);
  };
}

// Lanza el diálogo nativo de Chrome. Devuelve true si el tendero aceptó.
export async function instalar(): Promise<boolean> {
  if (!diferido) return false;
  const evento = diferido;
  // Un evento diferido solo sirve una vez: si el tendero cancela, Chrome
  // vuelve a dispararlo cuando toque.
  diferido = null;
  avisar();
  await evento.prompt();
  const { outcome } = await evento.userChoice;
  return outcome === "accepted";
}

// Ya está instalada: la ventana corre sin barras del navegador. `standalone`
// suelto es el de Safari en iPhone, que no implementa display-mode.
export function yaEstaInstalada(): boolean {
  if (typeof window === "undefined") return false;
  const comoApp = window.matchMedia?.("(display-mode: standalone)")?.matches;
  const safari = (window.navigator as Navigator & { standalone?: boolean }).standalone;
  return Boolean(comoApp || safari);
}

export function esIphone(): boolean {
  if (typeof window === "undefined") return false;
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

type Descartes = { veces: number; cuando: number };

function leerDescartes(): Descartes {
  // localStorage puede lanzar, no solo devolver vacío: en una ventana privada o
  // con las cookies bloqueadas, leerlo es una excepción. Y esto no puede
  // romper Cartera.
  try {
    const crudo = window.localStorage.getItem(CLAVE);
    if (!crudo) return { veces: 0, cuando: 0 };
    const d = JSON.parse(crudo) as Descartes;
    return { veces: Number(d.veces) || 0, cuando: Number(d.cuando) || 0 };
  } catch {
    return { veces: 0, cuando: 0 };
  }
}

export function descartar() {
  try {
    const previo = leerDescartes();
    window.localStorage.setItem(
      CLAVE,
      JSON.stringify({ veces: previo.veces + 1, cuando: Date.now() } satisfies Descartes),
    );
  } catch {
    // Sin memoria donde anotarlo, el aviso vuelve a salir. Molesto, no roto.
  }
  avisar();
}

function tocaOfrecerlo(): boolean {
  const { veces, cuando } = leerDescartes();
  if (veces >= MAX_DESCARTES) return false;
  if (veces === 0) return true;
  return Date.now() - cuando > DIAS;
}

// Un solo valor primitivo que resume las tres preguntas: si ya está instalada,
// si toca ofrecerlo, y si Chrome nos dejó el botón de un toque.
//
// Devuelve un primitivo a propósito. useSyncExternalStore compara el resultado
// por valor en cada render, y un objeto nuevo cada vez es un bucle infinito.
export type EstadoAviso = "un-toque" | "pasos" | "oculto";

export function estadoDelAviso(): EstadoAviso {
  if (yaEstaInstalada()) return "oculto";
  if (!tocaOfrecerlo()) return "oculto";
  return diferido ? "un-toque" : "pasos";
}

// Antes de montar no hay navegador que preguntar, y "oculto" es la respuesta
// segura: la tira no existe, así que servidor y cliente no pueden discrepar.
// Mismo patrón que useIsMobile, y por el mismo motivo — ahí está escrito
// entero, incluido el fallo de hidratación que lo motivó.
export function estadoEnElServidor(): EstadoAviso {
  return "oculto";
}

// Suscripción vacía: el sistema operativo no cambia a mitad de sesión.
export function suscribirseANada() {
  return () => {};
}
