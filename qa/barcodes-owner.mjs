// SOLO LA RAMA DEV (vzqppwrwnmlbrxizskdh) — lee .env.local.
//
// qa:barcodes-owner (CT-182, migration 219). `product_barcodes` is a table the owner reads
// and writes DIRECTLY, so this suite runs AS THE OWNER (magic link, no password typed),
// not with the service key that skips RLS and grants (CLAUDE.md, «A qa/ script runs as
// the service role. The owner does not.»; migration 108 is why).
//
// What it checks, as the owner:
//   1. he can insert a code on his own product and read it back;
//   2. the same code twice in his business is refused (one product per code);
//   3. a code pointing at ANOTHER business's product is refused, even with his owner_id;
//   4. he cannot see another business's codes;
//   5. he can delete his code;
//   6. he can switch `owners.barcodes_enabled` on his own row, and it goes back to what it was.
// Everything it writes is deleted by id at the end, whatever happens.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
    }),
);
const DEV = "vzqppwrwnmlbrxizskdh";
if (!env.NEXT_PUBLIC_SUPABASE_URL.includes(DEV)) {
  console.error("❌ .env.local no apunta a la rama dev. No se corre.");
  process.exit(1);
}

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const results = [];
const check = (name, ok, detail = "") => results.push([name, Boolean(ok), detail]);
const createdIds = [];
let owner = null;
let switchBefore = null;

try {
  const correo = env.QA_OWNER_EMAIL;
  const { data: link, error: eLink } = await admin.auth.admin.generateLink({ type: "magiclink", email: correo });
  if (eLink) throw new Error(`generateLink: ${eLink.message}`);
  const me = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: sesion, error: eOtp } = await me.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  if (eOtp) throw new Error(`verifyOtp: ${eOtp.message}`);
  owner = sesion.user.id;

  const { data: mine } = await admin.from("products").select("id").eq("owner_id", owner).is("trashed_at", null).limit(1).single();
  const { data: foreign } = await admin.from("products").select("id, owner_id").neq("owner_id", owner).limit(1).single();
  if (!mine || !foreign) throw new Error("hacen falta un producto del dueño de QA y uno de otro negocio");

  const code = `QA${Date.now()}`;
  const ins = await me.from("product_barcodes").insert({ owner_id: owner, product_id: mine.id, code }).select("id").single();
  if (ins.data) createdIds.push(ins.data.id);
  check("1. El dueño guarda un código en su producto", !ins.error, ins.error?.message);
  const read = await me.from("product_barcodes").select("code").eq("code", code);
  check("1. Y lo vuelve a leer", read.data?.length === 1, read.error?.message);

  const dup = await me.from("product_barcodes").insert({ owner_id: owner, product_id: mine.id, code }).select("id").single();
  if (dup.data) createdIds.push(dup.data.id);
  check("2. El mismo código dos veces se rechaza", dup.error?.code === "23505", dup.error?.code ?? "se guardó");

  const alien = await me.from("product_barcodes").insert({ owner_id: owner, product_id: foreign.id, code: `${code}X` }).select("id").single();
  if (alien.data) createdIds.push(alien.data.id);
  check("3. Un código sobre el producto de otro negocio se rechaza", Boolean(alien.error), alien.error?.code ?? "se guardó");

  const { data: otherCode } = await admin.from("product_barcodes").insert({ owner_id: foreign.owner_id, product_id: foreign.id, code: `${code}Y` }).select("id").single();
  if (otherCode) createdIds.push(otherCode.id);
  const peek = await me.from("product_barcodes").select("id").eq("code", `${code}Y`);
  check("4. No ve los códigos de otro negocio", (peek.data ?? []).length === 0, peek.error?.message);

  const del = await me.from("product_barcodes").delete().eq("code", code).select("id");
  check("5. Borra su propio código", (del.data ?? []).length === 1, del.error?.message);

  const { data: row } = await admin.from("owners").select("barcodes_enabled").eq("id", owner).single();
  switchBefore = row.barcodes_enabled;
  const flip = await me.from("owners").update({ barcodes_enabled: !switchBefore }).eq("id", owner).select("barcodes_enabled").single();
  check("6. Cambia el interruptor de su negocio", flip.data?.barcodes_enabled === !switchBefore, flip.error?.message);
} catch (e) {
  check("La suite corrió hasta el final", false, e instanceof Error ? e.message : String(e));
} finally {
  if (createdIds.length) await admin.from("product_barcodes").delete().in("id", createdIds);
  if (owner && switchBefore !== null) await admin.from("owners").update({ barcodes_enabled: switchBefore }).eq("id", owner);
}

let fails = 0;
for (const [name, ok, detail] of results) {
  console.log(`${ok ? "✅" : "❌"} ${name}${detail && !ok ? ` — ${detail}` : ""}`);
  if (!ok) fails++;
}
console.log(fails ? `\n${fails} fallo(s).` : `\n${results.length}/${results.length} bien. Filas de prueba borradas por id: ${createdIds.length}.`);
process.exit(fails ? 1 : 0);
