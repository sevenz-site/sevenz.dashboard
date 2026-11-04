// «Filtrar el historial»: a throwaway client of the demo business, with transactions
// inside and outside the last 7 days, removed at the end. Run from scripts/ayuda.
import { go, click, shot, sleep, js, call } from "../lib.mjs";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync("../../.env.local", "utf8")
    .split(/\r?\n/)
    .filter((x) => x.includes("=") && !x.startsWith("#"))
    .map((x) => {
      const i = x.indexOf("=");
      return [x.slice(0, i).trim(), x.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);
if (!env.NEXT_PUBLIC_SUPABASE_URL.includes("vzqppwrwnmlbrxizskdh")) throw new Error("no es dev");
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const M = JSON.parse(readFileSync(new URL("../demo-manifest.json", import.meta.url), "utf8"));
const { data: demo } = await admin.from("products").select("owner_id").eq("id", M.productos.harina).single();
const OWNER = demo.owner_id;
const S = "filtrar-el-historial";
const RAW = fileURLToPath(new URL("../raw-portadas", import.meta.url)).split(String.fromCharCode(92)).join("/");

const hace = (d) => new Date(Date.now() - d * 864e5).toISOString();
const fila = `[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='Estado').parentElement`;
const chipFecha = `js:${fila}.children[1]`;
const verFila = () => js(`(()=>{const e=${fila}; scrollTo({top:e.getBoundingClientRect().top+scrollY-320,behavior:'instant'}); return true})()`);
const enHoja = (t) => `js:[...document.querySelectorAll('[data-slot=sheet-content] button')].find(b=>b.innerText.trim()===${JSON.stringify(t)})`;

const { data: c } = await admin.from("clients").insert({ owner_id: OWNER, name: "Pedro Salas", document_id: "28100900" }).select("id").single();
try {
  const mov = (type, amount, d) => admin.from("movements").insert({ client_id: c.id, created_by: OWNER, type, amount, currency: "USD", source: "manual", created_at: hace(d) });
  await mov("charge", 12, 20);
  await mov("charge", 30, 5);
  await mov("payment", 10, 1);
  await admin.rpc("recalc_client_running_balance", { p_client_id: c.id });

  await go(`/clients/${c.id}`, 8000);
  await verFila();
  await sleep(500);
  await shot(S, 1, `js:${fila}`, { crop: 0, blur: false });
  await shot(S, 2, chipFecha, { crop: 0, blur: false });
  await click(chipFecha, { wait: 1100 });
  await shot(S, 3, enHoja("Últimos 7 días"), { crop: 0, blur: false });
  await click(enHoja("Últimos 7 días"), { wait: 1500 });
  await verFila();
  await sleep(500);
  await shot(S, 4, chipFecha, { crop: 0, blur: false });
  await js(`document.activeElement?.blur?.(); 1`);
  await sleep(500);
  await call({ op: "shot", file: `${RAW}/${S}.png`, target: null, crop: 0 });
  await click(chipFecha, { wait: 1100 });
  await js(`document.querySelector('[data-slot=sheet-content]').scrollTop=9999; 1`);
  await sleep(400);
  await shot(S, 5, enHoja("Quitar fecha"), { crop: 0, blur: false });
} finally {
  await admin.from("movements").delete().eq("client_id", c.id);
  await admin.from("clients").delete().eq("id", c.id);
  console.log("limpio");
}
