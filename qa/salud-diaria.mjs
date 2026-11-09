// SIN BASE DE DATOS. No escribe nada.
//
// PL-28: the daily check (`/api/cron/rate-health`) also fails when the WhatsApp
// cron stops. This checks the verdict and what reaches the PUBLIC workflow log,
// case by case, without calling the route — which would also run the held-rate
// WhatsApp alert.
import { cronForLog, dailyVerdict } from "../lib/admin/daily-health.ts";

let fallos = 0;
let pasan = 0;
function check(nombre, ok, detalle = "") {
  if (ok) pasan++;
  else fallos++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${nombre}${detalle ? `  — ${detalle}` : ""}`);
}

const tasaBien = { status: "ok", detail: "La tasa está al día." };
const tasaMal = { status: "fail", detail: "El euro lleva 30 h retenido." };
const tasaAviso = { status: "warn", detail: "Una fuente no respondió." };
const cron = (o) => ({
  ultimaCorrida: "2026-11-09T13:04:00Z",
  horasDesdeUltima: 2,
  ultimoDiaIso: 1,
  resumen: { enviados: 7, destinatarios: 9 },
  atencion: null,
  ultimoError: null,
  corridas7d: 7,
  corridasConError7d: 0,
  enviados7d: 31,
  fallidos7d: 0,
  estado: "ok",
  detalle: "hace 2 h",
  ...o,
});

const casos = [
  ["todo bien → verde", tasaBien, cron({}), false],
  ["tasa caída, cron bien → rojo", tasaMal, cron({}), true],
  ["cron 28 h sin correr → rojo", tasaBien, cron({ horasDesdeUltima: 28, estado: "fail" }), true],
  ["cron nunca corrió → rojo", tasaBien, cron({ horasDesdeUltima: null, ultimaCorrida: null, estado: "fail", detalle: "nunca se ha disparado" }), true],
  ["última corrida con error → rojo", tasaBien, cron({ ultimoError: "boom 584121112233", estado: "fail" }), true],
  ["no se pudo leer el latido → rojo", tasaBien, cron({ horasDesdeUltima: null, ultimaCorrida: null, estado: "fail", detalle: "no pudimos leer el estado del cron" }), true],
  ["envíos fallidos en la semana (warn) → NO rojo", tasaBien, cron({ fallidos7d: 3, estado: "warn" }), false],
  ["tasa en aviso (warn) → NO rojo", tasaAviso, cron({}), false],
  ["las dos caídas → rojo", tasaMal, cron({ horasDesdeUltima: 50, estado: "fail" }), true],
];
for (const [nombre, tasa, c, esperado] of casos) {
  const v = dailyVerdict(tasa, c);
  check(nombre, v.failed === esperado, v.detail);
}

check(
  "leer mal el latido no se confunde con «nunca se ha disparado»",
  dailyVerdict(tasaBien, cron({ horasDesdeUltima: null, ultimaCorrida: null, estado: "fail", detalle: "no pudimos leer el estado del cron" })).detail ===
    "Cron de WhatsApp: no pudimos leer el estado del cron.",
);
const dos = dailyVerdict(tasaMal, cron({ horasDesdeUltima: 50, estado: "fail" }));
check("con las dos caídas, el detalle nombra las dos", dos.detail.includes("euro") && dos.detail.includes("WhatsApp"));
check(
  "con la tasa bien y el cron caído, el detalle es el del cron",
  dailyVerdict(tasaBien, cron({ horasDesdeUltima: 28, estado: "fail" })).detail.startsWith("Cron de WhatsApp"),
);

// What the public log gets.
const log = cronForLog(cron({ ultimoError: "boom 584121112233 Bodega X", estado: "fail", fallidos7d: 4 }));
const texto = JSON.stringify(log);
check("el registro público no lleva el texto del error", !texto.includes("boom") && !texto.includes("5841"));
check("ni contadores de envíos", !/enviad|fallid|destinat|7d|31/.test(texto), texto);
check("solo estado, fecha, horas y si falló", Object.keys(log).sort().join(",") === "hours_since_last,last_run,last_run_failed,status");
check("las horas van redondeadas", cronForLog(cron({ horasDesdeUltima: 25.6 })).hours_since_last === 26);
const detalleConError = dailyVerdict(tasaBien, cron({ ultimoError: "boom 584121112233", estado: "fail" })).detail;
check("el detalle de GitHub tampoco lleva el error", !detalleConError.includes("5841"), detalleConError);

console.log(`\n${pasan}/${pasan + fallos} pasan.`);
process.exit(fallos ? 1 : 0);
