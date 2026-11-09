// `new_device_login_alert` AND `account_change_alert`: WHAT LEAVES FOR KAPSO (PL-40).
//
// DEV ONLY (vzqppwrwnmlbrxizskdh), and NOTHING LEAVES FOR KAPSO: `fetch` is intercepted before
// it reaches them and the suite asserts what would have gone. Writes one throw-away business,
// its devices, tokens and `whatsapp_sends` rows, and removes them at the end.
//
// WHY IT EXISTS. Both alerts shipped switched off in v0.4.0, and until 2026-11-09 nothing ran
// the code that builds their message: `qa:new-device` checks the database functions and the
// words, and `qa/plantillas-esperadas.mjs` had a row for each that no suite read. A template
// whose parameters do not match what Meta approved fails whole and in silence (46 receipts on
// 2026-10-15), and for these two the silence is the worst case: the shopkeeper believes the
// account is watched and no alert ever arrives. This runs the real functions, with the
// switches on, and compares the envelope with the approved shape.
//
// `next/headers` only works inside a Next request, so a loader hook swaps it for a stub that
// reads the cookie jar and the headers this suite sets before each sign-in.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { register } from "node:module";
import { createClient } from "@supabase/supabase-js";
import { PLANTILLAS_ESPERADAS } from "./plantillas-esperadas.mjs";

const STUB = "data:text/javascript," + encodeURIComponent(
  "export async function cookies(){return globalThis.__qaRequest.cookies}" +
  "export async function headers(){return globalThis.__qaRequest.headers}",
);
register("data:text/javascript," + encodeURIComponent(
  `export async function resolve(s,c,n){if(s==="next/headers"||s==="next/headers.js")return{url:${JSON.stringify(STUB)},shortCircuit:true};return n(s,c)}`,
));

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
if (!env.NEXT_PUBLIC_SUPABASE_URL?.includes("vzqppwrwnmlbrxizskdh")) {
  console.error("ME NIEGO A CORRER: .env.local no apunta a la rama dev.");
  process.exit(1);
}
for (const [k, v] of Object.entries(env)) process.env[k] ??= v;
process.env.KAPSO_API_KEY ||= "qa-sin-clave";
delete process.env.NEW_DEVICE_ALERTS;
delete process.env.ACCOUNT_CHANGE_ALERTS;

