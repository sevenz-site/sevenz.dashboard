import type { ExtractedMovement } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────
// LA REVISIÓN SOBREVIVE A UNA RECARGA
//
// Hasta el 2026-10-01 el estado de la revisión vivía solo en memoria: recargar
// la pantalla lo perdía entero. Media hora corrigiendo treinta movimientos,
// escribiendo cédulas y decidiendo duplicados, y basta un roce al botón de
// recargar. En iOS no hace falta ni eso: el navegador recicla pestañas en
// segundo plano por su cuenta.
//
// POR QUÉ `sessionStorage` Y NO `localStorage`. `localStorage` no caduca, así
// que una revisión abandonada hace tres semanas reaparecería al abrir la app
// con datos viejos encima de una cartera que ya cambió — y el dueño no tiene
// forma de saber de cuándo son. `sessionStorage` muere con la pestaña, que es
// exactamente el alcance que esto quiere: sobrevivir a una recarga, no a un
// olvido.
//
// LAS FOTOS NO SE GUARDAN, y hay que decirlo porque cambia lo que se recupera.
// Son megabytes y el almacén son ~5 MB. Al volver, el trabajo manual está —las
// correcciones, las decisiones, los quitados— pero la tira de fotos sale vacía
// y el contador de "de N fotos analizadas" dice cero. Lo caro era el trabajo
// manual; releer la foto cuesta cuota, pero se puede.
//
// TODO VA EN try/catch. En modo privado, con el almacenamiento bloqueado o con
// la cuota llena, `sessionStorage` LANZA en vez de devolver null. Una pantalla
// que se cae por no poder guardar un borrador sería mucho peor que una que no
// lo guarda.

const CLAVE = "sevenz:revision-libreta";
// Una revisión no se arrastra más de un día ni dentro de la misma pestaña. Una
// pestaña puede vivir abierta una semana, y recuperar a esas alturas es
// recuperar algo que el dueño ya no reconoce.
const MAX_HORAS = 24;
// Si la forma cambia, lo viejo se tira en vez de reventar al leerlo.
const VERSION = 1 as const;

// Lo guardado puede venir de antes de CT-29 ("mismo" | "otra" en texto plano) o
// de después ({ cual, clientId }). `import-flow` convierte al leerlo: "otra"
// sigue valiendo, y un "mismo" viejo se descarta porque no dice CON CUÁL.
export type DecisionDuplicadoGuardada =
  | "mismo"
  | "otra"
  | { cual: "otra" }
  | { cual: "mismo"; clientId: string };

export type RevisionGuardada = {
  version: typeof VERSION;
  guardadaEn: number;
  // Si el dueno llego a ABRIR la revision, o solo se leyo la foto.
  //
  // CT-26: desde el 2026-10-01 tambien se guarda en cuanto termina la lectura,
  // antes de tocar "Ver resultados". Esa ventana es corta pero es donde la cuota
  // ya se gasto y nada estaba guardado: recargar ahi —o que iOS recicle la
  // pestana— obligaba a subir la foto otra vez y a pagar una segunda peticion
  // por la misma pagina.
  //
  // Hace falta distinguirlas porque el aviso MIENTE si no: "dejaste una revision
  // a medias, las correcciones siguen ahi" es falso de cabo a rabo cuando no
  // hubo revision ni correcciones.
  //
  // Un borrador viejo sin este campo se lee como `true`: en la version 1 solo se
  // escribia con la revision abierta, asi que es lo que era.
  revisada: boolean;
  movimientos: ExtractedMovement[];
  eliminados: string[];
  clientesQuitados: Record<string, string[]>;
  decisiones: Record<string, DecisionDuplicadoGuardada>;
  // Se guarda como viene: `cual`, `escrito` y `calculado`. Las cifras que se
  // enseñan salen del libro sombra, no de aquí (ver import-flow), así que esto
  // solo sirve para recordar QUÉ se eligió y poder avisar si el ajuste cambió.
  decisionesDeTotal: Record<string, unknown>;
  subidos: string[];
  sameClient: boolean;
  sharedName: string;
  sharedDocument: string;
  sharedWhatsapp: string;
  unlinked: string[];
};

// El almacén se inyecta para poder probar esto desde Node, donde no hay
// `sessionStorage`. En la app no se pasa nada y usa el del navegador.
export type Almacen = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function almacenDelNavegador(): Almacen | null {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function guardarRevision(r: Omit<RevisionGuardada, "version" | "guardadaEn">, almacen?: Almacen | null): void {
  const a = almacen ?? almacenDelNavegador();
  if (!a) return;
  try {
    const completa: RevisionGuardada = { ...r, version: VERSION, guardadaEn: Date.now() };
    a.setItem(CLAVE, JSON.stringify(completa));
  } catch {
    // Cuota llena o almacenamiento bloqueado. Se sigue sin borrador: es peor
    // tirar la pantalla que no poder guardarlo.
  }
}

export function olvidarRevision(almacen?: Almacen | null): void {
  const a = almacen ?? almacenDelNavegador();
  if (!a) return;
  try {
    a.removeItem(CLAVE);
  } catch {
    // Igual que arriba.
  }
}

// Lo guardado, o null si no hay, si no se puede leer, si es de otra versión, si
// está caducado o si no tiene movimientos. Nunca lanza.
export function cargarRevision(ahora = Date.now(), almacen?: Almacen | null): RevisionGuardada | null {
  const a = almacen ?? almacenDelNavegador();
  if (!a) return null;
  let crudo: string | null = null;
  try {
    crudo = a.getItem(CLAVE);
  } catch {
    return null;
  }
  if (!crudo) return null;

  let p: Partial<RevisionGuardada>;
  try {
    p = JSON.parse(crudo) as Partial<RevisionGuardada>;
  } catch {
    // Un blob corrupto se tira: dejarlo haría fallar todas las cargas
    // siguientes de esta pestaña.
    olvidarRevision(a);
    return null;
  }

  if (p.version !== VERSION) {
    olvidarRevision(a);
    return null;
  }
  if (typeof p.guardadaEn !== "number" || ahora - p.guardadaEn > MAX_HORAS * 60 * 60 * 1000) {
    olvidarRevision(a);
    return null;
  }
  // Sin movimientos no hay nada que recuperar, y entrar en la revisión con una
  // lista vacía deja una pantalla que solo sabe decir "pulsa Volver".
  if (!Array.isArray(p.movimientos) || p.movimientos.length === 0) {
    olvidarRevision(a);
    return null;
  }

  return {
    version: VERSION,
    guardadaEn: p.guardadaEn,
    revisada: p.revisada !== false,
    movimientos: p.movimientos,
    eliminados: Array.isArray(p.eliminados) ? p.eliminados : [],
    clientesQuitados: p.clientesQuitados ?? {},
    decisiones: p.decisiones ?? {},
    decisionesDeTotal: p.decisionesDeTotal ?? {},
    subidos: Array.isArray(p.subidos) ? p.subidos : [],
    sameClient: Boolean(p.sameClient),
    sharedName: typeof p.sharedName === "string" ? p.sharedName : "",
    sharedDocument: typeof p.sharedDocument === "string" ? p.sharedDocument : "",
    sharedWhatsapp: typeof p.sharedWhatsapp === "string" ? p.sharedWhatsapp : "",
    unlinked: Array.isArray(p.unlinked) ? p.unlinked : [],
  };
}
