// Migration 184: product categories.
//
// DEV ONLY, writes and cleans up after itself. Runs as the owner of
// QA_OWNER_EMAIL with HIS session (magic link) — the table is new, has RLS,
// and a missing grant is the failure the service key cannot see (migration
// 108). A second owner plays «someone else's business».
//
// What it pins down:
//   - the owner creates, renames and deletes his categories with his session;
//   - one name per business whatever the case, and the name's shape;
//   - he cannot see or touch another business's categories, and — the one
//     that matters for money screens — cannot put HIS product in ANOTHER
//     business's category (the composite foreign key);
//   - deleting a category leaves its products without one, intact;
//   - the client's catalogue (get_shared_catalog) carries each product's
//     category and only the chips that have a published product.
//
//   npm run qa:categorias
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

const DEV_REF = "vzqppwrwnmlbrxizskdh";
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
if (ref !== DEV_REF) {
  console.error(`ME NIEGO A CORRER. .env.local apunta a "${ref}", no a la rama dev (${DEV_REF}).`);
  process.exit(1);
}

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const nuevoAnonimo = () =>
  createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

async function comoDueno(email) {
  // A client of its own for the login: `verifyOtp` leaves the session on the
  // client that calls it (the second trap of qa:attack).
  const login = nuevoAnonimo();
  const { data: link, error: eL } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (eL) throw new Error(`generateLink: ${eL.message}`);
  const { data: s, error: eV } = await login.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  if (eV) throw new Error(`verifyOtp: ${eV.message}`);
  return {
    id: s.user.id,
    db: createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${s.session.access_token}` } },
    }),
  };
}

const filas = [];
function check(nombre, pasa, detalle) {
  filas.push({ nombre, pasa });
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${detalle ? `  — ${detalle}` : ""}`);
}

// Short on purpose: a category name is at most 30 letters.
const MARCA = `ZZ${Date.now() % 100000}`;
const creadas = [];
const productos = [];
let linkCreado = null;

