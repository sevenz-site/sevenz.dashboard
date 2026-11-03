// Helpers shared by the capture scripts. Talk to daemon.mjs on 127.0.0.1:9555.
import { fileURLToPath } from "node:url";
// Raw PNG captures, git-ignored: only the WebP versions in Web/public ship.
export const RAW = fileURLToPath(new URL("./raw", import.meta.url)).split(String.fromCharCode(92)).join("/");

export const call = async (q) => {
  const r = await (await fetch("http://127.0.0.1:9555", { method: "POST", body: JSON.stringify(q) })).json();
  if (!r.ok) throw new Error(`${q.op}: ${r.error}`);
  return r.out;
};

// The first VISIBLE control whose accessible text equals, starts with, or
// contains `text`. A target starting with "js:" is a raw expression instead.
export const FIND = (text, scope = "document") => {
  if (text.startsWith("js:")) return text.slice(3);
  return `(() => {
    const want = ${JSON.stringify(text)};
    const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const label = (e) => (e.getAttribute('aria-label') || e.textContent || e.value || e.placeholder || '').replace(/\\s+/g, ' ').trim();
    const root = ${scope};
    const els = [...root.querySelectorAll('button,a,[role=button],[role=tab],[role=option],[role=menuitem],[role=radio],[role=checkbox],label,input,textarea,select')].filter(vis);
    return els.find((e) => label(e) === want) || els.find((e) => label(e).startsWith(want)) || els.find((e) => label(e).includes(want)) || null;
  })()`;
};
export const DIALOG = "(document.querySelectorAll('[role=dialog]')[document.querySelectorAll('[role=dialog]').length-1]||document)";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const go = (url, wait) => call({ op: "go", url, wait });
export const js = (expr) => call({ op: "eval", expr });
export const text = () => js("document.body.innerText");

export async function click(target, { wait = 1200, scope } = {}) {
  const r = await js(`(async()=>{const e=${FIND(target, scope)}; if(!e) return null; e.scrollIntoView({block:'center',behavior:'instant'}); e.click(); await new Promise(r=>setTimeout(r,${wait})); return (e.getAttribute('aria-label')||e.textContent).trim().slice(0,60)})()`);
  if (r === null) throw new Error(`click: not found «${target}»`);
  return r;
}

export async function type(target, value, { scope, wait = 800 } = {}) {
  const r = await js(`(async()=>{const e=${FIND(target, scope)}; if(!e) return null; const el = e.tagName==='LABEL' ? (e.control||document.getElementById(e.htmlFor)) : e; el.focus(); const set=Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set; set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); await new Promise(r=>setTimeout(r,${wait})); return true})()`);
  if (r === null) throw new Error(`type: not found «${target}»`);
}

// One step's picture. `target` is what gets the ring; `crop` the window height
// in CSS px (0 = the whole screen).
export async function shot(slug, n, target, { crop = 440, scope, pad, blur = true } = {}) {
  const file = `${RAW}/${slug}/${n}.png`;
  if (blur) await js("document.activeElement?.blur?.()");
  const out = await call({ op: "shot", file, target: target ? FIND(target, scope) : null, crop, pad });
  console.log(`  ✔ ${slug}/${n}  ${target ?? "(sin objetivo)"}`);
  return out;
}

// Radix dropdowns and selects open on pointerdown, not on click.
export async function openMenu(target, { wait = 900, scope } = {}) {
  const r = await js(`(async()=>{const e=${FIND(target, scope)}; if(!e) return null; e.scrollIntoView({block:'center',behavior:'instant'}); e.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'mouse',button:0})); await new Promise(r=>setTimeout(r,${wait})); return true})()`);
  if (r === null) throw new Error(`openMenu: not found «${target}»`);
}
export const escape = () => js("document.activeElement?.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); 1");
export const MENU = "js:document.querySelector('[data-slot=dropdown-menu-content],[data-slot=select-content],[role=menu],[role=listbox]')";
// Polls `expr` until truthy (max `ms`).
export async function waitFor(expr, ms = 30000) {
  for (let t = 0; t < ms; t += 500) { if (await js(expr)) return true; await sleep(500); }
  throw new Error(`waitFor timed out: ${expr}`);
}
// Picks an item of the open dropdown/select by its text.
export async function pick(textItem, { wait = 900 } = {}) {
  const r = await js(`(async()=>{const m=document.querySelector('[data-slot=dropdown-menu-content],[data-slot=select-content],[role=menu],[role=listbox]'); if(!m) return null; const it=[...m.querySelectorAll('[role=menuitem],[role=option],[role=menuitemradio],[role=menuitemcheckbox]')].find(e=>e.textContent.trim()===${JSON.stringify(textItem)}||e.textContent.trim().startsWith(${JSON.stringify(textItem)})); if(!it) return null; it.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true})); it.dispatchEvent(new PointerEvent('pointerup',{bubbles:true})); it.click(); await new Promise(r=>setTimeout(r,${wait})); return true})()`);
  if (r === null) throw new Error(`pick: not found «${textItem}»`);
}

// Removes the client-side pop-ups (WhatsApp consent, «Ayúdanos a mejorar») from
// the PICTURE only: accepting the consent would write it for a demo client.
export const clearPopups = () => js("document.querySelectorAll('[role=dialog],[data-slot=dialog-overlay],[data-slot=sheet-overlay],[data-sonner-toaster]').forEach(e=>e.remove()); [...document.querySelectorAll('div,aside,section')].filter(e=>/^¡?Ayúdanos a mejorar/.test(e.textContent.trim())&&!e.textContent.includes('Productos'))[0]?.remove(); document.body.style.pointerEvents=''; document.body.removeAttribute('data-scroll-locked'); 1");
