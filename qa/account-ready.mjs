// `account_ready`: WHO GETS «TU CUENTA QUEDÓ ACTIVA», AND WHAT LEAVES FOR KAPSO.
//
// DEV ONLY (vzqppwrwnmlbrxizskdh), and NOTHING LEAVES FOR KAPSO: `fetch` is intercepted and
// the suite asserts what would have gone. Writes two throw-away businesses and their
// `whatsapp_sends` rows, and removes them. Needs migration 200 in dev.
//
// What it guards (lib/whatsapp/account-ready.ts, migration 200): the envelope matches what
// Meta approved; it goes once; the first sign-in sends it; a failed send can be retried; and
// every guard that keeps it from the wrong account holds: confirmed long ago (the twenty old
// accounts that record their first device after v0.5.1), out of trial, test account, no
// number, no consent. The guards are the point: the worst case here is silent, a true-
// sounding «tu cuenta quedó activa» sent to someone who has used Sevenz for months.
import { readFileSync } from "node:fs";
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

const filas = [];
const check = (nombre, pasa, detalle = "") => {
  filas.push(pasa);
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${pasa || !detalle ? "" : `  — ${detalle}`}`);
};

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

const { trialEndText, accountReadyParameters, sendAccountReady, sendPendingAccountReady } = await import("../lib/whatsapp/account-ready.ts");
const { recordLoginDevice } = await import("../lib/security/new-device.ts");

// ── 1. Pure ───────────────────────────────────────────────────────────────
{
  // A trial that ends at the last second of 6 February in Caracas.
  check("1a. la fecha de fin, como se aprobó: «6 de febrero», en Venezuela", trialEndText("2027-02-07T03:59:59Z", "VE") === "6 de febrero", trialEndText("2027-02-07T03:59:59Z", "VE"));
  check("1b. el mismo instante en Colombia es todavía el 6", trialEndText("2027-02-07T04:59:59Z", "CO") === "6 de febrero", trialEndText("2027-02-07T04:59:59Z", "CO"));
  const p = accountReadyParameters({ eligible: true, whatsapp: "x", first_name: "  María ", business_name: "Bodega La Esquina", country: "VE", trial_ends_at: "2027-02-07T03:59:59Z" });
  check("1c. los tres parámetros, con su nombre y en el orden aprobado", JSON.stringify(p.map((x) => x.nombre)) === JSON.stringify(PLANTILLAS_ESPERADAS.account_ready.cuerpo), JSON.stringify(p));
  check("1d. el nombre va sin espacios de sobra", p[0].texto === "María", p[0].texto);
  const q = accountReadyParameters({ eligible: true, whatsapp: "x", first_name: null, business_name: "Bodega La Esquina", country: "VE", trial_ends_at: "2027-02-07T03:59:59Z" });
  check("1e. sin nombre de pila no sale «Hola ,»: va el del negocio", q[0].texto === "Bodega La Esquina", q[0].texto);
}

// ── 2. Dev ────────────────────────────────────────────────────────────────
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const usuarios = [];
const NUM_A = "570000000011";
const NUM_B = "570000000012";
async function cuenta(tag, whatsapp) {
  const email = `qa-account-ready-${tag}-${Date.now().toString(36)}@sevenz-qa.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { business_name: `Bodega QA ${tag}`, first_name: "Rosa", last_name: "QA", country: "VE", whatsapp, whatsapp_opt_in_text: "QA: acepta avisos por WhatsApp" },
  });
  if (error) throw new Error(`createUser: ${error.message}`);
  usuarios.push(data.user.id);
  const id = data.user.id;
  // The signup trigger records number and consent; the suite makes sure of both so a change
  // there shows up as a failed row below and not as a silent skip.
  await admin.from("owners").update({ whatsapp, whatsapp_opt_in_at: new Date().toISOString(), whatsapp_opt_out_at: null }).eq("id", id);
  return { id, email };
}
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
const motivo = async (id, extra = {}) => (await admin.rpc("account_ready_target", { p_owner_id: id, ...extra })).data?.reason;

