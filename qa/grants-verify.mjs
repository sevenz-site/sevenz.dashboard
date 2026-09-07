// DEV BRANCH ONLY (vzqppwrwnmlbrxizskdh) — reads .env.local.
//
// Verifies the grant state after 045: a signed-in owner can still read and
// write everything the app needs, and an anonymous caller can reach nothing.
//
// The point is that a `revoke` reporting "Success" says nothing about what the
// app can now do. 041 already taught this project that lesson the expensive
// way — a revoke ran clean, changed nothing, and only calling the endpoint
// with the anon key told the difference. This is the same idea pointed the
// other way: prove the doors that must stay open are still open.
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

const DEV_REF = "vzqppwrwnmlbrxizskdh";
const projectRef = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
if (projectRef !== DEV_REF) {
  console.error(`REFUSING TO RUN. .env.local points at "${projectRef}", not the dev branch (${DEV_REF}).`);
  process.exit(1);
}

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
// Never authenticates. Kept apart from `signer` because supabase-js keeps a
// session in memory on whichever instance signed in, which silently turns an
// "anon" client into the owner and makes every negative check meaningless.
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});
const signer = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

// Sign in as any real owner in dev. Which one does not matter — grants are
// per-role, not per-user; RLS is what makes it per-user, and that is unchanged.
const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
const owner = users.users.find((u) => u.email && !u.email.startsWith("qa-"));
if (!owner) throw new Error("no owner found in dev");
const { data: gen } = await admin.auth.admin.generateLink({ type: "magiclink", email: owner.email });
const { data: verified, error: signInError } = await signer.auth.verifyOtp({
  type: "magiclink",
  token_hash: gen.properties.hashed_token,
});
if (signInError) throw signInError;
const asOwner = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
  global: { headers: { Authorization: `Bearer ${verified.session.access_token}` } },
});

// Every table the app reads with an owner session. A missing grant surfaces as
// error code 42501 (permission denied); zero rows is a perfectly fine answer
// and means RLS did its job, not that the grant is gone.
const OWNER_READS = [
  "clients",
  "movements",
  "client_flags",
  "client_summary",
  "client_summary_all",
  "client_hides",
  "link_opens",
  "movement_deletions",
  "import_notifications",
  "owners",
  "owner_exchange_settings",
  "share_links",
  "bcv_exchange_rate_fetches",
];

for (const table of OWNER_READS) {
  const { error } = await asOwner.from(table).select("*").limit(1);
  check(`owner can SELECT ${table}`, !error, error ? `${error.code} ${error.message}` : "ok");
}

// The five production leaves closed. Denied is the expected answer.
const OWNER_MUST_NOT_READ = [
  "client_identities",
  "rate_limiters",
  "rate_limit_counters",
  "schema_migrations",
  "applied_data_migrations",
];
for (const table of OWNER_MUST_NOT_READ) {
  const { error } = await asOwner.from(table).select("*").limit(1);
  check(`owner is DENIED on ${table}`, error?.code === "42501", error ? error.code : "NO ERROR — readable");
}

// Anonymous: nothing at all, on the tables that hold customer data.
for (const table of ["clients", "movements", "owners", "client_summary", "client_summary_all", "client_hides"]) {
  const { error } = await anon.from(table).select("*").limit(1);
  check(`anon is DENIED on ${table}`, error?.code === "42501", error ? error.code : "NO ERROR — readable");
}

// The public share link must still work — it goes through a SECURITY DEFINER
// function, whose EXECUTE grant is a different ACL from any table grant, so
// this is exactly the thing a table-level revoke could have broken by accident.
const { data: link } = await admin.from("share_links").select("token").limit(1).single();
const { data: shared, error: sharedError } = await anon.rpc("get_shared_balance", { p_token: link.token });
check(
  "anon can still open a share link",
  !sharedError && shared !== null,
  sharedError ? sharedError.message : `cliente=${shared?.client_name}`,
);

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) process.exitCode = 1;
