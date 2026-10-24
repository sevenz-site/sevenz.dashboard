// EL CATÁLOGO SIGUE ACEPTANDO PEDIDOS, Y AHORA GUARDA LA DIRECCIÓN.
// RAMA DEV ÚNICAMENTE (vzqppwrwnmlbrxizskdh) — lee .env.local y se niega a
// correr en cualquier otro sitio.
//
// ===========================================================================
// WHY THIS SUITE EXISTS, AND WHY IT LOOKS AT THE OUTSIDE WORLD
//
// Migration `157` did something no other migration in this repo had done:
// it RENAMED the function the public catalogue calls on every order
// (`create_catalog_order` -> `_core`) and put another one in front of it. Four
// hundred lines of padlocks moved in one go -- the per-minute rate limit,
// «this product belongs to this owner», «the price is computed here and never
// travels in the request» -- to add one argument.
//
// IF THAT BROKE, THE FAILURE WOULD BE MUTE from the shopkeeper's side: the
// customer sending the order sees an error, the order never arrives, and the
// shopkeeper does not find out until somebody asks why they got no reply. It
// is the WhatsApp template failure of 2026-10-15 again, through another door.
//
// ───────────────────────────────────────────────────────────────────────
// THE ROW THAT MATTERS MOST IS 1: THE EIGHT-ARGUMENT CALL
//
// The wrapper takes NINE parameters and the ninth carries `default null`, on
// purpose: a browser still holding the previous bundle keeps calling with
// eight for hours after a deploy. That PostgREST resolves such a call against
// the nine-argument function is an assumption until somebody measures it --
// and on 2026-10-24 migration `157` reached production by mistake with that
// assumption unchecked. This row is the measurement.
//
// AND IT USES THE `anon` CLIENT, not the service key: that is the role the
// public page calls with. With the service key this would pass even with the
// grants wrong, which is exactly the half this suite watches.
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

// HARD STOP. This suite CREATES real orders and deletes them. Against
// production it would be adding and removing rows from a real shop's account.
if (!env.NEXT_PUBLIC_SUPABASE_URL.includes("vzqppwrwnmlbrxizskdh")) {
  console.error("PARADA: .env.local no apunta a la rama dev. Esta suite escribe.");
  process.exit(1);
}

const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

