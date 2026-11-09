// A long-lived headless Chrome, signed in as the DEMO business of
// `seed-demo.mjs` (next to this file), driven over CDP and reached through a tiny local
// HTTP server, so the help-centre screenshots can be taken one step at a time.
//
// DEV ONLY: refuses to run unless `dashboard/.env.local` points at the dev
// branch (vzqppwrwnmlbrxizskdh). The session is the demo owner's, by magic link
// (`generateLink` + `verifyOtp`, no password), the same as `qa/*.mjs`.
//
//   node daemon.mjs            → listens on http://127.0.0.1:9555
//   POST { op: "go", url } | { op: "eval", expr } | { op: "shot", file, target, crop }
//
// No new dependency: system Chrome + Node 22's built-in WebSocket.
import { createRequire } from "node:module";
import { readFileSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

// The Sevenz folder: dashboard/, Web/ and docs/ side by side.
const ROOT = fileURLToPath(new URL("../../../", import.meta.url)).split(String.fromCharCode(92)).join("/").replace(/\/$/, "");
const { createClient } = createRequire(`${ROOT}/dashboard/package.json`)("@supabase/supabase-js");
const M = JSON.parse(readFileSync(`${ROOT}/dashboard/scripts/ayuda/demo-manifest.json`, "utf8"));

const env = Object.fromEntries(
  readFileSync(`${ROOT}/dashboard/.env.local`, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);
const REF = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
if (REF !== "vzqppwrwnmlbrxizskdh") throw new Error(`Dev only, not ${REF}.`);
const BASE = "http://localhost:3000";

// `email` defaults to the demo owner; the C1 walk signs in as another dev account by magic
// link, never with a password (op `login-as`).
async function sessionCookies(email = M.email) {
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const { data: s, error } = await anon.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  if (error) throw new Error(`verifyOtp: ${error.message}`);
  const v = "base64-" + Buffer.from(JSON.stringify(s.session), "utf8").toString("base64url");
  const MAX = 3180;
  return v.length <= MAX
    ? [[`sb-${REF}-auth-token`, v]]
    : Array.from({ length: Math.ceil(v.length / MAX) }, (_, i) => [`sb-${REF}-auth-token.${i}`, v.slice(i * MAX, (i + 1) * MAX)]);
}

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9444;
spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(tmpdir(), `sevenz-ayuda-${Date.now()}`)}`,
  "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--hide-scrollbars",
  "--disable-features=Translate", "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let list;
for (let i = 0; i < 120; i++) {
  try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (list[0]) break; } catch {}
  await sleep(250);
}
const ws = new WebSocket(list.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let n = 0;
const pending = new Map();
const events = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); if (m.error) rej(new Error(m.error.message)); else res(m.result); }
  else if (m.method) events.push(m.method);
};
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++n; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });

// The phone by default. `AYUDA_W=1280 AYUDA_H=800` takes the web width, for the release
// documents that have to show both (CLAUDE.md, «Todo ajuste se evalúa también en la resolución web»).
const W = Number(process.env.AYUDA_W ?? 375), H = Number(process.env.AYUDA_H ?? 812), SCALE = 2;
await send("Page.enable"); await send("Network.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: SCALE, mobile: W < 768 });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (Linux; Android 14; SM-S906B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36" });
for (const [name, value] of await sessionCookies()) await send("Network.setCookie", { name, value, url: BASE });
// The Next dev indicator is not part of the app; neither is the install prompt.
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `
    try { sessionStorage.setItem('sevenz:instalar-descartado','1'); localStorage.setItem('sevenz:instalar-descartado','1'); } catch {}
    document.addEventListener('DOMContentLoaded',()=>{
      const s=document.createElement('style');
      s.textContent='nextjs-portal{display:none!important}';
      document.head.appendChild(s);
    });`,
});

const evaluate = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
};
const go = async (url, wait = 3000) => {
  events.length = 0;
  await send("Page.navigate", { url: url.startsWith("http") ? url : BASE + url });
  for (let i = 0; i < 80 && !events.includes("Page.loadEventFired"); i++) await sleep(250);
  await sleep(wait);
};

// The spotlight: everything outside the target is dimmed, the target gets a
// ring. Drawn as an overlay in the page and removed right after the capture.
const SPOT = (sel, pad) => `(() => {
  const t = ${sel};
  if (!t) return null;
  // INSTANT: the app scrolls smoothly, and a rect read mid-animation put the
  // ring on the wrong control.
  // Only when it is off screen: centring a control that was already visible
  // scrolled the page, collapsed the client page's dark header, and moved the
  // control out from under the ring.
  const r0 = t.getBoundingClientRect();
  if (r0.top < 70 || r0.bottom > innerHeight - 10) t.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
  const r = t.getBoundingClientRect();
  const o = document.createElement('div');
  o.id = '__spot';
  const p = ${pad};
  Object.assign(o.style, {
    position: 'fixed', left: (r.left - p) + 'px', top: (r.top - p) + 'px',
    width: (r.width + 2 * p) + 'px', height: (r.height + 2 * p) + 'px',
    borderRadius: '12px', boxShadow: '0 0 0 3px #f5b400, 0 0 0 9999px rgba(15,15,15,.55)',
    zIndex: 2147483647, pointerEvents: 'none',
  });
  document.body.appendChild(o);
  window.__spotTarget = t;
  window.__spotPad = p;
  return { x: r.left, y: r.top, w: r.width, h: r.height };
})()`;

// Re-measures the target and moves the ring onto it: a header that collapses
// on scroll (the client page's) shifts everything AFTER the first measure.
const RESPOT = `(() => {
  const t = window.__spotTarget, o = document.getElementById('__spot'), p = window.__spotPad;
  const r = t.getBoundingClientRect();
  Object.assign(o.style, { left: (r.left - p) + 'px', top: (r.top - p) + 'px', width: (r.width + 2 * p) + 'px', height: (r.height + 2 * p) + 'px' });
  return { x: r.left - p, y: r.top - p, w: r.width + 2 * p, h: r.height + 2 * p };
})()`;

async function shot({ file, target, pad = 6, crop = 520 }) {
  let box = null;
  if (target) {
    box = await evaluate(SPOT(target, pad));
    if (!box) throw new Error(`target not found: ${target}`);
    await sleep(700);
    box = await evaluate(RESPOT);
    await sleep(150);
  }
  // A window `crop` tall around the target, clamped to the viewport; the full
  // screen when there is no target or crop is 0.
  // CDP's clip is in DOCUMENT coordinates, so the scroll offset is added: in
  // viewport coordinates a scrolled page captured an off-screen, blank region.
  const { sx, sy } = await evaluate("({ sx: scrollX, sy: scrollY })");
  let clip = { x: sx, y: sy, width: W, height: H, scale: 1 };
  if (box && crop && crop < H) {
    const mid = box.y + box.h / 2;
    const y = Math.max(0, Math.min(H - crop, mid - crop / 2));
    clip = { x: sx, y: sy + y, width: W, height: crop, scale: 1 };
  }
  const { data } = await send("Page.captureScreenshot", { format: "png", clip });
  mkdirSync(dirname(file), { recursive: true });
  await writeFile(file, Buffer.from(data, "base64"));
  await evaluate(`document.getElementById('__spot')?.remove()`);
  return { file, clip, box };
}

createServer(async (req, res) => {
  let body = "";
  for await (const c of req) body += c;
  try {
    const q = JSON.parse(body || "{}");
    let out;
    if (q.op === "go") out = await go(q.url, q.wait);
    else if (q.op === "eval") out = await evaluate(q.expr);
    else if (q.op === "shot") out = await shot(q);
    else if (q.op === "sleep") out = await sleep(q.ms);
    // C1 walk: forget every cookie, so the next sign-in is «a device Sevenz does not know».
    else if (q.op === "clear") { await send("Network.clearBrowserCookies"); out = "ok"; }
    else if (q.op === "login-as") { await send("Network.clearBrowserCookies"); for (const [name, value] of await sessionCookies(q.email)) await send("Network.setCookie", { name, value, url: BASE }); out = "ok"; }
    else if (q.op === "relogin") { for (const [name, value] of await sessionCookies()) await send("Network.setCookie", { name, value, url: BASE }); out = "ok"; }
    else throw new Error(`unknown op ${q.op}`);
    res.end(JSON.stringify({ ok: true, out }));
  } catch (e) {
    res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
  }
}).listen(9555, "127.0.0.1", () => console.log("ready on 9555"));
