// «Verificación en dos pasos» (C1 of PL-22), on the demo business, end to end: turning it
// on from Mi negocio, and the code screen on the next sign-in from a device Sevenz does
// not know. WRITES in dev: it gives the demo owner a password (admin API, never typed in
// chat), turns the factor on, and at the end turns it OFF again and hands the daemon its
// session back, so the demo stays as `seed-demo.mjs` left it.
//
// The code never reaches a phone: `.env.local` has `SECOND_FACTOR_WHATSAPP=fake` and
// `SECOND_FACTOR_QA_LOG`, so the server appends every code to that file and this script
// reads the last one. Dev only, like the daemon.
import { go, click, type, shot, js, sleep, call, DIALOG, waitFor } from "../lib.mjs";
import { M, LASTBTN } from "./_m.mjs";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const S = "verificacion-en-dos-pasos";
const env = Object.fromEntries(readFileSync("../../.env.local", "utf8").split(/\r?\n/).filter((x) => x.includes("=") && !x.startsWith("#")).map((x) => { const i = x.indexOf("="); return [x.slice(0, i).trim(), x.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
if (!env.NEXT_PUBLIC_SUPABASE_URL.includes("vzqppwrwnmlbrxizskdh")) throw new Error("no es dev");
if (!env.SECOND_FACTOR_QA_LOG) throw new Error("falta SECOND_FACTOR_QA_LOG en .env.local");
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const LOG = `../../${env.SECOND_FACTOR_QA_LOG}`;
const ultimoCodigo = () => JSON.parse(readFileSync(LOG, "utf8").trim().split("\n").pop()).code;
const CODE = "js:document.querySelector('[role=dialog] input[name=code], input[name=code]')";

// A throwaway password for the demo owner: random, used once here, never printed.
const password = `Demo-${randomBytes(9).toString("base64url")}1`;
const { error: ePw } = await admin.auth.admin.updateUserById(M.ownerId, { password });
if (ePw) throw new Error(`password: ${ePw.message}`);
// Setting a password ends every other session of the account — the daemon's included
// (that is C1 working). Give it a fresh one before walking.
await call({ op: "relogin" });

try {
  await go("/dashboard", 4000);
  await click("Abrir menú", { wait: 1500 });
  await shot(S, 1, "js:[...document.querySelectorAll('a')].find(a=>a.textContent.trim()==='Mi negocio')", { crop: 0 });

  await go("/profile", 5000);
  await shot(S, 2, "js:[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Activar')", { pad: 8 });
  await click("js:[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Activar')", { wait: 1500 });
  await shot(S, 3, "Enviar código de prueba", { scope: DIALOG });
  await click("Enviar código de prueba", { scope: DIALOG, wait: 6000 });
  await shot(S, 4, CODE, { scope: DIALOG, blur: false });
  await type(CODE, ultimoCodigo(), { wait: 500 });
  await click(LASTBTN("Activar"), { wait: 6000 });
  await shot(S, 5, "js:[...document.querySelectorAll('span,div,p')].find(e=>!e.children.length&&e.textContent.trim()==='Activa')", { pad: 8 });
  console.log("activada:", await js("document.body.innerText.includes('Activa')"));

  // A device Sevenz does not know: no cookies at all, then the password.
  await call({ op: "clear" });
  await go("/login", 4000);
  await type("Correo", M.email);
  await type("Contraseña", password);
  await click("Iniciar sesión", { wait: 6000 });
  await waitFor("location.pathname === '/login/codigo'", 30000);
  await sleep(1500);
  await shot(S, 6, CODE, { blur: false });
  console.log("pantalla del código:", await js("document.body.innerText.replace(/\\s+/g,' ').slice(0,160)"));
  await type(CODE, ultimoCodigo(), { wait: 500 });
  await click("Confirmar", { wait: 7000 });
  console.log("tras el código:", await js("location.pathname"));
} finally {
  await admin.rpc("set_second_factor", { p_owner_id: M.ownerId, p_enabled: false });
  await admin.from("owner_login_codes").delete().eq("owner_id", M.ownerId);
  await admin.from("owner_devices").delete().eq("owner_id", M.ownerId);
  await call({ op: "relogin" });
  console.log("demo restaurado: verificación apagada, códigos y aparatos borrados, sesión del daemon de vuelta");
}
