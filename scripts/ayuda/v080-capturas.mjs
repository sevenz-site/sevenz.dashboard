// Captures for the v0.7.3 Figma frames and release document, taken from the dev app through
// daemon.mjs with the demo account. Run with the daemon up:
//   MSYS_NO_PATHCONV=1 node v073-capturas.mjs [phone|web]
// Phone (375) is the default; `web` expects the daemon started with AYUDA_W=1280 AYUDA_H=800.
//
// WRITES IN DEV, and undoes it: the catalogue branding is saved through the real screen (cover
// drawn in a canvas, never a real shop's photo) and the demo's own branding is put back in a
// `finally`, cover file included. The duplicate-name warnings are opened with an existing demo
// name and dismissed with «Cambiar nombre», so no product is created.
//
// The tall photo in the photo frames exists only in the page: the demo's photos are square, and
// a square photo looks the same cropped or whole. An `<img>` is pointed at a drawn bottle, which
// is what an owner's vertical photo looks like inside the new square box.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { FIND } from "./c.mjs";
import { exportScreen } from "./figma-export.mjs";

const MODE = process.argv[2] ?? "phone";
const WEB = MODE === "web";
const OUT = fileURLToPath(new URL("./raw/v073/", import.meta.url));
// The same state, as editable layers for Figma (figma-export.mjs, figma-build.js).
const FIGMA = fileURLToPath(new URL("./raw/figma/", import.meta.url));
const M = JSON.parse(readFileSync(new URL("./demo-manifest.json", import.meta.url), "utf8"));
const ORDER = "3e2b135d-60d0-43d1-8ab0-345d53f6ff48"; // demo order «Karina Medina», status new

const call = async (q) => {
  const r = await (await fetch("http://127.0.0.1:9555", { method: "POST", body: JSON.stringify(q) })).json();
  if (!r.ok) throw new Error(`${q.op}: ${r.error}`);
  return r.out;
};
const go = (url, wait = 6000) => call({ op: "go", url, wait });
const ev = (expr) => call({ op: "eval", expr });
const wait = (ms) => ev(`new Promise(r=>setTimeout(r,${ms}))`);
const name = (n) => (WEB ? `${n}-web` : n);
const shot = async (n) => {
  await ev("document.activeElement?.blur?.(); document.querySelectorAll('nextjs-portal').forEach(e=>e.remove()); 1");
  await call({ op: "shot", file: `${OUT}${name(n)}.png`, target: null, crop: 0 });
  const f = await exportScreen(call, name(n), FIGMA);
  console.log(`  ✔ ${name(n)}  (${f.nodes} capas, ${f.assets} archivos)`);
};
const click = (text, ms = 2500) =>
  ev(`(async()=>{const e=${FIND(text)}; if(!e) throw new Error('NOT FOUND ${text.replace(/'/g, "")}'); e.click(); await new Promise(r=>setTimeout(r,${ms})); return 'ok'})()`);
const clickJs = (expr, ms = 2500) =>
  ev(`(async()=>{const e=${expr}; if(!e) throw new Error('NOT FOUND'); e.click(); await new Promise(r=>setTimeout(r,${ms})); return 'ok'})()`);
const set = (expr, value) =>
  ev(`(()=>{const el=${expr}; const p=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(p,'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return 1})()`);
const top = (expr, margin = 16) =>
  ev(`(()=>{const e=${expr}; if(!e) return 0; scrollTo(0, e.getBoundingClientRect().top + scrollY - ${margin}); return 1})()`);
const openMenu = (label) =>
  ev(`(async()=>{const b=[...document.querySelectorAll('button')].find(e=>(e.getAttribute('aria-label')||e.textContent).trim()===${JSON.stringify(label)}); b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerType:'mouse'})); await new Promise(r=>setTimeout(r,1200)); return 1})()`);
const escape = () => ev("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); new Promise(r=>setTimeout(r,800))");
const LAST = (t) => `[...document.querySelectorAll('button')].filter(b=>b.textContent.trim()===${JSON.stringify(t)}&&b.getBoundingClientRect().height>0).pop()`;
const clearPopups = () =>
  ev("document.querySelectorAll('[data-sonner-toaster]').forEach(e=>e.remove()); [...document.querySelectorAll('div,aside,section')].filter(e=>/^¡?Ayúdanos a mejorar/.test(e.textContent.trim())&&!e.textContent.includes('Productos'))[0]?.remove(); 1");

