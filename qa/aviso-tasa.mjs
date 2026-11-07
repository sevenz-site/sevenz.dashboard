// `tasa_retenida_aviso`: WHAT LEAVES FOR KAPSO WHEN THE RATE IS HELD (PL-25).
//
// DEV ONLY (vzqppwrwnmlbrxizskdh), and NOTHING LEAVES FOR KAPSO: `fetch` is intercepted before
// it reaches them and the suite asserts what would have gone. Writes one throw-away business
// and its `whatsapp_sends` rows, and removes them at the end.
//
// It exists because a template fails whole and in silence when its parameters do not match
// what Meta approved. On 2026-10-15 that was 12 of 12 receipts, with the screen saying fine.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { assessRateHealth } from "../lib/exchange-rate/rate-health.ts";
import { PLANTILLAS_ESPERADAS } from "./plantillas-esperadas.mjs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
if (!env.NEXT_PUBLIC_SUPABASE_URL?.includes("vzqppwrwnmlbrxizskdh")) {
  console.error("ME NIEGO A CORRER: .env.local no apunta a la rama dev.");
  process.exit(1);
}
for (const [k, v] of Object.entries(env)) process.env[k] ??= v;
delete process.env.RATE_ALERT_WHATSAPP_TO;
delete process.env.RATE_ALERT_OWNER_ID;
process.env.KAPSO_API_KEY ||= "qa-sin-clave";