try {
  const A = await cuenta("a", NUM_A);
  const { data: sub } = await admin.from("subscriptions").select("estado, demo_termina_el, is_test_account").eq("owner_id", A.id).maybeSingle();
  check("2a. una cuenta recién registrada nace en prueba, con fecha de fin por delante", sub?.estado === "demo" && new Date(sub.demo_termina_el) > new Date() && !sub.is_test_account, JSON.stringify(sub));

  const { data: t } = await admin.rpc("account_ready_target", { p_owner_id: A.id });
  check("2b. la función la da por buena", t?.eligible === true && t.whatsapp === NUM_A, JSON.stringify(t));

  const r1 = await sendAccountReady(A.id);
  const s1 = sobre(aKapso.at(-1));
  check("2c. sale UN mensaje", r1.estado === "enviado" && aKapso.length === 1, `${JSON.stringify(r1)} · ${aKapso.length} a Kapso`);
  check("2d. la plantilla aprobada, en español", s1.plantilla === "account_ready" && s1.idioma === "es", `${s1.plantilla} · ${s1.idioma}`);
  check("2e. los parámetros, con su nombre y en el orden aprobado", JSON.stringify(s1.nombres) === JSON.stringify(PLANTILLAS_ESPERADAS.account_ready.cuerpo), JSON.stringify(s1.nombres));
  check("2f. sin componente de botón: el aprobado es estático", PLANTILLAS_ESPERADAS.account_ready.boton === "sin_parametros" && !s1.boton, JSON.stringify(s1.boton));
  check("2g. dice su nombre, su negocio y el día en que termina SU prueba", s1.textos.owner_name === "Rosa" && s1.textos.business_name === "Bodega QA a" && s1.textos.trial_end_date === trialEndText(sub.demo_termina_el, "VE"), JSON.stringify(s1.textos));
  check("2h. a su número, por la línea de dueños", s1.to === NUM_A && s1.lineaDeDuenos, `${s1.to}`);

  const r2 = await sendAccountReady(A.id);
  check("2i. la segunda vez no sale nada: una sola en la vida de la cuenta", r2.estado === "omitido" && r2.motivo === "already_sent" && aKapso.length === 1, JSON.stringify(r2));
  const { data: pend } = await admin.rpc("account_ready_pending");
  const pendIds = (pend ?? []).map((x) => (typeof x === "string" ? x : Object.values(x)[0]));
  check("2j. y deja de estar en la lista del cron", !pendIds.includes(A.id), `${pendIds.length} en la lista`);

  // ── 3. The first sign-in sends it; a failed send is retried ──
  const B = await cuenta("b", NUM_B);
  const { data: pend2 } = await admin.rpc("account_ready_pending");
  check("3a. una cuenta confirmada y sin mensaje está en la lista del cron", (pend2 ?? []).map((x) => (typeof x === "string" ? x : Object.values(x)[0])).includes(B.id));
  kapsoCaido = true;
  const jar = new Map();
  const h = { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Version/17.5 Mobile/15E148 Safari/604.1", "x-vercel-ip-country": "VE", "x-vercel-ip-city": "Maracay" };
  globalThis.__qaRequest = {
    cookies: { get: (n) => (jar.has(n) ? { name: n, value: jar.get(n) } : undefined), set: (n, v) => jar.set(n, v) },
    headers: { get: (k) => h[k.toLowerCase()] ?? null },
  };
  const antes = aKapso.length;
  const login = await recordLoginDevice({ id: B.id, email: B.email });
  kapsoCaido = false;
  check("3b. el primer inicio de sesión lo intenta, y no rompe la entrada aunque Kapso falle", login.isNew === true && aKapso.length === antes + 1 && sobre(aKapso.at(-1)).plantilla === "account_ready", `${JSON.stringify(login)} · ${aKapso.length - antes} a Kapso`);
  const { data: fallida } = await admin.from("whatsapp_sends").select("ok").eq("owner_id", B.id).eq("template", "account_ready");
  check("3c. el fallo queda registrado y no gasta el turno", (fallida ?? []).length === 1 && fallida[0].ok === false, JSON.stringify(fallida));
  const r3 = await sendAccountReady(B.id);
  check("3d. el reintento (el cron) lo manda", r3.estado === "enviado" && sobre(aKapso.at(-1)).to === NUM_B, JSON.stringify(r3));

  // ── 3e. The cron's catch-up, end to end. Only when the pending list holds nobody but this
  // suite's accounts: with fetch intercepted, Kapso «accepts» every send, so running it over a
  // real tester's account would mark their welcome as sent in dev without it ever leaving.
  const D = await cuenta("d", "570000000014");
  const { data: pend3 } = await admin.rpc("account_ready_pending");
  const ajenos = (pend3 ?? []).map((x) => (typeof x === "string" ? x : Object.values(x)[0])).filter((id) => !usuarios.includes(id));
  if (ajenos.length) {
    console.log(`SKIP  3e. el envío de la mañana, de punta a punta — hay ${ajenos.length} cuenta(s) de dev en la lista que no son de esta suite`);
  } else {
    const antesD = aKapso.length;
    const tanda = await sendPendingAccountReady();
    check("3e. el envío de la mañana manda a quien falta y a nadie más", tanda.enviados === 1 && tanda.fallidos === 0 && aKapso.length === antesD + 1 && sobre(aKapso.at(-1)).to === "570000000014", JSON.stringify(tanda));
  }

  // ── 4. The guards. Each one ON A FRESH ACCOUNT, so «already_sent» cannot hide them ──
  const C = await cuenta("c", "570000000013");
  check("4a. confirmada hace más de la ventana: NO (las cuentas viejas de la v0.5.1)", (await motivo(C.id, { p_max_age: "0 seconds" })) === "confirmed_long_ago");
  const { data: pendViejas } = await admin.rpc("account_ready_pending", { p_max_age: "0 seconds" });
  check("4b. y el cron tampoco la ve", !(pendViejas ?? []).map((x) => (typeof x === "string" ? x : Object.values(x)[0])).includes(C.id));
  await admin.from("subscriptions").update({ estado: "activa" }).eq("owner_id", C.id);
  check("4c. con plan de pago: NO, porque el mensaje habla de la prueba", (await motivo(C.id)) === "not_in_trial");
  await admin.from("subscriptions").update({ estado: "demo", demo_termina_el: new Date(Date.now() - 60_000).toISOString() }).eq("owner_id", C.id);
  check("4d. con la prueba ya vencida: NO", (await motivo(C.id)) === "not_in_trial");
  await admin.from("subscriptions").update({ demo_termina_el: new Date(Date.now() + 30 * 86_400_000).toISOString(), is_test_account: true }).eq("owner_id", C.id);
  check("4e. cuenta de prueba: NO", (await motivo(C.id)) === "test_account");
  await admin.from("subscriptions").update({ is_test_account: false }).eq("owner_id", C.id);
  await admin.from("owners").update({ whatsapp_opt_out_at: new Date(Date.now() + 1000).toISOString() }).eq("id", C.id);
  check("4f. retiró el permiso: NO", (await motivo(C.id)) === "no_consent");
  await admin.from("owners").update({ whatsapp_opt_out_at: null, whatsapp_opt_in_at: null }).eq("id", C.id);
  check("4g. nunca dio permiso: NO", (await motivo(C.id)) === "no_consent");
  await admin.from("owners").update({ whatsapp: null, whatsapp_opt_in_at: new Date().toISOString() }).eq("id", C.id);
  check("4h. sin número: NO", (await motivo(C.id)) === "no_whatsapp");
  const antesC = aKapso.length;
  const rC = await sendAccountReady(C.id);
  check("4i. y en ninguno de esos casos se llama a Kapso", rC.estado === "omitido" && aKapso.length === antesC, JSON.stringify(rC));

  // ── 5. Nobody else can call the functions ──
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { error: e1 } = await anon.rpc("account_ready_target", { p_owner_id: A.id });
  const { error: e2 } = await anon.rpc("account_ready_pending");
  check("5. anon no puede preguntar quién la recibe", e1 != null && e2 != null, `${e1?.code} ${e2?.code}`);
} catch (e) {
  check("la suite corrió entera", false, e instanceof Error ? e.message : String(e));
} finally {
  for (const id of usuarios) {
    await admin.from("owner_devices").delete().eq("owner_id", id);
    await admin.from("owner_device_places").delete().eq("owner_id", id);
    await admin.from("whatsapp_sends").delete().eq("owner_id", id);
    await admin.auth.admin.deleteUser(id);
  }
  const { count } = usuarios.length ? await admin.from("owners").select("id", { count: "exact", head: true }).in("id", usuarios) : { count: 0 };
  check("6. limpieza: los negocios de prueba ya no existen", count === 0, String(count));
}

const ok = filas.filter(Boolean).length;
console.log(`\n${ok}/${filas.length} pasan. A Kapso de verdad: 0 (${aKapso.length} interceptados).`);
process.exit(ok === filas.length ? 0 : 1);
