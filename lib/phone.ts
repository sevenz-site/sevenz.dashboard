import { COUNTRIES } from "@/lib/countries";

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
