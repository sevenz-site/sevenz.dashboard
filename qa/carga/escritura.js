// LOAD TEST, PHASE 3: WRITES (k6 review of 2026-11-05, owner's go-ahead the same day).
//
// Up to MAX_VUS virtual users, EACH ONE ITS OWN TEST ACCOUNT (qa/carga/cuentas.mjs), each
// opening Inicio and then registering sales through the real server action `registrarVenta`
// — a cash sale, then a credit sale — the way the browser does: a POST to the page with the
// `next-action` header and the arguments as the Flight body.
//
// WHERE THIS RUNS, AND WHY: against a production build of this repo on THIS machine
// (`npm run build` + `next start -p 3100`), built with the analytics, WhatsApp, email and AI
// keys BLANK, so nothing the writes trigger can leave the machine; the database is the dev
// branch. The owner's rule of 2026-11-05: «nada debe tocar producción (WhatsApp, Mixpanel,
// Gemini)… ante la duda, es mejor omitir la prueba». Refuses any BASE_URL that is not
// localhost.
//
// Run (from dashboard/):
//   node qa/carga/cuentas.mjs
//   PATRON='qa-carga-%@sevenz-qa.test' node qa/carga/sesiones.mjs
//   node qa/carga/acciones.mjs
//   k6 run -e BASE_URL=http://localhost:3100 -e MAX_VUS=100 qa/carga/escritura.js
import http from "k6/http";
import { check, sleep, fail } from "k6";
import { SharedArray } from "k6/data";
import { Counter, Trend } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://localhost:3100";
if (!/^http:\/\/localhost:\d+$/.test(BASE)) fail(`BASE_URL «${BASE}» no es localhost: la prueba de escritura no corre`);

const sesiones = new SharedArray("sesiones", () => JSON.parse(open("../../scripts/ayuda/raw/carga-sesiones.json")));
const cuentas = new SharedArray("cuentas", () => JSON.parse(open("../../scripts/ayuda/raw/carga-cuentas.json")));
const acciones = JSON.parse(open("../../scripts/ayuda/raw/carga-acciones.json"));
if (!sesiones.length || !cuentas.length || !acciones.registrarVenta) fail("faltan sesiones, cuentas o ids de acciones");

const MAX = Number(__ENV.MAX_VUS || 100);
export const options = {
  scenarios: {
    escritura: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "1m", target: Math.round(MAX * 0.1) },
        { duration: "1m", target: Math.round(MAX * 0.5) },
        { duration: "2m", target: MAX },
        { duration: "1m", target: 0 },
      ],
      gracefulRampDown: "30s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    "http_req_duration{tipo:pagina}": ["p(95)<4000"],
    "http_req_duration{tipo:venta}": ["p(95)<4000"],
    "venta_ms{modo:contado}": ["p(95)<4000"],
    "venta_ms{modo:fiado}": ["p(95)<4000"],
    ventas_rechazadas: ["count<1"],
  },
  userAgent: "Sevenz-carga-k6/1 (prueba de escritura en dev)",
};

const ventasOk = new Counter("ventas_ok");
const ventasRechazadas = new Counter("ventas_rechazadas");
const ventasMs = new Trend("venta_ms", true);
const estados = { ok: new Counter("status_2xx"), c4xx: new Counter("status_4xx"), c5xx: new Counter("status_5xx"), c0: new Counter("status_0_sin_respuesta") };

function cuentaDe(vu) {
  // Sessions and accounts are written in the same order; match by email to be safe.
  const s = sesiones[(vu - 1) % sesiones.length];
  const c = cuentas.find((x) => x.email === s.email) || cuentas[(vu - 1) % cuentas.length];
  return { cookie: s.cookie, cuenta: c };
}

function venta(cookie, cuenta, modo) {
  // cuentas.mjs prices product k at 5·k dollars; a cash sale must pay the whole line or the
  // app refuses it («no cubre la venta y no hay plazo»). The first run paid $5 for every
  // product and half the cash sales were refused — correctly — which looked like a failure.
  const idx = Math.floor(Math.random() * cuenta.productos.length);
  const producto = cuenta.productos[idx];
  const precio = 5 * (idx + 1);
  const cliente = cuenta.clientes[Math.floor(Math.random() * cuenta.clientes.length)];
  const entrada = {
    clientId: cliente,
    lineas: [{ productId: producto, quantity: 1, currency: "USD" }],
    pagos: modo === "contado" ? [{ currency: "USD", amount: precio }] : [],
    credito: modo === "contado" ? [] : [{ currency: "USD", plazoDias: 7, cuotas: null }],
    nota: null,
  };
  const r = http.post(`${BASE}/ventas/nueva`, JSON.stringify([entrada]), {
    headers: { Cookie: cookie, "next-action": acciones.registrarVenta, accept: "text/x-component", "content-type": "text/plain;charset=UTF-8", origin: BASE },
    tags: { tipo: "venta", modo },
    redirects: 0,
    timeout: "30s",
  });
  (r.status === 0 ? estados.c0 : r.status < 300 ? estados.ok : r.status < 500 ? estados.c4xx : estados.c5xx).add(1);
  ventasMs.add(r.timings.duration, { modo });
  const ok = r.status === 200 && /"ok":true/.test(r.body);
  if (ok) ventasOk.add(1); else ventasRechazadas.add(1);
  check(r, { [`venta ${modo}: 200 y ok:true`]: () => ok });
  return ok;
}

export default function () {
  const { cookie, cuenta } = cuentaDe(__VU);
  const r = http.get(`${BASE}/dashboard`, { headers: { Cookie: cookie }, tags: { tipo: "pagina" }, redirects: 0, timeout: "30s" });
  check(r, { "dashboard: 200": (res) => res.status === 200 });
  sleep(1 + Math.random() * 2);
  venta(cookie, cuenta, "contado");
  sleep(2 + Math.random() * 3);
  venta(cookie, cuenta, "fiado");
  sleep(3 + Math.random() * 4);
}

export function handleSummary(data) {
  const m = data.metrics;
  const p = (name, k) => (m[name] && m[name].values ? Math.round(m[name].values[k]) : "—");
  const lines = [
    `peticiones: ${p("http_reqs", "count")} · fallidas: ${(m.http_req_failed.values.rate * 100).toFixed(2)} % · VU máx: ${p("vus_max", "value")} · iteraciones: ${p("iterations", "count")}`,
    `ventas ok: ${m.ventas_ok ? p("ventas_ok", "count") : 0} · rechazadas: ${m.ventas_rechazadas ? p("ventas_rechazadas", "count") : 0}`,
  ];
  for (const [label, key] of [["pagina", "http_req_duration{tipo:pagina}"], ["venta", "http_req_duration{tipo:venta}"], ["contado", "venta_ms{modo:contado}"], ["fiado", "venta_ms{modo:fiado}"]]) {
    const x = m[key];
    if (x) lines.push(`  ${label.padEnd(7)} p50 ${Math.round(x.values.med)} ms · p95 ${Math.round(x.values["p(95)"])} ms · máx ${Math.round(x.values.max)} ms`);
  }
  for (const name of ["status_2xx", "status_4xx", "status_5xx", "status_0_sin_respuesta"]) if (m[name]) lines.push(`  ${name} → ${Math.round(m[name].values.count)}`);
  return { stdout: `\n${lines.join("\n")}\n`, [`scripts/ayuda/raw/carga-escritura-${MAX}.json`]: JSON.stringify(data) };
}
