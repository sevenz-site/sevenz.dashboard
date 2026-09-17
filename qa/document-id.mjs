// The document field's shape rules, pinned down.
//
// Needs no database and no browser: these are pure functions, and they decide
// something that is expensive to get wrong. A document typed as "E-12345678"
// must NOT be quietly reshaped into "V-12345678" — that is changing a person's
// nationality because someone opened a dialog — and a Colombian record must
// never grow a "V-" it does not have.
//
// Added 2026-09-17 alongside the prefixed field. The browser automation could
// not deliver real keystrokes to that input, so this is what actually covers
// the rules; the rendering was checked by driving React's own change events.

import { composeDocumentId, parseDocumentId } from "../lib/document-id.ts";
import { formatDocumentId } from "../lib/format.ts";

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

// ── Venezuela ───────────────────────────────────────────────────────────
check("VE empty", parseDocumentId("", "VE"), { digits: "", legacy: false });
check("VE prefixed", parseDocumentId("V-12345678", "VE"), { digits: "12345678", legacy: false });
check("VE lowercase prefix", parseDocumentId("v-12345678", "VE"), { digits: "12345678", legacy: false });
check("VE no dash", parseDocumentId("V12345678", "VE"), { digits: "12345678", legacy: false });

// Legacy, on purpose: a VE record stored as bare digits predates the rule, and
// adding the prefix on open would be a silent rewrite of a real person's data.
check("VE bare digits is legacy", parseDocumentId("12345678", "VE"), { digits: "", legacy: true });

// The one this suite exists for.
check("VE foreigner E- is legacy", parseDocumentId("E-12345678", "VE"), { digits: "", legacy: true });

check("VE dotted is legacy", parseDocumentId("12.345.678", "VE"), { digits: "", legacy: true });
check("VE junk is legacy", parseDocumentId("pendiente", "VE"), { digits: "", legacy: true });
check("VE compose", composeDocumentId("12345678", "VE"), "V-12345678");
check("VE compose empty stays empty", composeDocumentId("", "VE"), "");

// ── Colombia ────────────────────────────────────────────────────────────
check("CO digits", parseDocumentId("12345678", "CO"), { digits: "12345678", legacy: false });
check("CO never takes V-", parseDocumentId("V-12345678", "CO"), { digits: "", legacy: true });
check("CO dotted is legacy", parseDocumentId("12.345.678", "CO"), { digits: "", legacy: true });
check("CO compose has no prefix", composeDocumentId("12345678", "CO"), "12345678");

// ── How it reads on screen ──────────────────────────────────────────────
check("format VE groups after the prefix", formatDocumentId("V-12345678"), "V-12.345.678");
check("format CO groups", formatDocumentId("12345678"), "12.345.678");
check("format leaves a legacy value alone", formatDocumentId("12.345.678"), "12.345.678");
check("format leaves junk alone", formatDocumentId("pendiente"), "pendiente");

console.log("");
console.log(failed === 0 ? `ALL GREEN (${passed}/${passed + failed})` : `FAILURES: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
