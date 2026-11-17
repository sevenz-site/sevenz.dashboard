// THE INACTIVITY NUDGES (MS-53): who gets one, which one, on which channel, and the way out.
//
// DEV ONLY (vzqppwrwnmlbrxizskdh), and NOTHING LEAVES: `fetch` to Kapso and to Resend is
// intercepted. Writes throw-away businesses and removes them. Needs migration 217 in dev.
//
// What it guards, all owner's decisions of 2026-11-17:
//   - the four approved templates in rotation, never `inactive_nudge_tax_invoice`;
//   - real account, in trial, not paused, email confirmed, 15 days without registering, one
//     every 3 weeks, and never after «Consejos de Sevenz» is switched off;
//   - «Esperar al lunes libre»: with the WhatsApp notices on, only on a Monday whose plan
//     stayed silent; email and WhatsApp go together;
//   - the email carries the one-click unsubscribe, and a forged link turns off nobody.
//
// The email's bullets are compared with the fichas in ../docs/WHATSAPP-PLANTILLAS.md, which
// were compared with what Meta approved on 2026-11-17: the outside reality this checks against.
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
process.env.RESEND_API_KEY ||= "qa-sin-clave";
process.env.UNSUBSCRIBE_SECRET ||= "qa-secreto-de-baja-0123456789";
process.env.RESEND_TIPS_FROM = "Sevenz QA <consejos@qa.sevenz.test>";

const filas = [];
const check = (nombre, pasa, detalle = "") => {
  filas.push(pasa);
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${pasa || !detalle ? "" : `  — ${detalle}`}`);
};

const fetchReal = globalThis.fetch;
const aKapso = [];
const aResend = [];
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes("kapso.ai")) {
    aKapso.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ messages: [{ id: "qa" }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (u.includes("api.resend.com")) {
    aResend.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ id: "qa" }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (!u.includes(new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname)) return new Response("{}", { status: 200 });
  return fetchReal(url, init);
};

const { NUDGE_TEMPLATES, NUDGE_COPY, nudgeTemplateFor, nudgeEmailText } = await import("../lib/inactivity-nudge/content.ts");
const { unsubscribeToken, verifyUnsubscribeToken } = await import("../lib/inactivity-nudge/unsubscribe-token.ts");
const { unsubscribeFromTips } = await import("../lib/inactivity-nudge/unsubscribe.ts");
const { sendInactivityNudges } = await import("../lib/whatsapp/inactivity-nudge.ts");

// ── 1. Pure ───────────────────────────────────────────────────────────────
{
  const ronda = [0, 1, 2, 3, 4].map(nudgeTemplateFor);
  check("1a. rotan en orden: fiado, catálogo, inventario, contado, y vuelve a empezar",
    JSON.stringify(ronda) === JSON.stringify(["inactive_nudge_credit", "inactive_nudge_catalog", "inactive_nudge_inventory", "inactive_nudge_cash_sales", "inactive_nudge_credit"]), JSON.stringify(ronda));
  check("1b. la del SENIAT no está en la rotación («Las 4, sin SENIAT»)", !NUDGE_TEMPLATES.includes("inactive_nudge_tax_invoice"));
  check("1c. las cuatro están en plantillas-esperadas con un solo parámetro y botón fijo",
    NUDGE_TEMPLATES.every((t) => JSON.stringify(PLANTILLAS_ESPERADAS[t]?.cuerpo) === '["owner_name"]' && PLANTILLAS_ESPERADAS[t]?.boton === "sin_parametros"));

  // The fichas' bullets, minus the last line, which the email replaces with its own way out.
  const fichas = readFileSync("../docs/WHATSAPP-PLANTILLAS.md", "utf8");
  for (const t of NUDGE_TEMPLATES) {
    const i = fichas.indexOf("### `" + t + "`");
    const bloque = i < 0 ? "" : fichas.slice(fichas.indexOf("```", i) + 3, fichas.indexOf("```", fichas.indexOf("```", i) + 3));
    const vinetas = bloque.split("\n").filter((l) => l.startsWith("• ") && !l.includes("Puedes desactivar")).map((l) => l.slice(2).trim());
    check(`1d. el correo de ${t} dice las mismas viñetas que lo aprobado`, JSON.stringify(vinetas) === JSON.stringify(NUDGE_COPY[t].bullets), JSON.stringify(vinetas));
  }

  const { subject, text } = nudgeEmailText("inactive_nudge_credit", "Rosa", "https://app.sevenz.site", "https://app.sevenz.site/consejos/baja/X");
  const lineas = text.split("\n");
  check("1e. saluda por su nombre y lleva el asunto", lineas[0].startsWith("Hola Rosa, ") && subject.length > 0, lineas[0]);
  check("1f. cada viñeta empieza por • y termina en punto", lineas.filter((l) => l.startsWith("•")).every((l) => l.startsWith("• ") && l.endsWith(".")));
  check("1g. lleva el enlace de baja y el aviso antifraude", text.includes("https://app.sevenz.site/consejos/baja/X") && text.includes("Sevenz no pide códigos ni pagos."));

  const id = "11111111-2222-4333-8444-555555555555";
  const otro = "99999999-2222-4333-8444-555555555555";
  const tok = unsubscribeToken(id);
  check("1h. el enlace firmado se reconoce", verifyUnsubscribeToken(tok) === id);
  check("1i. la firma de un dueño no sirve para otro", verifyUnsubscribeToken(`${otro}.${tok.split(".")[1]}`) === null);
  check("1j. un enlace inventado, vacío o sin firma no vale",
    [null, "", "x", id, `${id}.`, `${id}.abc`, `no-es-uuid.${tok.split(".")[1]}`].every((t) => verifyUnsubscribeToken(t) === null));
}