const filas = [];
const check = (nombre, pasa, detalle = "") => {
  filas.push(pasa);
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${pasa || !detalle ? "" : `  — ${detalle}`}`);
};

// Everything that is not the database stops here: Kapso, and Mixpanel behind it.
const fetchReal = globalThis.fetch;
const aKapso = [];
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes("kapso.ai")) {
    aKapso.push({ url: u, cuerpo: JSON.parse(init.body) });
    return new Response(JSON.stringify({ messages: [{ id: "qa" }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (!u.includes(new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname)) return new Response("{}", { status: 200 });
  return fetchReal(url, init);
};

const { parametrosDeTasaRetenida, avisarTasaRetenida } = await import("../lib/whatsapp/tasa-retenida.ts");

const ahora = new Date("2026-11-06T15:00:00Z");
const hace = (h) => new Date(ahora.getTime() - h * 3_600_000).toISOString();
const fila = (h, source, usd = 480, eur = 999.77, needs_review = false) => ({ fetched_at: hace(h), usd, eur, source, needs_review });
const euroRetenido = assessRateHealth([fila(1, "dolarvzla held:eur"), fila(10, "dolarvzla held:eur"), fila(30, "dolarvzla held:eur"), fila(40, "dolarapi+dolarvzla+bcv")], ahora);
const dosRetenidas = assessRateHealth([fila(1, "x held:eur,usd"), fila(30, "x held:eur,usd")], ahora);
const detenida = assessRateHealth([fila(40, "dolarapi+dolarvzla+bcv")], ahora);
const revision = assessRateHealth([fila(1, "x", 700, 900, true), fila(30, "x", 700, 900, true), fila(31, "dolarapi+dolarvzla+bcv")], ahora);
const sana = assessRateHealth([fila(1, "dolarapi+dolarvzla+bcv")], ahora);
const texto = (p) => Object.fromEntries((p ?? []).map((x) => [x.nombre, x.texto]));

const esperado = PLANTILLAS_ESPERADAS.tasa_retenida_aviso.cuerpo;
const p1 = parametrosDeTasaRetenida(euroRetenido, ahora);
check("1a. los cuatro parámetros, con su nombre y en su orden", JSON.stringify(p1?.map((x) => x.nombre)) === JSON.stringify(esperado), JSON.stringify(p1));
check("1b. euro retenido: dice el euro, sus horas y su cifra", texto(p1).currency === "el euro" && texto(p1).hours === "30 horas" && texto(p1).held_rate.includes("999,77"), JSON.stringify(texto(p1)));
check("1c. la fecha sale escrita, en hora de Colombia", /^\d{1,2} de noviembre$/.test(texto(p1).since_date), texto(p1).since_date);
const p2 = texto(parametrosDeTasaRetenida(dosRetenidas, ahora));
check("1d. dos monedas: «la tasa», para que la frase concuerde, y las dos cifras", p2.currency === "la tasa" && p2.held_rate.includes("dólar") && p2.held_rate.includes("euro"), JSON.stringify(p2));
const p3 = texto(parametrosDeTasaRetenida(detenida, ahora));
check("1e. tasa detenida: también avisa", p3.currency === "la tasa" && p3.hours === "40 horas", JSON.stringify(p3));
const p4 = texto(parametrosDeTasaRetenida(revision, ahora));
check("1f. en revisión: también avisa", p4.currency === "la tasa" && p4.hours === "30 horas", JSON.stringify(p4));
check("1g. con la tasa sana no hay mensaje", parametrosDeTasaRetenida(sana, ahora) === null);
check("1h. sin ninguna tasa no hay mensaje: no hay cifra que nombrar", parametrosDeTasaRetenida(assessRateHealth([], ahora), ahora) === null);
check("1i. ningún parámetro lleva salto de línea, ni va vacío", [p1, parametrosDeTasaRetenida(dosRetenidas, ahora)].flat().every((x) => x.texto && !/[\n\t]| {4}/.test(x.texto)));

const sinVariables = await avisarTasaRetenida(euroRetenido, ahora);
check("2a. sin las dos variables no sale nada, y lo dice", sinVariables === "sin_configurar" && aKapso.length === 0, sinVariables);

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const email = `qa-aviso-tasa-${Date.now().toString(36)}@sevenz-qa.test`;
let ownerId = null;
try {
  const { data: u, error } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { business_name: "QA Aviso", country: "VE", first_name: "QA", last_name: "Aviso" } });
  if (error) throw new Error(`createUser: ${error.message}`);
  ownerId = u.user.id;
  process.env.RATE_ALERT_WHATSAPP_TO = "570000000000";
  process.env.RATE_ALERT_OWNER_ID = ownerId;

  const r1 = await avisarTasaRetenida(euroRetenido, ahora);
  check("2b. con las dos variables se envía", r1 === "enviado", r1);
  const salio = aKapso[0]?.cuerpo;
  const nombres = salio?.template?.components?.find((c) => c.type === "body")?.parameters?.map((x) => x.parameter_name);
  check("2c. a Kapso va la plantilla aprobada, con sus cuatro parámetros", salio?.template?.name === "tasa_retenida_aviso" && JSON.stringify(nombres) === JSON.stringify(esperado), JSON.stringify(salio?.template));
  check("2d. sin botón, como la aprobó Meta", !salio?.template?.components?.some((c) => c.type === "button"));
  check("2e. al número del aviso, por la línea de dueños", salio?.to === "570000000000" && aKapso[0].url.includes("1373508439159674"), aKapso[0]?.url);

  const r2 = await avisarTasaRetenida(euroRetenido, ahora);
  check("2f. la segunda llamada del día no repite el aviso", r2 === "ya_enviado" && aKapso.length === 1, r2);
  const r3 = await avisarTasaRetenida(euroRetenido, new Date(ahora.getTime() + 86_400_000));
  check("2g. al día siguiente, si sigue retenida, vuelve a avisar", r3 === "enviado" && aKapso.length === 2, r3);
  const r4 = await avisarTasaRetenida(sana, ahora);
  check("2h. con la tasa sana no se llama a nadie", r4 === "sin_aviso" && aKapso.length === 2, r4);
} catch (e) {
  check("2. la suite corrió entera", false, e instanceof Error ? e.message : String(e));
} finally {
  if (ownerId) {
    await admin.from("whatsapp_sends").delete().eq("owner_id", ownerId);
    await admin.auth.admin.deleteUser(ownerId);
  }
  const { count } = await admin.from("owners").select("id", { count: "exact", head: true }).eq("email", email);
  check("3. limpieza: el negocio de prueba ya no existe", count === 0, String(count));
}

const ok = filas.filter(Boolean).length;
console.log(`\n${ok}/${filas.length} pasan.`);
process.exit(ok === filas.length ? 0 : 1);
