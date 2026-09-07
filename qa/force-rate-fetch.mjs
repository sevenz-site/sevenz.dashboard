// DEV BRANCH ONLY (vzqppwrwnmlbrxizskdh). Runs the real fetchAndStoreBcvRate —
// the same function the Vercel cron calls — so a row lands with a real
// rate_date instead of waiting up to 24h for the schedule.
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  if (!line.includes("=") || line.startsWith("#")) continue;
  const i = line.indexOf("=");
  process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}

const DEV_REF = "vzqppwrwnmlbrxizskdh";
const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
if (ref !== DEV_REF) {
  console.error(`REFUSING TO RUN. .env.local points at "${ref}", not the dev branch (${DEV_REF}).`);
  process.exit(1);
}

const { fetchAndStoreBcvRate } = await import("../lib/exchange-rate/fetch-and-store.ts");
console.log(JSON.stringify(await fetchAndStoreBcvRate(), null, 1));
