// `prueba_por_vencer`: WHO GETS «TU PRUEBA TERMINA EL …», AND WHAT LEAVES FOR KAPSO.
//
// DEV ONLY (vzqppwrwnmlbrxizskdh), and NOTHING LEAVES FOR KAPSO: `fetch` is intercepted.
// Writes throw-away businesses and their `whatsapp_sends` rows, and removes them. Needs
// migration 201 in dev.
//
// What it guards: «exactly 7 days», as the owner chose on 2026-11-12, counted as DATES in the
// business's zone (a trial ending at 23:59 on day 7 in Caracas is 7, not 6 or 8); once in the
// account's life; and the same guards as every owner message. The suite only runs the cron's
// batch when no real dev account is in the list, because with fetch intercepted Kapso
// «accepts» every send and would mark a tester's notice as sent without it leaving.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
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
process.env.KAPSO_API_KEY ||= "qa-sin-clave";

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

const { trialEndingParameters, sendTrialEndingNotices } = await import("../lib/whatsapp/trial-ending.ts");
const { trialEndText } = await import("../lib/whatsapp/account-ready.ts");

// The last second of the day N days from today, in a zone: how `fin_de_prueba` stores it.
const ZONA = { VE: "America/Caracas", CO: "America/Bogota" };
function finDeDia(diasAdelante, country) {
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA[country] }).format(new Date());
  const [y, m, d] = hoy.split("-").map(Number);
  const offsetH = country === "VE" ? 4 : 5; // both zones are fixed, no daylight saving
  return new Date(Date.UTC(y, m - 1, d + diasAdelante, 23 + offsetH, 59, 59)).toISOString();
}

// ── 1. Pure ───────────────────────────────────────────────────────────────
{
  const p = trialEndingParameters({ first_name: " Rosa ", business_name: "Bodega", country: "VE", trial_ends_at: "2027-02-07T03:59:59Z" });
  check("1a. los dos parámetros, con su nombre y en su orden", JSON.stringify(p.map((x) => x.nombre)) === JSON.stringify(PLANTILLAS_ESPERADAS.prueba_por_vencer.cuerpo), JSON.stringify(p));
  check("1b. «6 de febrero» y el nombre sin espacios", p[0].texto === "Rosa" && p[1].texto === "6 de febrero", JSON.stringify(p));
  const q = trialEndingParameters({ first_name: null, business_name: "Bodega La Esquina", country: "CO", trial_ends_at: "2027-02-07T04:59:59Z" });
  check("1c. sin nombre de pila va el del negocio", q[0].texto === "Bodega La Esquina", q[0].texto);
}

// ── 2. Dev ────────────────────────────────────────────────────────────────
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const usuarios = [];
async function cuenta(tag, country, diasAdelante) {
  const email = `qa-trial-ending-${tag}-${Date.now().toString(36)}@sevenz-qa.test`;
  const whatsapp = `5700000002${String(usuarios.length).padStart(2, "0")}`;
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { business_name: `Bodega QA ${tag}`, first_name: "Rosa", last_name: "QA", country, whatsapp } });
  if (error) throw new Error(`createUser: ${error.message}`);
  usuarios.push(data.user.id);
  await admin.from("owners").update({ country, whatsapp, whatsapp_opt_in_at: new Date().toISOString(), whatsapp_opt_out_at: null }).eq("id", data.user.id);
  await admin.from("subscriptions").update({ estado: "demo", is_test_account: false, demo_termina_el: finDeDia(diasAdelante, country) }).eq("owner_id", data.user.id);
  return { id: data.user.id, whatsapp, country };
}
const ids = async (extra) => ((await admin.rpc("trial_ending_targets", extra ?? {})).data ?? []).map((t) => t.owner_id);
const sobre = (m) => {
  const c = m?.cuerpo?.template?.components ?? [];
  const body = c.find((x) => x.type === "body");
  return { plantilla: m?.cuerpo?.template?.name, to: m?.cuerpo?.to, nombres: body?.parameters?.map((p) => p.parameter_name), textos: Object.fromEntries((body?.parameters ?? []).map((p) => [p.parameter_name, p.text])), boton: c.find((x) => x.type === "button") };
};

