// LOAD TEST, PHASE 3: THE TEST ACCOUNTS (k6 review of 2026-11-05).
//
//   node qa/carga/cuentas.mjs            → creates N owners (default 100) in DEV
//   node qa/carga/cuentas.mjs --clean    → deletes every one of them (cascade)
//
// Each account is `qa-carga-NNN@sevenz-qa.test`, created through Auth so `handle_new_user`
// builds its `owners` row like a real signup, with onboarding done, NO WhatsApp number, three
// clients with NO number and NO consent, and two published products. That is the whole
// guard against reaching a real phone: there is no number anywhere for a message to go to.
// ONLY DEV: refuses any other database.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
if (!env.NEXT_PUBLIC_SUPABASE_URL?.includes("vzqppwrwnmlbrxizskdh")) throw new Error("solo contra la rama dev");
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const FILE = "scripts/ayuda/raw/carga-cuentas.json";
const N = Number(process.env.CARGA_CUENTAS || 100);
const clean = process.argv.includes("--clean");

if (clean) {
  const cuentas = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : [];
  // Also by email, in case the file was lost: nothing else is named like this.
  const { data: porEmail } = await admin.from("owners").select("id, email").like("email", "qa-carga-%@sevenz-qa.test");
  const ids = new Set([...cuentas.map((c) => c.id), ...(porEmail ?? []).map((o) => o.id)]);
  let borrados = 0;
  for (const id of ids) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.log(`no se pudo borrar ${id}: ${error.message}`); else borrados++;
  }
  const { count } = await admin.from("owners").select("id", { count: "exact", head: true }).like("email", "qa-carga-%@sevenz-qa.test");
  console.log(`borradas ${borrados} cuentas; quedan ${count} con ese nombre`);
  if (existsSync(FILE)) writeFileSync(FILE, "[]");
  process.exit(count === 0 ? 0 : 1);
}

const stamp = Date.now().toString(36);
const out = [];
for (let n = 1; n <= N; n++) {
  const tag = String(n).padStart(3, "0");
  const email = `qa-carga-${tag}-${stamp}@sevenz-qa.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { business_name: `QA Carga ${tag}`, country: "VE", first_name: "Carga", last_name: tag },
  });
  if (error) { console.log(`cuenta ${tag}: ${error.message}`); continue; }
  const id = data.user.id;
  await admin.from("owners").update({ onboarding_completed_at: new Date().toISOString(), whatsapp: null }).eq("id", id);
  const { data: clientes, error: eC } = await admin.from("clients")
    .insert([1, 2, 3].map((k) => ({ owner_id: id, name: `Cliente ${k} de carga ${tag}`, whatsapp: null })))
    .select("id");
  if (eC) console.log(`clientes ${tag}: ${eC.message}`);
  const { data: productos, error: eP } = await admin.from("products")
    .insert([1, 2].map((k) => ({
      owner_id: id, name: `Producto ${k} de carga ${tag}`,
      base_currency: "USD", base_currency_retail: "USD", base_currency_wholesale: "USD",
      price_retail: 5 * k, published_retail: true, published_wholesale: false,
    })))
    .select("id");
  if (eP) console.log(`productos ${tag}: ${eP.message}`);
  out.push({ id, email, clientes: (clientes ?? []).map((c) => c.id), productos: (productos ?? []).map((p) => p.id) });
  if (n % 20 === 0) console.log(`${n} cuentas…`);
}
mkdirSync("scripts/ayuda/raw", { recursive: true });
writeFileSync(FILE, JSON.stringify(out, null, 1));
const { count: conNumero } = await admin.from("clients").select("id", { count: "exact", head: true }).in("owner_id", out.map((o) => o.id)).not("whatsapp", "is", null);
console.log(`\n${out.length} cuentas en ${FILE}; clientes con número de WhatsApp entre ellas: ${conNumero} (tiene que ser 0)`);
process.exit(conNumero === 0 ? 0 : 1);
