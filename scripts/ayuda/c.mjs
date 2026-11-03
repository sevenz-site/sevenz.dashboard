// CLI for daemon.mjs.
//   node c.mjs go /dashboard
//   node c.mjs eval "document.title"
//   node c.mjs ui                 → visible buttons, links, inputs and headings
//   node c.mjs click "Registrar"  → clicks the first visible control whose text/aria-label matches
//   node c.mjs type "Monto" "12"  → types into the input labelled/placeholdered that way
const [op, a, b, c] = process.argv.slice(2);
const call = async (q) => {
  const r = await (await fetch("http://127.0.0.1:9555", { method: "POST", body: JSON.stringify(q) })).json();
  if (!r.ok) { console.error("ERR", r.error); process.exit(1); }
  return r.out;
};
export const FIND = (text) => `(() => {
  const want = ${JSON.stringify(text)};
  const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const label = (e) => (e.getAttribute('aria-label') || e.textContent || e.value || e.placeholder || '').replace(/\\s+/g, ' ').trim();
  const els = [...document.querySelectorAll('button,a,[role=button],[role=tab],[role=option],[role=menuitem],[role=radio],[role=checkbox],label,input,textarea,select')].filter(vis);
  return els.find((e) => label(e) === want) || els.find((e) => label(e).startsWith(want)) || els.find((e) => label(e).includes(want)) || null;
})()`;
const UI = `(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && r.bottom > 0 && r.top < innerHeight * 3; };
  const out = [];
  for (const e of document.querySelectorAll('h1,h2,h3,button,a,[role=button],[role=tab],[role=radio],[role=checkbox],input,textarea,select,label,[role=dialog] p')) {
    if (!vis(e)) continue;
    const r = e.getBoundingClientRect();
    const t = (e.getAttribute('aria-label') || e.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 90);
    const extra = e.tagName === 'INPUT' || e.tagName === 'TEXTAREA' ? ' [' + (e.type || '') + ' ph=' + (e.placeholder || '') + ' val=' + e.value + ']' : '';
    out.push(e.tagName.toLowerCase() + '@' + Math.round(r.top) + ' ' + t + extra);
  }
  return location.pathname + location.search + '\\n' + out.join('\\n');
})()`;

let out;
if (op === "go") out = await call({ op: "go", url: a, wait: b ? Number(b) : undefined });
else if (op === "eval") out = await call({ op: "eval", expr: a });
else if (op === "ui") out = await call({ op: "eval", expr: UI });
else if (op === "text") out = await call({ op: "eval", expr: "document.body.innerText" });
else if (op === "click") out = await call({ op: "eval", expr: `(async()=>{const e=${FIND(a)}; if(!e) return 'NOT FOUND'; e.scrollIntoView({block:'center'}); e.click(); await new Promise(r=>setTimeout(r,${b || 1200})); return 'clicked ' + (e.getAttribute('aria-label')||e.textContent).trim().slice(0,60)})()` });
else if (op === "type") out = await call({ op: "eval", expr: `(async()=>{const e=${FIND(a)}; if(!e) return 'NOT FOUND'; const el = e.tagName==='LABEL' ? (e.control||document.getElementById(e.htmlFor)) : e; el.focus(); const set=Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set; set.call(el, ${JSON.stringify(b ?? "")}); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); await new Promise(r=>setTimeout(r,800)); return 'typed into ' + (el.placeholder||el.name||el.id)})()` });
else if (op === "shot") out = await call({ op: "shot", file: a, target: b ? FIND(b) : null, crop: c ? Number(c) : undefined });
else if (op === "relogin") out = await call({ op: "relogin" });
console.log(typeof out === "string" ? out : JSON.stringify(out, null, 1));
