// El texto que sale de la app cuando el dueño comparte un movimiento.
//
// Existe porque este texto aterriza en el WhatsApp de un cliente y se queda
// ahi. No es una pantalla que se puede corregir recargando: es un papel escrito
// que alguien va a citar en una discusion sobre lo que debe.
import { textoParaCompartir } from "../lib/movement-share.ts";

let fallos = 0;
const check = (nombre, ok, detalle) => {
  if (!ok) fallos++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${nombre}${detalle ? "  — " + detalle : ""}`);
};

const completo = {
  tipo: "charge",
  fecha: "14 sept. 2026",
  monto: "Bs. 900,00",
  equivalente: "$1,08",
  tasa: "$1 = Bs. 832,49",
  plazo: "7 días",
  detalle: "Dos panes y una leche",
  saldoEtiqueta: "Por cobrar",
  saldo: "$1,08",
};

const t = textoParaCompartir(completo);
console.log("---\n" + t + "\n---");

// Ninguna cifra puede perderse por el camino: cada una que entra, sale.
for (const [campo, valor] of Object.entries(completo)) {
  if (campo === "tipo") continue;
  check(`"${valor}" aparece en el mensaje`, t.includes(valor), campo);
}

check("un cargo se llama cargo", t.startsWith("Cargo (fía)"));
check("un abono se llama abono",
  textoParaCompartir({ ...completo, tipo: "payment" }).startsWith("Abono (paga)"));

// El saldo va el ultimo y separado: es lo que el cliente busca primero.
check("el saldo cierra el mensaje", t.trimEnd().endsWith("Por cobrar: $1,08"));
check("y va separado del resto", t.includes("\n\nPor cobrar:"));

// Un negocio colombiano no tiene tasa ni equivalente. Esas lineas no salen en
// blanco: no salen.
const cop = textoParaCompartir({
  ...completo,
  monto: "$ 50.000",
  equivalente: null,
  tasa: null,
  detalle: null,
  saldo: "$ 50.000",
});
console.log("---\n" + cop + "\n---");
check("sin tasa no hay linea de tasa", !cop.includes("Tasa"));
check("sin equivalente no hay linea de equivalente", !cop.includes("Equivalente"));
check("sin detalle no hay linea de detalle", !cop.includes("Detalle"));
check("pero el monto y el saldo siguen ahi",
  cop.includes("Monto: $ 50.000") && cop.includes("Por cobrar: $ 50.000"));

// Ninguna linea puede quedar a medias, del tipo "Detalle: " sin nada detras.
const vacio = textoParaCompartir({
  tipo: "payment", fecha: "1 ene. 2026", monto: "$1,00",
  equivalente: null, tasa: null, plazo: null, detalle: null,
  saldoEtiqueta: "Sin deuda", saldo: "$0,00",
});
check("ninguna linea acaba en dos puntos vacios",
  !vacio.split("\n").some((l) => l.trimEnd().endsWith(":")), JSON.stringify(vacio));

console.log(`\n${fallos === 0 ? "TODO EN VERDE" : fallos + " FALLO(S)"}`);
process.exit(fallos === 0 ? 0 : 1);
