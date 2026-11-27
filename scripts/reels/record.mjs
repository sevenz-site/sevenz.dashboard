// Records one app flow for a Reel, as a CDP screencast of headless Chrome.
//
//   node scripts/reels/record.mjs <flow>        e.g. calculadora-de-tasa
//
// DEV ONLY, same as scripts/ayuda/daemon.mjs: it refuses to run unless
// `.env.local` points at the dev branch (vzqppwrwnmlbrxizskdh), and signs in as
// the DEMO business by magic link (generateLink + verifyOtp). No password is ever
// typed or stored. Needs `npm run dev` on localhost:3000.
//
// The flow itself lives in flows/<flow>.mjs and only says what to tap and type.
// Output, in output/reels/work/<flow>/ (git-ignored): frames/*.jpg, timeline.json
// (frame times plus the flow's named marks) and whatever the flow saves as extras.
import { createRequire } from "node:module";
import { readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const DASH = join(HERE, "..", "..");
const FLOW = process.argv[2];
if (!FLOW) throw new Error("Usage: node scripts/reels/record.mjs <flow>");
const flow = (await import(pathToFileURL(join(HERE, "flows", `${FLOW}.mjs`)).href)).default;
const TOKENS = JSON.parse(readFileSync(join(HERE, "tokens.json"), "utf8"));
const { viewport: VP, tap: TAP } = TOKENS.recording;

const { createClient } = createRequire(join(DASH, "package.json"))("@supabase/supabase-js");
const DEMO = JSON.parse(readFileSync(join(DASH, "scripts", "ayuda", "demo-manifest.json"), "utf8"));
const env = Object.fromEntries(
  readFileSync(join(DASH, ".env.local"), "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
const REF = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
if (REF !== "vzqppwrwnmlbrxizskdh") throw new Error(`Dev only, not ${REF}.`);
const BASE = "http://localhost:3000";

async function sessionCookies(email = DEMO.email) {
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const { data: s, error } = await anon.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  if (error) throw new Error(`verifyOtp: ${error.message}`);
  const v = "base64-" + Buffer.from(JSON.stringify(s.session), "utf8").toString("base64url");
  const MAX = 3180;
  return v.length <= MAX ? [[`sb-${REF}-auth-token`, v]]
    : Array.from({ length: Math.ceil(v.length / MAX) }, (_, i) => [`sb-${REF}-auth-token.${i}`, v.slice(i * MAX, (i + 1) * MAX)]);
}

const OUT = join(DASH, "output", "reels", "work", FLOW);
const FR = join(OUT, "frames");
rmSync(OUT, { recursive: true, force: true });
mkdirSync(FR, { recursive: true });

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9468;
// The profile name is how a leftover Chrome is found and killed: `sevenz-reel-`.
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(tmpdir(), `sevenz-reel-${Date.now()}`)}`,
  "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "--disable-features=Translate", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  let list;
  for (let i = 0; i < 120; i++) { try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (list.find((t) => t.type === "page")) break; } catch {} await sleep(250); }
  const ws = new WebSocket(list.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let n = 0; const pending = new Map(); const events = [];
  const frames = []; let recording = false;
  const send = (method, params = {}) => new Promise((res, rej) => { const id = ++n; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); return; }
    if (m.method === "Page.screencastFrame") {
      send("Page.screencastFrameAck", { sessionId: m.params.sessionId }).catch(() => {});
      if (recording) {
        const f = `f${String(frames.length).padStart(5, "0")}.jpg`;
        writeFileSync(join(FR, f), Buffer.from(m.params.data, "base64"));
        frames.push({ f, wall: Date.now() / 1000 });
      }
    } else if (m.method) events.push(m.method);
  };
  const evaluate = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result?.value;
  };

  await send("Page.enable"); await send("Network.enable"); await send("Runtime.enable");
  // Keep recordings out of the analytics.
  await send("Network.setBlockedURLs", { urls: ["*mixpanel*"] });
  await send("Emulation.setDeviceMetricsOverride", { width: VP.width, height: VP.height, deviceScaleFactor: VP.deviceScaleFactor, mobile: true });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (Linux; Android 14; SM-S906B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36" });
  for (const [name, value] of await sessionCookies()) await send("Network.setCookie", { name, value, url: BASE });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `
    try { sessionStorage.setItem('sevenz:instalar-descartado','1'); localStorage.setItem('sevenz:instalar-descartado','1'); } catch {}
    // Headless Chrome has no share sheet: keep the file the app would share instead.
    try {
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
      Object.defineProperty(navigator, 'share', { configurable: true, value: async (d) => {
        if (d && d.files && d.files[0]) window.__shared = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(d.files[0]); });
      } });
    } catch {}
    // The tap marker (CLAUDE.md, «Los Reels de Sevenz»: brand orange, never yellow).
    window.__tap = (x, y) => {
      const s = ${TAP.size}, d = document.createElement('div');
      Object.assign(d.style, { position: 'fixed', left: (x - s / 2) + 'px', top: (y - s / 2) + 'px', width: s + 'px', height: s + 'px', borderRadius: '50%',
        background: '${TAP.fill}', border: '3px solid ${TAP.ring}', zIndex: 2147483647, pointerEvents: 'none',
        transition: 'transform .55s ease-out, opacity .55s ease-out', transform: 'scale(.6)', opacity: '1' });
      document.body.appendChild(d);
      requestAnimationFrame(() => requestAnimationFrame(() => { d.style.transform = 'scale(1.5)'; d.style.opacity = '0'; }));
      setTimeout(() => d.remove(), 700);
    };
    document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = 'nextjs-portal{display:none!important}'; document.head.appendChild(s); });
  ` });

  const go = async (url, wait = 3000) => {
    events.length = 0;
    await send("Page.navigate", { url: BASE + url });
    for (let i = 0; i < 120 && !events.includes("Page.loadEventFired"); i++) await sleep(250);
    await sleep(wait);
  };
  // The first visible control whose text equals, starts with or contains `text`.
  const FIND = (text, scope = "document") => `(() => {
    const want = ${JSON.stringify(text)};
    const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const label = (e) => (e.getAttribute('aria-label') || e.textContent || e.value || '').replace(/\\s+/g, ' ').trim();
    const els = [...${scope}.querySelectorAll('button,a,[role=button],input,label')].filter(vis);
    return els.find((e) => label(e) === want) || els.find((e) => label(e).startsWith(want)) || els.find((e) => label(e).includes(want)) || null;
  })()`;
  const DIALOG = "(document.querySelector('[role=dialog]')||document)";
  const rectOf = (expr) => evaluate(`(() => { const e = ${expr}; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  const timeline = [];
  const extras = {};

  const api = {
    sleep, evaluate, go, FIND, DIALOG,
    mark: (name) => { timeline.push({ name, wall: Date.now() / 1000 }); console.log("  mark", name); },
    // A real touch at the element's centre, with the orange marker drawn first.
    async tap(expr) {
      const r = await rectOf(expr);
      if (!r) throw new Error(`tap: not found ${expr.slice(0, 80)}`);
      await evaluate(`window.__tap(${r.x}, ${r.y})`);
      await sleep(120);
      await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: r.x, y: r.y }] });
      await sleep(60);
      await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    },
    async type(text, gap = 220) { for (const ch of text) { await send("Input.insertText", { text: ch }); await sleep(gap); } },
    async scrollIntoView(expr) { await evaluate(`(() => { const e = ${expr}; e && e.scrollIntoView({ block: 'center', behavior: 'smooth' }); })()`); },
    async assert(expr, what) { if (!(await evaluate(expr))) throw new Error(`assert failed: ${what}`); },
    // Saves a data URL the page produced (for example the shared card) next to the frames.
    async saveShared(file) {
      const url = await evaluate("window.__shared || null");
      if (url) { writeFileSync(join(OUT, file), Buffer.from(url.split(",")[1], "base64")); extras[file] = true; }
      return !!url;
    },
    async startRecording() {
      await send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: VP.width * VP.deviceScaleFactor, maxHeight: VP.height * VP.deviceScaleFactor, everyNthFrame: 1 });
      recording = true;
      await sleep(400);
    },
    async stopRecording() { await sleep(300); recording = false; await send("Page.stopScreencast"); },
    note: (k, v) => { extras[k] = v; },
  };

  await flow(api);
  writeFileSync(join(OUT, "timeline.json"), JSON.stringify({ flow: FLOW, viewport: VP, frames, timeline, extras }, null, 1));
  console.log(`frames ${frames.length} -> ${OUT}`);
  ws.close();
} finally {
  chrome.kill();
}
process.exit(0);