// ── 2. Dev ────────────────────────────────────────────────────────────────
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const usuarios = [];
const DIA = 86_400_000;
async function cuenta(tag, { whatsapp = true, confirmado = true, edadDias = 30 } = {}) {
  const email = `qa-inactividad-${tag}-${Date.now().toString(36)}@sevenz-qa.test`;
  const numero = `5700000003${String(usuarios.length).padStart(2, "0")}`;
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: confirmado, user_metadata: { business_name: `Bodega QA ${tag}`, first_name: "Rosa", last_name: "QA", country: "VE", whatsapp: numero } });
  if (error) throw new Error(`createUser: ${error.message}`);
  usuarios.push(data.user.id);
  await admin.from("owners").update({
    whatsapp: numero,
    whatsapp_opt_in_at: whatsapp ? new Date().toISOString() : null,
    whatsapp_opt_out_at: null,
    product_tips_opt_out_at: null,
    created_at: new Date(Date.now() - edadDias * DIA).toISOString(),
  }).eq("id", data.user.id);
  await admin.from("subscriptions").update({ estado: "demo", is_test_account: false, demo_termina_el: new Date(Date.now() + 40 * DIA).toISOString() }).eq("owner_id", data.user.id);
  return { id: data.user.id, email, whatsapp: numero };
}
const objetivos = async () => (await admin.rpc("inactivity_nudge_targets")).data ?? [];
const ids = async () => (await objetivos()).map((t) => t.owner_id);

