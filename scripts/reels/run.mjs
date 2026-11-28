// Records and composes the Reels flows of flows.json, leaving the dev demo as it found it.
//
//   node scripts/reels/run.mjs                 every flow that is not `skip`
//   node scripts/reels/run.mjs <slug> [...]    only those (with the flows they come `after`)
//
// Needs the server with every send switched off: preview `dashboard-dev-no-sends`
// (scripts/reels/dev-no-sends.mjs). A chain is a flow plus the ones recorded `after` it
// without restoring in between (the abono needs the fiado's sale). Each chain: snapshot,
// record (one retry), restore, and the demo must come back identical or the run stops.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DASH = join(HERE, "..", "..");
const { flows } = JSON.parse(readFileSync(join(HERE, "flows.json"), "utf8"));
const bySlug = Object.fromEntries(flows.map((f) => [f.slug, f]));
const wanted = process.argv.slice(2);

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: DASH, encoding: "utf8" });
  return { ok: r.status === 0, out: (r.stdout ?? "") + (r.stderr ?? "") };
};
const killChrome = () => spawnSync("powershell", ["-NoProfile", "-Command",
  "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object CommandLine -match 'sevenz-reel-' | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"]);

// Chains, in flows.json order: a flow with `after` joins its predecessor's chain.
const chainOf = (f) => (f.after ? chainOf(bySlug[f.after]) : f.slug);
const chains = new Map();
for (const f of flows.filter((f) => !f.skip)) {
  const head = chainOf(f);
  if (!chains.has(head)) chains.set(head, []);
  chains.get(head).push(f);
}
const selected = [...chains.values()].filter((c) => !wanted.length || c.some((f) => wanted.includes(f.slug)));

const report = [];
for (const chain of selected) {
  const snap = `run-${chain[0].slug}`;
  const s = run("node", ["scripts/reels/demo-state.mjs", "snapshot", snap]);
  if (!s.ok) throw new Error(`snapshot failed:\n${s.out}`);
  for (const f of chain) {
    let rec;
    for (let attempt = 1; attempt <= 2; attempt++) {
      console.log(`● ${f.slug} (intento ${attempt})`);
      rec = run("node", ["scripts/reels/record.mjs", f.slug]);
      killChrome();
      if (rec.ok) break;
      console.log(rec.out.split("\n").filter((l) => /✖|Error/.test(l)).slice(0, 3).join("\n"));
      // A failed attempt may have saved half a flow: back to the snapshot before retrying,
      // and replay the chain's earlier flows so this one finds what it needs.
      run("node", ["scripts/reels/demo-state.mjs", "restore", snap]);
      for (const prev of chain.slice(0, chain.indexOf(f))) { run("node", ["scripts/reels/record.mjs", prev.slug]); killChrome(); }
    }
    if (!rec.ok) { report.push({ slug: f.slug, ok: false }); continue; }
    const c = run("python", ["-I", "scripts/reels/compose.py", f.slug, f.variant]);
    const parts = [...c.out.matchAll(/ok .*[\\/](\S+\.mp4) ([\d.]+)s/g)].map((m) => `${m[1]} (${m[2]} s)`);
    report.push({ slug: f.slug, ok: c.ok, variant: f.variant, parts });
    console.log(`  ${c.ok ? "✔" : "✖"} ${parts.join(", ")}`);
  }
  if (chain.some((f) => f.saves)) {
    const back = run("node", ["scripts/reels/demo-state.mjs", "restore", snap]);
    console.log(`  ${back.out.trim().split("\n").pop()}`);
    if (!back.ok) { console.log(back.out); throw new Error(`The demo did not come back after ${chain[0].slug}. Stopping.`); }
  }
}
console.log("\nRESUMEN");
for (const r of report) console.log(`${r.ok ? "✔" : "✖"} ${r.slug} [${r.variant ?? "-"}] ${r.parts?.join(", ") ?? ""}`);
