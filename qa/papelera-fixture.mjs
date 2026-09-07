// Throwaway QA fixture for the Papelera work. DEV BRANCH ONLY — it reads
// .env.local, which points at the dev branch (vzqppwrwnmlbrxizskdh). Never
// point it at production.
//
// Creates an isolated owner with three clients covering the three "mover a
// papelera" confirmations, plus a live share link on the one who owes money.
// qa/papelera-verify.mjs asserts against what this builds.
//
//   npm run qa:papelera:fixture         create it
//   npm run qa:papelera:fixture -- clean   delete it
//
// The password is a fixed constant so the same account can be signed into for
// manual UI checks. That is only safe because this account exists solely in
// the dev branch, owns nothing but its own generated rows, and is deleted and
// recreated on every run.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const EMAIL = "qa-papelera@example.com";
const QA_PASSWORD = "PapeleraQA!2026";
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { data: existing } = await db.auth.admin.listUsers({ perPage: 1000 });
for (const u of existing.users.filter((u) => u.email === EMAIL)) {
  await db.auth.admin.deleteUser(u.id);
}
if (process.argv[2] === "clean") {
  console.log("cleaned");
  process.exit(0);
}

const { data: created, error: createError } = await db.auth.admin.createUser({
  email: EMAIL,
  password: QA_PASSWORD,
  email_confirm: true,
  user_metadata: {
    business_name: "QA Papelera",
    first_name: "QA",
    last_name: "Papelera",
    country: "CO",
    whatsapp: "+573001112233",
  },
});
if (createError) throw createError;
const ownerId = created.user.id;

async function makeClient(name, documentId, movements) {
  const { data: c, error } = await db
    .from("clients")
    .insert({ owner_id: ownerId, name, document_id: documentId, whatsapp: "573001112233" })
    .select("id")
    .single();
  if (error) throw error;
  if (movements.length > 0) {
    const { error: mError } = await db
      .from("movements")
      .insert(movements.map((m) => ({ client_id: c.id, ...m })));
    if (mError) throw mError;
  }
  return c.id;
}

// One client per confirmation tier in PAPELERA-PLAN.md §5.
const debe = await makeClient("QA Debe Plata", "9001001", [
  { type: "charge", amount: 50000, description: "Fiado de prueba" },
]);
const saldado = await makeClient("QA Saldado", "9001002", [
  { type: "charge", amount: 30000, description: "Fiado" },
  { type: "payment", amount: 30000, description: "Abono total" },
]);
const vacio = await makeClient("QA Sin Movimientos", "9001003", []);

const { data: link, error: linkError } = await db
  .from("share_links")
  .insert({ client_id: debe })
  .select("token")
  .single();
if (linkError) throw linkError;

// Magic link -> verifyOtp gives a real session without a password ever being
// typed into a form.
const { data: gen, error: genError } = await db.auth.admin.generateLink({ type: "magiclink", email: EMAIL });
if (genError) throw genError;

const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});
const { data: verified, error: verifyError } = await anon.auth.verifyOtp({
  type: "magiclink",
  token_hash: gen.properties.hashed_token,
});
if (verifyError) throw verifyError;

const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
const cookieName = `sb-${ref}-auth-token`;
const value = "base64-" + Buffer.from(JSON.stringify(verified.session), "utf8").toString("base64url");
const MAX = 3180;
const chunks =
  value.length <= MAX
    ? [{ name: cookieName, value }]
    : Array.from({ length: Math.ceil(value.length / MAX) }, (_, i) => ({
        name: `${cookieName}.${i}`,
        value: value.slice(i * MAX, (i + 1) * MAX),
      }));

console.log(
  JSON.stringify(
    {
      signIn: { email: EMAIL, password: QA_PASSWORD },
      ownerId,
      clients: { debe, saldado, vacio },
      shareToken: link.token,
      cookies: chunks,
    },
    null,
    1,
  ),
);
