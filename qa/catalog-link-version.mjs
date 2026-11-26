// The catalogue link changes with the logo (lib/catalog/link-version.ts). Pure, no network.
import { logoVersion, withLogoVersion } from "../lib/catalog/link-version.ts";

const a = "ce68896a/logo-1793462817611.jpg";
const b = "ce68896a/logo-1793462999999.jpg";
const cases = [
  ["Sin logo, el enlace de siempre", withLogoVersion("https://x/c/tok", null) === "https://x/c/tok" && withLogoVersion("https://x/c/tok", "") === "https://x/c/tok"],
  ["Con logo, lleva ?v=", /^https:\/\/x\/c\/tok\?v=[0-9a-z]{1,7}$/.test(withLogoVersion("https://x/c/tok", a))],
  ["El mismo logo, el mismo enlace", withLogoVersion("/c/t", a) === withLogoVersion("/c/t", a)],
  ["Otro logo, otro enlace", logoVersion(a) !== logoVersion(b)],
  ["Si ya lleva parámetros, añade con &", withLogoVersion("/c/t/vista-previa?x=1", a).startsWith("/c/t/vista-previa?x=1&v=")],
];
let fails = 0;
for (const [name, ok] of cases) {
  console.log(`${ok ? "✅" : "❌"} ${name}`);
  if (!ok) fails++;
}
console.log(fails ? `\n${fails} fallo(s).` : `\n${cases.length}/${cases.length} bien.`);
process.exit(fails ? 1 : 0);
