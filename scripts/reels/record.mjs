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
    } else if (m.method === "Page.fileChooserOpened") {
      // The native picker never opens: the file the flow queued goes straight in.
      const file = fileQueue.shift();
      if (file) send("DOM.setFileInputFiles", { files: [file], backendNodeId: m.params.backendNodeId }).catch((e) => console.log("  ✖ file:", e.message));
      else console.log("  ✖ a file picker opened with no file queued");
    } else if (m.method) events.push(m.method);
  };
  const fileQueue = [];
  const evaluate = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result?.value;
  };

  await send("Page.enable"); await send("Network.enable"); await send("Runtime.enable"); await send("DOM.enable");
  await send("Page.setInterceptFileChooserDialog", { enabled: true });
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
    // The Next dev indicator («N», «Rendering…», «1 Issue») is not part of the app. A style
    // added before <head> exists is dropped when React takes the document over (it showed in
    // every frame on 2026-11-27), so it is added on DOMContentLoaded and put back by an
    // observer whenever it goes missing.
    (() => {
      const ensure = () => {
        if (document.getElementById('__reel_hide') || !document.head) return;
        const s = document.createElement('style'); s.id = '__reel_hide';
        s.textContent = 'nextjs-portal{display:none!important}';
        document.head.appendChild(s);
      };
      document.addEventListener('DOMContentLoaded', ensure);
      new MutationObserver(ensure).observe(document, { childList: true, subtree: true });
    })();
  ` });

  const go = async (url, wait = 3000) => {
    // A navigation while recording is a wait on the server, played fast like any other: it
    // left 2-4 s of blank loading screen in the devolución and mala paga videos.
    if (recording) timeline.push({ name: "ff", wall: Date.now() / 1000 });
    events.length = 0;
    await send("Page.navigate", { url: BASE + url });
    for (let i = 0; i < 120 && !events.includes("Page.loadEventFired"); i++) await sleep(250);
    if (recording) timeline.push({ name: "ff_end", wall: Date.now() / 1000 });
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
    sleep, evaluate, go, FIND, DIALOG, demo: DEMO,
    mark: (name) => { timeline.push({ name, wall: Date.now() / 1000 }); console.log("  mark", name); },
    // Waiting on the server («Guardando…»): compose.py plays this stretch fast, so a slow dev
    // server does not eat a third of a 25-second clip. Only server waits go in here, never a
    // pause meant for reading.
    async server(fn) {
      timeline.push({ name: "ff", wall: Date.now() / 1000 });
      try { return await fn(); } finally { timeline.push({ name: "ff_end", wall: Date.now() / 1000 }); }
    },
    // A real touch at the element's centre, with the orange marker drawn first.
    async tap(expr) {
      await api.reveal(expr);
      const r = await rectOf(expr);
      if (!r) throw new Error(`tap: not found ${expr.slice(0, 80)}`);
      await evaluate(`window.__tap(${r.x}, ${r.y})`);
      await sleep(120);
      await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: r.x, y: r.y }] });
      await sleep(60);
      await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    },
    // A target off screen, or under the fixed bars (the top 70px, the bottom 100px), is
    // scrolled to the middle first, smoothly and on camera, the way a person would.
    //
    // «Visible» means the point the finger lands on belongs to the target. A bottom bar or the
    // «Registrar» button can sit on top of it, and a tap there presses THEM: on 2026-11-27 a
    // tap meant for «Repartir manualmente» ticked the client's WhatsApp consent, and one meant
    // for a fiado opened a new sale. If it stays covered after scrolling, the flow stops.
    async reveal(expr) {
      const clear = `(() => { const e = ${expr}; if (!e) return null; const b = e.getBoundingClientRect();
        if (b.top < 0 || b.bottom > innerHeight - 4) return false;
        const h = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        return !!h && (h === e || e.contains(h) || h.contains(e)); })()`;
      const first = await evaluate(clear);
      if (first === null || first === true) return;
      for (const block of ["center", "start"]) {
        await evaluate(`(() => { const e = ${expr}; e.scrollIntoView({ block: '${block}', behavior: 'smooth' }); })()`);
        await sleep(900);
        if (block === "start") { await evaluate("window.scrollBy({ top: -120, behavior: 'smooth' })"); await sleep(600); }
        if (await evaluate(clear)) return;
      }
      throw new Error(`covered, will not tap: ${expr.slice(0, 80)}`);
    },
    // Radix menus, selects and dropdowns open on a mouse pointerdown, not on a touch tap.
    async menu(expr) {
      await api.reveal(expr);
      const r = await rectOf(expr);
      if (!r) throw new Error(`menu: not found ${expr.slice(0, 80)}`);
      await evaluate(`window.__tap(${r.x}, ${r.y})`);
      await sleep(120);
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: r.x, y: r.y });
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x: r.x, y: r.y, button: "left", clickCount: 1 });
      await sleep(60);
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: r.x, y: r.y, button: "left", clickCount: 1 });
    },
    // An item of the open menu/select/listbox, by its text.
    async pick(text) {
      const expr = `[...document.querySelectorAll('[role=menuitem],[role=option],[role=menuitemradio],[role=menuitemcheckbox]')].find(e=>{const t=e.textContent.replace(/\\s+/g,' ').trim(); return t===${JSON.stringify(text)}||t.startsWith(${JSON.stringify(text)})})`;
      await api.menu(expr);
    },
    async type(text, gap = 200) { for (const ch of text) { await send("Input.insertText", { text: ch }); await sleep(gap); } },
    // Smooth scroll that puts the element `top` px from the top of the screen (or centres it).
    async scrollTo(expr, top = null) {
      await evaluate(`(() => { const e = ${expr}; if (!e) return; ${top === null
        ? "e.scrollIntoView({ block: 'center', behavior: 'smooth' });"
        : `const s = (n => { while (n && n !== document.body) { const o = getComputedStyle(n).overflowY; if ((o === 'auto' || o === 'scroll') && n.scrollHeight > n.clientHeight) return n; n = n.parentElement; } return null; })(e.parentElement);
           if (s) s.scrollBy({ top: e.getBoundingClientRect().top - s.getBoundingClientRect().top - ${top}, behavior: 'smooth' });
           else window.scrollBy({ top: e.getBoundingClientRect().top - ${top}, behavior: 'smooth' });`} })()`);
    },
    async scrollIntoView(expr) { await api.scrollTo(expr); },
    async waitFor(expr, ms = 30000) {
      for (let t = 0; t < ms; t += 250) { if (await evaluate(`!!(${expr})`)) return; await sleep(250); }
      throw new Error(`waitFor timed out: ${expr.slice(0, 100)}`);
    },
    async assert(expr, what) { if (!(await evaluate(expr))) throw new Error(`assert failed: ${what}`); },
    // The next native file picker the page opens gets this file.
    queueFile(path) { fileQueue.push(path); },
    asset: (name) => join(HERE, "assets", name),
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

  try {
    await flow(api);
  } catch (e) {
    // What the screen showed when the flow broke, for whoever fixes the flow.
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(OUT, "error.png"), Buffer.from(data, "base64"));
    console.log(`  ✖ ${e.message}\n    pantalla en ${join(OUT, "error.png")}`);
    throw e;
  }
  writeFileSync(join(OUT, "timeline.json"), JSON.stringify({ flow: FLOW, viewport: VP, frames, timeline, extras }, null, 1));
  console.log(`frames ${frames.length} -> ${OUT}`);
  ws.close();
} finally {
  chrome.kill();
}
process.exit(0);
