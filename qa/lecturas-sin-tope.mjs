// SIN BASE DE DATOS. Un segundo. PL-34, paso 6.
//
// FAILS IF A READ OVER A TABLE THAT GROWS WITH THE BUSINESS HAS NO BOUND.
//
// The Data API returns 1,000 rows at most and says nothing when it cuts. On 2026-11-09
// Reportes was measured summing $6,900 of $10,000 lent for a business with 1,500
// movements, because one read asked for everything at once. Every such read now goes
// through `lib/supabase/read-all.ts`; this keeps the next one from being written the
// old way, which is how all of them were written — no one decided it, it was the default.
//
// A read counts as BOUNDED when its chain carries any of:
//   · `.range(`                      it pages (the read-all helpers pass it in)
//   · `.limit(` · `.single()` · `.maybeSingle()` · `head: true`
//   · an equality on ONE entity: `.eq("id"`, `.eq("client_id"`, `.eq("sale_id"`,
//     `.eq("movement_id"`, `.eq("product_id"`, `.eq("catalog_order_id"`,
//     `.eq("payment_group_id"`, `.eq("token"` — one client's movements, one sale's lines
//   · it is a write: `.insert(` · `.update(` · `.delete(` · `.upsert(`
//
// NO EXCEPTION LIST, on purpose, like `qa:guiones`: a list has to be kept, and a stale
// one fails in silence. A read this flags is fixed with `readAllPages`/`readAllByIds`,
// or bounded explicitly.
//
// A READ BOUNDED BY SOMETHING THE TEXT CANNOT SHOW — the products of ONE sale's lines,
// the lines of ONE order — says so where it is written, with `// bounded: <why>` on the
// line of its `.from(` or within the three lines above. The reason travels with the code and is read
// by whoever changes it; a list in this file would not be.
//
// WHAT IT DOES NOT SEE: a single client with more than 1,000 movements (bounded by
// `client_id`, still cut). Accepted in PL-34: the largest client in production has 24.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// The two price tables carry 2–6 rows per product, so they pass 1,000 at ~200 products —
// sooner than `products` itself. Added on 2026-11-09 after finding the product editor
// read them whole and unfiltered.
const TABLAS = [
  "movements",
  "sales",
  "sale_lines",
  "sale_payments",
  "client_summary",
  "clients",
  "products",
  "product_price_overrides",
  "product_currencies",
];
const RAICES = ["app", "lib", "components"];
const TOPE = [
  /\.range\(/,
  /\.limit\(/,
  /\.single\(\)/,
  /\.maybeSingle\(\)/,
  /head:\s*true/,
  /\.eq\(\s*"(id|client_id|sale_id|movement_id|product_id|catalog_order_id|payment_group_id|token)"/,
  /\.(insert|update|delete|upsert)\(/,
];

function archivos(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "node_modules" ? [] : archivos(p);
    return /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

const sinTope = [];
let lecturas = 0;
for (const archivo of RAICES.flatMap(archivos)) {
  const texto = readFileSync(archivo, "utf8");
  const re = /\.from\(\s*"([a-z_]+)"\s*\)/g;
  let m;
  while ((m = re.exec(texto))) {
    if (!TABLAS.includes(m[1])) continue;
    // The chain: from this `.from(` to the end of the statement — a `;`, the next
    // `.from(`, or a blank line, whichever comes first. Enough for every chain in the repo.
    const resto = texto.slice(m.index + m[0].length, m.index + m[0].length + 1500);
    const siguiente = resto.search(/\.from\(/);
    const fin = Math.min(
      ...[resto.indexOf(";"), siguiente, resto.search(/\n\s*\n/)].filter((i) => i >= 0),
      resto.length,
    );
    const cadena = resto.slice(0, fin);
    if (!/\.select\(/.test(cadena)) continue;
    lecturas++;
    // The marker may sit up to three lines above `.from(`: a chain often starts with
    // `await supabase` on its own line.
    let desde = m.index;
    for (let i = 0; i < 4 && desde > 0; i++) desde = texto.lastIndexOf("\n", desde - 1);
    const alrededor = texto.slice(Math.max(0, desde), texto.indexOf("\n", m.index));
    if (/\/\/\s*bounded:\s*\S/.test(alrededor)) continue;
    // A query built in a variable (`let q = …; if (x) q = q.eq(…); return q.range(…)`)
    // ends its statement before its bound. So the bound may also sit further on, as long
    // as no other query starts first: up to the next `.from(`, within 600 characters.
    const alcance = resto.slice(0, Math.min(siguiente >= 0 ? siguiente : resto.length, 1200));
    if (!TOPE.some((t) => t.test(cadena) || (t.source.startsWith("\\.range") && t.test(alcance)))) {
      const linea = texto.slice(0, m.index).split("\n").length;
      sinTope.push(`${archivo.replace(/\\/g, "/")}:${linea}  ${m[1]}`);
    }
  }
}

console.log(`Lecturas de ${TABLAS.join(", ")}: ${lecturas}`);
if (sinTope.length) {
  console.log(`\nFAIL  ${sinTope.length} sin tope (ni páginas, ni límite, ni un solo cliente o venta):`);
  for (const s of sinTope) console.log(`  ${s}`);
  console.log("\nArréglalas con readAllPages / readAllByIds (lib/supabase/read-all.ts).");
  process.exit(1);
}
console.log("ALL GREEN — ninguna lectura sin tope");
