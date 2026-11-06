// LOAD TEST, STEP ONE: the sessions (phase 2 of the k6 review, 2026-11-05).
//
// Mints one session per QA account in DEV by magic link — never a password — and writes
// the cookies k6 will carry to a git-ignored file. The reason is Supabase Auth's limit of
// 30 sign-ins per 5 minutes per IP: a hundred virtual users signing in with a password
// from this machine would measure that limiter, not the app.
//
// ONLY DEV. Refuses any other database, and only accounts whose email is `qa-*@example.com`
// with no client holding a WhatsApp permission: a load test must never be able to send a
// real message (owner's rule, 2026-11-05: «ante la duda, es mejor omitir la prueba»).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
const REF = "vzqppwrwnmlbrxizskdh";
if (!env.NEXT_PUBLIC_SUPABASE_URL?.includes(REF)) throw new Error("solo contra la rama dev");

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: owners } = await admin.from("owners").select("id, email, business_name").like("email", "qa-%@example.com");
const out = [];
for (const o of owners) {
  const { count } = await admin.from("clients").select("id", { count: "exact", head: true }).eq("owner_id", o.id).not("whatsapp_opt_in_at", "is", null);
  if (count) { console.log(`omitido ${o.email}: ${count} clientes con permiso de WhatsApp`); continue; }
  const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: o.email });
  if (error) { console.log(`omitido ${o.email}: ${error.message}`); continue; }
  const { data: s, error: e2 } = await anon.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  if (e2) { console.log(`omitido ${o.email}: ${e2.message}`); continue; }
  // The cookie shape @supabase/ssr reads: base64url JSON of the session, chunked at 3180.
  const v = "base64-" + Buffer.from(JSON.stringify(s.session), "utf8").toString("base64url");
  const MAX = 3180;
  const cookies = v.length <= MAX
    ? [[`sb-${REF}-auth-token`, v]]
    : Array.from({ length: Math.ceil(v.length / MAX) }, (_, i) => [`sb-${REF}-auth-token.${i}`, v.slice(i * MAX, (i + 1) * MAX)]);
  const { data: clients } = await admin.from("clients").select("id").eq("owner_id", o.id).is("deleted_at", null).limit(5);
  out.push({ email: o.email, negocio: o.business_name, cookie: cookies.map(([k, val]) => `${k}=${val}`).join("; "), clientes: (clients ?? []).map((c) => c.id), expira: s.session.expires_at });
  console.log(`sesión: ${o.email} (${o.business_name}), ${clients?.length ?? 0} clientes`);
}
mkdirSync("scripts/ayuda/raw", { recursive: true });
writeFileSync("scripts/ayuda/raw/carga-sesiones.json", JSON.stringify(out, null, 1));
console.log(`\n${out.length} sesiones en scripts/ayuda/raw/carga-sesiones.json (git-ignored); caducan en 60 minutos.`);
