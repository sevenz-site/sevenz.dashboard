// NO HABLA CON NINGUNA BASE DE DATOS. Lógica pura.
//
// QUÉ PUEDE PREGUNTAR EL BUSCADOR DE INICIO COMO CÓDIGO DE TRANSACCIÓN — encargo
// del dueño el 2026-10-30. Lo que esta suite protege es el borde que importa:
// que escribir el NOMBRE de un cliente no dispare una búsqueda de transacciones,
// y que escribir un código tal como lo dicta alguien (minúsculas, guion, una O
// por un cero) sí encuentre lo que se busca.

import { normalizePartialCode } from "../lib/transaction-code.ts";

let fallos = 0;
function check(nombre, obtenido, esperado) {
  const pasa = obtenido === esperado;
  if (!pasa) fallos++;
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}  — ${JSON.stringify(obtenido)}${pasa ? "" : ` (esperaba ${JSON.stringify(esperado)})`}`);
}

// ── LO QUE SÍ ES UN CÓDIGO ──────────────────────────────────────────────
check("un código entero", normalizePartialCode("ABCD123"), "ABCD123");
check("minúsculas", normalizePartialCode("abcd123"), "ABCD123");
check("con guion", normalizePartialCode("ABCD-123"), "ABCD123");
check("con espacios", normalizePartialCode("  abcd 123 "), "ABCD123");
check("solo las cuatro letras ya busca", normalizePartialCode("ABCD"), "ABCD");
check("a medio escribir", normalizePartialCode("ABCD1"), "ABCD1");

// ── LO QUE NO LO ES: NOMBRES, Y LO QUE NO CABE ──────────────────────────
check("«Pedro» es un cliente, no un código", normalizePartialCode("Pedro"), null);
check("«Mara» tiene cuatro letras del alfabeto y SÍ puede ser el inicio de uno", normalizePartialCode("Mara"), "MARA");
check("«Mari» no: la I no está en el alfabeto", normalizePartialCode("Mari"), null);
check("«Mario» tampoco: ni cinco letras ni una O", normalizePartialCode("Mario"), null);
check("una O tecleada en lugar de un cero no se adivina", normalizePartialCode("ABCDO12"), null);
check("«Maria» (cinco letras) no puede serlo", normalizePartialCode("Maria"), null);
check("tres letras no bastan", normalizePartialCode("ABC"), null);
check("vacío", normalizePartialCode(""), null);
check("de más de siete", normalizePartialCode("ABCD1234"), null);
check("un documento de identidad no es un código", normalizePartialCode("V-12345678"), null);
check("una I entre las cuatro letras no existe en el alfabeto", normalizePartialCode("ABIC123"), null);
check("una O entre las cuatro letras tampoco", normalizePartialCode("OBCD123"), null);
check("letras después de los dígitos", normalizePartialCode("ABCD1A3"), null);

console.log(fallos === 0 ? "\nTODO PASA" : `\n${fallos} FALLO(S)`);
process.exit(fallos === 0 ? 0 : 1);
