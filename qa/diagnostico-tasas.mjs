// READ ONLY. The daily diagnosis of the three sources of the official rate, written for the
// scheduled task that runs it every morning and for a human running it by hand. It reads the
// sources live, reads the last rows of the DEV branch when .env.local points there, runs the
// same resolver the app runs, and prints what it found in Spanish, with one verdict per line.
// It writes nothing anywhere. Exit code 2 when something is broken, 1 when something needs a
// look, 0 when all is well.
//
// What it cannot see, said here so nobody reads silence as health: production's own rows.
// There is no production key on this machine, on purpose. The code path is the same, so what
// the sources answer here is what they answer to Vercel; what production STORED is checked with
// the read-only query in PL-25.
import tls from "node:tls";
import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { DolarApiProvider } from "../lib/exchange-rate/dolar-api-provider.ts";
import { CurrencyApiProvider } from "../lib/exchange-rate/currency-api-provider.ts";
import { fetchPrevista } from "../lib/exchange-rate/fetch-prevista.ts";
import { readDolarVzla } from "../lib/exchange-rate/dolar-vzla-provider.ts";
import { fetchBcvPageHtml, parseBcvPage } from "../lib/exchange-rate/bcv-page-provider.ts";
import { eurIsPlausible, usdIsPlausible, lastGoodRate } from "../lib/exchange-rate/rate-guard.ts";
import { resolveOfficialRates, describeSources } from "../lib/exchange-rate/resolve-rates.ts";
import { todayInCaracas } from "../lib/exchange-rate/rate-status.ts";

const DEV_REF = "vzqppwrwnmlbrxizskdh";
const PINNED_ISSUER = "Sectigo Public Server Authentication CA DV R36";
const CERT_WARNING_DAYS = 21;

const hallazgos = []; // { nivel: "ok" | "aviso" | "fallo", texto, accion? }
const ok = (texto) => hallazgos.push({ nivel: "ok", texto });
const aviso = (texto, accion) => hallazgos.push({ nivel: "aviso", texto, accion });
const fallo = (texto, accion) => hallazgos.push({ nivel: "fallo", texto, accion });
const pct = (a, b) => `${(((a - b) / b) * 100).toFixed(2)}%`;
const mensaje = (e) => (e instanceof Error ? e.message : String(e));

const hoy = todayInCaracas();
const readings = [];
const vigentes = {}; // source -> {usd, eur, date}

console.log(`# Diagnóstico de las fuentes de tasa · ${hoy} (hora de Venezuela)\n`);

// ── 1. DolarApi ───────────────────────────────────────────────────────────────────────────
try {
  const r = await new DolarApiProvider().getOfficialRates();
  const date = r.rateDate ?? hoy;
  readings.push({ date, usd: r.usd, eur: r.eur, source: "dolarapi" });
  vigentes.dolarapi = { usd: r.usd, eur: r.eur, date };
  const eurBien = eurIsPlausible(r.usd, r.eur);
  const usdBien = usdIsPlausible(r.usd);
  console.log(`DolarApi: ${date} · dólar ${r.usd} · euro ${r.eur}`);
  if (usdBien && eurBien) ok("DolarApi da las dos cifras creíbles. Si ayer no las daba, su fallo está corregido y PL-27 se puede cerrar.");
  if (!eurBien) aviso(`DolarApi sigue dando el euro roto (${r.eur}): el punto de los miles leído como decimal. Sevenz lo descarta y usa las otras dos fuentes.`, "Mirar si contestaron el issue (PL-27). No hace falta tocar código.");
  if (!usdBien) fallo(`DolarApi da el dólar roto (${r.usd}). Es el día que el dólar cruzó Bs. 1.000 con la fuente sin arreglar.`, "Comprobar que DolarVZLA y el BCV lo respaldan (abajo) y que la app no lo retuvo.");
} catch (e) {
  fallo(`DolarApi no responde: ${mensaje(e)}`, "Si DolarVZLA y el BCV responden, la app sigue bien con dos testigos. Si dura días, mirar su estado en https://dolarapi.com.");
}
try {
  const p = await fetchPrevista();
  if (p) readings.push(p);
  console.log(`DolarApi prevista: ${p ? `${p.date} · ${p.usd}/${p.eur}` : "ninguna (normal entre semana)"}`);
} catch (e) {
  aviso(`DolarApi no dio el histórico (prevista): ${mensaje(e)}`);
}

