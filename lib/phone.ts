import { COUNTRIES, splitPhoneNumber } from "@/lib/countries";

// Countries Sevenz has real numbers for: the two it operates in, plus the two
// its owners actually have clients in (a "Mj" ledger holds valid Peruvian and
// Chilean mobiles). ONLY these get normalized and length-checked.
//
// That restriction is the whole safety design. "Strip the leading zero" is
// correct here — in Venezuela, Colombia, Peru and Chile the 0 is a trunk
// prefix you dial inside the country and never part of the subscriber number,
// so 0414… and 414… are the same phone. It is WRONG in, say, Italy, where the
// 0 belongs to the landline number. Applying it globally would corrupt valid
// input, so an unlisted country is passed through untouched and unjudged.
// validPrefixes is only set where the national numbering plan is settled
// enough to be sure: Venezuela opens mobiles with 4 and landlines with 2,
// Colombia mobiles with 3 and landlines with 60. Peru and Chile get length
// checks only — their landline plans vary by region and a warning I am not
// certain about is worse than none, since it trains owners to ignore them.
//
// Without this, "1234567890" sails through: it is exactly 10 digits, and it
// is what one real ledger has stored as a client's phone.
const RULES: Record<string, { localLengths: number[]; validPrefixes?: RegExp }> = {
  "58": { localLengths: [10], validPrefixes: /^[24]/ }, // Venezuela
  "57": { localLengths: [10], validPrefixes: /^(3|60)/ }, // Colombia
  "51": { localLengths: [9] }, // Perú
  "56": { localLengths: [9] }, // Chile
};

export type PhoneCheck = {
  // The digits to store, after formatting. Never a guess: every rule below is
  // deterministic, and anything that can't be resolved by one is left exactly
  // as typed and reported instead.
  local: string;
  status: "ok" | "unknown" | "too-short" | "too-long" | "bad-prefix";
  expected: number | null;
};

export function normalizePhone(dialCode: string, raw: string): PhoneCheck {
  let digits = raw.replace(/\D/g, "");
  const rule = RULES[dialCode];

  // No opinion on countries we have no rules for — better silent than wrong.
  if (!rule) return { local: digits, status: "unknown", expected: null };

  // National trunk prefix. Dropped before the country-code check so that
  // "0584245401756" resolves the same as "584245401756".
  digits = digits.replace(/^0+/, "");

  // The owner typed the country code inside the field too, on top of picking
  // it from the selector. Only stripped when what remains is a valid length,
  // so a local number that happens to open with those digits survives.
  if (digits.startsWith(dialCode)) {
    const without = digits.slice(dialCode.length).replace(/^0+/, "");
    if (rule.localLengths.includes(without.length)) digits = without;
  }

  if (digits === "") return { local: "", status: "ok", expected: null };

  const expected = rule.localLengths[0];
  if (rule.localLengths.includes(digits.length)) {
    if (rule.validPrefixes && !rule.validPrefixes.test(digits)) {
      return { local: digits, status: "bad-prefix", expected };
    }
    return { local: digits, status: "ok", expected };
  }
  return {
    local: digits,
    status: digits.length < expected ? "too-short" : "too-long",
    expected,
  };
}

// Deliberately a warning, never a block: an owner mid-sale who doesn't have
// the client's full number to hand still has to be able to record the fiado.
// Saying nothing is what let seven unusable numbers pile up unnoticed.
export function phoneWarning(check: PhoneCheck, dialCode: string): string | null {
  if (check.status === "ok" || check.status === "unknown" || check.expected === null) {
    return null;
  }
  const country = COUNTRIES.find((c) => c.dialCode === dialCode);
  const where = country ? `de ${country.name}` : "";
  const tail = "Puedes guardarlo así, pero no vas a poder escribirle por WhatsApp.";

  if (check.status === "bad-prefix") {
    const shape = dialCode === "58" ? "por 4 (o por 2 si es fijo)" : "por 3 (o por 60 si es fijo)";
    return `Un número ${where} empieza ${shape}, y este empieza por ${check.local[0]}. ${tail}`;
  }
  return (
    `Un número ${where} tiene ${check.expected} dígitos y escribiste ${check.local.length}. ${tail}`
  );
}