const filas = [];
const check = (nombre, pasa, detalle = "") => {
  filas.push(pasa);
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${pasa || !detalle ? "" : `  — ${detalle}`}`);
};

// Everything that is not the database stops here: Kapso, and Mixpanel behind it.
const fetchReal = globalThis.fetch;
const aKapso = [];
let kapsoCaido = false;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes("kapso.ai")) {
    aKapso.push({ url: u, cuerpo: JSON.parse(init.body) });
    if (kapsoCaido) return new Response("caído", { status: 500 });
    return new Response(JSON.stringify({ messages: [{ id: "qa" }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (!u.includes(new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname)) return new Response("{}", { status: 200 });
  return fetchReal(url, init);
};

const { recordLoginDevice } = await import("../lib/security/new-device.ts");
const { notifyAccountChange } = await import("../lib/security/second-factor.ts");
const { DEVICE_COOKIE } = await import("../lib/security/device-text.ts");

const UA = {
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  android: "Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  firefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
};
// One sign-in: the cookie the browser brings (or none) and what Vercel says about it.
const signIn = async (user, cookie, ua, country, city) => {
  const jar = new Map(cookie ? [[DEVICE_COOKIE, cookie]] : []);
  const h = { "user-agent": ua, "x-vercel-ip-country": country, "x-vercel-ip-city": city };
  globalThis.__qaRequest = {
    cookies: { get: (n) => (jar.has(n) ? { name: n, value: jar.get(n) } : undefined), set: (n, v) => jar.set(n, v) },
    headers: { get: (k) => h[k.toLowerCase()] ?? null },
  };
  const r = await recordLoginDevice(user);
  return { r, cookie: jar.get(DEVICE_COOKIE) };
};
const sobre = (m) => {
  const c = m?.cuerpo?.template?.components ?? [];
  const body = c.find((x) => x.type === "body");
  return {
    plantilla: m?.cuerpo?.template?.name,
    idioma: m?.cuerpo?.template?.language?.code,
    to: m?.cuerpo?.to,
    nombres: body?.parameters?.map((p) => p.parameter_name),
    textos: Object.fromEntries((body?.parameters ?? []).map((p) => [p.parameter_name, p.text])),
    boton: c.find((x) => x.type === "button"),
    lineaDeDuenos: m?.url?.includes("1373508439159674"),
  };
};
// What Meta approved for both: a dynamic URL button whose suffix is POSITIONAL, so it goes
// with no `parameter_name` even though the body is NAMED. The suffix is the one-use token.
const botonBien = (b) =>
  b?.sub_type === "url" && b.index === "0" && b.parameters?.length === 1 &&
  !("parameter_name" in b.parameters[0]) && /^[A-Za-z0-9_-]{32}$/.test(b.parameters[0].text ?? "");
const textosLimpios = (t) => Object.values(t).every((x) => x && !/[\n\t]| {5}/.test(x));
const sha256 = (v) => createHash("sha256").update(v).digest("hex");
// The clock of a zone right now and a minute ago, as HH:MM: the send happened between the two.
const horaEn = (zona) => [0, 60_000].map((atras) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: zona, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(Date.now() - atras)));

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const email = `qa-security-alerts-${Date.now().toString(36)}@sevenz-qa.test`;
const NUMERO = "570000000001";
let ownerId = null;
try {
  const { data: u, error } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { business_name: "QA Alertas", country: "VE", first_name: "QA", last_name: "Alertas" } });
  if (error) throw new Error(`createUser: ${error.message}`);
  ownerId = u.user.id;
  const { error: eW } = await admin.from("owners").update({ whatsapp: NUMERO }).eq("id", ownerId);
  if (eW) throw new Error(`owners.whatsapp: ${eW.message}`);
  const user = { id: ownerId, email };

  // ── 1. The new-device alert ────────────────────────────────────────────
  const esperadoAparato = PLANTILLAS_ESPERADAS.new_device_login_alert;
  process.env.NEW_DEVICE_ALERTS = "on";

  const a = await signIn(user, null, UA.iphone, "VE", "Barquisimeto");
  check("1a. encendido: el primer aparato de la cuenta entra sin aviso", a.r.isNew === true && a.r.alerted === false && aKapso.length === 0, JSON.stringify(a.r));
  check("1b. y el navegador se lleva su cookie de aparato", /^[A-Za-z0-9_-]{32,}$/.test(a.cookie ?? ""), String(a.cookie));

  const b = await signIn(user, a.cookie, UA.iphone, "VE", "Caracas");
  check("1c. la misma cookie desde otra ciudad: conocido, sin aviso", b.r.isNew === false && b.r.alerted === false && aKapso.length === 0, JSON.stringify(b.r));

  // The place a device is known by is its LAST one: 1c moved this iPhone to Caracas, so a
  // cookie-less sign-in is recognised from Caracas and would NOT be from Barquisimeto.
  const c = await signIn(user, null, UA.iphone, "VE", "Caracas");
  check("1d. cookie borrada, mismo navegador y su última ciudad: conocido por lugar, sin aviso", c.r.isNew === false && aKapso.length === 0, JSON.stringify(c.r));

  delete process.env.NEW_DEVICE_ALERTS;
  const d = await signIn(user, null, UA.windows, "CO", "Bogot%C3%A1");
  check("1e. APAGADO: un aparato nuevo se registra y no sale nada", d.r.isNew === true && d.r.alerted === false && aKapso.length === 0, JSON.stringify(d.r));

  process.env.NEW_DEVICE_ALERTS = "on";
  const e = await signIn(user, null, UA.android, "VE", "Maracaibo");
  const s1 = sobre(aKapso[0]);
  check("1f. ENCENDIDO: un aparato nuevo manda UN aviso", e.r.isNew === true && e.r.alerted === true && aKapso.length === 1, `${JSON.stringify(e.r)} · ${aKapso.length} a Kapso`);
  check("1g. la plantilla aprobada, en español", s1.plantilla === "new_device_login_alert" && s1.idioma === "es", `${s1.plantilla} · ${s1.idioma}`);
  check("1h. los parámetros del cuerpo, con su nombre y en su orden", JSON.stringify(s1.nombres) === JSON.stringify(esperadoAparato.cuerpo), `esperado ${JSON.stringify(esperadoAparato.cuerpo)} · visto ${JSON.stringify(s1.nombres)}`);
  check("1i. el botón «No fui yo» lleva su sufijo, posicional y sin nombre", esperadoAparato.boton === "url_suffix" && botonBien(s1.boton), JSON.stringify(s1.boton));
  check("1j. dice el aparato y el lugar de ESA entrada", s1.textos.device === "un Android con Chrome" && s1.textos.place === "Maracaibo, Venezuela", JSON.stringify(s1.textos));
  check("1k. la hora es la de Venezuela, no la del servidor", horaEn("America/Caracas").some((x) => (s1.textos.when ?? "").includes(x)), `${s1.textos.when} · esperada ${horaEn("America/Caracas")[0]}`);
  check("1l. ningún parámetro va vacío ni con saltos de línea", textosLimpios(s1.textos), JSON.stringify(s1.textos));
  check("1m. al número del perfil, por la línea de dueños", s1.to === NUMERO && s1.lineaDeDuenos === true, `${s1.to} · ${aKapso[0]?.url}`);

  const token1 = s1.boton?.parameters?.[0]?.text ?? "";
  const { data: pk } = await admin.rpc("peek_not_me_token", { p_token_hash: sha256(token1) });
  check("1n. el sufijo del botón es un token vivo de «No fui yo»", pk?.ok === true, JSON.stringify(pk));

  const f = await signIn(user, e.cookie, UA.android, "VE", "Maracaibo");
  check("1o. ese aparato vuelve a entrar: ya es conocido, no hay segundo aviso", f.r.isNew === false && aKapso.length === 1, `${JSON.stringify(f.r)} · ${aKapso.length} a Kapso`);

  kapsoCaido = true;
  const g = await signIn(user, null, UA.firefox, "VE", "Valencia");
  kapsoCaido = false;
  check("1p. Kapso caído: la entrada no se rompe, y dice que no avisó", g.r.isNew === true && g.r.alerted === false && aKapso.length === 2, JSON.stringify(g.r));

  await admin.from("owners").update({ whatsapp: null }).eq("id", ownerId);
  const h = await signIn(user, null, UA.mac, "VE", "Mérida");
  check("1q. cuenta sin número de WhatsApp: se registra y no se llama a nadie", h.r.isNew === true && h.r.alerted === false && aKapso.length === 2, JSON.stringify(h.r));
  await admin.from("owners").update({ whatsapp: NUMERO }).eq("id", ownerId);

  // ── 2. The number / email change alert ─────────────────────────────────
  const esperadoCambio = PLANTILLAS_ESPERADAS.account_change_alert;
  const antes = aKapso.length;
  const cambio = { ownerId, email, to: NUMERO, ownerCountry: "VE", what: "number", newValueMasked: "···· 0265" };

  const apagado = await notifyAccountChange(cambio);
  check("2a. APAGADO: cambiar el número no manda nada", apagado === false && aKapso.length === antes, String(apagado));

  process.env.ACCOUNT_CHANGE_ALERTS = "on";
  const numero = await notifyAccountChange(cambio);
  const s2 = sobre(aKapso[antes]);
  check("2b. ENCENDIDO: cambiar el número manda UN aviso", numero === true && aKapso.length === antes + 1, `${numero} · ${aKapso.length - antes} a Kapso`);
  check("2c. la plantilla aprobada, en español", s2.plantilla === "account_change_alert" && s2.idioma === "es", `${s2.plantilla} · ${s2.idioma}`);
  check("2d. los parámetros del cuerpo, con su nombre y en su orden", JSON.stringify(s2.nombres) === JSON.stringify(esperadoCambio.cuerpo), `esperado ${JSON.stringify(esperadoCambio.cuerpo)} · visto ${JSON.stringify(s2.nombres)}`);
  check("2e. el botón «No fui yo» lleva su sufijo, posicional y sin nombre", esperadoCambio.boton === "url_suffix" && botonBien(s2.boton), JSON.stringify(s2.boton));
  check("2f. dice qué cambió y a qué, enmascarado", s2.textos.what === "el número de WhatsApp" && s2.textos.new_value === "···· 0265", JSON.stringify(s2.textos));
  check("2g. va al número que se le pasa (el anterior), por la línea de dueños", s2.to === NUMERO && s2.lineaDeDuenos === true, `${s2.to}`);
  check("2h. ningún parámetro va vacío ni con saltos de línea", textosLimpios(s2.textos), JSON.stringify(s2.textos));
  const { data: pk2 } = await admin.rpc("peek_not_me_token", { p_token_hash: sha256(s2.boton?.parameters?.[0]?.text ?? "") });
  check("2i. el sufijo del botón es un token vivo de «No fui yo»", pk2?.ok === true, JSON.stringify(pk2));

  const correo = await notifyAccountChange({ ...cambio, ownerCountry: "CO", what: "email", newValueMasked: "j***@gmail.com" });
  const s3 = sobre(aKapso[antes + 1]);
  check("2j. cambiar el correo: mismo sobre, y dice «el correo»", correo === true && s3.textos.what === "el correo" && s3.textos.new_value === "j***@gmail.com" && botonBien(s3.boton), JSON.stringify(s3.textos));
  check("2j2. a un negocio colombiano, la hora es la de Colombia", horaEn("America/Bogota").some((x) => (s3.textos.when ?? "").includes(x)), `${s3.textos.when} · esperada ${horaEn("America/Bogota")[0]}`);

  const sinNumero = await notifyAccountChange({ ...cambio, to: null });
  check("2k. sin número al que avisar: no se llama a nadie", sinNumero === false && aKapso.length === antes + 2, String(sinNumero));

  kapsoCaido = true;
  const caido = await notifyAccountChange(cambio);
  kapsoCaido = false;
  check("2l. Kapso caído: el cambio no se rompe, y dice que no avisó", caido === false, String(caido));
} catch (e) {
  check("la suite corrió entera", false, e instanceof Error ? e.message : String(e));
} finally {
  if (ownerId) {
    await admin.from("whatsapp_sends").delete().eq("owner_id", ownerId);
    await admin.auth.admin.deleteUser(ownerId);
  }
  const { count } = await admin.from("owners").select("id", { count: "exact", head: true }).eq("email", email);
  check("3. limpieza: el negocio de prueba ya no existe", count === 0, String(count));
}

const ok = filas.filter(Boolean).length;
console.log(`\n${ok}/${filas.length} pasan. A Kapso de verdad: 0 (${aKapso.length} interceptados).`);
process.exit(ok === filas.length ? 0 : 1);
