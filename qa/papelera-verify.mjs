// DEV BRANCH ONLY (vzqppwrwnmlbrxizskdh) — reads .env.local.
//
// Verifies migration 044's contract against the real database, from the three
// vantage points that matter:
//
//   service role  — sets up and tears down
//   owner session — a real signed-in owner, anon key + RLS, exactly what every
//                   dashboard screen reads through
//   anon          — no session at all, exactly what a client holding a share
//                   link is
//
// Does NOT test the server actions or any UI. It tests what the database
// guarantees underneath them.
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
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
// TWO separate anon-key clients, and the split is the whole point. supabase-js
// keeps a session in memory on the client instance that signed in, even with
// persistSession:false — so calling verifyOtp on the client used for the "anon"
// assertions silently turns it into the owner, and every "anon cannot read X"
// check passes for the wrong reason (or fails, as it did the first time this
// ran). `anon` never authenticates. `signer` exists only to mint the session.
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});
const signer = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

// ── find the fixture ────────────────────────────────────────────────────
const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
const owner = users.users.find((u) => u.email === EMAIL);
if (!owner) throw new Error("fixture missing — run: npm run qa:papelera:fixture");

const { data: clients } = await admin
  .from("clients")
  .select("id, name, trashed_at, deleted_at")
  .eq("owner_id", owner.id);
const debe = clients.find((c) => c.name === "QA Debe Plata");
const { data: linkRow } = await admin
  .from("share_links")
  .select("token")
  .eq("client_id", debe.id)
  .single();
const token = linkRow.token;

// A real owner session: anon key plus a JWT, which is what the app's server
// client holds. Every view read below therefore passes through RLS.
const { data: gen } = await admin.auth.admin.generateLink({ type: "magiclink", email: EMAIL });
const { data: verified } = await signer.auth.verifyOtp({
  type: "magiclink",
  token_hash: gen.properties.hashed_token,
});
const asOwner = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
  global: { headers: { Authorization: `Bearer ${verified.session.access_token}` } },
});

const sum = (rows) => rows.reduce((t, r) => t + Number(r.balance ?? 0), 0);
const visible = async () => {
  const { data } = await asOwner.from("client_summary").select("client_id, balance").eq("owner_id", owner.id);
  return data ?? [];
};
const shared = async () => {
  const { data } = await anon.rpc("get_shared_balance", { p_token: token });
  return data;
};

// ── 1. baseline ─────────────────────────────────────────────────────────
await admin
  .from("clients")
  .update({ trashed_at: null, deleted_at: null, trashed_balance: null, trashed_balance_usd: null, trashed_balance_eur: null })
  .eq("id", debe.id);

const before = await visible();
const beforeTotal = sum(before);
check(
  "baseline: owner sees the client in client_summary",
  before.some((r) => r.client_id === debe.id),
  `${before.length} clientes, capital ${beforeTotal}`,
);
const sharedBefore = await shared();
check("baseline: share link shows the balance", Number(sharedBefore?.balance) === 50000, `balance=${sharedBefore?.balance}`);

// ── 2. trash, writing exactly what trashClient() writes ─────────────────
await admin
  .from("clients")
  .update({
    trashed_at: new Date().toISOString(),
    trashed_balance: 50000,
    trashed_balance_usd: 0,
    trashed_balance_eur: 0,
  })
  .eq("id", debe.id);

const after = await visible();
const afterTotal = sum(after);
check(
  "trashed: client is gone from client_summary",
  !after.some((r) => r.client_id === debe.id),
  `${after.length} clientes`,
);
check(
  "trashed: capital por cobrar drops by exactly the balance",
  beforeTotal - afterTotal === 50000,
  `${beforeTotal} -> ${afterTotal} (delta ${beforeTotal - afterTotal})`,
);

const { data: all } = await asOwner
  .from("client_summary_all")
  .select("client_id, trashed_at, trashed_balance")
  .eq("client_id", debe.id);
check(
  "trashed: still visible in client_summary_all, with the snapshot",
  all?.length === 1 && all[0].trashed_at !== null && Number(all[0].trashed_balance) === 50000,
  `snapshot=${all?.[0]?.trashed_balance}`,
);

// THE ONE THAT MATTERS: D3. One line in 044. If this reads 0, a hidden
// client is told their debt was cancelled.
const sharedAfter = await shared();
check(
  "trashed: SHARE LINK STILL SHOWS THE REAL BALANCE (D3)",
  Number(sharedAfter?.balance) === 50000,
  `balance=${sharedAfter?.balance}, cliente=${sharedAfter?.client_name}`,
);

// ── 3. an anon caller must not reach the unfiltered view ────────────────
const { data: leak, error: leakError } = await anon.from("client_summary_all").select("client_id").limit(1);
check(
  "anon key cannot read client_summary_all",
  (leak ?? []).length === 0,
  leakError ? leakError.message : `${(leak ?? []).length} rows`,
);

// ── 4. restore ──────────────────────────────────────────────────────────
await admin
  .from("clients")
  .update({ trashed_at: null, deleted_at: null, trashed_balance: null, trashed_balance_usd: null, trashed_balance_eur: null })
  .eq("id", debe.id);

const restored = await visible();
check(
  "restored: back in client_summary and back in the total",
  restored.some((r) => r.client_id === debe.id) && sum(restored) === beforeTotal,
  `capital ${sum(restored)} (baseline ${beforeTotal})`,
);

// ── 5. hidden definitivamente ───────────────────────────────────────────
await admin
  .from("clients")
  .update({ trashed_at: new Date().toISOString(), deleted_at: new Date().toISOString(), trashed_balance: 50000 })
  .eq("id", debe.id);

const hidden = await visible();
check("hidden: gone from client_summary", !hidden.some((r) => r.client_id === debe.id));
const sharedHidden = await shared();
check(
  "hidden: share link STILL works (D1/D3 — not a deletion)",
  Number(sharedHidden?.balance) === 50000,
  `balance=${sharedHidden?.balance}`,
);

// ── 6. client_hides is writable by the owner and RLS-scoped ─────────────
const { error: hideInsertError } = await asOwner
  .from("client_hides")
  .insert({ client_id: debe.id, owner_id: owner.id, action: "trashed" });
check("owner can write client_hides under RLS", !hideInsertError, hideInsertError?.message ?? "inserted");

const { error: badActionError } = await asOwner
  .from("client_hides")
  .insert({ client_id: debe.id, owner_id: owner.id, action: "eliminado" });
check("client_hides rejects an unknown action", Boolean(badActionError), badActionError?.message ?? "NO ERROR");

const { data: anonHides } = await anon.from("client_hides").select("id").limit(1);
check("anon key cannot read client_hides", (anonHides ?? []).length === 0, `${(anonHides ?? []).length} rows`);

// ── reset the fixture to a clean state ──────────────────────────────────
await admin
  .from("clients")
  .update({ trashed_at: null, deleted_at: null, trashed_balance: null, trashed_balance_usd: null, trashed_balance_eur: null })
  .eq("id", debe.id);
await admin.from("client_hides").delete().eq("client_id", debe.id);

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) process.exitCode = 1;
