// Captures for the v0.6.1 release document (scripts/ayuda/raw/v061-pdf.py), taken from the
// dev app through daemon.mjs with the demo account. Run with the daemon up:
//   MSYS_NO_PATHCONV=1 node v061-capturas.mjs [phone|web]
// Phone (375) is the default; `web` expects the daemon started with AYUDA_W=1280 AYUDA_H=800.
// Shots that need a broken network fake it inside the page (window.fetch), never on the server.
import { fileURLToPath } from "node:url";
import { FIND } from "./c.mjs";

const MODE = process.argv[2] ?? "phone";
// Resume from a section: 1 sale, 9 product photos, 11 loading screens.
const FROM = Number(process.argv[3] ?? 1);
const OUT = fileURLToPath(new URL("./raw/v061/", import.meta.url));
const TOKEN = "eb5868b924086aed1429795ec88b53c9";

const call = async (q) => {
  const r = await (await fetch("http://127.0.0.1:9555", { method: "POST", body: JSON.stringify(q) })).json();
  if (!r.ok) throw new Error(`${q.op}: ${r.error}`);
  return r.out;
};
const go = (url, wait = 7000) => call({ op: "go", url, wait });
const ev = (expr) => call({ op: "eval", expr });
const shot = (name, target = null, crop) => call({ op: "shot", file: OUT + name + ".png", target: target ? FIND(target) : null, crop });
const wait = (ms) => ev(`new Promise(r=>setTimeout(r,${ms}))`);
const eager = () => ev(`(async()=>{document.querySelectorAll('img').forEach(i=>i.loading='eager'); await Promise.all([...document.querySelectorAll('img')].map(i=>i.complete?1:new Promise(r=>{i.onload=r;i.onerror=r;setTimeout(r,5000)}))); window.scrollTo(0,0); document.querySelectorAll('nextjs-portal').forEach(e=>e.remove()); return 'ok'})()`);
const click = (text, ms = 2500) => ev(`(async()=>{const e=${FIND(text)}; if(!e) return 'NOT FOUND ${text}'; e.click(); await new Promise(r=>setTimeout(r,${ms})); return 'ok'})()`);
const setv = `const setv=(el,v)=>{const s=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),'value').set; s.call(el,v); el.dispatchEvent(new Event('input',{bubbles:true}));};`;
// Server actions carry a Next-Action header. `after` lets the first N through.
const breakActions = (after = 0) => ev(`(()=>{window.__f=window.__f||window.fetch; let n=0; window.fetch=(u,o)=>{const h=o&&o.headers; const a=h&&(h['Next-Action']||h['next-action']||(h.get&&h.get('Next-Action'))); if(a){n++; if(n>${after}) return Promise.reject(new TypeError('Failed to fetch'));} return window.__f(u,o);}; return 'ok'})()`);
const fixActions = () => ev(`(()=>{if(window.__f) window.fetch=window.__f; return 'ok'})()`);
const quickProduct = (name, price) => ev(`(async()=>{${setv} const b=[...document.querySelectorAll('main button')].find(x=>x.innerText.trim()==='Agregar producto'); b.click(); await new Promise(r=>setTimeout(r,2500)); setv(document.querySelector('input[placeholder="Escribe nombre"]'),${JSON.stringify(name)}); setv(document.querySelector('input[placeholder="00"]'),${JSON.stringify(price)}); await new Promise(r=>setTimeout(r,600)); [...document.querySelectorAll('button')].find(x=>/^Agregar [$€]/.test(x.innerText.trim())).click(); return 'ok'})()`);

const log = (...a) => console.log(...a);

if (MODE === "web") {
  await go("/ventas/nueva"); await eager(); log(await shot("venta-p1-web"));
  await go(`/c/${TOKEN}`); await eager(); log(await shot("catalogo-web"));
  await go("/ventas/nueva"); await eager(); await click("Siguiente", 3000); await eager(); log(await shot("venta-paginado-web", "Siguiente", 300));
  process.exit(0);
}

