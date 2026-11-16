// Serves raw/figma/ and figma-build.js to the Figma desktop bridge on localhost:9230, for
// the time it takes to build the frames. Read-only, a closed set of file types.
//   node figma-serve.mjs
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const DIR = fileURLToPath(new URL("./raw/figma/", import.meta.url));
const BUILD = fileURLToPath(new URL("./figma-build.js", import.meta.url));
const TYPES = { json: "application/json", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", webp: "image/webp", js: "text/javascript" };
createServer(async (req, res) => {
  const name = decodeURIComponent((req.url || "").split("?")[0].slice(1));
  const m = /^[A-Za-z0-9_.-]+\.(json|svg|png|jpg|webp|js)$/.exec(name);
  if (!m || name.includes("..")) { res.writeHead(404); return res.end(); }
  try {
    const buf = await readFile(name === "figma-build.js" ? BUILD : DIR + name);
    res.writeHead(200, { "Content-Type": TYPES[m[1]], "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" });
    res.end(buf);
  } catch { res.writeHead(404); res.end(); }
}).listen(9230, "127.0.0.1", () => console.log("figma-serve on 9230"));
