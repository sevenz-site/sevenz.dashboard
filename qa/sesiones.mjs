// WHAT EACH WAY OF LEAVING AN ACCOUNT ACTUALLY DOES -- phase 3 of the console
// hardening, 2026-11-02.
//
// The logout dialog and the line on «Mi negocio» make promises to the owner:
// «solo en este dispositivo» leaves the others signed in, «en todos» signs
// every device out, changing the password signs the others out, and a password
// that appears in public leaks is refused. Each promise is a behaviour of
// Supabase Auth, not of our code, so it is measured here against the real
// service instead of being trusted from the docs -- the same rule as every
// other suite that looks at the outside world.
//
// "Signed out" is measured with `getUser(access_token)`: Auth looks the
// session up on every call and answers `session_not_found` once it is gone.
// That is the check the app's proxy makes on every screen, so it is exactly
// what decides whether a device can still use the app.
//
// The two logout rows go through the real server action over HTTP, with the
// owner's cookie, so they need `npm run dev` running. Dev only.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { cookieDeDueno, idDeLaAccion } from "./server-action.mjs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
if (!URL_.includes("vzqppwrwnmlbrxizskdh")) {
  console.error("Esta suite solo corre contra la rama dev (vzqppwrwnmlbrxizskdh).");
  process.exit(1);
}
const BASE = process.env.QA_BASE_URL ?? "http://localhost:3000";
const svc = createClient(URL_, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = () => createClient(URL_, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const filas = [];
const check = (n, ok, d = "") => { filas.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `  — ${d}` : ""}`); };
const stamp = Date.now().toString().slice(-6);
let ownerId = null;
let email = null;

// One more device: a fresh session of the same owner, as a token pair.
async function dispositivo() {
  const { data: lk } = await svc.auth.admin.generateLink({ type: "magiclink", email });
  const { data, error } = await anon().auth.verifyOtp({ type: "magiclink", token_hash: lk.properties.hashed_token });
  if (error) throw new Error(`verifyOtp: ${error.message}`);
  return data.session;
}
// The cookie of a device, built from its own session -- not a new one, or the
// action would sign out a session nobody is watching.
function cookieDe(session) {
  const ref = new URL(URL_).hostname.split(".")[0];
  const nombre = `sb-${ref}-auth-token`;
  const valor = "base64-" + Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  const MAX = 3180;
  return (valor.length <= MAX
    ? [`${nombre}=${valor}`]
    : Array.from({ length: Math.ceil(valor.length / MAX) }, (_, i) => `${nombre}.${i}=${valor.slice(i * MAX, (i + 1) * MAX)}`)
  ).join("; ");
}
const sigueDentro = async (session) => !(await anon().auth.getUser(session.access_token)).error;
const puedeRenovar = async (session) => !(await anon().auth.refreshSession({ refresh_token: session.refresh_token })).error;

// Calls `logout` the way the dialog does. A successful sign-out answers with a
// redirect to /login; anything else is returned so the row can show it.
async function cerrarSesion(accion, session, scope) {
  const res = await fetch(`${BASE}/dashboard`, {
    method: "POST",
    headers: { "Next-Action": accion, "Content-Type": "text/plain;charset=UTF-8", Cookie: cookieDe(session) },
    body: JSON.stringify([scope]),
    redirect: "manual",
  });
  const destino = res.headers.get("x-action-redirect") ?? res.headers.get("location") ?? "";
  return { status: res.status, destino };
}

try {
  email = `zz-sesiones-${stamp}@sevenz-qa.test`;
  const { data: u, error } = await svc.auth.admin.createUser({ email, email_confirm: true, user_metadata: { business_name: "ZZ Sesiones", country: "VE" } });
  if (error) throw new Error(`createUser: ${error.message}`);
  ownerId = u.user.id;

  const accion = await idDeLaAccion(BASE, "/dashboard", "logout", await cookieDeDueno(env, ownerId));
  if (!accion) throw new Error("no encontré la acción `logout` en los chunks de /dashboard — ¿está `npm run dev` corriendo?");

  // 1. «Solo en este dispositivo».
  {
    const telefono = await dispositivo();
    const compu = await dispositivo();
    const r = await cerrarSesion(accion, telefono, "local");
    check("1. «Solo en este dispositivo» redirige a /login", r.destino.includes("/login"), `HTTP ${r.status} → ${r.destino || "sin redirección"}`);
    check("1b. y este dispositivo queda fuera", !(await sigueDentro(telefono)));
    check("1c. mientras el otro SIGUE dentro", await sigueDentro(compu));
    check("1d. y el otro puede seguir renovando su sesión", await puedeRenovar(compu));
  }

  // 2. «En todos mis dispositivos».
  {
    const telefono = await dispositivo();
    const compu = await dispositivo();
    const tablet = await dispositivo();
    const r = await cerrarSesion(accion, telefono, "global");
    check("2. «En todos» redirige a /login", r.destino.includes("/login"), `HTTP ${r.status} → ${r.destino || "sin redirección"}`);
    check("2b. este dispositivo queda fuera", !(await sigueDentro(telefono)));
    check("2c. la computadora queda fuera", !(await sigueDentro(compu)));
    check("2d. la tableta queda fuera", !(await sigueDentro(tablet)));
    check("2e. y ninguna puede renovar su sesión", !(await puedeRenovar(compu)) && !(await puedeRenovar(tablet)));
  }

  // 3. Anything but the two values is read as «solo en este dispositivo»: the
  //    argument comes from the browser, and an unknown value must never widen
  //    what the button does.
  {
    const telefono = await dispositivo();
    const compu = await dispositivo();
    await cerrarSesion(accion, telefono, "others");
    check("3. un valor desconocido se trata como «solo este»: el otro sigue dentro", await sigueDentro(compu));
    check("3b. y este queda fuera", !(await sigueDentro(telefono)));
  }

  // 4. Changing the password signs the other devices out and keeps this one.
  //    It is what the line on «Mi negocio» promises.
  {
    const telefono = await dispositivo();
    const compu = await dispositivo();
    const db = createClient(URL_, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    await db.auth.setSession({ access_token: telefono.access_token, refresh_token: telefono.refresh_token });
    const nueva = `Qa-${stamp}-${Math.random().toString(36).slice(2, 10)}xZ!`;
    const { error: e4 } = await db.auth.updateUser({ password: nueva });
    check("4. el dueño cambia su contraseña", !e4, e4?.message);
    check("4b. y la computadora queda fuera", !(await sigueDentro(compu)));
    const { data: actual } = await db.auth.getSession();
    check("4c. mientras este dispositivo sigue dentro", !!actual.session && (await sigueDentro(actual.session)));
  }

  // 5. A password from public leaks is refused, and with the code our
  //    messages read. `Password1!` passes our own complexity rules on purpose:
  //    only the leak check can stop it. If this row fails, the switch
  //    «Prevent use of leaked passwords» is off in this project.
  {
    const telefono = await dispositivo();
    const db = createClient(URL_, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    await db.auth.setSession({ access_token: telefono.access_token, refresh_token: telefono.refresh_token });
    const { error: e5 } = await db.auth.updateUser({ password: "Password1!" });
    check(
      "5. una contraseña filtrada («Password1!») se rechaza con weak_password",
      e5?.code === "weak_password",
      e5 ? `${e5.code}: ${e5.message}` : "SE ACEPTÓ — el interruptor de contraseñas filtradas está apagado en dev",
    );
  }
} catch (e) {
  check("ERROR: la suite se detuvo", false, e instanceof Error ? e.message : String(e));
} finally {
  if (ownerId) {
    await svc.from("subscription_events").delete().eq("owner_id", ownerId);
    await svc.from("subscriptions").delete().eq("owner_id", ownerId);
    await svc.from("owners").delete().eq("id", ownerId);
    await svc.auth.admin.deleteUser(ownerId);
  }
  console.log(`\n${filas.filter(Boolean).length}/${filas.length} pasan.`);
  process.exit(filas.every(Boolean) ? 0 : 1);
}