if (FROM <= 1) {
// 1-3. The sale's product step: page 1, the page row, page 2, a category.
await go("/ventas/nueva"); await eager();
log(await shot("venta-p1"));
log(await shot("venta-paginado", "Siguiente", 360));
await click("Siguiente", 3000); await eager();
log(await shot("venta-p2"));
await click("Lácteos", 3000); await eager();
log(await shot("venta-lacteos"));

// 4. The customer's catalogue, top and its page row.
await go(`/c/${TOKEN}`); await eager();
log(await shot("catalogo"));
log(await shot("catalogo-paginado", "Siguiente", 360));

// 5. CT-173 fixed: a product created from the sale that sorts past the twelfth goes into the
// cart and «Ver carrito» shows.
await go("/ventas/nueva"); await eager();
await quickProduct("Zapato QA documento", "5"); await wait(6000); await eager();
log(await shot("carrito-producto-nuevo"));

// 6. The grid could not load.
await go("/ventas/nueva"); await eager();
await breakActions(0); await click("Siguiente", 3000); await eager();
log(await shot("venta-sin-conexion"));
await fixActions();

// 7. The network fell while saving: the sheet stays open and warns.
await go("/ventas/nueva"); await eager();
await breakActions(0); await quickProduct("Harina de maíz 1 kg", "1,50"); await wait(2500);
await ev(`(()=>{const s=[...document.querySelectorAll('[role="dialog"]')].pop(); s.scrollTop=s.scrollHeight; document.querySelectorAll('nextjs-portal').forEach(e=>e.remove()); return 'ok'})()`);
log(await shot("hoja-no-confirmo"));
await fixActions();

// 8. Saved, but could not be added: the toast, pinned so it does not fade before the shot.
await go("/ventas/nueva"); await eager();
await breakActions(1); await quickProduct("ZZ QA documento aviso", "1,50");
await ev(`(async()=>{let t=null; for(let i=0;i<40&&!t;i++){await new Promise(r=>setTimeout(r,250)); t=document.querySelector('[data-sonner-toaster]'); if(t&&!t.innerText.includes('Guardamos')) t=null;} if(t){const c=t.cloneNode(true); c.id='toast-fijo'; document.body.appendChild(c);} window.scrollTo(0,0); document.querySelectorAll('nextjs-portal').forEach(e=>e.remove()); return !!t})()`);
log(await shot("guardado-no-agregado"));
await fixActions();

}

if (FROM <= 9) {
// 9-10. Create product 3/4: «Agregar» and «Foto» side by side; then 4 photos.
await go("/productos/nuevo");
await ev(`(async()=>{${setv} const w=t=>new Promise(r=>setTimeout(r,t)); const cont=()=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Continuar').click(); setv(document.querySelector('input[placeholder="Escribe nombre"]'),'Harina de maíz 1 kg'); await w(300); cont(); await w(1500); const pr=[...document.querySelectorAll('input[placeholder="00.00"]')]; setv(pr[0],'1,50'); setv(pr[1],'1,20'); setv(document.querySelector('input[placeholder="0"]'),'12'); await w(300); cont(); await w(1500); return document.querySelector('main').innerText.match(/\\d\\/4 \\w+/)?.[0]})()`);
log(await shot("producto-sin-fotos", "Agregar", 420));
await ev(`(async()=>{const w=t=>new Promise(r=>setTimeout(r,t)); for (const col of ['#e8c547','#6aa84f','#cc4125','#3d85c6']) { const c=document.createElement('canvas'); c.width=300; c.height=300; const x=c.getContext('2d'); x.fillStyle=col; x.fillRect(0,0,300,300); const blob=await new Promise(r=>c.toBlob(r,'image/jpeg',0.85)); const inp=[...document.querySelectorAll('input[type=file]')].find(i=>i.getAttribute('capture')==='environment'); const dt=new DataTransfer(); dt.items.add(new File([blob],'c.jpg',{type:'image/jpeg'})); inp.files=dt.files; inp.dispatchEvent(new Event('change',{bubbles:true})); await w(3500);} return document.querySelector('main').innerText.match(/\\d\\/5/)?.[0]})()`);
await eager();
log(await shot("producto-4-fotos", "Agregar", 420));

}

// 11. Loading screens: navigate client-side and hold the server's answer after its first
// chunk, which carries the skeleton.
const skeleton = async (path, name, holdMs) => {
  await go("/dashboard?sk=" + name);
  await ev(`(()=>{window.__f=window.__f||window.fetch; window.fetch=async (u,o)=>{const h=o&&o.headers; const g=(k)=>h&&(h[k]||h[k.toLowerCase()]||(h.get&&h.get(k))); const url=String(u&&u.url||u); const res=await window.__f(u,o); if(!(g('RSC')||url.includes('_rsc='))) return res; const rd=res.body.getReader(); const t0=performance.now(); let first=true; const st=new ReadableStream({async pull(c){ if(!first && performance.now()-t0>${holdMs}) return new Promise(()=>{}); first=false; const {done,value}=await rd.read(); if(done){c.close();return;} c.enqueue(value);}}); return new Response(st,{status:res.status,headers:res.headers});}; return 'ok'})()`);
  const n = await ev(`(async()=>{window.next.router.push(${JSON.stringify(path)}); await new Promise(r=>setTimeout(r,4000)); document.querySelectorAll('nextjs-portal').forEach(e=>e.remove()); return document.querySelectorAll('.animate-pulse').length})()`);
  log(name, "pulses", n);
  if (n > 0) log(await shot(name));
  return n;
};
const pending = [];
for (const [path, name] of [
  ["/dashboard", "cargando-inicio"], ["/clients", "cargando-clientes"], ["/productos", "cargando-catalogo"],
  ["/malas-pagas", "cargando-malas-pagas"], ["/reportes", "cargando-reportes"], ["/notificaciones", "cargando-notificaciones"],
  ["/profile", "cargando-mi-negocio"], ["/papelera", "cargando-papelera"],
  ["/transacciones/2cab4671-e642-4aae-ac35-8923d3b72bb8", "cargando-transaccion"],
]) {
  const p = path === "/dashboard" ? "/dashboard?x=1" : path;
  if ((await skeleton(p, name, 150)) === 0) pending.push([path, name]);
}
log("SIN ESQUELETO:", JSON.stringify(pending));
