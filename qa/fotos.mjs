// qa:fotos -- up to five photos per product (CT-171, migration 204).
//
// WHAT IT GUARDS, in the order it can fail:
//   1. The owner can read and write `product_photos` WITH HIS OWN SESSION. A table with a
//      correct policy and no grant fails every read with 42501 while a service-role suite
//      passes -- migration 108 did exactly that (CLAUDE.md). So the owner's checks run as
//      the owner, through a magic-link session, never through the service key.
//   2. Nobody else can: anon and another owner see nothing and write nothing.
//   3. The customer gets the photos of a product only when the public page would show it:
//      `get_shared_product_photos` answers [] for a wrong token, an unpublished product
//      or a trashed one.
//   4. The nightly cleanup does NOT treat photos 2 to 5 as orphans. Without the lines 204
//      added to 182's functions, it would delete them a week after upload -- silently,
//      and Storage is not in the backups.
//   5. Positions are 1 to 4: the cover is position 0 and lives in `products.photo_path`.
//
// Writes only in dev and cleans up after itself.
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
  console.error("Este script ESCRIBE. Nunca contra producción.");
  process.exit(1);
}

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

async function comoDueno(email) {
  const { data: link, error: eL } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (eL) throw new Error(`generateLink: ${eL.message}`);
  const { data: s, error: eV } = await anon.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.properties.hashed_token,
  });
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

const MARCA = "ZZ QA fotos";
const productos = [];