// ── 2. DolarVZLA ──────────────────────────────────────────────────────────────────────────
try {
  const list = await readDolarVzla();
  readings.push(...list);
  const current = list[0];
  console.log(`DolarVZLA: ${list.map((r) => `${r.date} ${r.usd}/${r.eur}`).join(" · ")}`);
  // GET, not HEAD: Cloudflare answers HEAD without the CORS header, and a browser only ever
  // sends GET here. Measured on 2026-11-05: HEAD «sin cabecera», GET «*».
  const head = await fetch("https://rates.dolarvzla.com/bcv/current.json", { headers: { Origin: "https://sevenz.site" }, signal: AbortSignal.timeout(8000) });
  const modified = head.headers.get("last-modified");
  const cors = head.headers.get("access-control-allow-origin");
  const edadHoras = modified ? (Date.now() - new Date(modified).getTime()) / 36e5 : null;
  console.log(`DolarVZLA: modificado hace ${edadHoras === null ? "?" : edadHoras.toFixed(1)} h · CORS ${cors ?? "sin cabecera"}`);
  const vigente = list.find((r) => r.date <= hoy) ?? current;
  vigentes.dolarvzla = vigente;
  if (!usdIsPlausible(current.usd) || !eurIsPlausible(current.usd, current.eur)) fallo(`DolarVZLA da una cifra no creíble: ${current.usd}/${current.eur}.`, "La app la descarta sola. Avisar a contact@dolarvzla.com.");
  if (edadHoras !== null && edadHoras > 96) aviso(`DolarVZLA no se actualiza desde hace ${Math.round(edadHoras / 24)} días (más que un fin de semana largo).`, "Comprobar en https://dolarvzla.com si el proyecto sigue vivo. Mientras, la app tiene a DolarApi y al BCV.");
  if (cors !== "*") fallo("DolarVZLA ya no permite leerlo desde otros sitios (sin CORS): la calculadora de sevenz.site se queda sin esta fuente.", "La calculadora cae a DolarApi; si DolarApi sigue rota, enseña el último euro bueno de su histórico. Escribir a DolarVZLA.");
  else ok("DolarVZLA responde, con cifras creíbles y abierto para la calculadora de sevenz.site.");
} catch (e) {
  fallo(`DolarVZLA no responde: ${mensaje(e)}`, "Si DolarApi sigue con el euro roto, el euro de la app depende solo del BCV (un testigo, tope del 5%). Escribir a contact@dolarvzla.com.");
}

// ── 3. The BCV's page and its certificate ─────────────────────────────────────────────────
try {
  const html = await fetchBcvPageHtml();
  const r = parseBcvPage(html);
  readings.push(r);
  vigentes.bcv = r;
  console.log(`BCV: ${r.date} · dólar ${r.usd} · euro ${r.eur}`);
  ok("La página del BCV se lee con el certificado intermedio fijado y trae las dos cifras.");
} catch (e) {
  const m = mensaje(e);
  if (/no trae lo esperado/.test(m)) fallo(`El BCV cambió su página: ${m}`, "Abrir https://www.bcv.org.ve, ver dónde están ahora el dólar, el euro y «Fecha Valor», y ajustar parseBcvPage en lib/exchange-rate/bcv-page-provider.ts. Mientras, la app sigue con DolarApi y DolarVZLA.");
  else fallo(`La página del BCV no se pudo leer: ${m}`, "Si es un error de certificado, mirar la fila del certificado más abajo. Si es de red, el BCV suele caerse y volver; la app sigue con las otras dos.");
}
try {
  const cert = await new Promise((resolve, reject) => {
    const socket = tls.connect({ host: "www.bcv.org.ve", port: 443, servername: "www.bcv.org.ve", rejectUnauthorized: false, timeout: 8000 }, () => {
      const c = socket.getPeerCertificate();
      socket.end();
      resolve(c);
    });
    socket.on("error", reject);
    socket.on("timeout", () => socket.destroy(new Error("timeout")));
  });
  const vence = new Date(cert.valid_to);
  const dias = Math.round((vence.getTime() - Date.now()) / 864e5);
  const emisor = cert.issuer?.CN ?? "?";
  console.log(`BCV certificado: emitido por «${emisor}», vence ${vence.toISOString().slice(0, 10)} (${dias} días)`);
  if (emisor !== PINNED_ISSUER) fallo(`El BCV renovó su certificado con otro intermedio («${emisor}», y el fijado es «${PINNED_ISSUER}»).`, "Descargar el intermedio nuevo desde la URL «CA Issuers» del certificado (openssl x509 -ext authorityInfoAccess) y reemplazar lib/exchange-rate/bcv-intermediate-cert.ts. Hasta entonces esta fuente falla y la app sigue con las otras dos.");
  else if (dias <= CERT_WARNING_DAYS) aviso(`El certificado del BCV vence en ${dias} días. Si lo renuevan con otro intermedio, esta fuente deja de leerse.`, "Nada que hacer todavía: este diagnóstico avisará el día que cambie el emisor.");
  try {
    await fetch("https://www.bcv.org.ve/", { signal: AbortSignal.timeout(8000) });
    ok("El BCV ya envía su cadena de certificados completa: el intermedio fijado sigue valiendo, pero ya no hace falta.");
  } catch {
    // Expected while the BCV keeps sending the wrong intermediate; nothing to report.
  }
} catch (e) {
  aviso(`No se pudo leer el certificado del BCV: ${mensaje(e)}`);
}

