// LOAD TEST, PHASE 2: READS ONLY (k6 review of 2026-11-05, owner's go-ahead the same day).
//
// A hundred virtual users walking the owner's read-only screens of DEV with sessions
// minted by `qa/carga/sesiones.mjs`. Nothing here writes: no sale, no abono, no sign-in,
// no form. So nothing can reach Kapso, Resend, Mixpanel (its events fire from browser JS,
// which k6 does not run, or from server actions, which this never calls) or Gemini.
//
// REFUSES ANY HOST THAT IS NOT DEV OR LOCALHOST. Owner's rule of 2026-11-05: «nada debe
// tocar producción (…) ante la duda, es mejor omitir la prueba».
//
// Run (from dashboard/):
//   node qa/carga/sesiones.mjs
//   k6 run -e BASE_URL=https://dev.sevenz.site qa/carga/lectura.js
//
// Shape: a ramp to MAX_VUS virtual users (default 100) over five minutes, each one opening
// a screen, pausing like a person would, and opening the next. The thresholds are Vercel's
// own guide: under 1 % failures, p95 under 4 s. `-e MAX_VUS=300` looks for the ceiling: the
// stages scale with it, and the test does not abort on a failed threshold, so the summary
// says WHERE it broke instead of stopping at the first red.
//
// Measured 2026-11-05, 100 VUs: 3,144 requests, 0 % failed, p95 1,977 ms, nothing
// mitigated by Vercel. The ceiling run is the next line of this history.
import http from "k6/http";
import { check, sleep, fail } from "k6";
import { SharedArray } from "k6/data";
import { Trend, Counter } from "k6/metrics";

const BASE = __ENV.BASE_URL || "https://dev.sevenz.site";
if (!/^https:\/\/dev\.sevenz\.site$|^http:\/\/localhost:\d+$/.test(BASE)) {
  fail(`BASE_URL «${BASE}» no es dev ni localhost: la prueba no corre`);
}

const sesiones = new SharedArray("sesiones", () => JSON.parse(open("../../scripts/ayuda/raw/carga-sesiones.json")));
if (sesiones.length === 0) fail("sin sesiones: corre node qa/carga/sesiones.mjs");

const MAX = Number(__ENV.MAX_VUS || 100);

export const options = {
  scenarios: {
    lectura: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "1m", target: Math.round(MAX * 0.1) },
        { duration: "1m", target: Math.round(MAX * 0.5) },
        { duration: "2m", target: MAX },
        { duration: "1m", target: 0 },
      ],
      gracefulRampDown: "20s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<4000", "p(99)<8000"],
    "http_req_duration{pantalla:dashboard}": ["p(95)<4000"],
    "http_req_duration{pantalla:clients}": ["p(95)<4000"],
    "http_req_duration{pantalla:cliente}": ["p(95)<4000"],
    "http_req_duration{pantalla:productos}": ["p(95)<4000"],
    "http_req_duration{pantalla:reportes}": ["p(95)<6000"],
  },
  userAgent: "Sevenz-carga-k6/1 (prueba de carga en dev)",
};

const bloqueados = new Counter("vercel_mitigated");
const porPantalla = new Trend("pantalla_ms", true);
// One counter per class: k6 only reports a tagged sub-metric when a threshold names it, so
// a ceiling run would otherwise say «failed» without saying 429, 500 or 502.
const estados = { ok: new Counter("status_2xx"), redir: new Counter("status_3xx"), c429: new Counter("status_429"), c4xx: new Counter("status_4xx"), c5xx: new Counter("status_5xx"), c0: new Counter("status_0_sin_respuesta") };

function abrir(cookie, path, pantalla) {
  const r = http.get(`${BASE}${path}`, {
    headers: { Cookie: cookie, Accept: "text/html" },
    tags: { pantalla },
    redirects: 0,
    timeout: "30s",
  });
  if (r.headers["X-Vercel-Mitigated"]) bloqueados.add(1);
  (r.status === 0 ? estados.c0 : r.status < 300 ? estados.ok : r.status < 400 ? estados.redir : r.status === 429 ? estados.c429 : r.status < 500 ? estados.c4xx : estados.c5xx).add(1);
  porPantalla.add(r.timings.duration, { pantalla });
  check(r, {
    [`${pantalla}: 200`]: (res) => res.status === 200,
    [`${pantalla}: con sesión (no redirige a /login)`]: (res) => res.status !== 307 && res.status !== 302,
    [`${pantalla}: no bloqueado por Vercel`]: (res) => !res.headers["X-Vercel-Mitigated"],
  });
  return r;
}

export default function () {
  // Each virtual user keeps one account for its whole life.
  const s = sesiones[(__VU - 1) % sesiones.length];
  abrir(s.cookie, "/dashboard", "dashboard");
  sleep(2 + Math.random() * 3);
  abrir(s.cookie, "/clients", "clients");
  sleep(2 + Math.random() * 3);
  if (s.clientes.length) {
    const id = s.clientes[Math.floor(Math.random() * s.clientes.length)];
    abrir(s.cookie, `/clients/${id}`, "cliente");
    sleep(2 + Math.random() * 3);
  }
  abrir(s.cookie, "/productos", "productos");
  sleep(2 + Math.random() * 3);
  abrir(s.cookie, "/reportes", "reportes");
  sleep(4 + Math.random() * 4);
}

export function handleSummary(data) {
  const m = data.metrics;
  const p = (name, k) => (m[name] && m[name].values ? Math.round(m[name].values[k]) : "—");
  const lines = [
    `peticiones: ${p("http_reqs", "count")} · fallidas: ${(m.http_req_failed.values.rate * 100).toFixed(2)} % · VU máx: ${p("vus_max", "value")} · iteraciones: ${p("iterations", "count")}`,
    `duración p50 ${p("http_req_duration", "med")} ms · p95 ${p("http_req_duration", "p(95)")} ms · p99 ${p("http_req_duration", "p(99)")} ms · máx ${p("http_req_duration", "max")} ms`,
    `bloqueadas por Vercel: ${m.vercel_mitigated ? m.vercel_mitigated.values.count : 0}`,
  ];
  for (const pantalla of ["dashboard", "clients", "cliente", "productos", "reportes"]) {
    const t = m[`http_req_duration{pantalla:${pantalla}}`];
    if (t) lines.push(`  ${pantalla.padEnd(10)} p50 ${Math.round(t.values.med)} ms · p95 ${Math.round(t.values["p(95)"])} ms · máx ${Math.round(t.values.max)} ms`);
  }
  for (const name of ["status_2xx", "status_3xx", "status_429", "status_4xx", "status_5xx", "status_0_sin_respuesta"]) {
    if (m[name]) lines.push(`  ${name} → ${Math.round(m[name].values.count)}`);
  }
  return { stdout: `\n${lines.join("\n")}\n`, [`scripts/ayuda/raw/carga-lectura-${MAX}.json`]: JSON.stringify(data) };
}