try {
  if (!env.QA_OWNER_EMAIL) throw new Error("falta QA_OWNER_EMAIL en .env.local");
  const { data: dueno } = await admin.from("owners").select("id").eq("email", env.QA_OWNER_EMAIL).single();
  const { data: otro } = await admin
    .from("owners")
    .select("id, email")
    .neq("id", dueno.id)
    .not("email", "is", null)
    .limit(1)
    .single();
  const { data: enlace } = await admin
    .from("catalog_share_links")
    .select("token")
    .eq("owner_id", dueno.id)
    .single();

  const yo = await comoDueno(env.QA_OWNER_EMAIL);
  const ajeno = await comoDueno(otro.email);

  const crear = async (extra = {}) => {
    const { data, error } = await admin
      .from("products")
      .insert({
        owner_id: dueno.id,
        name: `${MARCA} ${productos.length + 1}`,
        base_currency: "USD",
        base_currency_retail: "USD",
        base_currency_wholesale: "USD",
        price_retail: 5,
        published_retail: true,
        photo_path: `${dueno.id}/zz-qa-portada.jpg`,
        ...extra,
      })
      .select("id")
      .single();
    if (error) throw new Error(`crear producto: ${error.message}`);
    productos.push(data.id);
    return data.id;
  };

  const p = await crear();
  const rutas = [1, 2, 3, 4].map((n) => `${dueno.id}/zz-qa-foto-${n}.jpg`);

  // ── 1. The owner, with his own session ──────────────────────────────────
  const { error: eIns } = await yo
    .from("product_photos")
    .insert(rutas.map((path, i) => ({ product_id: p, position: i + 1, path })));
  check("1a. el dueño guarda las fotos 2 a 5 con SU sesión", !eIns, eIns ? `${eIns.code} ${eIns.message}` : "4 filas");

  const { data: leidas, error: eSel } = await yo
    .from("product_photos")
    .select("path, position")
    .eq("product_id", p)
    .order("position");
  check(
    "1b. y las lee con su sesión, en orden",
    !eSel && JSON.stringify((leidas ?? []).map((r) => r.path)) === JSON.stringify(rutas),
    eSel ? `${eSel.code} ${eSel.message}` : `${leidas?.length} filas`,
  );

  const { error: e5 } = await yo.from("product_photos").insert({ product_id: p, position: 5, path: `${dueno.id}/x.jpg` });
  check("1c. una sexta foto (posición 5) la rechaza la base", e5?.code === "23514", e5 ? e5.code : "ENTRÓ");
  const { error: e0 } = await yo.from("product_photos").insert({ product_id: p, position: 0, path: `${dueno.id}/x.jpg` });
  check("1d. la posición 0 es la portada y no entra en esta tabla", e0?.code === "23514", e0 ? e0.code : "ENTRÓ");

  // ── 2. Nobody else ───────────────────────────────────────────────────────
  const { data: anonLee, error: eAnon } = await anon.from("product_photos").select("path").eq("product_id", p);
  check(
    "2a. anon no lee la tabla",
    eAnon?.code === "42501" || (anonLee ?? []).length === 0,
    eAnon ? eAnon.code : `${anonLee?.length} filas`,
  );
  const { data: ajenoLee } = await ajeno.from("product_photos").select("path").eq("product_id", p);
  check("2b. otro dueño no ve las fotos de este producto", (ajenoLee ?? []).length === 0, `${ajenoLee?.length ?? 0} filas`);
  const { error: eAjenoIns } = await ajeno
    .from("product_photos")
    .insert({ product_id: p, position: 1, path: `${otro.id}/intruso.jpg` });
  check("2c. otro dueño no puede añadirle fotos", !!eAjenoIns, eAjenoIns ? eAjenoIns.code : "ENTRÓ");
  const { error: eAjenoDel, count: borradasAjeno } = await ajeno
    .from("product_photos")
    .delete({ count: "exact" })
    .eq("product_id", p);
  check("2d. ni borrárselas", !eAjenoDel && (borradasAjeno ?? 0) === 0, `${borradasAjeno ?? 0} borradas`);

  // ── 3. The customer's door ───────────────────────────────────────────────
  const { data: publicas } = await anon.rpc("get_shared_product_photos", { p_token: enlace.token, p_product_id: p });
  check(
    "3a. el cliente recibe las fotos 2 a 5 en orden",
    JSON.stringify(publicas) === JSON.stringify(rutas),
    JSON.stringify(publicas),
  );
  const { data: tokenMalo } = await anon.rpc("get_shared_product_photos", { p_token: "no-existe", p_product_id: p });
  check("3b. con un enlace que no existe, nada", JSON.stringify(tokenMalo) === "[]", JSON.stringify(tokenMalo));

  await admin.from("products").update({ published_retail: false }).eq("id", p);
  const { data: sinPublicar } = await anon.rpc("get_shared_product_photos", { p_token: enlace.token, p_product_id: p });
  check("3c. de un producto sin publicar, nada", JSON.stringify(sinPublicar) === "[]", JSON.stringify(sinPublicar));

  await admin.from("products").update({ published_retail: true, trashed_at: new Date().toISOString() }).eq("id", p);
  const { data: enPapelera } = await anon.rpc("get_shared_product_photos", { p_token: enlace.token, p_product_id: p });
  check("3d. de un producto en la papelera, nada", JSON.stringify(enPapelera) === "[]", JSON.stringify(enPapelera));
  await admin.from("products").update({ trashed_at: null }).eq("id", p);

  // ── 4. The nightly cleanup leaves them alone ─────────────────────────────
  const huerfana = `${dueno.id}/zz-qa-huerfana.jpg`;
  const { data: siguenSueltas, error: eRe } = await admin.rpc("storage_orphan_recheck", {
    p_bucket: "product-photos",
    p_names: [...rutas, huerfana],
  });
  const sueltas = (siguenSueltas ?? []).map((r) => (typeof r === "string" ? r : Object.values(r)[0]));
  check(
    "4a. la limpieza no da por abandonadas las fotos 2 a 5",
    !eRe && rutas.every((r) => !sueltas.includes(r)),
    eRe ? eRe.message : `abandonadas: ${JSON.stringify(sueltas)}`,
  );
  check("4b. control: una ruta que nadie usa sí sale como abandonada", sueltas.includes(huerfana));

  // ── 5. Deleting the product takes its photo rows with it ─────────────────
  const { error: eBorra } = await yo.from("product_photos").delete().eq("product_id", p).eq("position", 4);
  const { count: quedan3 } = await admin
    .from("product_photos")
    .select("path", { count: "exact", head: true })
    .eq("product_id", p);
  check("5a. el dueño quita una foto con su sesión", !eBorra && quedan3 === 3, `quedan ${quedan3}`);
  await admin.from("products").delete().eq("id", p);
  const { count: trasBorrar } = await admin
    .from("product_photos")
    .select("path", { count: "exact", head: true })
    .eq("product_id", p);
  check("5b. borrar el producto se lleva sus fotos por cascada", trasBorrar === 0, `quedan ${trasBorrar}`);
} catch (error) {
  check("la suite corrió entera", false, error instanceof Error ? error.message : String(error));
} finally {
  if (productos.length) await admin.from("products").delete().in("id", productos);
  const { count } = await admin
    .from("products")
    .select("id", { count: "exact", head: true })
    .like("name", `${MARCA}%`);
  check("limpieza: no queda nada de la prueba en dev", count === 0, `quedan ${count}`);
}

const fallos = filas.filter((f) => !f.pasa).length;
console.log(`\n${filas.length - fallos}/${filas.length} pasan.`);
if (fallos) process.exitCode = 1;