// ── 4. The aggregator (last resort, never official) ───────────────────────────────────────
try {
  const r = await new CurrencyApiProvider().getOfficialRates();
  console.log(`currency-api (respaldo, no oficial): dólar ${r.usd} · euro ${r.eur}`);
  const ref = vigentes.bcv ?? vigentes.dolarvzla ?? vigentes.dolarapi;
  if (ref && Math.abs(r.usd - ref.usd) / ref.usd > 0.05) aviso(`El respaldo currency-api se aleja ${pct(r.usd, ref.usd)} del oficial. Solo importa si las tres fuentes oficiales caen a la vez.`);
} catch (e) {
  aviso(`currency-api no responde: ${mensaje(e)}. Solo importa si las tres fuentes oficiales caen a la vez.`);
}

// ── 5. Do the mirrors agree? ──────────────────────────────────────────────────────────────
console.log("\n## Las fuentes entre sí");
const nombres = Object.keys(vigentes);
for (let i = 0; i < nombres.length; i++) {
  for (let j = i + 1; j < nombres.length; j++) {
    const a = vigentes[nombres[i]];
    const b = vigentes[nombres[j]];
    if (a.date !== b.date) {
      console.log(`${nombres[i]} y ${nombres[j]} hablan de días distintos (${a.date} y ${b.date}); no se comparan.`);
      continue;
    }
    const du = Math.abs(a.usd - b.usd) / b.usd;
    const de = Math.abs(a.eur - b.eur) / b.eur;
    console.log(`${nombres[i]} y ${nombres[j]} (${a.date}): dólar ${pct(a.usd, b.usd)} · euro ${pct(a.eur, b.eur)}`);
    if (du > 0.001 && usdIsPlausible(a.usd) && usdIsPlausible(b.usd)) fallo(`${nombres[i]} y ${nombres[j]} dan dólares distintos y creíbles para el mismo día: ${a.usd} y ${b.usd}.`, "Abrir https://www.bcv.org.ve y ver cuál copia bien. La app usa la que coincide con el BCV; si el BCV no contesta, retiene la última buena.");
    if (de > 0.001 && eurIsPlausible(a.usd, a.eur) && eurIsPlausible(b.usd, b.eur)) fallo(`${nombres[i]} y ${nombres[j]} dan euros distintos y creíbles para el mismo día: ${a.eur} y ${b.eur}.`, "Igual que con el dólar: el BCV decide.");
  }
}

