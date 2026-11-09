// SOLO LA RAMA DEV (vzqppwrwnmlbrxizskdh) — lee .env.local. No escribe nada.
//
// THE PRICE A SHARED PRODUCT LINK CARRIES, ON EVERY FACE THAT WRITES IT.
//
// Since 2026-11-09 the text sent with a product link carries its price (the
// owner's request that day). Three places compute that price line:
//
//   1. the link preview, from `get_shared_product` (the source of truth);
//   2. the owner's screens, which rebuild the same blocks from the product
//      row, its pinned prices and its enabled currencies
//      (`ownerPreviewPriceInput`) — a second writer of a rule SQL owns;
//   3. the customer's catalogue grid, from `get_shared_catalog`, which carries
//      one tier and no wholesale minimum.
//
// So this compares them product by product. 1 and 2 must be IDENTICAL. 3 may
// only differ by the «(desde N)» it cannot know. Rates come from the RPC for
// every side, so what is compared is the block rebuilding, not two rate
// lookups that could disagree for reasons of their own.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  ownerPreviewPriceInput,
  previewPriceLine,
  productShareMessage,
} from "../lib/products/preview-price.ts";
import { currenciesOf, overridesByTier } from "../lib/products/catalog.ts";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);
if (!env.NEXT_PUBLIC_SUPABASE_URL?.includes("vzqppwrwnmlbrxizskdh")) {
  console.error("Este guion solo corre contra la rama dev (vzqppwrwnmlbrxizskdh).");
  process.exit(1);
}
const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
// The two RPCs are granted to anon/authenticated, as the public page calls them.
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

let fallos = 0;
let pasan = 0;
function check(nombre, ok, detalle = "") {
  if (ok) pasan++;
  else fallos++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${nombre}${detalle ? `  — ${detalle}` : ""}`);
}

// ── 1. The message itself ─────────────────────────────────────────────────
check(
  "con precio: nombre · precio, y el enlace en su línea",
  productShareMessage("Harina", "🇺🇸 $6,00  🇪🇺 €6,00", "https://x/c/t/p") ===
    "Harina · 🇺🇸 $6,00  🇪🇺 €6,00\nhttps://x/c/t/p",
);
check(
  "sin precio: nombre y enlace, sin «·» colgando",
  productShareMessage("Harina", null, "https://x/c/t/p") === "Harina\nhttps://x/c/t/p",
);

// ── 2. Every published product of every business with a catalogue link ────
const ratesFrom = (d) =>
  d.owner_country === "VE" && d.current_bcv_usd != null && d.current_bcv_eur != null
    ? d.rate_mode === "CUSTOM" && d.custom_rate_usd && d.custom_rate_eur
      ? { usd: Number(d.custom_rate_usd), eur: Number(d.custom_rate_eur) }
      : { usd: Number(d.current_bcv_usd), eur: Number(d.current_bcv_eur) }
    : null;

const { data: enlaces, error: e0 } = await svc.from("catalog_share_links").select("owner_id, token");
if (e0) throw e0;

let comparados = 0;
let conPrecio = 0;
let dosMonedas = 0;
const distintosPropios = [];
const distintosRejilla = [];

for (const { owner_id, token } of enlaces ?? []) {
  const { data: productos, error: e1 } = await svc
    .from("products")
    .select(
      "id, name, base_currency, base_currency_retail, base_currency_wholesale, price_retail, price_wholesale, published_retail, published_wholesale, wholesale_min_quantity",
    )
    .eq("owner_id", owner_id)
    .is("trashed_at", null)
    .or("published_retail.eq.true,published_wholesale.eq.true");
  if (e1) throw e1;
  if (!productos?.length) continue;
  const ids = productos.map((p) => p.id);
  const [{ data: overrides }, { data: monedas }, { data: catalogo }] = await Promise.all([
    svc.from("product_price_overrides").select("product_id, tier, currency, amount").in("product_id", ids),
    svc.from("product_currencies").select("product_id, tier, currency").in("product_id", ids),
    anon.rpc("get_shared_catalog", { p_token: token }),
  ]);
  const rejilla = new Map((catalogo?.products ?? []).map((p) => [p.id, p]));

  for (const p of productos) {
    const { data: d, error: e2 } = await anon.rpc("get_shared_product", {
      p_token: token,
      p_product_id: p.id,
    });
    if (e2) throw e2;
    if (!d) continue;
    const rates = ratesFrom(d);

    const publica = previewPriceLine({
      retail: d.retail ?? null,
      wholesale: d.wholesale ?? null,
      wholesale_min_quantity: d.wholesale_min_quantity ?? null,
      base_currency: d.base_currency ?? "USD",
      rates,
    });
    const delDueno = previewPriceLine(
      ownerPreviewPriceInput(
        p,
        overridesByTier(overrides ?? [], p.id),
        {
          retail: currenciesOf(monedas ?? [], p.id, "retail", p.base_currency_retail),
          wholesale: currenciesOf(monedas ?? [], p.id, "wholesale", p.base_currency_wholesale),
        },
        rates,
      ),
    );
    comparados++;
    if (publica) conPrecio++;
    if (publica && publica.includes("🇺🇸") && publica.includes("🇪🇺")) dosMonedas++;
    if (publica !== delDueno) distintosPropios.push(`${p.name}: vista previa «${publica}» · dueño «${delDueno}»`);

    const c = rejilla.get(p.id);
    if (c) {
      const bloque = { price: c.price, pinned: c.pinned, base_currency: c.base_currency, currencies: c.currencies };
      const deRejilla = previewPriceLine({
        retail: c.tier === "retail" ? bloque : null,
        wholesale: c.tier === "wholesale" ? bloque : null,
        wholesale_min_quantity: null,
        base_currency: c.base_currency,
        rates: ratesFrom(catalogo),
      });
      const sinDesde = (s) => (s ?? "").replace(/ \(desde \d+\)$/, "");
      if (sinDesde(publica) !== sinDesde(deRejilla))
        distintosRejilla.push(`${p.name}: vista previa «${publica}» · catálogo «${deRejilla}»`);
    }
  }
}

check("hay productos publicados que comparar", comparados > 0, `${comparados} productos, ${conPrecio} con precio, ${dosMonedas} en dólares y euros`);
check(
  "la ficha y el catálogo del dueño dicen el MISMO precio que la vista previa",
  distintosPropios.length === 0,
  distintosPropios.slice(0, 5).join(" | "),
);
check(
  "el catálogo del cliente dice lo mismo, salvo el «(desde N)» que no conoce",
  distintosRejilla.length === 0,
  distintosRejilla.slice(0, 5).join(" | "),
);

console.log(`\n${pasan}/${pasan + fallos} pasan.`);
process.exit(fallos ? 1 : 0);
