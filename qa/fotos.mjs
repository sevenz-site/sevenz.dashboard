// qa:fotos -- up to two photos per product (cap of 2026-11-15, migration 208; it was five
// from CT-171, migration 204).
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
//   4. The nightly cleanup does NOT treat the extra photo as an orphan. Without the lines
//      204 added to 182's functions, it would delete it a week after upload -- silently,
//      and Storage is not in the backups.
//   5. THE CAP, IN THE DATABASE: a new row only fits at position 1 (the cover is position
//      0 and lives in `products.photo_path`). The owner's session can write this table
//      directly, so this check is what a hand-written request meets. FAILS UNTIL
//      MIGRATION 208 HAS RUN in the database the suite points at.
//   6. THE CAP, IN THE RULE THE SERVER USES (`lib/products/photos.ts`): two for anything
//      new, and a product saved before the cap keeps its three to five photos and can
//      drop some, but cannot gain one. Checked on the pure functions, because once 208
//      has run no script can build a product over the cap to try it against the action.
//   7. THE CAP, THROUGH THE REAL ACTION, over HTTP: needs `npm run dev`. A third photo is
//      refused on create and on edit. While 208 has not run it also builds a product over
//      the cap and saves it four ways; after 208 that part prints as NOT TESTED.
//   8. NO SCREEN ASKS SUPABASE TO RESIZE A PHOTO (read from the source): the thumbnail is
//      a stored file since 2026-11-15, drawn by one component and uploaded through one
//      function. The thumbnails themselves -- the cleanup keeping them, the nightly pass
//      making the missing ones -- are in `qa:storage-cleanup`, rows T1 to T8.
//      And 8d: every product photo is drawn whole, never cropped, through the same two
//      components (owner's decision of 2026-11-15).
//
// Writes only in dev and cleans up after itself.
import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync } from "node:fs";
import {
  LEGACY_MAX_PRODUCT_PHOTOS,
  MAX_PRODUCT_PHOTOS,
  photoRowsToRemove,
  photosInOrder,
  photosWithinCap,
} from "../lib/products/photos.ts";
import { cookieDeDueno, idDeLaAccion, llamarAccion } from "./server-action.mjs";

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
// Section 7 calls the server under test and uploads real files for it.
const BASE = process.env.QA_BASE_URL ?? "http://localhost:3000";
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
const subidos = []; // paths in `product-photos`, removed at the end whatever happens

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
  // ONE extra photo: with the cover, that is the two a product can hold.
  const rutas = [`${dueno.id}/zz-qa-foto-1.jpg`];

  // ── 1. The owner, with his own session ──────────────────────────────────
  const { error: eIns } = await yo.from("product_photos").insert({ product_id: p, position: 1, path: rutas[0] });
  check("1a. el dueño guarda la segunda foto con SU sesión", !eIns, eIns ? `${eIns.code} ${eIns.message}` : "1 fila");

  const { data: leidas, error: eSel } = await yo
    .from("product_photos")
    .select("path, position")
    .eq("product_id", p)
    .order("position");
  check(
    "1b. y la lee con su sesión",
    !eSel && JSON.stringify((leidas ?? []).map((r) => r.path)) === JSON.stringify(rutas),
    eSel ? `${eSel.code} ${eSel.message}` : `${leidas?.length} filas`,
  );

  // ── 5. The cap, in the database (migration 208) ──────────────────────────
  // Positions 2, 3 and 4 were legal under 204. If any of them gets in, 208 has not run
  // here, and the row is removed so the rest of the suite reads one photo.
  const FALTA_208 = "ENTRÓ: falta correr la migración 208 en esta base";
  for (const position of [2, 3, 4]) {
    const { error } = await yo
      .from("product_photos")
      .insert({ product_id: p, position, path: `${dueno.id}/zz-qa-de-mas-${position}.jpg` });
    check(
      `5${"abc"[position - 2]}. una foto en la posición ${position} (la ${position + 1}.ª del producto) la rechaza la base`,
      error?.code === "23514",
      error ? error.code : FALTA_208,
    );
    if (!error) await admin.from("product_photos").delete().eq("product_id", p).eq("position", position);
  }
  const { error: e5 } = await yo.from("product_photos").insert({ product_id: p, position: 5, path: `${dueno.id}/x.jpg` });
  check("5d. la posición 5 la rechaza la base", e5?.code === "23514", e5 ? e5.code : "ENTRÓ");
  const { error: e0 } = await yo.from("product_photos").insert({ product_id: p, position: 0, path: `${dueno.id}/x.jpg` });
  check("5e. la posición 0 es la portada y no entra en esta tabla", e0?.code === "23514", e0 ? e0.code : "ENTRÓ");
  const { error: eAdmin } = await admin
    .from("product_photos")
    .insert({ product_id: p, position: 2, path: `${dueno.id}/zz-qa-servidor.jpg` });
  check("5f. ni el servidor puede meter una tercera foto", eAdmin?.code === "23514", eAdmin ? eAdmin.code : FALTA_208);
  if (!eAdmin) await admin.from("product_photos").delete().eq("product_id", p).eq("position", 2);

  // ── 2. Nobody else ───────────────────────────────────────────────────────
  const { data: anonLee, error: eAnon } = await anon.from("product_photos").select("path").eq("product_id", p);
  check(
    "2a. anon no lee la tabla",
    eAnon?.code === "42501" || (anonLee ?? []).length === 0,
    eAnon ? eAnon.code : `${anonLee?.length} filas`,
  );
  const { data: ajenoLee } = await ajeno.from("product_photos").select("path").eq("product_id", p);
  check("2b. otro dueño no ve las fotos de este producto", (ajenoLee ?? []).length === 0, `${ajenoLee?.length ?? 0} filas`);
  // A second product with no photo row: position 1 is free there, so the refusal can only
  // come from the policy and not from the primary key.
  const p2 = await crear();
  const { error: eAjenoIns } = await ajeno
    .from("product_photos")
    .insert({ product_id: p2, position: 1, path: `${otro.id}/intruso.jpg` });
  check("2c. otro dueño no puede añadirle fotos", eAjenoIns?.code === "42501", eAjenoIns ? eAjenoIns.code : "ENTRÓ");
  const { error: eAjenoDel, count: borradasAjeno } = await ajeno
    .from("product_photos")
    .delete({ count: "exact" })
    .eq("product_id", p);
  check("2d. ni borrárselas", !eAjenoDel && (borradasAjeno ?? 0) === 0, `${borradasAjeno ?? 0} borradas`);

  // ── 3. The customer's door ───────────────────────────────────────────────
  const { data: publicas } = await anon.rpc("get_shared_product_photos", { p_token: enlace.token, p_product_id: p });
  check(
    "3a. el cliente recibe la segunda foto",
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
    "4a. la limpieza no da por abandonada la segunda foto",
    !eRe && rutas.every((r) => !sueltas.includes(r)),
    eRe ? eRe.message : `abandonadas: ${JSON.stringify(sueltas)}`,
  );
  check("4b. control: una ruta que nadie usa sí sale como abandonada", sueltas.includes(huerfana));

  // ── Deleting: the owner removes a photo, and a product takes its rows with it ──
  const { error: eBorra } = await yo.from("product_photos").delete().eq("product_id", p).eq("position", 1);
  const { count: quedan } = await admin
    .from("product_photos")
    .select("path", { count: "exact", head: true })
    .eq("product_id", p);
  check("4c. el dueño quita la segunda foto con su sesión", !eBorra && quedan === 0, `quedan ${quedan}`);
  const { error: eVuelve } = await admin.from("product_photos").insert({ product_id: p, position: 1, path: rutas[0] });
  await admin.from("products").delete().eq("id", p);
  const { count: trasBorrar } = await admin
    .from("product_photos")
    .select("path", { count: "exact", head: true })
    .eq("product_id", p);
  check(
    "4d. borrar el producto se lleva sus fotos por cascada",
    !eVuelve && trasBorrar === 0,
    eVuelve ? `no se pudo montar: ${eVuelve.message}` : `quedan ${trasBorrar}`,
  );

  // ── 6. The cap, in the rule the server action uses ───────────────────────
  // Pure functions, no database. A to E stand for the five photos of a product saved
  // while the cap was five; N is a photo uploaded now.
  const [A, B, C, D, E, N] = ["a", "b", "c", "d", "e", "n"].map((x) => `${dueno.id}/${x}.jpg`);
  const antes = [A, B, C, D, E];
  check(
    "6a. el tope es 2, y lo más que la tabla llegó a guardar, 5",
    MAX_PRODUCT_PHOTOS === 2 && LEGACY_MAX_PRODUCT_PHOTOS === 5,
    `${MAX_PRODUCT_PHOTOS} y ${LEGACY_MAX_PRODUCT_PHOTOS}`,
  );
  check("6b. un producto nuevo con 2 fotos se guarda", photosWithinCap([A, B], []));
  check("6c. un producto nuevo con 3 fotos se rechaza", !photosWithinCap([A, B, C], []));
  check("6d. uno que ya tenía 5 las conserva al guardar sin tocarlas", photosWithinCap(antes, antes));
  check("6e. y puede quitar una, la portada incluida, y quedarse con 4", photosWithinCap([B, C, D, E], antes));
  check("6f. pero no ganar una nueva mientras pase de 2", !photosWithinCap([A, B, C, N], antes));
  check("6g. ni cambiar una por otra nueva mientras pase de 2", !photosWithinCap([A, B, N], antes));
  check("6h. ni reordenarlas", !photosWithinCap([B, A, C], antes));
  check("6i. si baja a 1 y sube otra nueva, se guarda", photosWithinCap([C, N], antes));
  check("6j. más de 5 no entra nunca", !photosWithinCap([A, B, C, D, E, N], [A, B, C, D, E, N]));
  const leidasDeAntes = photosInOrder(A, [B, C, D, E]);
  check("6k. al leer no se recorta: un producto de 5 fotos abre con las 5", leidasDeAntes.length === 5, `${leidasDeAntes.length} fotos`);
  const filasDeAntes = [B, C, D, E].map((path, i) => ({ path, position: i + 1 }));
  const sinTocar = photoRowsToRemove(filasDeAntes, [B, C, D, E]);
  check("6l. guardar uno de 5 sin tocar sus fotos no borra ninguna fila", sinTocar.length === 0, JSON.stringify(sinTocar));
  const sinPortada = photoRowsToRemove(filasDeAntes, [C, D, E]);
  check("6m. quitar la portada borra solo la fila de la que pasa a serlo", JSON.stringify(sinPortada) === "[1]", JSON.stringify(sinPortada));
  const sinCuarta = photoRowsToRemove(filasDeAntes, [B, C, E]);
  check("6n. quitar la cuarta foto borra solo su fila", JSON.stringify(sinCuarta) === "[3]", JSON.stringify(sinCuarta));

  // ── 8. No screen asks Supabase to resize a photo ─────────────────────────
  // Read from the source, no database. v0.7.0 drew every grid through `/render/image/`,
  // which bills each distinct photo once per billing cycle, and the quota of 100 was gone
  // within hours. Since 2026-11-15 the thumbnail is a stored file (owner's option B).
  // These three rows are what stops the next screen from going back: a new grid written
  // with the old URL works perfectly and nothing else would notice.
  const fuentes = [];
  const recorrer = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const ruta = `${dir}/${e.name}`;
      if (e.isDirectory()) recorrer(ruta);
      else if (/\.(ts|tsx)$/.test(e.name)) fuentes.push(ruta);
    }
  };
  for (const dir of ["app", "components", "lib", "hooks"]) recorrer(dir);
  // Code only: a line that is a comment may name the endpoint to explain it.
  const codigo = (ruta) =>
    readFileSync(ruta, "utf8")
      .split(/\r?\n/)
      .filter((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l))
      .join("\n");
  const conTransformacion = fuentes.filter((f) => codigo(f).includes("/render/image/"));
  // THE BRAND CARD OF A SHARED LINK IS THE OTHER ONE, and it is allowed (2026-11-26). Since
  // v0.13.0 (2026-11-25) the catalogue's WhatsApp card asks Supabase for the business LOGO
  // shrunk to the card, and this check, written before that, failed from then on. It is not
  // a product photo and not a grid: one logo per business, at one size, so one transformation
  // per business per billing cycle. The balance link's card (2026-11-26) asks for the same logo
  // with the same parameters, from the same file, so it adds none.
  check(
    "8a. solo las vistas previas de WhatsApp piden una transformación a Supabase",
    JSON.stringify(conTransformacion) ===
      JSON.stringify(["lib/catalog/brand-preview-image.tsx", "lib/supabase/storage.ts"]) &&
      codigo("lib/supabase/storage.ts").split("/render/image/").length === 2 &&
      codigo("lib/catalog/brand-preview-image.tsx").split("/render/image/").length === 2,
    conTransformacion.join(", ") || "ninguna",
  );
  const dibujanAMano = fuentes.filter(
    (f) => f !== "lib/supabase/storage.ts" && f !== "components/product-thumbnail.tsx" && codigo(f).includes("getProductThumbnailUrl"),
  );
  check(
    "8b. la miniatura solo la dibuja ProductThumbnail, que cae a la foto si no existe",
    dibujanAMano.length === 0,
    dibujanAMano.join(", ") || "ninguna pantalla la dibuja a mano",
  );
  // Whitespace removed first, so a call split across lines is still seen.
  const subenSolas = fuentes.filter(
    (f) => f !== "lib/products/upload-photo.ts" && codigo(f).replace(/\s+/g, "").includes('from("product-photos").upload('),
  );
  const usanLaPuerta = fuentes.filter((f) => codigo(f).includes("uploadProductPhoto(") && f !== "lib/products/upload-photo.ts");
  check(
    "8c. las fotos de producto se suben por una sola puerta, que sube también la miniatura",
    subenSolas.length === 0 &&
      usanLaPuerta.includes("components/dashboard/product-photos-input.tsx") &&
      usanLaPuerta.includes("components/dashboard/product-photo-input.tsx"),
    subenSolas.length ? `suben por su cuenta: ${subenSolas.join(", ")}` : `la usan: ${usanLaPuerta.join(", ")}`,
  );

  // The whole product, never a crop (owner, 2026-11-15: «Sí, siempre el producto entero,
  // también en web»). Twenty screens used to set their own fit, so one of them was always
  // going to crop again. Now every product photo goes through `ProductPhoto` or
  // `ProductThumbnail`, and both put `PRODUCT_PHOTO_FIT` last, where no caller can beat it.
  const conUrlDeFoto = fuentes.filter(
    (f) =>
      !["lib/supabase/storage.ts", "components/product-thumbnail.tsx", "components/product-photo.tsx"].includes(f) &&
      codigo(f).includes("getPublicProductPhotoUrl("),
  );
  const ajuste = codigo("components/product-photo.tsx").match(/PRODUCT_PHOTO_FIT = "([^"]*)"/)?.[1] ?? "";
  const alFinal = ["components/product-photo.tsx", "components/product-thumbnail.tsx"].every((f) =>
    codigo(f).replace(/\s+/g, "").includes("className={cn(className,PRODUCT_PHOTO_FIT)}"),
  );
  check(
    "8d. toda foto de producto se ve entera: pasa por ProductPhoto o ProductThumbnail, con object-contain al final",
    conUrlDeFoto.length === 0 && /\bobject-contain\b/.test(ajuste) && !/\bobject-cover\b/.test(ajuste) && alFinal,
    conUrlDeFoto.length ? `la dibujan a mano: ${conUrlDeFoto.join(", ")}` : `ajuste «${ajuste}», al final: ${alFinal}`,
  );

  // ── 7. The cap, through the real server action ───────────────────────────
  // Over HTTP, the way the browser calls it, so this needs `npm run dev`. It is the one
  // section that proves the action itself refuses, and not only the function it calls.
  const cookie = await cookieDeDueno(env, dueno.id);
  const accionCrear = await idDeLaAccion(BASE, "/productos/nuevo", "createProduct", cookie).catch(() => null);
  if (!accionCrear) throw new Error(`no encontré createProduct en ${BASE}: la sección 7 necesita \`npm run dev\``);
  const stamp = Date.now().toString().slice(-6);
  const archivo = async (n) => {
    const path = `${dueno.id}/zz-qa-fotos-accion-${n}-${stamp}.jpg`;
    const { error } = await admin.storage.from("product-photos").upload(path, JPG, { contentType: "image/jpeg", upsert: true });
    if (error) throw new Error(`upload ${path}: ${error.message}`);
    subidos.push(path);
    return path;
  };
  const [f1, f2, f3, f4, f5] = [await archivo(1), await archivo(2), await archivo(3), await archivo(4), await archivo(5)];
  const entrada = (nombre, fotos, extra = {}) => ({
    name: nombre,
    unit: null,
    activeCurrenciesRetail: ["USD"],
    activeCurrenciesWholesale: ["USD"],
    priceRetail: "10",
    priceWholesale: "9",
    fixedRetail: {},
    fixedWholesale: {},
    cost: null,
    costCurrency: null,
    costCurrencyOther: null,
    marginRetailPct: null,
    marginWholesalePct: null,
    stockOpening: null,
    supplier: null,
    wholesaleMinQuantity: "5",
    publishedRetail: false,
    publishedWholesale: false,
    photoPath: fotos[0] ?? null,
    extraPhotoPaths: fotos.slice(1),
    description: null,
    ...extra,
  });
  const guardadas = async (id) => {
    const { data: prod } = await admin.from("products").select("photo_path, price_retail").eq("id", id).single();
    const { data: rows } = await admin.from("product_photos").select("position, path").eq("product_id", id).order("position");
    return { portada: prod.photo_path, precio: Number(prod.price_retail), filas: (rows ?? []).map((r) => `${r.position}:${r.path}`) };
  };
  const porNombre = async (nombre) => {
    const { data } = await admin.from("products").select("id").eq("owner_id", dueno.id).eq("name", nombre);
    for (const r of data ?? []) if (!productos.includes(r.id)) productos.push(r.id);
    return data ?? [];
  };

  const nombre3 = `${MARCA} tres ${stamp}`;
  const r7a = await llamarAccion(BASE, "/productos/nuevo", accionCrear, cookie, [entrada(nombre3, [f1, f2, f3])], '{"error":');
  const creados3 = await porNombre(nombre3);
  check(
    "7a. crear un producto con 3 fotos lo rechaza el servidor, y no se crea",
    /hasta 2 fotos/.test(r7a.error ?? "") && creados3.length === 0,
    r7a.error ?? "SE GUARDÓ",
  );

  const nombre2 = `${MARCA} dos ${stamp}`;
  const r7b = await llamarAccion(BASE, "/productos/nuevo", accionCrear, cookie, [entrada(nombre2, [f1, f2])], '{"error":');
  const [creado] = await porNombre(nombre2);
  const tras7b = creado ? await guardadas(creado.id) : null;
  check(
    "7b. CONTROL: con 2 fotos se guarda, la segunda en la posición 1",
    !r7b.error && tras7b?.portada === f1 && JSON.stringify(tras7b.filas) === JSON.stringify([`1:${f2}`]),
    r7b.error ?? JSON.stringify(tras7b),
  );

  const accionEditar = await idDeLaAccion(BASE, `/productos/${creado.id}/editar`, "updateProduct", cookie);
  if (!accionEditar) throw new Error("no encontré updateProduct en los chunks de la pantalla de editar");
  const editar = (fotos, extra) =>
    llamarAccion(BASE, `/productos/${creado.id}/editar`, accionEditar, cookie, [creado.id, entrada(nombre2, fotos, extra)], '{"error":');
  const r7c = await editar([f1, f2, f3]);
  const tras7c = await guardadas(creado.id);
  check(
    "7c. editar para añadirle una tercera foto se rechaza, y el producto conserva sus 2",
    /hasta 2 fotos/.test(r7c.error ?? "") && JSON.stringify(tras7c.filas) === JSON.stringify([`1:${f2}`]),
    r7c.error ?? JSON.stringify(tras7c),
  );

  // A PRODUCT FROM BEFORE THE CAP, against the real action. It can only be built while
  // the database still takes positions 2 and 3, that is, before migration 208. Once 208
  // has run these three lines print as NOT TESTED and count neither way: sections 6l to
  // 6n cover the same rule on the pure functions.
  const { error: eLegado } = await admin.from("product_photos").insert([
    { product_id: creado.id, position: 2, path: f3 },
    { product_id: creado.id, position: 3, path: f4 },
  ]);
  if (eLegado) {
    console.log("SIN PROBAR  7d-7f. un producto de antes del tope, contra la acción  — la 208 ya corrió: la base no deja montar uno");
  } else {
    const antesDe = [`1:${f2}`, `2:${f3}`, `3:${f4}`];
    const r7d = await editar([f1, f2, f3, f4], { priceRetail: "12" });
    const tras7d = await guardadas(creado.id);
    check(
      "7d. uno de 4 fotos cambia de precio y conserva las 4",
      !r7d.error && tras7d.precio === 12 && tras7d.portada === f1 && JSON.stringify(tras7d.filas) === JSON.stringify(antesDe),
      r7d.error ?? JSON.stringify(tras7d),
    );
    const r7e = await editar([f1, f2, f3, f5]);
    const tras7e = await guardadas(creado.id);
    check(
      "7e. cambiarle una foto por otra nueva mientras pasa de 2 se rechaza, y no pierde ninguna",
      /hasta 2 fotos/.test(r7e.error ?? "") && JSON.stringify(tras7e.filas) === JSON.stringify(antesDe),
      r7e.error ?? JSON.stringify(tras7e),
    );
    const r7f = await editar([f2, f3, f4]);
    const tras7f = await guardadas(creado.id);
    check(
      "7f. quitarle la portada asciende a la segunda y deja las otras dos filas como estaban",
      !r7f.error && tras7f.portada === f2 && JSON.stringify(tras7f.filas) === JSON.stringify([`2:${f3}`, `3:${f4}`]),
      r7f.error ?? JSON.stringify(tras7f),
    );
    const r7g = await editar([f2, f5]);
    const tras7g = await guardadas(creado.id);
    check(
      "7g. y al bajar a 1 ya admite una nueva: queda con 2, la segunda en la posición 1",
      !r7g.error && tras7g.portada === f2 && JSON.stringify(tras7g.filas) === JSON.stringify([`1:${f5}`]),
      r7g.error ?? JSON.stringify(tras7g),
    );
  }
} catch (error) {
  check("la suite corrió entera", false, error instanceof Error ? error.message : String(error));
} finally {
  if (productos.length) await admin.from("products").delete().in("id", productos);
  if (subidos.length) await admin.storage.from("product-photos").remove(subidos).catch(() => null);
  const { count } = await admin
    .from("products")
    .select("id", { count: "exact", head: true })
    .like("name", `${MARCA}%`);
  check("limpieza: no queda nada de la prueba en dev", count === 0, `quedan ${count}`);
}

const fallos = filas.filter((f) => !f.pasa).length;
console.log(`\n${filas.length - fallos}/${filas.length} pasan.`);
if (fallos) process.exitCode = 1;