// ── 6. What the app would store right now, judged against the DEV branch's last good row ──
console.log("\n## Lo que la app guardaría ahora");
let lastGood = null;
let supabase = null;
if (existsSync(".env.local")) {
  const env = Object.fromEntries(
    readFileSync(".env.local", "utf8")
      .split(/\r?\n/)
      .filter((l) => l.includes("=") && !l.startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
      }),
  );
  const ref = env.NEXT_PUBLIC_SUPABASE_URL ? new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0] : "";
  if (ref === DEV_REF && env.SUPABASE_SERVICE_ROLE_KEY) supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  else console.log(`.env.local no apunta a la rama dev (${ref || "sin URL"}): no se leen filas de la base.`);
}
if (supabase) {
  const { data: rows, error } = await supabase
    .from("bcv_exchange_rate_fetches")
    .select("fetched_at, usd, eur, source, rate_date, needs_review")
    .order("fetched_at", { ascending: false })
    .limit(200);
  if (error) aviso(`No se pudieron leer las filas de dev: ${error.message}`);
  else {
    lastGood = lastGoodRate(rows.filter((r) => !r.needs_review));
    const newest = rows[0];
    const edadHoras = newest ? (Date.now() - new Date(newest.fetched_at).getTime()) / 36e5 : null;
    console.log(`DEV (${DEV_REF}), últimas filas:`);
    for (const r of rows.slice(0, 3)) console.log(`  ${r.fetched_at.slice(0, 16)} · ${r.rate_date} · ${r.usd}/${r.eur} · ${r.source}${r.needs_review ? " · EN REVISIÓN" : ""}`);
    const retenidas = rows.filter((r) => /held:/.test(r.source ?? "")).length;
    const revisadas24 = rows.filter((r) => r.needs_review && Date.now() - new Date(r.fetched_at).getTime() < 864e5).length;
    if (newest && /held:/.test(newest.source ?? "")) aviso(`La última fila de dev lleva una cifra retenida (${newest.source}): la app enseña un número de otro día.`, "Ver arriba qué fuente falta. Es el caso de PL-25.");
    if (revisadas24 > 0) aviso(`${revisadas24} filas de dev en revisión en las últimas 24 h.`, "Ver arriba por qué ninguna fuente convenció.");
    if (retenidas === 0 && revisadas24 === 0) ok("Las filas recientes de dev salen sin retener ni revisar.");
    if (edadHoras !== null && edadHoras > 48) console.log(`  (la última fila tiene ${Math.round(edadHoras)} h: nadie ha usado dev desde entonces, es normal)`);
  }
}
if (readings.length === 0) {
  fallo("Ninguna fuente dio una lectura: la app guardaría el respaldo currency-api en revisión, o nada.", "Esperar una hora y repetir. Si sigue, es un corte de red general o las tres fuentes caídas.");
} else {
  const res = resolveOfficialRates(readings, hoy, lastGood);
  console.log(`Resolución: ${res.date} · dólar ${res.usd.value} (${res.usd.witnesses.join("+") || "retenido"}) · euro ${res.eur.value} (${res.eur.witnesses.join("+") || "retenido"}) · ${describeSources(res)}`);
  console.log(`  ${res.usd.reason}\n  ${res.eur.reason}`);
  if (res.prevista) console.log(`  prevista ${res.prevista.date} · ${res.prevista.usd}/${res.prevista.eur} (${res.prevista.source})`);
  if (res.usd.held || res.eur.held) aviso(`La app RETENDRÍA una cifra ahora mismo: ${describeSources(res)}. ${res.usd.held ? res.usd.reason : res.eur.reason}`, "Es el caso de PL-25: el número que ven los tendederos es de otro día. Mirar arriba qué fuente falta o discrepa.");
  if (res.needsReview) fallo("La app no tendría ninguna cifra creíble ni nada que retener: la fila iría a revisión.", "Mirar arriba. Es el peor caso: cada pantalla intenta refrescar y nada entra.");
  if (!res.usd.held && !res.eur.held && !res.needsReview) {
    const testigos = Math.min(res.usd.witnesses.length, res.eur.witnesses.length);
    if (testigos >= 2) ok(`La tasa de hoy la respaldan al menos dos fuentes en las dos monedas (${describeSources(res)}).`);
    else aviso(`La tasa de hoy tiene un solo testigo en alguna moneda (${describeSources(res)}): entra por estar dentro del 5% de la última buena, sin nadie que la confirme.`, "Ver qué fuente falta arriba.");
  }
}

// ── 7. Verdict ────────────────────────────────────────────────────────────────────────────
console.log("\n## Veredicto");
const icono = { ok: "✅", aviso: "⚠️", fallo: "❌" };
for (const h of hallazgos) console.log(`${icono[h.nivel]} ${h.texto}${h.accion ? `\n   → ${h.accion}` : ""}`);
console.log("\nNo visto: las filas de PRODUCCIÓN (rabmiyqodnvnrwiartuj). Las fuentes son las mismas; lo que producción guardó se mira con la consulta de solo lectura de PL-25.");
const peor = hallazgos.some((h) => h.nivel === "fallo") ? 2 : hallazgos.some((h) => h.nivel === "aviso") ? 1 : 0;
console.log(`\nResultado: ${["todo en orden", "hay algo que mirar", "hay algo roto"][peor]}.`);
process.exit(peor);
