// «Registrar una devolución»: a fiado with an abono, so the left-over question
// shows. Works on a throwaway client of the demo business and removes it at the
// end, so the demo stays as it was. Run from scripts/ayuda.
import { go, click, shot, sleep, openMenu, pick, js, waitFor, call } from "../lib.mjs";
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
const S = "registrar-una-devolucion";
const DIALOG_BTN = (t) => `js:[...document.querySelectorAll('[data-slot=dialog-content] button')].find(b=>b.textContent.trim().startsWith(${JSON.stringify(t)}))`;

// THE SHELF IS PUT BACK BY HAND at the end: deleting the sale gives back what it
// took, and the unit returned would stay on top of that.
const { data: antes } = await admin.from("products").select("stock_opening").eq("id", M.productos.harina).single();
const RAW = fileURLToPath(new URL("../raw-portadas", import.meta.url)).split(String.fromCharCode(92)).join("/");

const { data: c } = await admin.from("clients").insert({ owner_id: OWNER, name: "Pedro Salas" }).select("id").single();
try {
  const { data: v } = await admin.from("sales").insert({ owner_id: OWNER, client_id: c.id, created_by: OWNER }).select("id").single();
  await admin.from("sale_lines").insert({ sale_id: v.id, product_id: M.productos.harina, name: "Harina de maíz 1 kg", quantity: 3, unit_price: 2, currency: "USD", tier: "retail" });
  const { data: f } = await admin.from("movements").insert({ client_id: c.id, created_by: OWNER, type: "charge", amount: 6, currency: "USD", sale_id: v.id, source: "manual" }).select("id").single();
  await admin.from("movements").insert({ client_id: c.id, created_by: OWNER, type: "payment", amount: 5, currency: "USD", applies_to_movement_id: f.id, source: "manual" });
  await admin.rpc("recalc_client_running_balance", { p_client_id: c.id });

  const MAS = `js:document.querySelector('button[aria-label="Más opciones de Harina de maíz 1 kg"]')`;
  await go(`/transacciones/${f.id}`, 6000);
  await shot(S, 1, MAS, { pad: 8 });
  await openMenu(MAS);
  await shot(S, 2, "js:document.querySelector('[role=menu]')", { blur: false });
  await pick("Registrar devolución");
  await sleep(1200);
  await shot(S, 3, "js:document.querySelector('[data-slot=dialog-content]')", { crop: 0, pad: 0, blur: false });
  await click(DIALOG_BTN("Dejar como saldo a favor"), { wait: 500 });
  await shot(S, 4, DIALOG_BTN("Dejar como saldo a favor"), { blur: false });
  await click(DIALOG_BTN("Registrar devolución"), { wait: 1000 });
  await waitFor("location.search.includes('registrada=1')", 40000);
  await sleep(2500);
  await shot(S, 5, null, { crop: 0 });
  await call({ op: "shot", file: `${RAW}/${S}.png`, target: null, crop: 0 });
  await go(`/transacciones/${f.id}`, 6000);
  await shot(S, 6, "js:[...document.querySelectorAll('span')].find(e=>e.textContent.trim()==='Devueltos: 1')", { pad: 8 });
  await go(`/clients/${c.id}`, 7000);
  await js("[...document.querySelectorAll('main li')].find(l=>l.innerText.includes('Devolución'))?.scrollIntoView({block:'center',behavior:'instant'})");
  await shot(S, 7, "js:[...document.querySelectorAll('main li')].find(l=>l.innerText.includes('Devolución'))", { pad: 8 });
} finally {
  await admin.from("sale_returns").delete().eq("client_id", c.id);
  await admin.from("movements").update({ applies_to_movement_id: null }).eq("client_id", c.id);
  await admin.from("movements").delete().eq("client_id", c.id);
  await admin.from("sales").delete().eq("client_id", c.id);
  await admin.from("clients").delete().eq("id", c.id);
  await admin.from("products").update({ stock_opening: antes.stock_opening }).eq("id", M.productos.harina);
}
