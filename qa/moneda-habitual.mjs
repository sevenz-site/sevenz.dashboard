// A que moneda abre el formulario, y cuando la costumbre NO manda.
//
// Existe porque este es el unico sitio donde una preferencia de comodidad toca
// el dinero: si la costumbre ganara siempre, un abono se abriria en el libro
// equivocado y el dueño veria "Maximo 0,00" en un cliente que si debe.
import { libroParaAbono } from "../lib/moneda-habitual.ts";

let fallos = 0;
const check = (nombre, ok, detalle) => {
  if (!ok) fallos++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${nombre}${detalle ? "  — " + detalle : ""}`);
};

// La deuda manda sobre la costumbre.
check("suele euros pero solo debe dolares -> dolares",
  libroParaAbono("EUR", 55, 0) === "USD");
check("suele dolares pero solo debe euros -> euros",
  libroParaAbono("USD", 0, 40) === "EUR");

// La costumbre solo desempata.
check("debe en las dos y suele euros -> euros",
  libroParaAbono("EUR", 55, 40) === "EUR");
check("debe en las dos y suele dolares -> dolares",
  libroParaAbono("USD", 55, 40) === "USD");

// Sin costumbre que desempatar, el que tenga deuda.
check("sin deuda en la preferida y solo euros -> euros",
  libroParaAbono("USD", 0, 0.01) === "EUR");

// Cero no es deuda. Un saldo en cero abriria un abono de cero.
check("cero no cuenta como deuda", libroParaAbono("USD", 0, 0) === "USD");
check("negativo tampoco (el cliente tiene saldo a favor)",
  libroParaAbono("EUR", 12, -5) === "USD");

// Idempotente: aplicarlo dos veces no cambia nada.
const una = libroParaAbono("EUR", 55, 0);
check("aplicarlo dos veces da lo mismo", libroParaAbono(una, 55, 0) === una, una);

console.log(`\n${fallos === 0 ? "TODO EN VERDE" : fallos + " FALLO(S)"}`);
process.exit(fallos === 0 ? 0 : 1);
