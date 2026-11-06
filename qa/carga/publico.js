// LOAD TEST, THE CLIENT'S PUBLIC PAGE: /s/[token] (k6 review of 2026-11-05).
//
// Anyone with a link opens it, no account, so it is the one page a stranger can hammer.
// Reads only: the page itself has no server-side side effect (the two actions on it —
// the document and the feedback — are not called, and they carry their own per-token
// quota). The tokens are the QA owners' share links in DEV, written by
// `qa/carga/tokens.mjs`; nothing here can reach a real client's link.
//
// Run (from dashboard/):
//   node qa/carga/tokens.mjs
//   k6 run -e BASE_URL=https://dev.sevenz.site -e MAX_VUS=100 qa/carga/publico.js
import http from "k6/http";
import { check, sleep, fail } from "k6";
import { SharedArray } from "k6/data";
import { Counter } from "k6/metrics";

const BASE = __ENV.BASE_URL || "https://dev.sevenz.site";
if (!/^https:\/\/dev\.sevenz\.site$|^http:\/\/localhost:\d+$/.test(BASE)) fail(`BASE_URL «${BASE}» no es dev ni localhost`);
const tokens = new SharedArray("tokens", () => JSON.parse(open("../../scripts/ayuda/raw/carga-tokens.json")));
if (!tokens.length) fail("sin tokens: corre node qa/carga/tokens.mjs");

const MAX = Number(__ENV.MAX_VUS || 100);
export const options = {
  scenarios: {
    publico: {
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
  thresholds: { http_req_failed: ["rate<0.01"], http_req_duration: ["p(95)<4000", "p(99)<8000"] },
  userAgent: "Sevenz-carga-k6/1 (prueba de carga en dev, página pública)",
};

const estados = { ok: new Counter("status_2xx"), redir: new Counter("status_3xx"), c4xx: new Counter("status_4xx"), c5xx: new Counter("status_5xx"), c0: new Counter("status_0_sin_respuesta") };
const bloqueados = new Counter("vercel_mitigated");

export default function () {
  const token = tokens[(__VU - 1 + __ITER) % tokens.length];
  const r = http.get(`${BASE}/s/${token}`, { tags: { pantalla: "s_token" }, redirects: 0, timeout: "30s" });
  if (r.headers["X-Vercel-Mitigated"]) bloqueados.add(1);
  (r.status === 0 ? estados.c0 : r.status < 300 ? estados.ok : r.status < 400 ? estados.redir : r.status < 500 ? estados.c4xx : estados.c5xx).add(1);
  check(r, { "s/[token]: 200": (res) => res.status === 200, "s/[token]: enseña el saldo": (res) => res.status === 200 && /Por cobrar|A favor|Sin deuda|saldo/i.test(res.body) });
  sleep(3 + Math.random() * 4);
}

export function handleSummary(data) {
  const m = data.metrics;
  const p = (name, k) => (m[name] && m[name].values ? Math.round(m[name].values[k]) : "—");
  const lines = [
    `peticiones: ${p("http_reqs", "count")} · fallidas: ${(m.http_req_failed.values.rate * 100).toFixed(2)} % · VU máx: ${p("vus_max", "value")} · req/s ${m.http_reqs.values.rate.toFixed(1)}`,
    `duración p50 ${p("http_req_duration", "med")} ms · p90 ${p("http_req_duration", "p(90)")} ms · p95 ${p("http_req_duration", "p(95)")} ms · máx ${p("http_req_duration", "max")} ms`,
    `bloqueadas por Vercel: ${m.vercel_mitigated ? m.vercel_mitigated.values.count : 0}`,
  ];
  for (const name of ["status_2xx", "status_3xx", "status_4xx", "status_5xx", "status_0_sin_respuesta"]) if (m[name]) lines.push(`  ${name} → ${Math.round(m[name].values.count)}`);
  return { stdout: `\n${lines.join("\n")}\n`, [`scripts/ayuda/raw/carga-publico-${MAX}.json`]: JSON.stringify(data) };
}
