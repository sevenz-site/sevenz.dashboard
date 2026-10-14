// No toca la base de datos. Son funciones puras.
//
// GARANTIZA QUE TODO NUMERO QUE LLEGA A LA BASE VA EN FORMA INTERNACIONAL.
//
// Por que esto merece su propia suite, y no es paranoia: desde la migracion
// 081 el PERMISO de WhatsApp se guarda con el telefono normalizado como CLAVE.
// Un numero guardado en forma local y el mismo numero en forma internacional
// son DOS claves distintas:
//
//   normalize_whatsapp_phone('04149900094')   -> '4149900094'
//   normalize_whatsapp_phone('584149900094')  -> '584149900094'
//
// La funcion de Postgres quita el 0 de troncal pero no puede adivinar el
// prefijo de pais, y hace bien en no inventarselo. O sea que la garantia
// tiene que estar AGUAS ARRIBA: lo que se guarda ya viene con su prefijo.
//
// Si se rompe, el sintoma es el peor posible: un permiso guardado bajo una
// clave que ningun envio consulta. Nadie ve un error. El tendero marca la
// casilla, la fila se escribe, y al cliente no le llega nada nunca.
//
// EL CAMINO QUE LO HACE PROBABLE es la libreta: la OCR lee lo que hay escrito
// en un cuaderno, y en un cuaderno venezolano eso es "0414-9900094".

import { normalizePhone, splitForInput } from "@/lib/phone";
import { splitPhoneNumber } from "@/lib/countries";

const filas = [];
function check(nombre, pasa, detalle) {
  filas.push({ nombre, pasa });
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${detalle ? `  — ${detalle}` : ""}`);
}

// Reproduce lo que hace WhatsappInput: elige el prefijo y normaliza la parte
// local. Lo que devuelve es EXACTAMENTE lo que el formulario manda a guardar.
function loQueSeGuarda(valorPrellenado, prefijoPreferido) {
  const parsed = valorPrellenado ? splitForInput(valorPrellenado, prefijoPreferido) : null;
  const dialCode = parsed?.dialCode ?? prefijoPreferido;
  const check = normalizePhone(dialCode, parsed?.local ?? "");
  return check.local ? `${dialCode}${check.local}` : "";
}

// ── 1. Un numero ya internacional se respeta ──────────────────────────────
check(
  "1a. 584149900094 con negocio VE se guarda igual",
  loQueSeGuarda("584149900094", "58") === "584149900094",
  loQueSeGuarda("584149900094", "58"),
);
check(
  "1b. 573001112233 con negocio CO se guarda igual",
  loQueSeGuarda("573001112233", "57") === "573001112233",
  loQueSeGuarda("573001112233", "57"),
);

// ── 2. EL CASO DE LA LIBRETA: formato local ──────────────────────────────
//
// Lo que la OCR lee de un cuaderno venezolano. Antes de arreglarlo esto daba
// 574149900094 -- un movil venezolano guardado como colombiano -- porque
// splitPhoneNumber NUNCA devolvia "no se": siempre caia en Colombia, y ese
// fallback pisaba el prefijo del negocio sin que nadie lo mirara.
check(
  "2a. 04149900094 (local VE) en un negocio VE se guarda como 584149900094",
  loQueSeGuarda("04149900094", "58") === "584149900094",
  loQueSeGuarda("04149900094", "58"),
);
check(
  "2b. 4149900094 (sin 0 ni pais) en un negocio VE tambien",
  loQueSeGuarda("4149900094", "58") === "584149900094",
  loQueSeGuarda("4149900094", "58"),
);
check(
  "2c. 3001112233 (local CO) en un negocio CO se guarda como 573001112233",
  loQueSeGuarda("3001112233", "57") === "573001112233",
  loQueSeGuarda("3001112233", "57"),
);
check(
  "2d. 03001112233 (con troncal) en un negocio CO tambien",
  loQueSeGuarda("03001112233", "57") === "573001112233",
  loQueSeGuarda("03001112233", "57"),
);

// ── 3. La forma local y la internacional dan LA MISMA clave ──────────────
//
// Es la propiedad que de verdad importa, dicha sin rodeos: si estas dos no
// coinciden, Pedro acaba con dos permisos segun como lo tecleara el tendero,
// y el que no se encuentre se traduce en silencio.
for (const [a, b, pref] of [
  ["04149900094", "584149900094", "58"],
  ["4149900094", "+58 414-9900094", "58"],
  ["03001112233", "573001112233", "57"],
]) {
  check(
    `3. "${a}" y "${b}" acaban en la misma clave`,
    loQueSeGuarda(a, pref) === loQueSeGuarda(b, pref),
    `${loQueSeGuarda(a, pref)} vs ${loQueSeGuarda(b, pref)}`,
  );
}

// ── 4. Lo que NO se debe tocar ───────────────────────────────────────────
//
// splitPhoneNumber sigue partiendo un numero guardado por su prefijo, que es
// para lo que existe. Un numero mexicano guardado hace tiempo tiene que
// seguir abriendose como mexicano y no reescribirse al prefijo del negocio.
const mx = splitPhoneNumber("525512345678");
check(
  "4a. splitPhoneNumber sigue partiendo un internacional por su prefijo",
  mx.country.dialCode === "52" && mx.local === "5512345678",
  `${mx.country.dialCode} + ${mx.local}`,
);
check(
  "4b. y el movil venezolano YA NO se lee como suizo (+41)",
  splitForInput("4149900094", "58").dialCode === "58",
  `antes: +${splitPhoneNumber("4149900094").country.dialCode}, ahora: +${splitForInput("4149900094", "58").dialCode}`,
);
check(
  "4c. un numero mexicano guardado NO se reescribe al prefijo del negocio",
  loQueSeGuarda("525512345678", "58") === "525512345678",
  loQueSeGuarda("525512345678", "58"),
);

// ── 5. Vacio es vacio, nunca un prefijo suelto ───────────────────────────
//
// Guardar "58" a secas seria un numero inventado, y la 081 lo rechazaria por
// longitud -- pero dejaria una ficha pareciendo que tiene telefono.
check("5a. sin valor no se guarda nada", loQueSeGuarda(null, "58") === "");
check("5b. una cadena vacia tampoco", loQueSeGuarda("", "58") === "");

const fallos = filas.filter((f) => !f.pasa).length;
console.log(`\n${filas.length - fallos}/${filas.length} pasan.`);
if (fallos) process.exitCode = 1;
