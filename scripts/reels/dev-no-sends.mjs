// `next dev` with every outbound channel switched off, for recording flows that save.
//
// Owner's decision of 2026-11-27: the Reels flows write to the DEV demo business, and dev
// has the Kapso key set, so a recorded fiado or abono could send a real WhatsApp to a demo
// client's number. Blank keys win over `.env.local` (@next/env never overrides a variable
// that is already set, even to ""), and both senders fail closed without one:
// lib/whatsapp/kapso.ts throws inside its try, lib/email/resend.ts returns ok:false.
// GEMINI stays on: «Subir tu libreta» needs the AI read.
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// `--dir <path>` serves another checkout, e.g. a clean worktree of origin/dev: on 2026-11-27
// another session was rewriting the order screens in this folder, uncommitted, and a
// recording here would have shown (and broken on) its work in progress.
const dirAt = process.argv.indexOf("--dir");
const DASH = dirAt > 0 ? process.argv[dirAt + 1] : join(dirname(fileURLToPath(import.meta.url)), "..", "..");
if (dirAt > 0) process.argv.splice(dirAt, 2);
// Mixpanel too: a recorded sale is not a sale, and the server-side events would count it.
const env = { ...process.env, KAPSO_API_KEY: "", RESEND_API_KEY: "", SECOND_FACTOR_WHATSAPP: "", NEXT_PUBLIC_MIXPANEL_TOKEN: "" };
const child = spawn(process.execPath, [join(DASH, "node_modules", "next", "dist", "bin", "next"), "dev", ...process.argv.slice(2)], {
  cwd: DASH,
  env,
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 0));
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => child.kill(s));
