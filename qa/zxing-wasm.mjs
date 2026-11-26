// qa:zxing-wasm (CT-182). The barcode reader's WASM is served from public/wasm/, copied
// from node_modules, with the zxing-wasm version in its name (lib/barcodes/camera.ts asks
// for that exact name). This fails when the copy and the installed package drift apart:
// a package update without a new copy would make the scanner fetch a file that does not
// exist, and the camera would open and never read anything -- with no error a shopkeeper
// could read.
//
// No database, no network: run it from dashboard/ with `npm run qa:zxing-wasm`.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

const { ZXING_WASM_VERSION, ZXING_WASM_SHA256 } = await import("zxing-wasm/reader");
const file = `public/wasm/zxing_reader-${ZXING_WASM_VERSION}.wasm`;
const cameraSource = readFileSync("lib/barcodes/camera.ts", "utf8");

const checks = [
  ["El archivo existe en public/wasm/", existsSync(file)],
  [
    "Su huella coincide con la del paquete instalado",
    existsSync(file) && createHash("sha256").update(readFileSync(file)).digest("hex") === ZXING_WASM_SHA256,
  ],
  ["lib/barcodes/camera.ts pide esa misma versión", cameraSource.includes(`"${ZXING_WASM_VERSION}"`)],
];

let fails = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "✅" : "❌"} ${name}`);
  if (!ok) fails++;
}
console.log(fails ? `\n${fails} fallo(s). Copia node_modules/zxing-wasm/dist/reader/zxing_reader.wasm a ${file} y actualiza la versión en lib/barcodes/camera.ts.` : `\nTodo bien (zxing-wasm ${ZXING_WASM_VERSION}).`);
process.exit(fails ? 1 : 0);
