// LOAD TEST, PHASE 3: the ids of the server actions k6 will call, discovered the way the
// browser gets them — from the client chunks of the deployed pages — so the test calls
// exactly what the app calls. Same technique as qa/abono-accion.mjs. Writes
// scripts/ayuda/raw/carga-acciones.json for qa/carga/escritura.js.
//
//   node qa/carga/acciones.mjs            (BASE_URL defaults to http://localhost:3100)
import { readFileSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:3100";
if (!/^https:\/\/dev\.sevenz\.site$|^http:\/\/localhost:\d+$/.test(BASE)) throw new Error(`BASE_URL «${BASE}» no es dev ni localhost`);
const sesiones = JSON.parse(readFileSync("scripts/ayuda/raw/carga-sesiones.json", "utf8"));
if (!sesiones.length) throw new Error("sin sesiones: corre node qa/carga/sesiones.mjs");
const cookie = sesiones[0].cookie;

async function idDeLaAccion(nombre, ruta) {
  const res = await fetch(`${BASE}${ruta}`, { headers: { Cookie: cookie } });
  if (!res.ok) throw new Error(`${ruta} respondió HTTP ${res.status}`);
  const html = await res.text();
  const urls = [...new Set([...html.matchAll(/(?:src|href)="(\/_next\/[^"]+\.js)"/g)].map((m) => m[1]))];
  const vistos = new Set(urls);
  const textos = new Map();
  for (const u of [...urls]) {
    const r = await fetch(`${BASE}${u}`);
    if (!r.ok) continue;
    const t = await r.text();
    textos.set(u, t);
    for (const m of t.matchAll(/["'(]((?:\/_next\/)[^"')]+?\.js)["')]/g)) {
      if (!vistos.has(m[1]) && vistos.size < 400) { vistos.add(m[1]); urls.push(m[1]); }
    }
  }
  const re = new RegExp(`"([0-9a-f]{40,})"[^()]{0,200}?"${nombre}"`);
  for (const u of urls) {
    let t = textos.get(u);
    if (t == null) { const r = await fetch(`${BASE}${u}`); if (!r.ok) continue; t = await r.text(); }
    const m = re.exec(t);
    if (m) return m[1];
  }
  return null;
}

const out = { base: BASE, registrarVenta: await idDeLaAccion("registrarVenta", "/ventas/nueva") };
for (const [k, v] of Object.entries(out)) console.log(k, v ? String(v).slice(0, 12) + "…" : "NO ENCONTRADO");
if (!out.registrarVenta) process.exit(1);
writeFileSync("scripts/ayuda/raw/carga-acciones.json", JSON.stringify(out));