try {
  const S7 = await cuenta("ve7", "VE", 7);
  const C7 = await cuenta("co7", "CO", 7);
  const S6 = await cuenta("ve6", "VE", 6);
  const S8 = await cuenta("ve8", "VE", 8);
  const lista = await ids();
  check("2a. a 7 días exactos entra, en Venezuela y en Colombia", lista.includes(S7.id) && lista.includes(C7.id), JSON.stringify(lista));
  check("2b. a 6 días NO (decisión del dueño: solo los de 7)", !lista.includes(S6.id));
  check("2c. a 8 días todavía NO", !lista.includes(S8.id));

  const T = await cuenta("test", "VE", 7);
  await admin.from("subscriptions").update({ is_test_account: true }).eq("owner_id", T.id);
  const P = await cuenta("pago", "VE", 7);
  await admin.from("subscriptions").update({ estado: "activa" }).eq("owner_id", P.id);
  const N = await cuenta("sinpermiso", "VE", 7);
  await admin.from("owners").update({ whatsapp_opt_out_at: new Date(Date.now() + 1000).toISOString() }).eq("id", N.id);
  const W = await cuenta("sinnumero", "VE", 7);
  await admin.from("owners").update({ whatsapp: null }).eq("id", W.id);
  const lista2 = await ids();
  check("2d. cuenta de prueba: NO", !lista2.includes(T.id));
  check("2e. con plan de pago: NO", !lista2.includes(P.id));
  check("2f. sin permiso: NO", !lista2.includes(N.id));
  check("2g. sin número: NO", !lista2.includes(W.id));

  const ajenos = lista2.filter((id) => !usuarios.includes(id));
  if (ajenos.length) {
    console.log(`SKIP  3. la tanda de la mañana — hay ${ajenos.length} cuenta(s) de dev en la lista que no son de esta suite`);
  } else {
    kapsoCaido = true;
    const caida = await sendTrialEndingNotices();
    kapsoCaido = false;
    check("3a. con Kapso caído no revienta, y cuenta los fallos", caida.fallidos === 2 && caida.enviados === 0, JSON.stringify(caida));
    const antes = aKapso.length;
    const tanda = await sendTrialEndingNotices();
    check("3b. el reintento del mismo día los manda: los dos de 7 días, nadie más", tanda.enviados === 2 && aKapso.length === antes + 2, JSON.stringify(tanda));
    const delVe = aKapso.slice(antes).map(sobre).find((s) => s.to === S7.whatsapp);
    const { data: subVe } = await admin.from("subscriptions").select("demo_termina_el").eq("owner_id", S7.id).single();
    check("3c. la plantilla aprobada, con sus parámetros en orden", delVe?.plantilla === "prueba_por_vencer" && JSON.stringify(delVe.nombres) === JSON.stringify(PLANTILLAS_ESPERADAS.prueba_por_vencer.cuerpo), JSON.stringify(delVe));
    check("3d. dice el día en que termina SU prueba", delVe?.textos.trial_end_date === trialEndText(subVe.demo_termina_el, "VE"), JSON.stringify(delVe?.textos));
    check("3e. sin componente de botón: el aprobado es estático", delVe && !delVe.boton);
    const otra = await sendTrialEndingNotices();
    check("3f. una sola vez: al día siguiente de la lista ya no salen", otra.candidatos === 0 && !(await ids()).includes(S7.id), JSON.stringify(otra));
  }

  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { error: e1 } = await anon.rpc("trial_ending_targets");
  check("4. anon no puede preguntar a quién se le acaba la prueba", e1 != null, e1?.code);
} catch (e) {
  check("la suite corrió entera", false, e instanceof Error ? e.message : String(e));
} finally {
  for (const id of usuarios) {
    await admin.from("whatsapp_sends").delete().eq("owner_id", id);
    await admin.auth.admin.deleteUser(id);
  }
  const { count } = usuarios.length ? await admin.from("owners").select("id", { count: "exact", head: true }).in("id", usuarios) : { count: 0 };
  check("5. limpieza: los negocios de prueba ya no existen", count === 0, String(count));
}

const ok = filas.filter(Boolean).length;
console.log(`\n${ok}/${filas.length} pasan. A Kapso de verdad: 0 (${aKapso.length} interceptados).`);
process.exit(ok === filas.length ? 0 : 1);
