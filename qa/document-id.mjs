// The document field's shape rules, pinned down.
//
// Needs no database and no browser: these are pure functions, and they decide
// something that is expensive to get wrong. A value with letters in it — a
// foreign "E-12345678", or a shopkeeper's "pendiente" — must never be reshaped
// into digits, because saving the form would then drop what it says.
//
// Added 2026-09-17. The stored value is digits and nothing else — the "V-" a
// Venezuelan shopkeeper sees is printed beside the box and never saved.

import { parseDocumentId } from "../lib/document-id.ts";
import { formatDocumentId, normalizeDocumentId } from "../lib/format.ts";

let passed = 0;
let failed = 0;

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) {
    console.log(`PASS  ${name} — ${a}`);
    passed++;
  } else {
    console.log(`FAIL  ${name} — got ${a}, expected ${b}`);
    failed++;
  }
}

// ── What the digits box shows ───────────────────────────────────────────
check("empty", parseDocumentId(""), { digits: "", legacy: false });

// 154 of the 158 documents in production are exactly this, and they are
// already in the right shape: the field stores digits and nothing else.
check("bare digits", parseDocumentId("12345678"), { digits: "12345678", legacy: false });

// Punctuation is how someone typed it, not a defect.
check("dotted", parseDocumentId("12.345.678"), { digits: "12345678", legacy: false });
check("spaced", parseDocumentId("12 345 678"), { digits: "12345678", legacy: false });

// The two this suite exists for. A value with letters is never reshaped:
// dropping the E from "E-12345678" on a save loses a real fact about a person.
check("foreigner E- is legacy", parseDocumentId("E-12345678"), { digits: "", legacy: true });
check("a stored V- is legacy", parseDocumentId("V-12345678"), { digits: "", legacy: true });
check("junk is legacy", parseDocumentId("pendiente"), { digits: "", legacy: true });
check("junk with digits is legacy", parseDocumentId("pendiente 123"), { digits: "", legacy: true });

// ── How it reads on screen ──────────────────────────────────────────────
check("groups digits", formatDocumentId("12345678"), "12.345.678");
check("leaves a dotted value alone", formatDocumentId("12.345.678"), "12.345.678");
check("leaves junk alone", formatDocumentId("pendiente"), "pendiente");

// ── Duplicate detection ─────────────────────────────────────────────────
//
// New records are digits, so they compare directly. This still has to reach
// the ones stored before the rule, which carry dots and spaces.
const same = (a, b) => normalizeDocumentId(a) === normalizeDocumentId(b);

check("dotted matches bare digits", same("12.345.678", "12345678"), true);
check("spaced matches bare digits", same("12 345 678", "12345678"), true);
check("two identical records match", same("12345678", "12345678"), true);
check("different people differ", same("12345678", "87654321"), false);

// A letter still counts, so a legacy "E-" is NOT mistaken for the bare number.
check("E- does not collide with bare digits", same("E-12345678", "12345678"), false);

console.log("");
console.log(failed === 0 ? `ALL GREEN (${passed}/${passed + failed})` : `FAILURES: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
