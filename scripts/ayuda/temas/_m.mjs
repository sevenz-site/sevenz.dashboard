import { readFileSync } from "node:fs";
export const M = JSON.parse(readFileSync(new URL("../demo-manifest.json", import.meta.url), "utf8"));
// The card/section that holds an h2 with this text.
export const H2 = (t) => `js:[...document.querySelectorAll('h2')].find(h=>h.textContent.includes(${JSON.stringify(t)}))?.parentElement`;
// The deepest element whose text starts with `t` (and optionally contains `also`).
export const BLOCK = (t, also = "") => `js:[...document.querySelectorAll('*')].filter(e=>e.children.length&&e.textContent.trim().startsWith(${JSON.stringify(t)})&&e.textContent.includes(${JSON.stringify(also)})).pop()`;
// The input whose placeholder starts with `ph`.
export const INPUT = (ph) => `js:[...document.querySelectorAll('input,textarea')].find(i=>(i.placeholder||'').startsWith(${JSON.stringify(ph)}))`;
// The last visible button whose text is exactly `t`.
export const LASTBTN = (t) => `js:[...document.querySelectorAll('button')].filter(b=>b.textContent.trim()===${JSON.stringify(t)}&&b.getBoundingClientRect().height>0).pop()`;
export const NAV = (t) => `js:[...document.querySelectorAll('nav a')].find(a=>a.textContent.trim()===${JSON.stringify(t)})`;
