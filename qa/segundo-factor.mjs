// C1 OF PL-22: the second factor by code.
//
// Part 1 needs no database: the words of the code screens and the shape of the code and of
// the email (lib/security/code-text.ts). Part 2 is DEV ONLY (vzqppwrwnmlbrxizskdh): the
// functions of migration 193 as the server calls them — one live code, five misses, expiry,
// the ticket chain on a resend, the gate before a session, the switch, the admin's email
// change — and that anon and an owner session get 42501 on all of it. Writes only the QA
// owner's rows and removes them. Needs `--experimental-strip-types`.
import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  CODE_LENGTH,
  CODE_MAX_ATTEMPTS,
  CODE_TTL_MINUTES,
  codeEmail,
  hasLink,
  maskEmail,
  maskPhone,
  normalizeCode,
  purposeText,
  rejectionText,
  sentToText,
} from "../lib/security/code-text.ts";

const filas = [];
const check = (nombre, pasa, detalle = "") => {
  filas.push(pasa);
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${pasa || !detalle ? "" : `  — ${detalle}`}`);
};

// 1. Pure.
{
  check("1a. seis dígitos, diez minutos, cinco intentos (decisión del dueño)", CODE_LENGTH === 6 && CODE_TTL_MINUTES === 10 && CODE_MAX_ATTEMPTS === 5);
  check("1b. «482 913» y «482-913» son el mismo código; «48291» no", normalizeCode("482 913") === "482913" && normalizeCode("482-913") === "482913" && normalizeCode("48291") === null && normalizeCode("abcdef") === null);
  check("1c. el número enmascarado enseña solo los 4 últimos", maskPhone("584128130265") === "···· 0265" && maskPhone("12") === "tu WhatsApp", maskPhone("584128130265"));
  check("1d. el correo enmascarado conserva el dominio", maskEmail("jesus@gmail.com") === "j***@gmail.com" && maskEmail("x") === "tu correo", maskEmail("jesus@gmail.com"));
  check("1e. «te enviamos un código al WhatsApp que termina en …»", sentToText("whatsapp", "584128130265") === "Te enviamos un código al WhatsApp que termina en 0265.", sentToText("whatsapp", "584128130265"));
  check("1f. cada rechazo tiene su frase, y distingue caducó de no coincide", rejectionText("expired") !== rejectionText("mismatch", 3) && /caducó/.test(rejectionText("expired")) && /quedan 3/.test(rejectionText("mismatch", 3)) && /queda 1 intento/.test(rejectionText("mismatch", 1)) && /10 minutos/.test(rejectionText("locked")));
  const mail = codeEmail("482913", purposeText("login"));
  check("1g. el correo lleva el código en el asunto y solo en su línea", mail.subject === "Tu código de Sevenz: 482913" && mail.text.split("\n").includes("482913"), mail.subject);
  check("1h. el correo NO lleva enlaces ni botones (regla del dueño)", !hasLink(mail.text) && !/<a\s|http/.test(mail.subject), mail.text);
  check("1i. el correo dice que Sevenz nunca pide el código", /nunca te pide este código/.test(mail.text));
  check("1j. hasLink detecta http, www y <a>", hasLink("ver https://x.y") && hasLink("www.sevenz.site") && hasLink('<a href="x">') && !hasLink("482913"));
}

// ── Part 2: DEV ───────────────────────────────────────────────────────────────
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);
if (!env.NEXT_PUBLIC_SUPABASE_URL?.includes("vzqppwrwnmlbrxizskdh")) {
  check("2. .env.local apunta a la rama dev", false, "esta suite solo escribe en dev");
} else {
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const anon = () => createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const sha = (v) => createHash("sha256").update(v).digest("hex");
  const hashCode = (code, owner) => sha(`${code}:${owner}`);
  const hashTicket = (t) => sha(`ticket:${t}`);
  const { data: dueno } = await admin.from("owners").select("id, email, whatsapp").eq("email", env.QA_OWNER_EMAIL).maybeSingle();
  if (!dueno) {
    check("2. existe el dueño de QA (QA_OWNER_EMAIL)", false, "no está en owners");
  } else {
    const OWNER = dueno.id;
    const emailOriginal = dueno.email;
    // Create AND mark delivered, as the server does once Kapso or Resend accepted the message.
    const crear = async (purpose, code, ticket, extra = {}) => {
      const r = await crearSinEntregar(purpose, code, ticket, extra);
      if (r.data?.ok) await admin.rpc("mark_login_code_delivered", { p_id: r.data.id });
      return r;
    };
    const crearSinEntregar = (purpose, code, ticket, extra = {}) =>
      admin.rpc("create_login_code", {
        p_owner_id: OWNER,
        p_purpose: purpose,
        p_channel: "whatsapp",
        p_target: dueno.whatsapp ?? "584120000000",
        p_code_hash: hashCode(code, OWNER),
        p_ticket_hash: ticket ? hashTicket(ticket) : null,
        p_ttl_minutes: 10,
        p_prev_ticket_hash: null,
        ...extra,
      });
    const verificar = (purpose, code, ticket) =>
      admin.rpc("verify_login_code", { p_owner_id: OWNER, p_purpose: purpose, p_code_hash: hashCode(code, OWNER), p_ticket_hash: ticket ? hashTicket(ticket) : null });
    const limpiar = async () => {
      await admin.from("owner_login_codes").delete().eq("owner_id", OWNER);
      await admin.from("owner_security_audit").delete().eq("owner_id", OWNER);
      await admin.rpc("set_second_factor", { p_owner_id: OWNER, p_enabled: false });
      await admin.from("owner_devices").delete().eq("owner_id", OWNER);
      await admin.from("rate_limit_counters").delete().like("key", `password:${OWNER}%`);
    };
    try {
      await limpiar();

      // 2. One live code, five misses, the right one.
      const t1 = randomBytes(24).toString("base64url");
      const { data: c1, error: e1 } = await crear("login", "111111", t1);
      check("2a. el servidor crea un código de entrada", !e1 && c1?.ok === true && typeof c1.id === "string", e1?.message ?? JSON.stringify(c1));
      const t2 = randomBytes(24).toString("base64url");
      const { data: c2 } = await crear("login", "222222", t2);
      check("2b. un segundo código invalida al primero (uno vivo por propósito)", c2?.ok === true, JSON.stringify(c2));
      const { data: v1 } = await verificar("login", "111111", t1);
      check("2c. el primero ya no vale: bad_ticket (el ticket viejo no es el del código vivo)", v1?.ok === false && v1.code === "bad_ticket", JSON.stringify(v1));
      const { data: v2 } = await verificar("login", "111111", t2);
      check("2d. código equivocado con el ticket bueno: mismatch, quedan 4", v2?.ok === false && v2.code === "mismatch" && v2.attempts_left === 4, JSON.stringify(v2));
      for (let i = 0; i < 3; i++) await verificar("login", "000000", t2);
      const { data: v3 } = await verificar("login", "000000", t2);
      check("2e. al quinto fallo: locked, y el código queda invalidado", v3?.ok === false && v3.code === "locked", JSON.stringify(v3));
      const { data: v4 } = await verificar("login", "222222", t2);
      check("2f. después del bloqueo, ni el código correcto entra: none", v4?.ok === false && v4.code === "none", JSON.stringify(v4));

      const t3 = randomBytes(24).toString("base64url");
      await crear("login", "333333", t3);
      const { data: v5 } = await verificar("login", "333333", t3);
      check("2g. el código correcto con su ticket: ok, con canal y destino", v5?.ok === true && v5.channel === "whatsapp" && typeof v5.target === "string", JSON.stringify(v5));
      const { data: v6 } = await verificar("login", "333333", t3);
      check("2h. un código usado no vale dos veces: none", v6?.ok === false && v6.code === "none", JSON.stringify(v6));

      // 3. Expiry and the ticket chain on a resend.
      const t4 = randomBytes(24).toString("base64url");
      await crear("login", "444444", t4);
      await admin.from("owner_login_codes").update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("owner_id", OWNER).eq("ticket_hash", hashTicket(t4));
      const { data: v7 } = await verificar("login", "444444", t4);
      check("3a. un código caducado: expired, sin gastar intentos del siguiente", v7?.ok === false && v7.code === "expired", JSON.stringify(v7));
      const t5 = randomBytes(24).toString("base64url");
      const { data: c5 } = await crear("login", "555555", t5, { p_prev_ticket_hash: hashTicket(t4) });
      check("3b. reenviar con el ticket de la cadena (aunque caducó) crea el nuevo", c5?.ok === true, JSON.stringify(c5));
      const { data: c6 } = await crear("login", "666666", randomBytes(24).toString("base64url"), { p_prev_ticket_hash: hashTicket("ticket-inventado") });
      check("3c. reenviar con un ticket inventado: bad_ticket (una cookie falsa no abre una cadena)", c6?.ok === false && c6.code === "bad_ticket", JSON.stringify(c6));
      const { data: v8 } = await verificar("login", "555555", t5);
      check("3d. el código del reenvío vale con su ticket nuevo", v8?.ok === true, JSON.stringify(v8));
      // A code whose message never left: not live, and the previous one keeps working.
      // On its own purpose, so the hourly cap of the sign-in codes above stays measurable in 4a.
      const t5b = randomBytes(24).toString("base64url");
      await crear("password", "551155", t5b);
      const t5c = randomBytes(24).toString("base64url");
      const { data: c5c } = await crearSinEntregar("password", "552255", t5c, { p_prev_ticket_hash: hashTicket(t5b) });
      const { data: v8b } = await verificar("password", "552255", t5c);
      const { data: v8c } = await verificar("password", "551155", t5b);
      check("3e. un código que no llegó a salir no vale, y el anterior sigue vivo (un reenvío fallido no deja al dueño sin código)", c5c?.ok === true && v8b?.ok === false && v8b.code === "bad_ticket" && v8c?.ok === true, JSON.stringify([c5c, v8b, v8c]));

      // 4. The hourly ceiling: 6 per owner and purpose. 6 were created above (1,2,3,4,5 + the refused 6th did not insert) → the next is refused.
      const { data: c6b } = await crear("login", "666666", randomBytes(24).toString("base64url"));
      const { data: c7 } = await crear("login", "777777", randomBytes(24).toString("base64url"));
      check("4a. a partir del séptimo código en una hora: too_many (los que no salieron también cuentan)", c6b?.ok === true && c7?.ok === false && c7.code === "too_many", JSON.stringify([c6b, c7]));
      const { data: c9 } = await crear("enable", "999999", null);
      check("4b. el tope es por propósito: un código de activación sale igual", c9?.ok === true, JSON.stringify(c9));
      const { data: v9 } = await verificar("enable", "999999", null);
      check("4c. sin ticket (acción con sesión): el código vale solo con sus dígitos", v9?.ok === true, JSON.stringify(v9));
      const { data: rv } = await admin.rpc("login_code_recently_verified", { p_owner_id: OWNER, p_purpose: "enable", p_minutes: 15 });
      const { data: rv2 } = await admin.rpc("login_code_recently_verified", { p_owner_id: OWNER, p_purpose: "admin_email", p_minutes: 15 });
      check("4d. «verificado hace poco» distingue el propósito", rv === true && rv2 === false, `${rv} ${rv2}`);

      // 5. The switch and the gate.
      const { data: g0 } = await admin.rpc("second_factor_gate", { p_email: emailOriginal, p_device_hash: null });
      check("5a. la puerta, con el factor apagado: found, second_factor false", g0?.found === true && g0.second_factor === false && g0.owner_id === OWNER, JSON.stringify(g0));
      const { error: eOn } = await admin.rpc("set_second_factor", { p_owner_id: OWNER, p_enabled: true });
      const cookie = randomBytes(24).toString("base64url");
      await admin.rpc("register_login_device", { p_owner_id: OWNER, p_device_hash: sha(cookie), p_browser: "Safari", p_country: "VE", p_city: "Barquisimeto" });
      const { data: g1 } = await admin.rpc("second_factor_gate", { p_email: emailOriginal.toUpperCase(), p_device_hash: sha(cookie) });
      check("5b. encendido y la cookie conocida: no pide código (device_known), y el correo no distingue mayúsculas", !eOn && g1?.second_factor === true && g1.device_known === true, eOn?.message ?? JSON.stringify(g1));
      const { data: g2 } = await admin.rpc("second_factor_gate", { p_email: emailOriginal, p_device_hash: sha("otra-cookie") });
      check("5c. encendido y cookie desconocida: pide código (device_known false), aunque sea el mismo navegador y ciudad", g2?.device_known === false && g2.whatsapp !== undefined && g2.email === emailOriginal, JSON.stringify(g2));
      const { data: g3 } = await admin.rpc("second_factor_gate", { p_email: "nadie-" + Date.now() + "@example.com", p_device_hash: null });
      check("5d. un correo que no existe: found false y nada más", g3?.found === false && Object.keys(g3).length === 1, JSON.stringify(g3));
      const { data: facts } = await admin.rpc("owner_security_facts", { p_owner_id: OWNER });
      check("5e. owner_security_facts: factor, número, aparatos", facts?.second_factor === true && facts.known_devices === 1 && "whatsapp" in facts, JSON.stringify(facts));

      // 6. As the owner and as anon.
      const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: emailOriginal });
      const { data: s } = await anon().auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
      const asOwner = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${s.session.access_token}` } } });
      const { data: mine, error: eMine } = await asOwner.rpc("my_second_factor");
      check("6a. como dueño: my_second_factor dice enabled true", !eMine && mine?.enabled === true, eMine?.message ?? JSON.stringify(mine));
      const { error: eA1 } = await asOwner.rpc("verify_login_code", { p_owner_id: OWNER, p_purpose: "login", p_code_hash: "x".repeat(64), p_ticket_hash: null });
      const { error: eA2 } = await anon().rpc("create_login_code", { p_owner_id: OWNER, p_purpose: "login", p_channel: "whatsapp", p_target: "1", p_code_hash: "x".repeat(64), p_ticket_hash: null, p_ttl_minutes: 10, p_prev_ticket_hash: null });
      const { error: eA3 } = await asOwner.rpc("set_second_factor", { p_owner_id: OWNER, p_enabled: false });
      const { error: eA4 } = await anon().rpc("second_factor_gate", { p_email: emailOriginal, p_device_hash: null });
      const { error: eA5 } = await asOwner.rpc("admin_set_owner_email", { p_owner_id: OWNER, p_email: "x@y.z", p_actor: "yo" });
      check("6b. ni una sesión ni anon pueden verificar, crear, apagar, preguntar a la puerta ni cambiar un correo", [eA1, eA2, eA3, eA4, eA5].every((e) => e && /42501|permission denied/.test(`${e.code} ${e.message}`)), [eA1, eA2, eA3, eA4, eA5].map((e) => e?.code).join(","));
      const { error: eT1 } = await asOwner.from("owner_login_codes").select("id").limit(1);
      const { error: eT2 } = await anon().from("owner_security_audit").select("id").limit(1);
      check("6c. las dos tablas nuevas no se leen con sesión ni sin ella", eT1 != null && eT2 != null, `${eT1?.code} ${eT2?.code}`);

      // 7. The admin's email change, at the database.
      const { data: seg } = await admin.rpc("admin_cuenta_seguridad", { p_owner_id: OWNER });
      check("7a. admin_cuenta_seguridad: datos para preguntar, sin nombres de clientes", seg && typeof seg.clients === "number" && "last_sale_at" in seg && !("client_names" in seg) && Array.isArray(seg.audit), JSON.stringify(Object.keys(seg ?? {})));
      const { data: otro } = await admin.from("owners").select("email").neq("id", OWNER).limit(1).maybeSingle();
      if (otro?.email) {
        const { data: taken } = await admin.rpc("admin_set_owner_email", { p_owner_id: OWNER, p_email: otro.email.toUpperCase(), p_actor: "qa" });
        check("7b. un correo que ya tiene otra cuenta: taken, sin tocar nada", taken?.ok === false && taken.code === "taken", JSON.stringify(taken));
      } else {
        check("7b. (sin otro dueño en dev para probar «taken»)", true);
      }
      const nuevo = `qa-cambio-${Date.now()}@example.com`;
      const { data: ch } = await admin.rpc("admin_set_owner_email", { p_owner_id: OWNER, p_email: nuevo, p_actor: "qa@sevenz" });
      const { data: fila } = await admin.from("owners").select("email").eq("id", OWNER).single();
      const { data: aud } = await admin.from("owner_security_audit").select("action, actor, detail").eq("owner_id", OWNER).eq("action", "email_changed_by_admin").maybeSingle();
      check("7c. admin_set_owner_email cambia owners.email y deja la auditoría con quién y de cuál a cuál", ch?.ok === true && fila?.email === nuevo && aud?.actor === "qa@sevenz" && aud.detail?.from === emailOriginal && aud.detail?.to === nuevo, JSON.stringify([ch, fila, aud]));
      await admin.from("owners").update({ email: emailOriginal }).eq("id", OWNER);
      const { data: back } = await admin.from("owners").select("email").eq("id", OWNER).single();
      check("7d. el correo del dueño de QA vuelve a ser el original", back?.email === emailOriginal, back?.email);
      const { data: logId } = await admin.rpc("log_security_audit", { p_owner_id: OWNER, p_action: "qa_probe", p_actor: "owner", p_detail: { x: 1 } });
      check("7e. log_security_audit escribe una fila", typeof logId === "string");
    } finally {
      await limpiar();
      await admin.from("owners").update({ email: emailOriginal }).eq("id", OWNER);
      const { count } = await admin.from("owner_login_codes").select("id", { count: "exact", head: true }).eq("owner_id", OWNER);
      const { data: st } = await admin.from("owner_security_state").select("second_factor_enabled").eq("owner_id", OWNER).maybeSingle();
      check("8. limpieza: sin códigos, factor apagado, correo original", count === 0 && (st == null || st.second_factor_enabled === false), `${count} ${JSON.stringify(st)}`);
    }
  }
}

const ok = filas.filter(Boolean).length;
console.log(`\n${ok}/${filas.length} pasan.`);
process.exit(ok === filas.length ? 0 : 1);