try {
  const { error: sin217 } = await admin.rpc("inactivity_nudge_targets");
  if (sin217) throw new Error(`¿Corriste la 217 en dev? ${sin217.message}`);

  const A = await cuenta("whatsapp");
  const B = await cuenta("solocorreo", { whatsapp: false });
  const L = await cuenta("lunesocupado");
  const J = await cuenta("joven", { edadDias: 5 });
  const U = await cuenta("sinconfirmar", { confirmado: false });
  const T = await cuenta("prueba");
  await admin.from("subscriptions").update({ is_test_account: true }).eq("owner_id", T.id);
  const V = await cuenta("vencida");
  await admin.from("subscriptions").update({ demo_termina_el: new Date(Date.now() - DIA).toISOString() }).eq("owner_id", V.id);
  const X = await cuenta("debaja");
  await admin.from("owners").update({ product_tips_opt_out_at: new Date().toISOString() }).eq("id", X.id);

  const lista = await ids();
  check("2a. cuenta real en prueba, 15 días quieta y correo confirmado: entra", [A, B, L].every((c) => lista.includes(c.id)), JSON.stringify(lista.filter((i) => usuarios.includes(i)).length));
  check("2b. una cuenta de 5 días NO: está empezando, no inactiva", !lista.includes(J.id));
  check("2c. correo sin confirmar: NO", !lista.includes(U.id));
  check("2d. cuenta de prueba: NO", !lista.includes(T.id));
  check("2e. prueba vencida: NO («hasta que termine su prueba»)", !lista.includes(V.id));
  check("2f. con «Consejos de Sevenz» apagado: NO", !lista.includes(X.id));
  const fa = (await objetivos()).find((t) => t.owner_id === A.id);
  check("2g. con WhatsApp aceptado lo dice, y sin aceptar también", fa?.whatsapp_ok === true && (await objetivos()).find((t) => t.owner_id === B.id)?.whatsapp_ok === false);

  // Only this suite's accounts: real dev accounts on the list are filtered out by the batch's
  // test-only `onlyOwners`, so nothing is reserved or "sent" for them.
  {
    const propios = new Set(usuarios);
    // A's Monday stayed silent; L's sent something, so L waits; B has no WhatsApp Monday.
    const lunes = new Date("2026-11-23T13:00:00Z");
    const tanda = await sendInactivityNudges(new Set([A.id]), lunes, propios);
    const wa = aKapso.map((m) => ({ to: m.to, name: m.template?.name, boton: (m.template?.components ?? []).find((c) => c.type === "button") }));
    check("3a. WhatsApp solo al del lunes libre, con la primera de la ronda", wa.length === 1 && wa[0].to === A.whatsapp && wa[0].name === "inactive_nudge_credit", JSON.stringify(wa));
    check("3b. sin componente de botón: el aprobado es estático", wa[0] && !wa[0].boton);
    const correos = aResend.map((r) => r.to[0]);
    check("3c. correo a A y a B (sin WhatsApp no hay lunes que esperar), no a L", correos.includes(A.email) && correos.includes(B.email) && !correos.includes(L.email), JSON.stringify(correos));
    check("3d. el lunes ocupado espera: L cuenta en «esperan»", tanda.esperan >= 1, JSON.stringify(tanda));
    const c = aResend.find((r) => r.to[0] === A.email);
    check("3e. el correo sale del remitente de consejos, nunca del de los códigos", c?.from === process.env.RESEND_TIPS_FROM, c?.from);
    check("3f. con la baja en un clic (List-Unsubscribe y su POST)", /consejos\/baja\?t=/.test(c?.headers?.["List-Unsubscribe"] ?? "") && c?.headers?.["List-Unsubscribe-Post"] === "List-Unsubscribe=One-Click", JSON.stringify(c?.headers));

    const antesK = aKapso.length, antesR = aResend.length;
    await sendInactivityNudges(new Set([A.id]), lunes, propios);
    check("3g. la misma mañana dos veces no manda nada dos veces", aKapso.length === antesK && aResend.length === antesR);
    const despues = await ids();
    check("3h. ya avisados, salen de la lista por tres semanas", !despues.includes(A.id) && !despues.includes(B.id) && despues.includes(L.id));

    // 22 days later the turn comes back, with the next template of the round.
    await admin.from("inactivity_nudges").update({ cycle_on: new Date(Date.now() - 22 * DIA).toISOString().slice(0, 10) }).eq("owner_id", A.id);
    const vuelta = (await objetivos()).find((t) => t.owner_id === A.id);
    check("3i. a las tres semanas vuelve, y le toca la siguiente de la ronda", vuelta && nudgeTemplateFor(vuelta.nudges_sent) === "inactive_nudge_catalog", JSON.stringify(vuelta?.nudges_sent));
  }

  // ── 4. The way out ──
  check("4a. un enlace falso no da de baja a nadie", (await unsubscribeFromTips(`${A.id}.firma-falsa`)) === false);
  const { data: sigue } = await admin.from("owners").select("product_tips_opt_out_at").eq("id", A.id).single();
  check("4b. …y A sigue recibiendo consejos", sigue?.product_tips_opt_out_at == null);
  check("4c. el enlace de A lo da de baja", (await unsubscribeFromTips(unsubscribeToken(A.id))) === true);
  const { data: baja } = await admin.from("owners").select("product_tips_opt_out_at").eq("id", A.id).single();
  check("4d. queda la fecha, y A sale de la lista", baja?.product_tips_opt_out_at != null && !(await ids()).includes(A.id));

  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const llamadas = [
    ["inactivity_nudge_targets", {}],
    ["inactivity_nudged_owners", { p_since: "2026-01-01" }],
    ["inactivity_nudge_reserve", { p_owner_id: A.id, p_cycle_on: "2026-01-05", p_template: "x" }],
    ["inactivity_nudge_finish", { p_id: A.id, p_whatsapp_status: "x", p_email_status: "x" }],
    ["product_tips_unsubscribe", { p_owner_id: B.id }],
  ];
  const abiertas = [];
  for (const [fn, args] of llamadas) {
    const { error } = await anon.rpc(fn, args);
    if (!error) abiertas.push(fn);
  }
  check("5. anon no puede llamar ninguna de las cinco funciones", abiertas.length === 0, abiertas.join(", "));
} catch (e) {
  check("la suite corrió entera", false, e instanceof Error ? e.message : String(e));
} finally {
  for (const id of usuarios) {
    await admin.from("whatsapp_sends").delete().eq("owner_id", id);
    await admin.auth.admin.deleteUser(id);
  }
  const { count } = usuarios.length ? await admin.from("owners").select("id", { count: "exact", head: true }).in("id", usuarios) : { count: 0 };
  check("6. limpieza: los negocios de prueba ya no existen", count === 0, String(count));
}

const ok = filas.filter(Boolean).length;
console.log(`\n${ok}/${filas.length} pasan. Hacia fuera de verdad: 0 (${aKapso.length} a Kapso y ${aResend.length} a Resend, interceptados).`);
process.exit(ok === filas.length ? 0 : 1);