try {
  const { error: e0 } = await admin.from("product_categories").select("id").limit(1);
  check("0. la tabla product_categories existe (migración 184 corrida en dev)", !e0, e0?.message);
  if (e0) throw new Error("sin la 184 no tiene sentido seguir");

  if (!env.QA_OWNER_EMAIL) throw new Error("falta QA_OWNER_EMAIL en .env.local");
  const A = await comoDueno(env.QA_OWNER_EMAIL);
  const { data: otro } = await admin.from("owners").select("id").neq("id", A.id).limit(1).single();
  const B = otro.id;

  // ── 1. Create, as the owner.
  const { data: catA, error: e1 } = await A.db
    .from("product_categories")
    .insert({ owner_id: A.id, name: `${MARCA} Bebidas` })
    .select("id, name")
    .single();
  check("1a. el dueño CREA una categoría con su sesión", !e1 && !!catA, e1?.message);
  if (catA) creadas.push(catA.id);

  const { error: eDup } = await A.db
    .from("product_categories")
    .insert({ owner_id: A.id, name: `${MARCA} bebidas`.toUpperCase() });
  check("1b. el mismo nombre con otras mayúsculas se rechaza", eDup?.code === "23505", eDup?.message ?? "¡entró repetida!");

  const { error: eVacia } = await A.db.from("product_categories").insert({ owner_id: A.id, name: "  " });
  const { error: eLarga } = await A.db.from("product_categories").insert({ owner_id: A.id, name: "x".repeat(31) });
  check("1c. un nombre vacío o de más de 30 letras se rechaza", !!eVacia && !!eLarga, `${eVacia?.code} · ${eLarga?.code}`);

  // ── 2. Another business's categories.
  const { data: catB } = await admin
    .from("product_categories")
    .insert({ owner_id: B, name: `${MARCA} de otro negocio` })
    .select("id")
    .single();
  creadas.push(catB.id);

  const { data: veB } = await A.db.from("product_categories").select("id").eq("id", catB.id);
  check("2a. el dueño NO ve las categorías de otro negocio", (veB ?? []).length === 0, `${(veB ?? []).length} fila(s)`);

  await A.db.from("product_categories").update({ name: "HACKED" }).eq("id", catB.id);
  await A.db.from("product_categories").delete().eq("id", catB.id);
  const { data: siguesB } = await admin.from("product_categories").select("name").eq("id", catB.id).single();
  check("2b. NO puede renombrar ni borrar la de otro", siguesB?.name === `${MARCA} de otro negocio`, siguesB?.name);

  const { error: eAjena } = await A.db
    .from("product_categories")
    .insert({ owner_id: B, name: `${MARCA} plantada` });
  check("2c. NO puede crear una categoría a nombre de otro", !!eAjena, eAjena?.message ?? "¡entró!");

  // ── 3. The product side.
  const { data: prod, error: eP } = await A.db
    .from("products")
    .insert({ owner_id: A.id, name: `${MARCA} producto`, base_currency: "USD", base_currency_retail: "USD", price_retail: 1, published_retail: true, category_id: catA.id })
    .select("id, category_id")
    .single();
  check("3a. su producto entra con SU categoría", !eP && prod?.category_id === catA.id, eP?.message);
  if (prod) productos.push(prod.id);

  const { error: eCruce } = await A.db.from("products").update({ category_id: catB.id }).eq("id", prod.id);
  const { data: tras } = await admin.from("products").select("category_id").eq("id", prod.id).single();
  check("3b. NO puede poner su producto en la categoría de otro negocio", !!eCruce && tras.category_id === catA.id, eCruce?.message ?? "¡entró!");

  // ── 4. Rename, then the client's catalogue.
  const { error: eRen } = await A.db.from("product_categories").update({ name: `${MARCA} Refrescos` }).eq("id", catA.id);
  check("4a. el dueño RENOMBRA su categoría", !eRen, eRen?.message);

  const { data: vacia } = await A.db
    .from("product_categories")
    .insert({ owner_id: A.id, name: `${MARCA} Vacía` })
    .select("id")
    .single();
  creadas.push(vacia.id);
  const { data: soloOculto } = await admin
    .from("product_categories")
    .insert({ owner_id: A.id, name: `${MARCA} Solo sin publicar` })
    .select("id")
    .single();
  creadas.push(soloOculto.id);
  const { data: prodOculto } = await admin
    .from("products")
    .insert({ owner_id: A.id, name: `${MARCA} oculto`, base_currency: "USD", base_currency_retail: "USD", price_retail: 1, published_retail: false, category_id: soloOculto.id })
    .select("id")
    .single();
  productos.push(prodOculto.id);

  let { data: link } = await admin.from("catalog_share_links").select("token").eq("owner_id", A.id).maybeSingle();
  if (!link) {
    link = (await admin.from("catalog_share_links").insert({ owner_id: A.id }).select("token").single()).data;
    linkCreado = link.token;
  }
  const { data: cat, error: eCat } = await nuevoAnonimo().rpc("get_shared_catalog", { p_token: link.token });
  const chips = (cat?.categories ?? []).map((c) => c.id);
  const suyo = (cat?.products ?? []).find((p) => p.id === prod.id);
  check("4b. el catálogo del cliente trae la categoría de cada producto", !eCat && suyo?.category_id === catA.id, eCat?.message ?? suyo?.category_id);
  check(
    "4c. sus chips: la que tiene un publicado sí, la vacía y la de solo sin publicar no",
    chips.includes(catA.id) && !chips.includes(vacia.id) && !chips.includes(soloOculto.id),
    `${chips.length} chip(s)`,
  );
  const nombre = (cat?.categories ?? []).find((c) => c.id === catA.id)?.name;
  check("4d. el chip lleva el nombre nuevo", nombre === `${MARCA} Refrescos`, nombre);
  check("4e. el catálogo no filtra categorías de otro negocio", !chips.includes(catB.id));

  // ── 5. Delete: the product stays, without a category.
  const { error: eDel } = await A.db.from("product_categories").delete().eq("id", catA.id);
  const { data: tras2 } = await admin.from("products").select("id, name, category_id, trashed_at").eq("id", prod.id).single();
  check(
    "5. eliminar la categoría deja el producto SIN categoría e intacto",
    !eDel && tras2?.category_id === null && tras2?.trashed_at === null && tras2?.name === `${MARCA} producto`,
    eDel?.message ?? JSON.stringify(tras2),
  );

  // ── 6. A stranger.
  const { data: anonVe, error: eAnon } = await nuevoAnonimo().from("product_categories").select("id").limit(1);
  check("6. sin sesión no se leen categorías", !!eAnon || (anonVe ?? []).length === 0, eAnon?.message ?? `${(anonVe ?? []).length} fila(s)`);
} catch (e) {
  check("ejecución", false, e.message);
} finally {
  if (productos.length) await admin.from("products").delete().in("id", productos);
  if (creadas.length) await admin.from("product_categories").delete().in("id", creadas);
  if (linkCreado) await admin.from("catalog_share_links").delete().eq("token", linkCreado);
}

const fallos = filas.filter((f) => !f.pasa).length;
console.log(`\n${filas.length - fallos}/${filas.length} pasan.`);
if (fallos) process.exitCode = 1;