// A vertical product photo drawn in the page: a bottle on white, 600×1200.
const TALL_PHOTOS = `(async()=>{
  const c=document.createElement('canvas'); c.width=600; c.height=1200; const g=c.getContext('2d');
  g.fillStyle='#FFFFFF'; g.fillRect(0,0,600,1200);
  g.fillStyle='#2F5E8C'; g.fillRect(250,90,100,140);
  g.fillStyle='#DCEAF5'; g.beginPath(); g.moveTo(250,230); g.lineTo(350,230); g.lineTo(440,360); g.lineTo(440,1110); g.lineTo(160,1110); g.lineTo(160,360); g.closePath(); g.fill();
  g.fillStyle='#2F5E8C'; g.fillRect(160,560,280,300);
  g.fillStyle='#FFFFFF'; g.font='bold 54px sans-serif'; g.textAlign='center'; g.fillText('AGUA', 300, 690); g.font='36px sans-serif'; g.fillText('1 L', 300, 760);
  const url=c.toDataURL('image/png'); let n=0;
  for (const i of document.querySelectorAll('img')) { if ((i.currentSrc||i.src).includes('/product-photos/')) { i.srcset=''; i.src=url; n++; } }
  await new Promise(r=>setTimeout(r,800)); return n})()`;

// DEV only, checked: the service key, to keep and put back the demo's branding.
const DIR = new URL("../../", import.meta.url);
const require = createRequire(new URL("package.json", DIR));
const { createClient } = require("@supabase/supabase-js");
const env = Object.fromEntries(
  readFileSync(new URL(".env.local", DIR), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
if (!env.NEXT_PUBLIC_SUPABASE_URL.includes("vzqppwrwnmlbrxizskdh")) throw new Error("not the dev branch");
const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const COLS = "brand_color, catalog_cover_path, catalog_welcome, brand_description, catalog_show_address";
const { data: before, error: readError } = await svc.from("owners").select(COLS).eq("id", M.ownerId).single();
if (readError) throw readError;
const uploaded = new Set();

const HEX = "document.querySelector('input[placeholder=\"#272727\"]')";
const SWITCH =
  "(()=>{const l=[...document.querySelectorAll('label')].find(l=>/Mostrar mi dirección/.test(l.textContent)); return (l.htmlFor&&document.getElementById(l.htmlFor))||l.closest('div').querySelector('button,[role=switch],input[type=checkbox]')})()";
const COVER = `(async()=>{
  const c=document.createElement('canvas'); c.width=1600; c.height=600; const g=c.getContext('2d');
  const grad=g.createLinearGradient(0,0,1600,600); grad.addColorStop(0,'#F2C14E'); grad.addColorStop(1,'#E07A3F');
  g.fillStyle=grad; g.fillRect(0,0,1600,600);
  g.fillStyle='rgba(255,255,255,0.18)'; for(let i=0;i<4;i++) g.fillRect(0,150+i*120,1600,14);
  const colors=['#3D8B6E','#C94F3D','#F7F3E9','#2F5E8C','#8C5A2F'];
  for(let r=0;r<4;r++) for(let k=0;k<22;k++){ g.fillStyle=colors[(k+r)%5]; g.fillRect(30+k*72, 80+r*120, 52, 70); }
  const blob=await new Promise(res=>c.toBlob(res,'image/jpeg',0.9));
  const input=document.querySelector('input[type=file]');
  const dt=new DataTransfer(); dt.items.add(new File([blob],'portada.jpg',{type:'image/jpeg'}));
  input.files=dt.files; input.dispatchEvent(new Event('change',{bubbles:true}));
  await new Promise(r=>setTimeout(r,6000)); return 1})()`;
const save = async () => {
  await clickJs(LAST("Guardar cambios"), 4500);
  const { data } = await svc.from("owners").select("catalog_cover_path").eq("id", M.ownerId).single();
  if (data?.catalog_cover_path) uploaded.add(data.catalog_cover_path);
};

try {
  // ── CT-170 · Personalizar catálogo ───────────────────────────────────────────
  if (!WEB) {
    await go("/productos");
    await openMenu("Más opciones");
    await shot("c1-menu");
    await escape();
  }
  await go("/productos/personalizar");
  await shot("c2-vacio");

  // Since 2026-11-15 (frame `2163:955`) the colour is stored as picked and paints nothing,
  // so there is no «ajustado» state any more. The new private field takes its place.
  await set(HEX, "#1E6B52");
  await set("document.getElementById('brand-description')", ["Víveres y charcutería para el barrio desde 2015.", "Atendemos de lunes a sábado y llevamos pedidos a domicilio."].join(String.fromCharCode(10)));
  await wait(900);
  await top("document.getElementById('brand-description').closest('div').parentElement", 80);
  await shot("c3-descripcion");

  await ev(COVER);
  await set("document.getElementById('catalog-welcome')", "¡Bienvenido! Haz tu pedido y te lo tenemos listo.");
  const on = await ev(`(()=>{const s=${SWITCH}; return s.getAttribute('aria-checked')==='true'||s.checked===true||s.dataset.state==='checked'})()`);
  if (!on) await clickJs(SWITCH, 800);
  await top("[...document.querySelectorAll('span')].find(s=>s.textContent.trim()==='Portada')", 16);
  await shot("c4-con-portada");

  await clickJs(LAST("Ver cómo queda"), 3000);
  await shot("c5-ver-como-queda");
  await escape();

  await save();
  await go(`/c/${M.catalogToken}`);
  await clearPopups();
  await shot("c6-cliente-con-portada");

  // The other frame of the design: no cover, a dark colour and the address.
  await go("/productos/personalizar");
  await clickJs(LAST("Quitar portada"), 800);
  await set(HEX, "#2B2D6E");
  await save();
  await go(`/c/${M.catalogToken}`);
  await clearPopups();
  await shot("c7-cliente-sin-portada");
} finally {
  const { data: now } = await svc.from("owners").select("catalog_cover_path").eq("id", M.ownerId).single();
  if (now?.catalog_cover_path) uploaded.add(now.catalog_cover_path);
  await svc.from("owners").update(before).eq("id", M.ownerId);
  const gone = [...uploaded].filter((p) => p !== before.catalog_cover_path && p.startsWith(`${M.ownerId}/`));
  if (gone.length) await svc.storage.from("logos").remove(gone);
  console.log("marca de la demo devuelta; portadas de prueba borradas:", gone.length);
}

// What every owner who never opens «Personalizar catálogo» keeps seeing.
await go(`/c/${M.catalogToken}`);
await clearPopups();
await shot("c8-cliente-sin-personalizar");

// ── CT-177 · Fotos enteras, en su recuadro cuadrado ─────────────────────────────
// Through the list, not by id: the manifest's id for the flour is stale since a re-seed.
await go("/productos");
await click("Abrir Harina de maíz 1 kg", 6000);
await ev(TALL_PHOTOS);
await shot("p1-ficha-duenio");

await go("/ventas/nueva");
await click("Ver Harina de maíz 1 kg", 3000);
await ev(TALL_PHOTOS);
await shot("p2-hoja-venta");
await escape();

if (!WEB) {
  await go(`/productos/ordenes/${ORDER}`);
  await clickJs("[...document.querySelectorAll('main button')].find(b=>/×/.test(b.textContent))", 3000);
  await ev(TALL_PHOTOS);
  await shot("p3-hoja-pedido");
  await escape();
}

// ── CT-178 · Aviso de nombre repetido ───────────────────────────────────────────
await go("/productos");
await click("Crear producto", 5000);
await set("document.getElementById('producto_nombre')", "Harina de maíz 1 kg");
await set("document.querySelector('input[placeholder=\"0\"]')", "1");
await clickJs(LAST("Continuar"), 2500);
await set("document.querySelector('input[placeholder=\"00\"]')", "1");
await set("document.getElementById('precio_retail')", "2");
await wait(800);
await clickJs(LAST("Continuar"), 2500);
await clickJs(LAST("Continuar"), 2500);
await clickJs(LAST("Crear producto"), 3000);
await shot("n1-aviso-asistente");
await clickJs("[...document.querySelectorAll('[role=alertdialog] button')].find(b=>b.textContent.trim()==='Cambiar nombre')", 1500);
await shot("n2-cambiar-nombre");

if (!WEB) {
  await go("/ventas/nueva");
  await click("Agregar producto", 2500);
  await set("document.getElementById('qp-nombre')", "Harina de maíz 1 kg");
  await set("document.getElementById('qp-precio')", "2");
  await wait(800);
  await clickJs("[...document.querySelectorAll('[role=dialog] button')].filter(b=>b.textContent.trim().startsWith('Agregar')).pop()", 3000);
  await shot("n3-aviso-alta-rapida");
  await clickJs("[...document.querySelectorAll('[role=alertdialog] button')].find(b=>b.textContent.trim()==='Cambiar nombre')", 1200);
}
await go("/productos", 3000);
console.log("listo");
