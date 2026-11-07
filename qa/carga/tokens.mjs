// The share-link tokens of the QA owners' clients in DEV, for qa/carga/publico.js. Only
// accounts whose email starts with `qa-`: never a real client's link. Refuses any other
// database.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
if (!env.NEXT_PUBLIC_SUPABASE_URL?.includes("vzqppwrwnmlbrxizskdh")) throw new Error("solo contra la rama dev");
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: owners } = await admin.from("owners").select("id").like("email", "qa-%@example.com");
const { data: clients } = await admin.from("clients").select("id").in("owner_id", (owners ?? []).map((o) => o.id)).is("deleted_at", null);
const { data: links, error } = await admin.from("share_links").select("token").in("client_id", (clients ?? []).map((c) => c.id));
if (error) throw new Error(error.message);
const tokens = (links ?? []).map((l) => l.token).filter(Boolean);
mkdirSync("scripts/ayuda/raw", { recursive: true });
writeFileSync("scripts/ayuda/raw/carga-tokens.json", JSON.stringify(tokens));
console.log(`${tokens.length} enlaces de clientes de QA en scripts/ayuda/raw/carga-tokens.json`);
if (!tokens.length) process.exit(1);