// Las longitudes locales que conocemos, para quien necesite decidir si una
// cadena de dígitos ES ya un número completo de ese país.
export function localLengthsFor(dialCode: string): number[] | null {
  return RULES[dialCode]?.localLengths ?? null;
}

// CÓMO SE ABRE UN NÚMERO GUARDADO DENTRO DEL CAMPO, y por qué no basta con
// `splitPhoneNumber`.
//
// `splitPhoneNumber` parte un número por el prefijo de país más largo que
// encaje. Para algo ya guardado en forma internacional es correcto. Para una
// cadena en forma LOCAL es una trampa, porque casa prefijos por coincidencia:
//
//   "4149900094"  (móvil venezolano)  →  +41 Suiza  + "49900094"
//   "3001112233"  (móvil colombiano)  →  +30 Grecia + "01112233"
//
// Y eso acababa guardándose como "5849900094" y "571112233": números que no
// existen, con el prefijo del negocio pegado a un resto mutilado. Medido con
// `npm run qa:telefono` el 2026-10-10.
//
// Importa más desde la migración 081, que guarda el PERMISO de WhatsApp con el
// teléfono normalizado como CLAVE. Un permiso escrito bajo una clave rota no
// lo encuentra ningún envío: el tendero marca la casilla, la fila se escribe,
// y al cliente no le llega nada nunca. Sin un solo error por ninguna parte.
//
// El camino que lo hace probable es la libreta: la OCR lee lo que hay escrito
// en el cuaderno, y en un cuaderno eso es "0414-9900094".
//
// LA REGLA, en una frase: **un número completo del país del negocio gana a
// cualquier coincidencia de prefijo.** Solo si la cadena NO es un local válido
// se intenta leerla como internacional — que es cuando de verdad lo es.
export function splitForInput(
  stored: string,
  preferredDialCode?: string,
): { dialCode: string; local: string } {
  const clean = stored.replace(/\D/g, "");
  const sinTroncal = clean.replace(/^0+/, "");

  if (preferredDialCode) {
    const lengths = localLengthsFor(preferredDialCode);
    if (lengths?.includes(sinTroncal.length)) {
      return { dialCode: preferredDialCode, local: sinTroncal };
    }
  }

  const parsed = splitPhoneNumber(clean);
  return { dialCode: parsed.country.dialCode, local: parsed.local };
}

