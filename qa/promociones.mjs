// qa:promociones -- catalogue promotions (CT-184, part 1, migration 228).
//
//   1. THE PRICE RULE, on the pure functions: the frames' figures (3,80 at 40% = 2,28;
//      7,50 at 20% = 6,00), bolívares with four decimals, and the owner's validations.
//   2. AS THE OWNER, with his own session (CLAUDE.md: a suite on tables the owner writes needs
//      one check that runs as him): `save_promotion` writes a promotion with two groups.
//   3. ONE AT A TIME: a second promotion that crosses it is refused by the database.
//   4. WHAT THE CUSTOMER RECEIVES, anonymously: `get_shared_promotion` with each product's %.
//   5. A REAL ORDER through `create_catalog_order`: the stored price is the discounted one,
//      to the cent of what the cart computes, with the list price and the % kept; an
//      excluded product stays at list price.
//   6. THE WHOLESALE PRICE (migration 230, owner's decision of 2026-11-28): it is discounted
//      too, with the group's own wholesale % when it has one and the retail % otherwise; an
//      order that reaches the wholesale minimum stores the discounted wholesale price.
//
// Writes only in dev, on the QA owner, and removes what it created.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { applyPromotion } from "../lib/promotions/pricing.ts";
import { checkPromotion, crosses, groupLine, lastDay, promotionStatus } from "../lib/promotions/rules.ts";

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
if (new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0] !== DEV_REF) {
  console.error(`ME NIEGO A CORRER. .env.local no apunta a la rama dev (${DEV_REF}).`);
  process.exit(1);
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = () => createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
async function comoDueno(email) {
  const { data: link, error: eL } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (eL) throw new Error(`generateLink: ${eL.message}`);
  const { data: s, error: eV } = await anon().auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  if (eV) throw new Error(`verifyOtp: ${eV.message}`);
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${s.session.access_token}` } },
  });
}

const filas = [];
function check(nombre, pasa, detalle) {
  filas.push({ nombre, pasa });
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${detalle ? `  — ${detalle}` : ""}`);
}

