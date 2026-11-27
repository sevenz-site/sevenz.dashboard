// «Personalizar tu catálogo» (CT-170, v0.8.0) in the demo business.
//
// With --finalizar it WRITES in dev: it uploads a cover drawn in the page (a canvas, so no
// real photo of anybody's shop is published), saves a colour, a welcome and the address, and
// takes the customer's catalogue with all of it. Before anything it keeps the demo's branding,
// and at the end it puts it back, because every other topic's captures show the catalogue as
// the demo has it -- without a brand. Without --finalizar nothing is saved: the last two
// pictures are the «Ver cómo queda» sheet.
// v0.14.0 (migration 225, 2026-11-26): two steps after the welcome message, the WhatsApp
// box (6) and the extra link (7), so every later picture moved two numbers on. The demo's
// WhatsApp and link are kept and put back with the rest of its branding.
import { go, js, click, shot, openMenu, escape, sleep, clearPopups, call, pick } from "../lib.mjs";
import { fileURLToPath } from "node:url";
import { M } from "./_m.mjs";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const S = "personalizar-tu-catalogo";
const FINAL = process.argv.includes("--finalizar");
const DIR = new URL("../../../", import.meta.url);

// DEV only, and checked: the same service key the seed uses.
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
const COLS =
  "brand_color, catalog_cover_path, catalog_welcome, brand_description, catalog_show_address, catalog_show_whatsapp, catalog_link_kind, catalog_link_url";
const { data: before, error: readError } = await svc.from("owners").select(COLS).eq("id", M.ownerId).single();
if (readError) throw readError;

const set = (selector, value) =>
  js(`(()=>{const el=${selector}; const p=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(p,'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return 1})()`);
const HEX = "document.querySelector('input[placeholder=\"#272727\"]')";
const TEXTAREA = "document.getElementById('catalog-welcome')";
const DESCRIPTION = "document.getElementById('brand-description')";
// The address box left this screen on 2026-11-18 (it is in Mi negocio now). With
// --finalizar the demo shows its address for the customer's picture, set here and put back
// in `finally` with the rest of the branding.

try {
  await go(`/productos`, 6000);
  await openMenu("Más opciones");
  await shot(S, 1, "Personalizar catálogo", { blur: false });
  await click("Personalizar catálogo", { wait: 5000 });

  await set(HEX, "#1E6B52");
  await sleep(800);
  await shot(S, 2, `js:${HEX}.closest('div').parentElement`);

  // The brand description (211): private, under the colour.
  await set(DESCRIPTION, ["Víveres y charcutería para el barrio desde 2015.", "Atendemos de lunes a sábado y llevamos pedidos a domicilio."].join(String.fromCharCode(10)));
  await sleep(800);
  await shot(S, 3, `js:${DESCRIPTION}.closest('div').parentElement`);

  if (FINAL) {
    // A banner drawn in the page: warm gradient and a row of shelves. Through the form's own
    // file input, so it goes the way an owner's photo goes (resized on the device, uploaded
    // to his folder of `logos`).
    await js(`(async()=>{
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
      return 1})()`);
    await sleep(6000);
    // The sticky «Guardar cambios» bar covers the cover's buttons at the bottom of the
    // screen: bring the «Portada» block to the top first.
    await js("(()=>{const e=[...document.querySelectorAll('span')].find(s=>s.textContent.trim()==='Portada'); scrollTo(0, e.getBoundingClientRect().top + scrollY - 80); return 1})()");
    await sleep(500);
    await shot(S, 4, "Cambiar portada");
  } else {
    await shot(S, 4, "Subir portada");
  }

  await set(TEXTAREA, "¡Bienvenido! Haz tu pedido y te lo tenemos listo.");
  await sleep(800);
  await shot(S, 5, `js:${TEXTAREA}.closest('div').parentElement`);

  // 6. The WhatsApp box, ticked (it is off by default). Clicking the label toggles it.
  await click("Mostrar «Contactar vía WhatsApp» en mi catálogo", { wait: 800 });
  await shot(S, 6, "js:[...document.querySelectorAll('label')].find(l=>l.textContent.includes('Contactar vía WhatsApp')).parentElement");

  // 7. The extra link: Instagram from the list, then its address. The account is invented,
  // like everything in the demo.
  await openMenu("Qué enlace es");
  await pick("Instagram");
  await set("document.getElementById('catalog-link-url')", "https://instagram.com/miniabastoelchino");
  await js("document.getElementById('catalog-link-url').blur(); 1");
  await sleep(800);
  await shot(S, 7, "js:document.getElementById('catalog-link-url').parentElement");

  await shot(S, 8, "Ver cómo queda");
  await click("Ver cómo queda", { wait: 3000 });
  await shot(S, 9, "js:document.querySelector('[role=dialog]')", { crop: 0 });
  await escape();
  await sleep(800);

  await shot(S, 10, "Guardar cambios");
  if (FINAL) {
    await click("Guardar cambios", { wait: 4000 });
    await svc.from("owners").update({ catalog_show_address: true }).eq("id", M.ownerId);
    await go(`/c/${M.catalogToken}`, 6000);
    await clearPopups();
    await sleep(500);
    await shot(S, 11, null, { crop: 0 });
    // The topic's cover for the /ayuda index, taken here and not in `portadas.mjs`: it
    // needs the branding saved, and only this script saves it and puts it back.
    const RAW = fileURLToPath(new URL("../raw-portadas", import.meta.url)).split(String.fromCharCode(92)).join("/");
    await js("scrollTo(0,0)");
    await call({ op: "shot", file: `${RAW}/${S}.png`, target: null, crop: 0 });
  }
} finally {
  // Back to the demo's own branding, whatever happened above, and the test cover out.
  const { data: now } = await svc.from("owners").select("catalog_cover_path").eq("id", M.ownerId).single();
  await svc.from("owners").update(before).eq("id", M.ownerId);
  if (now?.catalog_cover_path && now.catalog_cover_path !== before.catalog_cover_path) {
    await svc.storage.from("logos").remove([now.catalog_cover_path]);
  }
  console.log("marca de la demo devuelta", JSON.stringify(before));
}
