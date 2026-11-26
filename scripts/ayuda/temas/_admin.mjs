// The service-role client for the help scripts that must switch something on in the demo
// business and put it back (DEV only: refuses any other project).
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const ROOT = new URL("../../../../", import.meta.url);
const { createClient } = createRequire(new URL("dashboard/package.json", ROOT))("@supabase/supabase-js");
const env = Object.fromEntries(
  readFileSync(new URL("dashboard/.env.local", ROOT), "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")]; }),
);
if (!env.NEXT_PUBLIC_SUPABASE_URL.includes("vzqppwrwnmlbrxizskdh")) throw new Error("not dev");
export const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

