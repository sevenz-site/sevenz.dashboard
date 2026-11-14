// THE PERMISSION SENTENCE, VERSION 2, AND THE ONE-TIME NOTICE THAT THE WEEKLY WHATSAPP CHANGED.
//
// Part 1 needs no database: who gets the notice (`tocaAvisoDelResumen`). Part 2 is DEV ONLY
// (vzqppwrwnmlbrxizskdh) and needs migration 202: a new signup stores the version 2 sentence
// as its evidence and so never sees the notice, and the owner's OWN session can mark it seen
// (the suite runs that update as the owner, not with the service key, because the service key
// would pass with the grant or the policy broken for everyone). Writes throw-away accounts
// and removes them.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const {
  tocaAvisoDelResumen,
  TEXTO_AVISOS_WHATSAPP,
  TEXTO_AVISOS_WHATSAPP_REGISTRO,
  TEXTO_AVISOS_WHATSAPP_V2,
  TEXTO_AVISOS_WHATSAPP_REGISTRO_V2,
} = await import("../lib/whatsapp-opt-in.ts");

const filas = [];
const check = (nombre, pasa, detalle = "") => {
  filas.push(pasa);
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${pasa || !detalle ? "" : `  — ${detalle}`}`);
};

// ── 1. Who sees the notice ────────────────────────────────────────────────
{
  const base = {
    whatsapp: "584120000000",
    whatsapp_opt_in_at: "2026-10-01T12:00:00Z",
    whatsapp_opt_out_at: null,
    whatsapp_opt_in_text: TEXTO_AVISOS_WHATSAPP,
    whatsapp_scope_notice_at: null,
    onboarding_completed_at: "2026-10-01T12:00:00Z",
  };
  check("1a. aceptó con la frase vieja de Mi negocio: SÍ lo ve", tocaAvisoDelResumen(base) === true);
  check("1b. aceptó con la frase vieja del registro: SÍ", tocaAvisoDelResumen({ ...base, whatsapp_opt_in_text: TEXTO_AVISOS_WHATSAPP_REGISTRO }) === true);
  check("1c. aceptó sin frase guardada (cuentas muy viejas): SÍ", tocaAvisoDelResumen({ ...base, whatsapp_opt_in_text: null }) === true);
  check("1d. aceptó con la frase nueva de Mi negocio: NO, ya la leyó", tocaAvisoDelResumen({ ...base, whatsapp_opt_in_text: TEXTO_AVISOS_WHATSAPP_V2 }) === false);
  check("1e. aceptó con la frase nueva del registro: NO", tocaAvisoDelResumen({ ...base, whatsapp_opt_in_text: TEXTO_AVISOS_WHATSAPP_REGISTRO_V2 }) === false);
  check("1f. ya lo vio: NO, nunca más", tocaAvisoDelResumen({ ...base, whatsapp_scope_notice_at: "2026-11-13T12:00:00Z" }) === false);
  check("1g. se dio de baja: NO", tocaAvisoDelResumen({ ...base, whatsapp_opt_out_at: "2026-10-05T12:00:00Z" }) === false);
  check("1h. se dio de baja y volvió a aceptar con la frase vieja: SÍ", tocaAvisoDelResumen({ ...base, whatsapp_opt_out_at: "2026-09-01T12:00:00Z" }) === true);
  check("1i. nunca aceptó: NO", tocaAvisoDelResumen({ ...base, whatsapp_opt_in_at: null }) === false);
  check("1j. sin número: NO", tocaAvisoDelResumen({ ...base, whatsapp: null }) === false);
  check("1k. todavía en el tour de bienvenida: NO, todavía", tocaAvisoDelResumen({ ...base, onboarding_completed_at: null }) === false);
  check("1l. las frases nuevas dicen negocio y avisos de la cuenta, no cartera", /resumen semanal de tu negocio y los avisos de tu cuenta/.test(TEXTO_AVISOS_WHATSAPP_V2) && /resumen semanal de tu negocio y los\s+avisos de tu cuenta/.test(TEXTO_AVISOS_WHATSAPP_REGISTRO_V2) && !/cartera/.test(TEXTO_AVISOS_WHATSAPP_V2 + TEXTO_AVISOS_WHATSAPP_REGISTRO_V2));
}

// ── 2. Dev ────────────────────────────────────────────────────────────────
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
if (!env.NEXT_PUBLIC_SUPABASE_URL?.includes("vzqppwrwnmlbrxizskdh")) {
  check("2. .env.local apunta a la rama dev", false, "esta suite solo escribe en dev");
} else {
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const usuarios = [];
  try {
    // A signup exactly as the form sends it: the sentence goes in the metadata and the
    // signup trigger (070) stores it as the evidence.
    const email = `qa-aviso-resumen-${Date.now().toString(36)}@sevenz-qa.test`;
    const { data: u, error } = await admin.auth.admin.createUser({
      email, email_confirm: true,
      user_metadata: { business_name: "Bodega QA aviso", first_name: "Rosa", country: "VE", whatsapp: "584120000099", whatsapp_opt_in_text: TEXTO_AVISOS_WHATSAPP_REGISTRO_V2 },
    });
    if (error) throw new Error(`createUser: ${error.message}`);
    usuarios.push(u.user.id);
    const { data: o } = await admin.from("owners").select("whatsapp, whatsapp_opt_in_at, whatsapp_opt_out_at, whatsapp_opt_in_text, whatsapp_scope_notice_at").eq("id", u.user.id).single();
    check("2a. un registro nuevo guarda la frase nueva como su permiso", o?.whatsapp_opt_in_text === TEXTO_AVISOS_WHATSAPP_REGISTRO_V2 && !!o?.whatsapp_opt_in_at, JSON.stringify(o));
    check("2b. y por eso nunca ve el aviso", tocaAvisoDelResumen({ ...o, onboarding_completed_at: "2026-11-13T00:00:00Z" }) === false);

    // An owner who accepted the old sentence, signed in with their own session.
    await admin.from("owners").update({ whatsapp_opt_in_text: TEXTO_AVISOS_WHATSAPP, onboarding_completed_at: new Date().toISOString() }).eq("id", u.user.id);
    const login = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: lk } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    const { data: ses, error: eOtp } = await login.auth.verifyOtp({ type: "magiclink", token_hash: lk.properties.hashed_token });
    if (eOtp) throw new Error(`otp: ${eOtp.message}`);
    const comoDueno = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${ses.session.access_token}` } },
    });
    const { data: leido, error: eLee } = await comoDueno.from("owners").select("whatsapp_opt_in_text, whatsapp_scope_notice_at, onboarding_completed_at, whatsapp, whatsapp_opt_in_at, whatsapp_opt_out_at").eq("id", u.user.id).single();
    check("2c. como dueño, lee la columna nueva (Inicio la lee así)", !eLee && leido && "whatsapp_scope_notice_at" in leido, eLee?.message);
    check("2d. con la frase vieja, el aviso le toca", tocaAvisoDelResumen(leido) === true, JSON.stringify(leido));
    // Exactly what `registrarAvisoDelResumen` does, with the owner's session.
    const { error: eUpd } = await comoDueno.from("owners").update({ whatsapp_scope_notice_at: new Date().toISOString() }).eq("id", u.user.id).is("whatsapp_scope_notice_at", null);
    const { data: despues } = await comoDueno.from("owners").select("whatsapp_opt_in_text, whatsapp_scope_notice_at, onboarding_completed_at, whatsapp, whatsapp_opt_in_at, whatsapp_opt_out_at").eq("id", u.user.id).single();
    check("2e. como dueño, lo marca visto (sin grant o sin política, aquí fallaría)", !eUpd && !!despues?.whatsapp_scope_notice_at, eUpd?.message ?? JSON.stringify(despues));
    check("2f. y ya no le vuelve a tocar", tocaAvisoDelResumen(despues) === false);
    const primera = despues.whatsapp_scope_notice_at;
    await comoDueno.from("owners").update({ whatsapp_scope_notice_at: new Date(Date.now() + 60_000).toISOString() }).eq("id", u.user.id).is("whatsapp_scope_notice_at", null);
    const { data: otra } = await admin.from("owners").select("whatsapp_scope_notice_at").eq("id", u.user.id).single();
    check("2g. marcarlo otra vez no mueve la fecha de la primera", otra?.whatsapp_scope_notice_at === primera, `${primera} → ${otra?.whatsapp_scope_notice_at}`);
  } catch (e) {
    check("la suite corrió entera", false, e instanceof Error ? e.message : String(e));
  } finally {
    for (const id of usuarios) await admin.auth.admin.deleteUser(id);
    const { count } = usuarios.length ? await admin.from("owners").select("id", { count: "exact", head: true }).in("id", usuarios) : { count: 0 };
    check("3. limpieza: la cuenta de prueba ya no existe", count === 0, String(count));
  }
}

const ok = filas.filter(Boolean).length;
console.log(`\n${ok}/${filas.length} pasan.`);
process.exit(ok === filas.length ? 0 : 1);