// ESPEJO EN JS DE `normalize_whatsapp_phone()` (migración 081).
//
// Devuelve la clave bajo la que se guardaría el permiso de WhatsApp de este
// número, o null si no serviría para nada. La regla de la base es
// deliberadamente tonta: quitar todo lo que no sea dígito, quitar el 0 de
// troncal, y aceptar entre 10 y 15 dígitos. Ni más listo ni más estricto.
//
// POR QUÉ HACE FALTA UNA COPIA AQUÍ. La pantalla tiene que saber, ANTES de
// enviar, si marcar la casilla del permiso va a servir de algo — y no puede
// preguntárselo a Postgres en cada tecla. Sin esto, `hasWhatsapp` era
// `Boolean(whatsapp.trim())`, una comprobación de PRESENCIA y no de validez.
//
// Lo que eso provocaba, medido contra producción el 2026-10-12: hay 20
// clientes reales cuyo teléfono guardado es "581", "582", "583" o "570" — un
// prefijo y un dígito suelto, de alguien que empezó a teclear y guardó. La
// base los normaliza a null, así que no se les puede escribir ni pueden
// consentir. Pero la casilla se veía perfectamente funcional, sin el aviso
// rojo, y marcarla devolvía `false` sin escribir nada y sin decir nada.
//
// DOS COPIAS DE UNA REGLA ACABAN DISCREPANDO, así que `qa:consent` compara
// esta función con la de Postgres sobre una lista de casos. Si alguien cambia
// una y no la otra, esa prueba lo dice.
// Y DISCREPARON, el 2026-10-21. La migración `136` hizo que la de Postgres
// CANONIZARA —un número nacional suelto cuya forma solo puede ser venezolana
// o colombiana sale con su indicativo delante, para que «04149900094» y
// «+584149900094» dejen de ser dos claves distintas— y esta se quedó atrás.
// `qa:consent` lo dijo en la primera corrida, que es para lo que estaba.
//
// Las ramas de abajo son la misma regla, en el mismo orden. Si una cambia,
// cambia la otra: la lista de casos de esa prueba es el único sitio donde se
// comparan, y lo hace sobre valores concretos y no sobre el parecido del
// código.
export function consentPhoneKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, "").replace(/^0+/, "");

  // Ya canónico: uno de los dos indicativos y diez dígitos nacionales. Va
  // primero para que canonizar lo ya canónico no le pegue otro indicativo.
  if (d.length === 12 && (d.startsWith("58") || d.startsWith("57"))) return d;

  // Venezuela: los cinco prefijos móviles, uno a uno, o un fijo que abre por
  // 2. Listados y no «empieza por 4» porque 404 y 415 son indicativos reales
  // de EE. UU. y la regla ancha archivaría uno de allí como venezolano.
  if (d.length === 10 && (["412", "414", "416", "424", "426"].includes(d.slice(0, 3)) || d.startsWith("2"))) {
    return `58${d}`;
  }

  // Colombia: cualquier móvil 3xx, o un fijo 60x.
  if (d.length === 10 && (d.startsWith("3") || d.startsWith("60"))) return `57${d}`;

  // Y lo que no se puede situar se queda exactamente como estaba, que es el
  // contrato de siempre: adivinar mal fusiona a dos personas en una clave y
  // no adivinar solo repite lo de ayer.
  return d.length >= 10 && d.length <= 15 ? d : null;
}

// EL TELÉFONO SE LEE, NO SE DESCIFRA.
//
// Lo que viaja es la cadena combinada de `WhatsappInput`: dígitos pegados,
// «584148889977». Doce dígitos seguidos no se comprueban de un vistazo — hay
// que contarlos— y las pantallas que enseñan los datos de alguien existen
// justo para que los compruebe.
//
// Se separa con `splitForInput`, que es la misma función que usa el campo para
// abrir un número guardado. No se parte a mano por longitud: la migración 073
// documenta lo que cuesta — un móvil venezolano «4149900094» se leía como
// +41 Suiza.
//
// VIVÍA DENTRO DE `components/public/cart-screen.tsx` hasta el 2026-10-18, y
// se mudó aquí el día que el resumen de una venta tuvo que enseñar lo mismo en
// la pantalla Y en la imagen que se comparte. Tres copias de una misma forma
// de leer un número acaban enseñando tres números distintos para el mismo
// cliente, que es la clase de diferencia que nadie reporta y todos notan.
export function telefonoLegible(combinado: string): string {
  const { dialCode, local } = splitForInput(combinado);
  if (local === "") return combinado;
  // OPERADORA Y NÚMERO: los tres primeros dígitos aparte y el resto junto.
  // Es como se dice un móvil en los dos países donde Sevenz opera — «412
  // 1234567», «300 1112233» — y no un troceado mecánico.
  //
  // La primera versión partía de tres en tres y dejaba «412 123 456 7», con
  // un dígito suelto al final. Se vio en pantalla, no leyendo el código.
  if (local.length <= 3) return `+${dialCode} ${local}`;
  return `+${dialCode} ${local.slice(0, 3)} ${local.slice(3)}`;
}
