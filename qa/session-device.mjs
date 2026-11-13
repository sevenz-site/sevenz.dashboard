// THE FIRST DEVICE OF AN ACCOUNT, LEARNT FROM AN OPEN SESSION (PL-40).
//
// DEV ONLY (vzqppwrwnmlbrxizskdh), and it NEEDS `npm run dev`: what is under test is the
// proxy, and the proxy only exists in front of a running app. Plain HTTP with a real session
// cookie, the way a browser that was already signed in arrives. Writes two throw-away
// businesses and removes them. The verdict is read in the database, not in the response.
//
// What it guards (lib/security/session-device.ts): a page visit with a session and no
// `sz_device` cookie leaves the cookie; the account's FIRST device is recorded in silence;
// a second browser is NOT recorded, so a stolen session cannot make itself a known device;
// and the app's own background requests ask nothing.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
const REF = "vzqppwrwnmlbrxizskdh";
if (!env.NEXT_PUBLIC_SUPABASE_URL?.includes(REF)) {
  console.error("ME NIEGO A CORRER: .env.local no apunta a la rama dev.");
  process.exit(1);
}
const BASE = process.env.QA_BASE_URL ?? "http://localhost:3000";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) {
  console.error("ME NIEGO A CORRER: esta suite solo habla con localhost.");
  process.exit(1);
}