const creadas = [];
const pedidos = [];
try {
  // ── 1. Pure rules ─────────────────────────────────────────────────────
  check("1a. $3,80 al 40% = $2,28 y €7,50 al 20% = €6,00 (los frames)", applyPromotion(3.8, 40, "USD") === 2.28 && applyPromotion(7.5, 20, "EUR") === 6);
  check("1b. bolívares con 4 decimales: Bs. 1.234,5678 al 15% = 1.049,3826", applyPromotion(1234.5678, 15, "VES") === 1049.3826, String(applyPromotion(1234.5678, 15, "VES")));
  check("1c. sin % el precio no cambia", applyPromotion(3.8, null, "USD") === 3.8);
  const base = { name: "X", bannerPath: null, startsOn: "2026-12-01", endsOn: "2026-12-03", extendedUntil: null, groups: [{ percent: 20, wholesalePercent: null, allProducts: true, productIds: [] }] };
  check("1d. una promoción bien formada pasa", checkPromotion(base).ok);
  check("1e. cierre antes del inicio, % de 95 y dos «Todos» se rechazan",
    !checkPromotion({ ...base, endsOn: "2026-11-30" }).ok &&
      !checkPromotion({ ...base, groups: [{ percent: 95, allProducts: true, productIds: [] }] }).ok &&
      !checkPromotion({ ...base, groups: [{ percent: 10, allProducts: true, productIds: [] }, { percent: 20, allProducts: true, productIds: [] }] }).ok);
  check("1f. un producto en dos grupos se rechaza", !checkPromotion({ ...base, groups: [{ percent: 10, allProducts: false, productIds: ["a"] }, { percent: 20, allProducts: false, productIds: ["a"] }] }).ok);
  check("1i. % al mayor: vacío y 0 valen, 95 se rechaza",
    checkPromotion({ ...base, groups: [{ percent: 20, wholesalePercent: 0, allProducts: true, productIds: [] }] }).ok &&
      checkPromotion({ ...base, groups: [{ percent: 20, wholesalePercent: 30, allProducts: true, productIds: [] }] }).ok &&
      !checkPromotion({ ...base, groups: [{ percent: 20, wholesalePercent: 95, allProducts: true, productIds: [] }] }).ok);
  check("1j. el resumen dice los dos % como el frame 8",
    groupLine({ percent: 20, wholesalePercent: null, allProducts: true, productIds: ["a", "b", "c"] }, 125) === "20% al detal y al mayor: 125 productos (3 excluidos)" &&
      groupLine({ percent: 40, wholesalePercent: 30, allProducts: false, productIds: [] }, 12) === "40% al detal y 30% al mayor: 12 productos",
    groupLine({ percent: 40, wholesalePercent: 30, allProducts: false, productIds: [] }, 12));
  check("1g. estados: programada, activa, extendida, terminada",
    promotionStatus({ startsOn: "2026-12-01", endsOn: "2026-12-03", extendedUntil: "2026-12-05", endedOn: null }, "2026-11-30") === "scheduled" &&
      promotionStatus({ startsOn: "2026-12-01", endsOn: "2026-12-03", extendedUntil: "2026-12-05", endedOn: null }, "2026-12-02") === "active" &&
      promotionStatus({ startsOn: "2026-12-01", endsOn: "2026-12-03", extendedUntil: "2026-12-05", endedOn: null }, "2026-12-04") === "extended" &&
      promotionStatus({ startsOn: "2026-12-01", endsOn: "2026-12-03", extendedUntil: "2026-12-05", endedOn: "2026-12-02" }, "2026-12-02") === "ended");
  check("1h. se cruzan si se tocan un día; no si «Terminar ahora» la cortó antes",
    crosses({ startsOn: "2026-12-01", last: "2026-12-03" }, { startsOn: "2026-12-03", last: "2026-12-09" }) &&
      !crosses({ startsOn: "2026-12-01", last: lastDay({ endsOn: "2026-12-03", extendedUntil: null, endedOn: "2026-12-02" }) }, { startsOn: "2026-12-02", last: "2026-12-09" }));

  // ── 2-5. Against dev ──────────────────────────────────────────────────
  if (!env.QA_OWNER_EMAIL) throw new Error("falta QA_OWNER_EMAIL en .env.local");
  const { data: dueno } = await admin.from("owners").select("id, country").eq("email", env.QA_OWNER_EMAIL).single();
  const { data: ledger } = await admin.from("schema_migrations").select("key").eq("key", "228_catalog_promotions");
  check("2a. la 228 está en el registro de migraciones de dev", (ledger ?? []).length === 1);
  const { data: ledger230 } = await admin.from("schema_migrations").select("key").eq("key", "230_promotion_wholesale_percent");
  check("2a2. la 230 está en el registro de migraciones de dev", (ledger230 ?? []).length === 1);
  const { data: previas } = await admin.from("promotions").select("id").eq("owner_id", dueno.id);
  if ((previas ?? []).length) throw new Error("el dueño de QA ya tiene promociones: bórralas antes de correr la suite");
  const { data: enlace } = await admin.from("catalog_share_links").select("token").eq("owner_id", dueno.id).single();
  // W: a product with BOTH prices published, for the wholesale checks of section 6.
  const { data: W } = await admin
    .from("products")
    .select("id, name, price_wholesale, base_currency_wholesale, wholesale_min_quantity")
    .eq("owner_id", dueno.id)
    .is("trashed_at", null)
    .eq("published_retail", true)
    .eq("published_wholesale", true)
    .not("price_wholesale", "is", null)
    .not("wholesale_min_quantity", "is", null)
    .order("name")
    .limit(1)
    .single();
  if (!W) throw new Error("el dueño de QA necesita un producto publicado al detal y al mayor");
  const { data: prods } = await admin
    .from("products")
    .select("id, name, price_retail, base_currency_retail, published_retail, wholesale_min_quantity")
    .eq("owner_id", dueno.id)
    .is("trashed_at", null)
    .eq("published_retail", true)
    .not("price_retail", "is", null)
    .neq("id", W.id)
    .order("name")
    .limit(3);
  if (!prods || prods.length < 3) throw new Error("el dueño de QA necesita 3 productos publicados al detal");
  const [A, B, C] = prods;
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: dueno.country === "VE" ? "America/Caracas" : "America/Bogota" }).format(new Date());

  const yo = await comoDueno(env.QA_OWNER_EMAIL);
  const grupos = [
    { percent: 40, wholesale_percent: 30, all_products: false, include: [A.id, W.id], exclude: [] },
    { percent: 20, wholesale_percent: null, all_products: true, include: [], exclude: [B.id] },
  ];
  const { data: pid, error: e2 } = await yo.rpc("save_promotion", {
    p_id: null, p_name: "ZZ QA Black Friday", p_banner_path: null, p_starts_on: hoy, p_ends_on: hoy,
    p_extended_until: null, p_includes_wholesale: true, p_code: null, p_code_percent: null, p_code_max_uses: null, p_groups: grupos,
  });
  if (pid) creadas.push(pid);
  check("2b. el dueño guarda una promoción de dos grupos con su sesión", !e2 && Boolean(pid), e2?.message);
  const { data: grs } = await yo.from("promotion_groups").select("percent, all_products").eq("promotion_id", pid);
  check("2c. el dueño lee sus grupos (RLS y permisos)", (grs ?? []).length === 2, JSON.stringify(grs));

  const { data: pid2, error: e3 } = await yo.rpc("save_promotion", {
    p_id: null, p_name: "ZZ QA cruzada", p_banner_path: null, p_starts_on: hoy, p_ends_on: hoy,
    p_extended_until: null, p_includes_wholesale: true, p_code: null, p_code_percent: null, p_code_max_uses: null,
    p_groups: [{ percent: 10, all_products: true, include: [], exclude: [] }],
  });
  if (pid2) creadas.push(pid2);
  check("3a. una segunda promoción el mismo día se rechaza", Boolean(e3) && /promocion_cruzada/.test(e3.message), e3?.message ?? "SE GUARDÓ");

  const { data: otro } = await admin.from("owners").select("id").neq("id", dueno.id).limit(1).single();
  const { data: ajeno } = await admin.from("products").select("id").eq("owner_id", otro.id).limit(1).maybeSingle();
  if (ajeno) {
    const { error: e3b } = await yo.rpc("save_promotion", {
      p_id: pid, p_name: "ZZ QA Black Friday", p_banner_path: null, p_starts_on: hoy, p_ends_on: hoy,
      p_extended_until: null, p_includes_wholesale: true, p_code: null, p_code_percent: null, p_code_max_uses: null,
      p_groups: [{ percent: 40, all_products: false, include: [ajeno.id], exclude: [] }],
    });
    check("3b. un producto de otro negocio en un grupo se rechaza", Boolean(e3b) && /producto_ajeno/.test(e3b.message), e3b?.message ?? "SE GUARDÓ");
    // Put the good groups back (3b's call rolled back, but be explicit).
  }

  const { data: compartida, error: e4 } = await anon().rpc("get_shared_promotion", { p_token: enlace.token });
  check("4a. el cliente recibe la promoción activa sin sesión", !e4 && compartida?.name === "ZZ QA Black Friday", e4?.message);
  check("4b. A al 40%, B excluido, C al 20% de «Todos»",
    compartida?.percents?.[A.id] === 40 && compartida?.percents?.[B.id] === undefined && compartida?.percents?.[C.id] === 20,
    JSON.stringify({ A: compartida?.percents?.[A.id], B: compartida?.percents?.[B.id], C: compartida?.percents?.[C.id] }));
  check("4d. al mayor: W lleva su 30% propio y C el 20% del detal",
    compartida?.wholesale_percents?.[W.id] === 30 && compartida?.percents?.[W.id] === 40 && compartida?.wholesale_percents?.[C.id] === 20 && compartida?.wholesale_percents?.[B.id] === undefined,
    JSON.stringify({ W: compartida?.wholesale_percents?.[W.id], C: compartida?.wholesale_percents?.[C.id] }));
  check("4c. no viaja nada del código (fuera de este lanzamiento)", compartida && !("code" in compartida) && compartida.has_code === false);

  const items = [A, B, C].map((p) => ({ product_id: p.id, quantity: 1, currency: p.base_currency_retail, comment: null }));
  // W at its wholesale minimum: the line goes at the wholesale tier.
  items.push({ product_id: W.id, quantity: Number(W.wholesale_min_quantity), currency: W.base_currency_wholesale, comment: null });
  const { data: r5, error: e5 } = await anon().rpc("create_catalog_order", {
    p_token: enlace.token, p_customer_name: "ZZ QA Promo", p_customer_document: "12345678", p_customer_document_type: null,
    p_customer_whatsapp: "+584145550199", p_wants_notices: false, p_consent_text: null, p_customer_address: null, p_items: items,
  });
  if (r5?.order_id) pedidos.push(r5.order_id);
  check("5a. el pedido del cliente se crea", !e5 && r5?.ok === true, e5?.message ?? JSON.stringify(r5));
  const { data: lineas } = await admin.from("catalog_order_items").select("product_id, unit_price, list_price, promo_percent, promotion_id, currency, tier").eq("order_id", r5?.order_id);
  const L = (id) => (lineas ?? []).find((l) => l.product_id === id);
  const esperado = (p, pct) => applyPromotion(Number(p.price_retail), pct, p.base_currency_retail);
  check("5b. A se guarda al 40%, al céntimo de lo que dice el carrito",
    Number(L(A.id)?.unit_price) === esperado(A, 40) && Number(L(A.id)?.list_price) === Number(A.price_retail) && Number(L(A.id)?.promo_percent) === 40 && L(A.id)?.promotion_id === pid,
    `${L(A.id)?.unit_price} vs ${esperado(A, 40)}`);
  check("5c. B (excluido) se guarda a su precio, sin promoción",
    Number(L(B.id)?.unit_price) === Number(B.price_retail) && L(B.id)?.promo_percent == null && L(B.id)?.list_price == null);
  check("5d. C se guarda al 20%", Number(L(C.id)?.unit_price) === esperado(C, 20), `${L(C.id)?.unit_price} vs ${esperado(C, 20)}`);
  const { data: ped } = await admin.from("catalog_orders").select("promotion_id").eq("id", r5?.order_id).single();
  check("5e. el pedido queda ligado a la promoción", ped?.promotion_id === pid);
  const esperadoW = applyPromotion(Number(W.price_wholesale), 30, W.base_currency_wholesale);
  check("6a. W al mayor se guarda con su 30%, no con el 40% del detal",
    L(W.id)?.tier === "wholesale" && Number(L(W.id)?.unit_price) === esperadoW && Number(L(W.id)?.promo_percent) === 30 && Number(L(W.id)?.list_price) === Number(W.price_wholesale),
    `${L(W.id)?.tier} ${L(W.id)?.unit_price} vs ${esperadoW}`);

  // «Terminar ahora»: the catalogue goes back to list prices at once.
  const { error: e6 } = await yo.from("promotions").update({ ended_at: new Date().toISOString() }).eq("id", pid).eq("owner_id", dueno.id);
  const { data: tras } = await anon().rpc("get_shared_promotion", { p_token: enlace.token });
  check("7a. «Terminar ahora» la quita del catálogo en el acto", !e6 && tras == null, e6?.message ?? JSON.stringify(tras));
} catch (error) {
  check("la suite terminó", false, error instanceof Error ? error.message : String(error));
} finally {
  if (pedidos.length) await admin.from("catalog_orders").delete().in("id", pedidos);
  if (creadas.length) await admin.from("promotions").delete().in("id", creadas);
}
const fallos = filas.filter((f) => !f.pasa).length;
console.log(`\n${filas.length - fallos}/${filas.length} pasan.`);
process.exit(fallos ? 1 : 0);
