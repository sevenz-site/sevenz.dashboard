// C2 OF PL-22: the new-device alert and «No fui yo».
//
// Part 1 needs no database: the words of the alert and what a header says about a device
// (lib/security/device-text.ts). Part 2 is DEV ONLY (vzqppwrwnmlbrxizskdh): the functions of
// migration 192 as the server calls them, the one thing a session may ask, and that «No fui
// yo» really ends a live session. Writes only its own rows and removes them.
import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { deviceText, identityFromHeaders, placeText, templateSafe, whenText } from "../lib/security/device-text.ts";
import { browserOf, osOf } from "../lib/user-agent.ts";

const filas = [];
const check = (nombre, pasa, detalle = "") => {
  filas.push(pasa);
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${pasa || !detalle ? "" : `  — ${detalle}`}`);
};
const H = (map) => ({ get: (k) => map[k.toLowerCase()] ?? null });
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const ANDROID_CHROME = "Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36";
const WINDOWS_CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

// 1. What a header says.
{
  const d = identityFromHeaders(H({ "user-agent": IPHONE, "x-vercel-ip-country": "VE", "x-vercel-ip-city": "Barquisimeto" }));
  check("1a. iPhone con Safari en Barquisimeto", d.browser === "Safari" && d.os === "iOS" && d.country === "VE" && d.city === "Barquisimeto", JSON.stringify(d));
  check("1b. la frase del aparato", deviceText(d) === "un iPhone con Safari", deviceText(d));
  check("1c. la frase del lugar", placeText(d) === "Barquisimeto, Venezuela", placeText(d));
  const e = identityFromHeaders(H({ "user-agent": ANDROID_CHROME, "x-vercel-ip-country": "CO", "x-vercel-ip-city": "Bogot%C3%A1" }));
  check("1d. Android con Chrome, ciudad con acento decodificada", deviceText(e) === "un Android con Chrome" && placeText(e) === "Bogotá, Colombia", `${deviceText(e)} · ${placeText(e)}`);
  const w = identityFromHeaders(H({ "user-agent": WINDOWS_CHROME }));
  check("1e. sin cabeceras de Vercel: computador, lugar desconocido", deviceText(w) === "un computador con Chrome" && placeText(w) === "un lugar desconocido", `${deviceText(w)} · ${placeText(w)}`);
  const x = identityFromHeaders(H({}));
  check("1f. sin nada: un aparato, otro navegador, y no revienta", x.browser === "otro" && deviceText(x) === "un aparato", JSON.stringify(x));
  const bad = identityFromHeaders(H({ "x-vercel-ip-city": "%E0%A4%A" }));
  check("1g. una ciudad mal codificada no revienta", typeof bad.city === "string", JSON.stringify(bad));
  check("1h. Chrome en iPhone no es Chrome de escritorio", browserOf("Mozilla/5.0 (iPhone) CriOS/125.0 Mobile Safari/604.1") === "Chrome iOS" && osOf("Mozilla/5.0 (iPhone)") === "iOS");
  check("1i. un parámetro de plantilla no lleva saltos de línea ni más de cuatro espacios", templateSafe("a\nb\tc") === "a b c" && templateSafe("x      y") === "x    y", JSON.stringify([templateSafe("a\nb\tc"), templateSafe("x      y")]));
  // The sentence the owner approved on 2026-11-05, and the example Meta was given.
  check("1j. la hora, como se aprobó: «5 de noviembre a las 2:10 p. m.», en Venezuela", whenText("2026-11-05T18:10:00Z", "VE") === "5 de noviembre a las 2:10 p. m.", whenText("2026-11-05T18:10:00Z", "VE"));
  check("1k. el mismo instante en Colombia es una hora menos, y «a la 1»", whenText("2026-11-05T18:10:00Z", "CO") === "5 de noviembre a la 1:10 p. m.", whenText("2026-11-05T18:10:00Z", "CO"));
  check("1l. medianoche es «12:00 a. m.» del día que empieza", whenText("2026-11-06T04:00:00Z", "VE") === "6 de noviembre a las 12:00 a. m.", whenText("2026-11-06T04:00:00Z", "VE"));
  check("1m. de noche en Venezuela sigue siendo el día de Venezuela, no el de UTC", whenText("2026-11-06T03:30:00Z", "VE") === "5 de noviembre a las 11:30 p. m.", whenText("2026-11-06T03:30:00Z", "VE"));
  check("1n. mediodía es «12:05 p. m.», y sin país manda la zona de Colombia", whenText("2026-11-05T17:05:00Z", null) === "5 de noviembre a las 12:05 p. m.", whenText("2026-11-05T17:05:00Z", null));
  check("1o. solo espacios corrientes: nada que dependa de la versión de ICU", /^[\x20-\x7eáéíóúñ]+$/.test(whenText("2026-11-05T18:10:00Z", "VE")));
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
  const { data: dueno } = await admin.from("owners").select("id, email").eq("email", env.QA_OWNER_EMAIL).maybeSingle();
  if (!dueno) {
    check("2. existe el dueño de QA (QA_OWNER_EMAIL)", false, "no está en owners");
  } else {
    const OWNER = dueno.id;
    const creados = { hashes: [], tokens: [] };
    const reg = (hash, browser, country, city) => admin.rpc("register_login_device", { p_owner_id: OWNER, p_device_hash: hash, p_browser: browser, p_country: country, p_city: city });
    try {
      await admin.from("owner_devices").delete().eq("owner_id", OWNER);
      await admin.from("owner_device_places").delete().eq("owner_id", OWNER);
      await admin.from("owner_security_state").delete().eq("owner_id", OWNER);
      const h1 = sha(randomBytes(24).toString("base64url")); creados.hashes.push(h1);
      const { data: r1, error: e1 } = await reg(h1, "Safari", "VE", "Barquisimeto");
      check("2a. el primer aparato de la cuenta se registra en silencio (first_ever)", !e1 && r1?.ok === true && r1.known === false && r1.first_ever === true && r1.known_devices === 0, e1?.message ?? JSON.stringify(r1));
      const { data: r2 } = await reg(h1, "Safari", "VE", "Barquisimeto");
      check("2b. la misma cookie: conocido por aparato", r2?.known === true && r2.by === "device" && r2.known_devices === 1, JSON.stringify(r2));
      const h2 = sha(randomBytes(24).toString("base64url")); creados.hashes.push(h2);
      const { data: r3 } = await reg(h2, "Safari", "VE", "Barquisimeto");
      check("2c. cookie nueva, mismo navegador y lugar: conocido por lugar (iPhone borró la cookie)", r3?.known === true && r3.by === "place", JSON.stringify(r3));
      const h3 = sha(randomBytes(24).toString("base64url")); creados.hashes.push(h3);
      const { data: r4 } = await reg(h3, "Chrome", "CO", "Bogotá");
      check("2d. otro navegador en otra ciudad: NO conocido, y la cuenta ya tenía aparatos → avisaría", r4?.known === false && r4.first_ever === false && r4.known_devices === 2, JSON.stringify(r4));
      check("2e. la función devuelve el número y el país del dueño para el aviso", r4 && "whatsapp" in r4 && "owner_country" in r4, JSON.stringify(Object.keys(r4 ?? {})));
      const h4 = sha(randomBytes(24).toString("base64url")); creados.hashes.push(h4);
      const { data: r5 } = await reg(h4, "Safari", null, null);
      check("2f. sin lugar (cabeceras ausentes) con la misma familia: solo cuenta como conocido si ya hubo uno sin lugar", r5?.known === false, JSON.stringify(r5));

      // Migration 199: a device is known by every place it signed in from, not only the
      // last. Before it, the device row's city was overwritten and 2i raised a false alert.
      const h5 = sha(randomBytes(24).toString("base64url")); creados.hashes.push(h5);
      const { data: r6 } = await reg(h5, "Firefox", "VE", "Mérida");
      check("2g. Firefox en Mérida, que nadie había usado: NO conocido → avisaría", r6?.known === false && r6.first_ever === false, JSON.stringify(r6));
      const { data: r7 } = await reg(h5, "Firefox", "VE", "Valencia");
      check("2h. ese mismo aparato entra un día desde Valencia: conocido por aparato", r7?.known === true && r7.by === "device", JSON.stringify(r7));
      const h6 = sha(randomBytes(24).toString("base64url")); creados.hashes.push(h6);
      const { data: r8 } = await reg(h6, "Firefox", "VE", "Mérida");
      check("2i. pierde la cookie y vuelve a Mérida, su ciudad de siempre: conocido por lugar, sin aviso falso (199)", r8?.known === true && r8.by === "place", JSON.stringify(r8));
      const h7 = sha(randomBytes(24).toString("base64url")); creados.hashes.push(h7);
      const { data: r9 } = await reg(h7, "Firefox", "VE", "Valencia");
      check("2j. y desde Valencia también: las dos ciudades cuentan", r9?.known === true && r9.by === "place", JSON.stringify(r9));
      const { error: eOld } = await admin.from("owner_device_places").update({ last_seen: new Date(Date.now() - 91 * 86_400_000).toISOString() }).eq("owner_id", OWNER).eq("browser", "Firefox").eq("city", "Mérida");
      const h8 = sha(randomBytes(24).toString("base64url")); creados.hashes.push(h8);
      const { data: r10 } = await reg(h8, "Firefox", "VE", "Mérida");
      check("2k. una ciudad que no se ve hace 91 días ya no cuenta: avisaría", !eOld && r10?.known === false, eOld?.message ?? JSON.stringify(r10));
      const { data: viejos } = await admin.from("owner_device_places").select("city, last_seen").eq("owner_id", OWNER).lt("last_seen", new Date(Date.now() - 90 * 86_400_000).toISOString());
      check("2l. y los lugares de más de 90 días no se quedan guardados", (viejos ?? []).length === 0, JSON.stringify(viejos));
      const h9 = sha(randomBytes(24).toString("base64url")); creados.hashes.push(h9);
      const { data: r11 } = await reg(h9, "Chrome", "VE", "Mérida");
      check("2m. otro navegador en una ciudad conocida sigue siendo desconocido", r11?.known === false, JSON.stringify(r11));

      // The token, end to end, against a live session of the QA owner.
      const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: dueno.email });
      const login = anon();
      const { data: s, error: eS } = await login.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
      check("3a. el dueño de QA tiene una sesión viva", !eS && !!s?.session?.access_token, eS?.message);
      const asOwner = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${s.session.access_token}` } } });
      const { data: st0, error: eSt } = await asOwner.rpc("my_security_state");
      check("3b. como dueño: my_security_state dice false", !eSt && st0 === false, eSt?.message ?? String(st0));

      const token = randomBytes(24).toString("base64url");
      const { data: tid, error: eT } = await admin.rpc("create_not_me_token", { p_owner_id: OWNER, p_token_hash: sha(token), p_ttl_hours: 24 });
      creados.tokens.push(sha(token));
      check("3c. el servidor crea el token", !eT && typeof tid === "string", eT?.message);
      const { data: pk } = await admin.rpc("peek_not_me_token", { p_token_hash: sha(token) });
      check("3d. mirar el token no lo gasta", pk?.ok === true, JSON.stringify(pk));
      const { data: pk2 } = await admin.rpc("peek_not_me_token", { p_token_hash: sha("no-existe-" + token) });
      check("3e. un token inventado: invalid", pk2?.ok === false && pk2.code === "invalid", JSON.stringify(pk2));
      const { error: eAnon } = await anon().rpc("consume_not_me_token", { p_token_hash: sha(token) });
      check("3f. anon NO puede consumirlo", eAnon != null && /permission denied|42501/.test(`${eAnon.code} ${eAnon.message}`), eAnon ? `${eAnon.code}` : "respondió");
      const { data: c1, error: eC } = await admin.rpc("consume_not_me_token", { p_token_hash: sha(token) });
      check("3g. consumirlo: ok, con el dueño y su correo", !eC && c1?.ok === true && c1.owner_id === OWNER && c1.email === dueno.email, eC?.message ?? JSON.stringify(c1));
      const { data: c2 } = await admin.rpc("consume_not_me_token", { p_token_hash: sha(token) });
      check("3h. la segunda vez: used", c2?.ok === false && c2.code === "used", JSON.stringify(c2));
      const { data: st1, error: eSt1 } = await asOwner.rpc("my_security_state");
      const { data: u1, error: eU } = await asOwner.auth.getUser();
      check("3i. la sesión viva ya no vale: Auth la rechaza", !!eU || !u1?.user, eU ? eU.message : "getUser respondió con usuario");
      check("3j. como dueño, después de «No fui yo», la sesión no puede ni preguntar", eSt1 != null || st1 === true, eSt1 ? eSt1.message : String(st1));
      const { data: fila } = await admin.from("owner_security_state").select("must_reset_password, reason").eq("owner_id", OWNER).maybeSingle();
      check("3k. owner_security_state: must_reset_password = true, reason not_me", fila?.must_reset_password === true && fila.reason === "not_me", JSON.stringify(fila));
      const { error: eCl } = await admin.rpc("clear_must_reset_password", { p_owner_id: OWNER });
      const { data: fila2 } = await admin.from("owner_security_state").select("must_reset_password, cleared_at").eq("owner_id", OWNER).maybeSingle();
      check("3l. al cambiar la contraseña, la marca se limpia", !eCl && fila2?.must_reset_password === false && fila2.cleared_at != null, eCl?.message ?? JSON.stringify(fila2));

      const old = randomBytes(24).toString("base64url");
      await admin.from("owner_security_tokens").insert({ owner_id: OWNER, token_hash: sha(old), purpose: "not_me", expires_at: new Date(Date.now() - 60_000).toISOString() });
      creados.tokens.push(sha(old));
      const { data: c3 } = await admin.rpc("consume_not_me_token", { p_token_hash: sha(old) });
      check("3m. un token caducado: expired, y no cierra nada", c3?.ok === false && c3.code === "expired", JSON.stringify(c3));

      const { error: eTab } = await anon().from("owner_devices").select("id").limit(1);
      const { error: eTab2 } = await asOwner.from("owner_security_tokens").select("id").limit(1);
      check("4. ni anon ni una sesión leen las tablas", eTab != null && eTab2 != null, `${eTab?.code} ${eTab2?.code}`);
      const { error: eTab3 } = await anon().from("owner_device_places").select("city").limit(1);
      const { error: eTab4 } = await asOwner.from("owner_device_places").select("city").limit(1);
      check("4b. ni anon ni una sesión leen los lugares (199)", eTab3 != null && eTab4 != null, `${eTab3?.code} ${eTab4?.code}`);
    } finally {
      await admin.from("owner_devices").delete().eq("owner_id", OWNER);
      await admin.from("owner_device_places").delete().eq("owner_id", OWNER);
      for (const t of creados.tokens) await admin.from("owner_security_tokens").delete().eq("token_hash", t);
      await admin.from("owner_security_state").delete().eq("owner_id", OWNER);
      const { count } = await admin.from("owner_devices").select("id", { count: "exact", head: true }).eq("owner_id", OWNER);
      const { count: lugares } = await admin.from("owner_device_places").select("city", { count: "exact", head: true }).eq("owner_id", OWNER);
      check("5. limpieza: no queda nada de la prueba en dev", count === 0 && lugares === 0, `${count} aparatos · ${lugares} lugares`);
    }
  }
}

const ok = filas.filter(Boolean).length;
console.log(`\n${ok}/${filas.length} pasan.`);
process.exit(ok === filas.length ? 0 : 1);