let fallos = 0;
const check = (nombre, ok, detalle) => {
  if (!ok) fallos++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${nombre}${detalle ? "  — " + detalle : ""}`);
};

// THE LINK AND THE PRODUCT ARE LOOKED UP, NOT HARD-CODED. A fixed id stops
// existing the day somebody cleans dev, and then the suite fails for a reason
// that has nothing to do with what it watches.
const { data: enlaces } = await svc.from("catalog_share_links").select("token, owner_id");
let link = null;
let producto = null;
for (const e of enlaces ?? []) {
  const { data: p } = await svc
    .from("products")
    .select("id, name, base_currency_retail, price_retail")
    .eq("owner_id", e.owner_id)
    .is("trashed_at", null)
    .eq("published_retail", true)
    .not("price_retail", "is", null)
    .limit(1)
    .maybeSingle();
  if (p) {
    link = e;
    producto = p;
    break;
  }
}
if (!link || !producto) {
  console.error("Sin un enlace de catálogo con al menos un producto publicado al detal en dev.");
  process.exit(1);
}

const base = {
  p_token: link.token,
  p_customer_name: "QA direccion",
  p_customer_document: "157157157",
  p_customer_document_type: "V",
  p_customer_whatsapp: "584140000157",
  p_wants_notices: false,
  p_consent_text: "prueba de la suite qa:pedido-direccion",
  p_items: [
    {
      product_id: producto.id,
      quantity: 1,
      currency: producto.base_currency_retail ?? "USD",
      comment: null,
    },
  ],
};

const creados = [];

const { data: r8, error: e8 } = await anon.rpc("create_catalog_order", base);
check(
  "1. la llamada de OCHO argumentos resuelve (la que hace un paquete viejo)",
  !e8 && r8?.ok === true,
  e8?.message ?? JSON.stringify(r8),
);
if (r8?.order_id) creados.push(r8.order_id);

const { data: r9, error: e9 } = await anon.rpc("create_catalog_order", {
  ...base,
  p_customer_address: "Calle 56 #1200-56",
});
check(
  "2. la llamada de NUEVE argumentos resuelve",
  !e9 && r9?.ok === true,
  e9?.message ?? JSON.stringify(r9),
);
if (r9?.order_id) creados.push(r9.order_id);

if (r9?.order_id) {
  const { data: o } = await svc
    .from("catalog_orders")
    .select("customer_address, sale_id, registered_at, customer_document_type")
    .eq("id", r9.order_id)
    .single();
  check(
    "3. la dirección queda guardada tal cual se escribió",
    o?.customer_address === "Calle 56 #1200-56",
    JSON.stringify(o?.customer_address),
  );
  // AN ORDER IS BORN UNREGISTERED. These two are what stop it being registered
  // twice with the debt duplicated: the screen reads them to know.
  check("4. sale_id y registered_at nacen vacíos", o?.sale_id === null && o?.registered_at === null);
  check(
    "5. la letra del documento sigue entrando (la 155 intacta)",
    o?.customer_document_type === "V",
    JSON.stringify(o?.customer_document_type),
  );

  const { data: lineas } = await svc
    .from("catalog_order_items")
    .select("product_name, quantity, unit_price, currency, tier")
    .eq("order_id", r9.order_id);
  check(
    "6. las líneas se guardan: los candados del núcleo siguen enteros",
    (lineas ?? []).length === 1 && Number(lineas[0].unit_price) > 0,
    JSON.stringify(lineas),
  );
}

if (r8?.order_id) {
  const { data: o } = await svc
    .from("catalog_orders")
    .select("customer_address")
    .eq("id", r8.order_id)
    .single();
  // NULL AND NOT AN EMPTY STRING: an address nobody gave and one left blank
  // have to look the same on screen, and `null` is what the rest of the repo
  // reads as «there is none».
  check(
    "7. sin dirección queda null, no cadena vacía",
    o?.customer_address === null,
    JSON.stringify(o?.customer_address),
  );
}

const { data: rToken, error: eT } = await anon.rpc("create_catalog_order", {
  ...base,
  p_token: "__token_que_no_existe__",
});
check(
  "8. un enlace inválido se sigue rechazando",
  !eT && rToken?.ok === false,
  eT?.message ?? JSON.stringify(rToken),
);

// THE PADLOCK THAT MATTERS MOST OF THE ONES THAT MOVED: a product id from
// another shop pasted into the request does not get in. Without it, anybody
// with a link could put another shop's catalogue inside an order.
const { data: otros } = await svc
  .from("products")
  .select("id")
  .neq("owner_id", link.owner_id)
  .is("trashed_at", null)
  .limit(1)
  .maybeSingle();
if (otros) {
  const { data: rAjeno, error: eA } = await anon.rpc("create_catalog_order", {
    ...base,
    p_items: [{ product_id: otros.id, quantity: 1, currency: "USD", comment: null }],
  });
  check(
    "9. un producto de OTRO dueño se sigue rechazando",
    !eA && rAjeno?.ok === false,
    eA?.message ?? JSON.stringify(rAjeno),
  );
  if (rAjeno?.order_id) creados.push(rAjeno.order_id);
} else {
  console.log("SKIP  9. no hay productos de otro dueño en dev con los que probar el candado");
}

// THE CORE IS NOT REACHABLE FROM OUTSIDE. It is the other half of the rename:
// if `anon` could call it, it would save orders with no address and nothing
// would complain, and `157` would have been for nothing.
const { error: eCore } = await anon.rpc("create_catalog_order_core", base);
check("10. anon NO alcanza el núcleo", Boolean(eCore), eCore ? eCore.message.slice(0, 60) : "LO ALCANZÓ");

for (const id of creados) await svc.from("catalog_orders").delete().eq("id", id);
console.log(`\n${creados.length} pedidos de prueba borrados de dev`);
console.log(fallos === 0 ? "TODO PASA" : `${fallos} FALLOS`);
process.exit(fallos ? 1 : 0);