const filas = [];
const check = (nombre, pasa, detalle = "") => {
  filas.push(pasa);
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${pasa || !detalle ? "" : `  — ${detalle}`}`);
};
const sha256 = (v) => createHash("sha256").update(v).digest("hex");

const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const login = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

// A session without a sign-in: the magic-link pair the other suites use. It is the case
// under test, a session that exists and never passed through the login form.
async function sesion(email) {
  const { data: lk } = await svc.auth.admin.generateLink({ type: "magiclink", email });
  const { data: ses, error } = await login.auth.verifyOtp({ type: "magiclink", token_hash: lk.properties.hashed_token });
  if (error) throw new Error(`otp: ${error.message}`);
  const valor = `base64-${Buffer.from(JSON.stringify(ses.session)).toString("base64url")}`;
  const MAX = 3180;
  const partes = valor.length <= MAX ? [[`sb-${REF}-auth-token`, valor]] : Array.from({ length: Math.ceil(valor.length / MAX) }, (_, i) => [`sb-${REF}-auth-token.${i}`, valor.slice(i * MAX, (i + 1) * MAX)]);
  return partes.map(([k, v]) => `${k}=${v}`).join("; ");
}
const usuarios = [];
async function dueno(tag) {
  const email = `qa-session-device-${tag}-${Date.now().toString(36)}@sevenz-qa.test`;
  const { data, error } = await svc.auth.admin.createUser({ email, email_confirm: true, user_metadata: { business_name: `QA Sesión ${tag}`, country: "VE", first_name: "QA", last_name: tag } });
  if (error) throw new Error(`createUser: ${error.message}`);
  usuarios.push(data.user.id);
  // Onboarding done, or every page redirects there.
  await svc.from("owners").update({ onboarding_completed_at: new Date().toISOString(), whatsapp: "570000000002" }).eq("id", data.user.id);
  return { id: data.user.id, email, cookie: await sesion(email) };
}

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
// A page a person opens. `extra` turns it into what the app fetches on its own.
const visita = async (ruta, { cookie, ua = IPHONE, city = "Barquisimeto", extra = {} } = {}) => {
  const res = await fetch(BASE + ruta, {
    redirect: "manual",
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": ua,
      "x-vercel-ip-country": "VE",
      "x-vercel-ip-city": city,
      ...(cookie ? { cookie } : {}),
      ...extra,
    },
  });
  await res.arrayBuffer().catch(() => null);
  const puesta = (res.headers.getSetCookie?.() ?? []).find((c) => c.startsWith("sz_device="));
  return { status: res.status, aparato: puesta ? puesta.slice("sz_device=".length).split(";")[0] : null, cabecera: puesta ?? "" };
};
const aparatos = async (id) => (await svc.from("owner_devices").select("device_hash, browser, country, city").eq("owner_id", id)).data ?? [];
const lugares = async (id) => (await svc.from("owner_device_places").select("browser, country, city").eq("owner_id", id)).data ?? [];
const enviados = async (id) => (await svc.from("whatsapp_sends").select("id", { count: "exact", head: true }).eq("owner_id", id)).count ?? 0;

try {
  const vivo = await fetch(BASE + "/login", { redirect: "manual" }).then((r) => r.status).catch(() => 0);
  if (!vivo) throw new Error(`no hay nada en ${BASE}: esta suite necesita «npm run dev»`);

  const A = await dueno("a");

  // ── 1. What the app fetches on its own asks nothing ──────────────────────
  const rsc = await visita("/dashboard", { cookie: A.cookie, extra: { rsc: "1", accept: "*/*" } });
  check("1a. una petición de la app (RSC), sin cookie de aparato: no deja cookie ni registra", rsc.aparato === null && (await aparatos(A.id)).length === 0, `${rsc.status} · ${rsc.cabecera}`);
  // Next strips its own headers (`rsc`, `next-router-prefetch`) before the proxy runs, so what
  // tells a background request apart is what the browser itself says about it.
  const pre = await visita("/dashboard", { cookie: A.cookie, extra: { "next-router-prefetch": "1", accept: "*/*", "sec-fetch-dest": "empty" } });
  check("1b. una precarga: tampoco", pre.aparato === null && (await aparatos(A.id)).length === 0, `${pre.status} · ${pre.cabecera}`);
  const fondo = await visita("/dashboard", { cookie: A.cookie, extra: { "sec-fetch-dest": "empty" } });
  check("1b2. un fetch que pide HTML pero no es una navegación: tampoco", fondo.aparato === null && (await aparatos(A.id)).length === 0, `${fondo.status} · ${fondo.cabecera}`);
  const anon = await visita("/dashboard");
  check("1c. sin sesión: va a /login y no recibe cookie de aparato", anon.status >= 300 && anon.status < 400 && anon.aparato === null, `${anon.status} · ${anon.cabecera}`);
  const publica = await visita("/s/no-existe", { cookie: A.cookie });
  check("1d. una página pública, aun con sesión: no pregunta nada", publica.aparato === null && (await aparatos(A.id)).length === 0, `${publica.status}`);

  // ── 2. The first device of the account ───────────────────────────────────
  // What a current browser says on a navigation. 3a goes without it, like Safari before 16.4.
  const v1 = await visita("/dashboard", { cookie: A.cookie, extra: { "sec-fetch-dest": "document", "sec-fetch-mode": "navigate" } });
  const d1 = await aparatos(A.id);
  check("2a. la página responde, con la sesión abierta", v1.status === 200, String(v1.status));
  check("2b. deja la cookie de aparato: httpOnly, 400 días, toda la app", /^[A-Za-z0-9_-]{32,}$/.test(v1.aparato ?? "") && /httponly/i.test(v1.cabecera) && /max-age=34560000/i.test(v1.cabecera) && /path=\//i.test(v1.cabecera), v1.cabecera);
  check("2c. y la cuenta, que no tenía ninguno, tiene su primer aparato: el de esa cookie", d1.length === 1 && d1[0].device_hash === sha256(v1.aparato ?? ""), JSON.stringify(d1));
  check("2d. con el navegador y el lugar de esa visita", d1[0]?.browser === "Safari" && d1[0]?.country === "VE" && d1[0]?.city === "Barquisimeto", JSON.stringify(d1[0]));
  const l1 = await lugares(A.id);
  check("2e. y su lugar queda entre los conocidos (199)", l1.length === 1 && l1[0].city === "Barquisimeto", JSON.stringify(l1));
  check("2f. en silencio: no se reservó ningún WhatsApp", (await enviados(A.id)) === 0, String(await enviados(A.id)));

  const v2 = await visita("/dashboard", { cookie: `${A.cookie}; sz_device=${v1.aparato}`, city: "Caracas" });
  check("2g. ese navegador vuelve con su cookie: no se le da otra ni se registra nada", v2.status === 200 && v2.aparato === null && (await aparatos(A.id)).length === 1, `${v2.status} · ${v2.cabecera}`);

  // ── 3. A second browser with the same session is NOT made known ─────────
  const v3 = await visita("/clients", { cookie: A.cookie, ua: WINDOWS, city: "Maracaibo" });
  const d3 = await aparatos(A.id);
  check("3a. otro navegador con la misma sesión: recibe cookie, para no preguntar en cada página", /^[A-Za-z0-9_-]{32,}$/.test(v3.aparato ?? "") && v3.aparato !== v1.aparato, v3.cabecera);
  check("3b. pero NO queda como aparato conocido: la cuenta sigue con uno", d3.length === 1 && d3[0].device_hash === sha256(v1.aparato ?? ""), JSON.stringify(d3));
  check("3c. ni su lugar entre los conocidos", !(await lugares(A.id)).some((l) => l.city === "Maracaibo"), JSON.stringify(await lugares(A.id)));
  check("3d. y tampoco manda nada", (await enviados(A.id)) === 0, String(await enviados(A.id)));
  const { data: alEntrar } = await svc.rpc("register_login_device", { p_owner_id: A.id, p_device_hash: sha256(v3.aparato ?? ""), p_browser: "Chrome", p_country: "VE", p_city: "Maracaibo" });
  check("3e. si ese navegador inicia sesión después, se juzga como desconocido: avisaría", alEntrar?.known === false && alEntrar.first_ever === false, JSON.stringify(alEntrar));

  // ── 4. A cookie that is not ours is treated as none ──────────────────────
  const B = await dueno("b");
  const v4 = await visita("/dashboard", { cookie: `${B.cookie}; sz_device=corta` });
  const d4 = await aparatos(B.id);
  check("4. una cookie de aparato mal formada cuenta como ninguna: se reemplaza y se registra", /^[A-Za-z0-9_-]{32,}$/.test(v4.aparato ?? "") && d4.length === 1 && d4[0].device_hash === sha256(v4.aparato ?? ""), `${v4.cabecera} · ${JSON.stringify(d4)}`);
} catch (e) {
  check("la suite corrió entera", false, e instanceof Error ? e.message : String(e));
} finally {
  for (const id of usuarios) {
    await svc.from("whatsapp_sends").delete().eq("owner_id", id);
    await svc.auth.admin.deleteUser(id);
  }
  const { count } = usuarios.length
    ? await svc.from("owners").select("id", { count: "exact", head: true }).in("id", usuarios)
    : { count: 0 };
  check("5. limpieza: los negocios de prueba ya no existen", count === 0, String(count));
}

const ok = filas.filter(Boolean).length;
console.log(`\n${ok}/${filas.length} pasan.`);
process.exit(ok === filas.length ? 0 : 1);
