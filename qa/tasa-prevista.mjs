// No toca red ni base de datos: solo la regla de cuándo se ofrece la tasa
// prevista. Se puede correr en cualquier entorno y en cualquier día, que es
// justo el problema — el caso que importa (fin de semana con una tasa futura
// publicada) no se puede observar un martes.
import { tasaPrevistaDe, etiquetaDePrevista, tocaOfrecerPrevista } from "../lib/exchange-rate/tasa-prevista.ts";

let fallos = 0;
const check = (nombre, ok, detalle) => {
  if (!ok) fallos++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${nombre}${detalle ? "  — " + detalle : ""}`);
};

// El histórico real del 2026-09-13, tal cual lo devolvió ve.dolarapi.com.
const HIST = [
  { date: "2026-09-09", usd: 820.1018, eur: 954.02 },
  { date: "2026-09-10", usd: 827.7371, eur: 963.21 },
  { date: "2026-09-11", usd: 832.4883, eur: 968.0673 },
  { date: "2026-09-15", usd: 842.2067, eur: 977.88 },
];
// Caracas es UTC-4, así que a una hora de Caracas se le suman 4 para el UTC.
const caracas = (ymd, hora) => new Date(`${ymd}T${String(hora + 4).padStart(2, "0")}:00:00Z`);

const casos = [
  ["viernes 10 a.m. — todavia no",            "2026-09-11", 10, false],
  ["viernes 12 del mediodia — se abre",       "2026-09-11", 12, true],
  ["viernes 6 p.m.",                          "2026-09-11", 18, true],
  ["sabado",                                  "2026-09-12", 11, true],
  ["domingo (el caso del reporte)",           "2026-09-13", 16, true],
  ["lunes feriado, sin tasa propia",          "2026-09-14", 9,  true],
];
for (const [nombre, ymd, hora, esperado] of casos) {
  const r = tasaPrevistaDe(HIST, caracas(ymd, hora));
  check(nombre, Boolean(r) === esperado, r ? `ofrece ${r.fecha} · ${r.usd}` : "no ofrece");
}

// El martes 15 ya rige: deja de ser futura y el checkbox desaparece solo.
const conMartes = [...HIST];
check(
  "martes 15, ya vigente -> se apaga sola",
  tasaPrevistaDe(conMartes, caracas("2026-09-15", 10)) === null,
);

// Un miercoles normal, con tasa de hoy publicada y ninguna futura.
const normal = [{ date: "2026-09-16", usd: 845, eur: 980 }];
check("miercoles normal -> no aparece", tasaPrevistaDe(normal, caracas("2026-09-16", 15)) === null);

// Sabado sin tasa futura publicada todavia: no se inventa nada.
check("sabado sin prevista -> no aparece", tasaPrevistaDe(HIST.slice(0, 3), caracas("2026-09-12", 11)) === null);

// La mas cercana, no la ultima.
const dos = [...HIST, { date: "2026-09-16", usd: 850, eur: 990 }];
const cercana = tasaPrevistaDe(dos, caracas("2026-09-13", 16));
check("elige la mas cercana de las futuras", cercana?.fecha === "2026-09-15", cercana?.fecha);

// La etiqueta nombra el dia correcto sin calendario de feriados.
check("15 sep 2026 es martes", etiquetaDePrevista("2026-09-15") === "el martes 15 sep.", etiquetaDePrevista("2026-09-15"));
check("14 sep 2026 es lunes", etiquetaDePrevista("2026-09-14") === "el lunes 14 sep.", etiquetaDePrevista("2026-09-14"));

// tocaOfrecerPrevista es la MISMA regla, pero por la puerta que usa el
// formulario de fiado: ahi no hay historial, solo la fecha de la prevista y la
// de la vigente. Si las dos puertas se separaran, la casilla saldria en la
// calculadora y no en el formulario, o al reves.
check("formulario: domingo con prevista -> ofrece",
  tocaOfrecerPrevista("2026-09-15", "2026-09-11", caracas("2026-09-13", 16)) === true);
check("formulario: miercoles con tasa de hoy -> no ofrece",
  tocaOfrecerPrevista("2026-09-17", "2026-09-16", caracas("2026-09-16", 15)) === false);
check("formulario: viernes 10 a.m. -> todavia no",
  tocaOfrecerPrevista("2026-09-15", "2026-09-11", caracas("2026-09-11", 10)) === false);
check("formulario: sin prevista -> no ofrece",
  tocaOfrecerPrevista(null, "2026-09-11", caracas("2026-09-13", 16)) === false);
check("formulario: prevista ya vigente -> no ofrece",
  tocaOfrecerPrevista("2026-09-13", "2026-09-11", caracas("2026-09-13", 16)) === false);

// Las dos puertas tienen que coincidir siempre, no solo en los casos elegidos.
let discrepancias = 0;
for (const dia of ["2026-09-11", "2026-09-12", "2026-09-13", "2026-09-14", "2026-09-15"]) {
  for (const hora of [9, 12, 18]) {
    const cuando = caracas(dia, hora);
    const porHistorial = Boolean(tasaPrevistaDe(HIST, cuando));
    const vigente = [...HIST].filter((p) => p.date <= dia).sort((a, b) => b.date.localeCompare(a.date))[0];
    const proxima = [...HIST].filter((p) => p.date > dia).sort((a, b) => a.date.localeCompare(b.date))[0];
    const porFechas = tocaOfrecerPrevista(proxima?.date ?? null, vigente?.date ?? null, cuando);
    if (porHistorial !== porFechas) discrepancias++;
  }
}
check("las dos puertas coinciden en los 15 momentos probados", discrepancias === 0, `${discrepancias} discrepancias`);

console.log(`\n${fallos === 0 ? "TODO EN VERDE" : fallos + " FALLO(S)"}`);
process.exit(fallos === 0 ? 0 : 1);
