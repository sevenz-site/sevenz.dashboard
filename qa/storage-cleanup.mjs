// THE NIGHTLY CLEANUP OF ABANDONED LOGOS AND PRODUCT PHOTOS -- `DM-12`,
// migration 182, 2026-11-02.
//
// The worst case of this feature is deleting a file that IS in use: a broken
// image in the app, the catalogue and the receipts, and Storage has no backup.
// So most rows here are CONTROLS -- files that must survive -- and only two
// files are supposed to go. A cleanup that deleted nothing would fail rows 1
// and 9; one that deleted too much fails every control.
//
// It runs the real route over HTTP with CRON_SECRET, so it needs `npm run dev`.
// To make the route act on files uploaded seconds ago it sets, in DEV ONLY,
// `min_age = 0` and `scope_owner = <this suite's owner>` -- the scope is what
// keeps it from touching any other file in dev -- and puts the original
// settings back at the end, whatever happens.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { cookieDeDueno, idDeLaAccion, llamarAccion } from "./server-action.mjs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
if (!URL_.includes("vzqppwrwnmlbrxizskdh")) {
  console.error("Esta suite solo corre contra la rama dev (vzqppwrwnmlbrxizskdh).");
  process.exit(1);
}
const BASE = process.env.QA_BASE_URL ?? "http://localhost:3000";
const svc = createClient(URL_, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = () => createClient(URL_, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const filas = [];
const check = (n, ok, d = "") => { filas.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `  — ${d}` : ""}`); };
const stamp = Date.now().toString().slice(-6);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
const usuarios = [];
const subidos = []; // [bucket, path] -- removed at the end whatever happens
let original = null;

async function dueno(tag) {
  const email = `zz-limpieza-${tag}-${stamp}@sevenz-qa.test`;
  const { data, error } = await svc.auth.admin.createUser({ email, email_confirm: true, user_metadata: { business_name: `ZZ Limpieza ${tag}`, country: "VE" } });
  if (error) throw new Error(`createUser: ${error.message}`);
  usuarios.push(data.user.id);
  await svc.from("owners").update({ onboarding_completed_at: new Date().toISOString() }).eq("id", data.user.id);
  return data.user.id;
}
async function subir(bucket, path) {
  const { error } = await svc.storage.from(bucket).upload(path, JPG, { contentType: "image/jpeg", upsert: true });
  if (error) throw new Error(`upload ${bucket}/${path}: ${error.message}`);
  subidos.push([bucket, path]);
}
async function existe(bucket, path) {
  const i = path.lastIndexOf("/");
  const { data } = await svc.storage.from(bucket).list(path.slice(0, i), { search: path.slice(i + 1) });
  return (data ?? []).some((o) => o.name === path.slice(i + 1));
}
const ruta = (cabeceras = {}) =>
  fetch(`${BASE}/api/cron/storage-cleanup`, { headers: cabeceras }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
const conClave = () => ruta({ authorization: `Bearer ${env.CRON_SECRET}` });
const ajustes = (cambios) => svc.from("storage_cleanup_settings").update({ ...cambios, updated_at: new Date().toISOString() }).eq("id", true);

try {
  if (!env.CRON_SECRET) throw new Error("falta CRON_SECRET en .env.local");
  const { data: o, error: eAjustes } = await svc.from("storage_cleanup_settings").select("enforce, min_age, max_per_run, scope_owner").eq("id", true).single();
  if (eAjustes) throw new Error(`no se pueden leer los ajustes — ¿la migración 182 está en dev? ${eAjustes.message}`);
  original = o;

  const A = await dueno("a");
  const B = await dueno("b");
  const F = {
    logoUsado: `${A}/logo-usado-${stamp}.jpg`,
    logoHuerfano: `${A}/logo-huerfano-${stamp}.jpg`,
    fotoUsada: `${A}/usada-${stamp}.jpg`,
    fotoPapelera: `${A}/papelera-${stamp}.jpg`,
    fotoHuerfana: `${A}/huerfana-${stamp}.jpg`,
    fotoDeB: `${B}/huerfana-de-b-${stamp}.jpg`,
    fueraDeCarpeta: `zz-qa-${stamp}/fuera.jpg`,
  };
  await subir("logos", F.logoUsado);
  await subir("logos", F.logoHuerfano);
  await subir("product-photos", F.fotoUsada);
  await subir("product-photos", F.fotoPapelera);
  await subir("product-photos", F.fotoHuerfana);
  await subir("product-photos", F.fotoDeB);
  await subir("product-photos", F.fueraDeCarpeta);
  await svc.from("owners").update({ logo_path: F.logoUsado }).eq("id", A);
  await svc.from("products").insert({ owner_id: A, name: "ZZ con foto", base_currency: "USD", price_retail: 1, photo_path: F.fotoUsada });
  await svc.from("products").insert({ owner_id: A, name: "ZZ en papelera", base_currency: "USD", price_retail: 1, photo_path: F.fotoPapelera, trashed_at: new Date().toISOString() });

  // 1-4. The decision, straight from the function.
  const { data: cand, error: eCand } = await svc.rpc("storage_orphan_candidates", { p_min_age: "0 seconds", p_limit: 1000, p_scope_owner: A });
  const nombres = new Set((cand ?? []).map((c) => c.name));
  check("1. salen como abandonados el logo y la foto que nadie usa", !eCand && nombres.has(F.logoHuerfano) && nombres.has(F.fotoHuerfana), eCand?.message ?? [...nombres].join(", "));
  check("2. NO salen el logo puesto ni la foto de un producto vivo", !nombres.has(F.logoUsado) && !nombres.has(F.fotoUsada));
  check("3. NO sale la foto de un producto en la papelera (se puede restaurar)", !nombres.has(F.fotoPapelera));
  check("3b. y solo esos dos: nada más de la carpeta de A", nombres.size === 2, `${nombres.size} archivos`);
  const { data: cand7 } = await svc.rpc("storage_orphan_candidates", { p_min_age: "7 days", p_limit: 1000, p_scope_owner: A });
  check("4. con 7 días, un archivo recién subido NO es candidato", (cand7 ?? []).length === 0, `${(cand7 ?? []).length} archivos`);
  const { data: candTodos } = await svc.rpc("storage_orphan_candidates", { p_min_age: "0 seconds", p_limit: 1000, p_scope_owner: null });
  check("4b. un archivo fuera de la carpeta de un negocio NUNCA es candidato", !(candTodos ?? []).some((c) => c.name === F.fueraDeCarpeta));
  const { data: neg } = await svc.rpc("storage_orphan_candidates", { p_min_age: "-1 day", p_limit: 1000, p_scope_owner: A });
  check("4c. una antigüedad negativa se trata como cero, no como «todo»", (neg ?? []).length === 2);

  // 5. Only the service role reaches any of it.
  const { error: eAnon } = await anon().rpc("storage_orphan_candidates", { p_min_age: "0 seconds", p_limit: 10 });
  const cookieA = await cookieDeDueno(env, A);
  const sesionA = JSON.parse(Buffer.from(cookieA.split("=").slice(1).join("=").slice(7), "base64url").toString());
  const comoA = createClient(URL_, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${sesionA.access_token}` } } });
  const { error: eDueno } = await comoA.rpc("storage_orphan_candidates", { p_min_age: "0 seconds", p_limit: 10 });
  const { error: eRecheck } = await comoA.rpc("storage_orphan_recheck", { p_bucket: "logos", p_names: [F.logoUsado] });
  const { data: tocaInt } = await comoA.from("storage_cleanup_settings").update({ enforce: true }).eq("id", true).select("id");
  const { data: leeLog } = await comoA.from("storage_cleanup_log").select("name").limit(1);
  check("5. ni un anónimo ni un dueño pueden preguntar qué archivos sobran", eAnon?.code === "42501" && eDueno?.code === "42501" && eRecheck?.code === "42501", `${eAnon?.code} · ${eDueno?.code} · ${eRecheck?.code}`);
  check("5b. un dueño no toca el interruptor ni lee el registro", !(tocaInt?.length) && !(leeLog?.length));

  // 6. The re-check: a name referenced since the nightly query is kept.
  const { data: rc } = await svc.rpc("storage_orphan_recheck", { p_bucket: "product-photos", p_names: [F.fotoHuerfana, F.fotoUsada] });
  check("6. la comprobación de última hora suelta lo que ya está en uso", JSON.stringify(rc) === JSON.stringify([F.fotoHuerfana]), JSON.stringify(rc));

  // 7-9. The route: refused without the key, then watching, then deleting.
  check("7. la ruta sin clave responde 401", (await ruta()).status === 401);
  await ajustes({ enforce: false, min_age: "0 seconds", scope_owner: A });
  const obs = await conClave();
  check("8. OBSERVANDO: encuentra los dos y no borra nada", obs.status === 200 && obs.body?.mode === "observe" && obs.body?.found === 2 && obs.body?.deleted === 0, JSON.stringify(obs.body));
  check("8b. los dos siguen en Storage", (await existe("logos", F.logoHuerfano)) && (await existe("product-photos", F.fotoHuerfana)));
  const { data: log1 } = await svc.from("storage_cleanup_log").select("name, deleted_at").in("name", [F.logoHuerfano, F.fotoHuerfana]);
  check("8c. y quedan apuntados en el registro, sin fecha de borrado", (log1 ?? []).length === 2 && log1.every((r) => r.deleted_at == null));

  await ajustes({ enforce: true });
  const act = await conClave();
  check("9. ACTIVADA: borra exactamente los dos", act.status === 200 && act.body?.mode === "enforce" && act.body?.deleted === 2, JSON.stringify(act.body));
  check("9b. ya no están en Storage", !(await existe("logos", F.logoHuerfano)) && !(await existe("product-photos", F.fotoHuerfana)));
  const vivos = await Promise.all([
    existe("logos", F.logoUsado), existe("product-photos", F.fotoUsada), existe("product-photos", F.fotoPapelera),
    existe("product-photos", F.fotoDeB), existe("product-photos", F.fueraDeCarpeta),
  ]);
  check("9c. siguen el logo puesto, la foto viva, la de la papelera, la de OTRO negocio y la de fuera de carpeta", vivos.every(Boolean), JSON.stringify(vivos));
  const { data: log2 } = await svc.from("storage_cleanup_log").select("name, deleted_at").in("name", [F.logoHuerfano, F.fotoHuerfana]);
  check("9d. el registro apunta la fecha de borrado de los dos", (log2 ?? []).length === 2 && log2.every((r) => r.deleted_at != null));
  const otra = await conClave();
  check("9e. una segunda noche no encuentra nada más que borrar", otra.body?.found === 0 && otra.body?.deleted === 0, JSON.stringify(otra.body));
  await ajustes({ enforce: original.enforce, min_age: original.min_age, scope_owner: original.scope_owner });

  // 10-12. The brake on save: a NEW path whose file is gone is refused.
  const accionCrear = await idDeLaAccion(BASE, "/productos/nuevo", "createProduct", cookieA);
  if (!accionCrear) throw new Error("no encontré `createProduct` en los chunks de /productos/nuevo");
  const base = (nombre, photoPath) => ({ name: nombre, unit: null, activeCurrenciesRetail: ["USD"], activeCurrenciesWholesale: ["USD"], priceRetail: "10", priceWholesale: "9", fixedRetail: {}, fixedWholesale: {}, cost: null, costCurrency: null, costCurrencyOther: null, marginRetailPct: null, marginWholesalePct: null, stockOpening: null, supplier: null, wholesaleMinQuantity: "5", publishedRetail: false, publishedWholesale: false, photoPath, description: null });
  const r10 = await llamarAccion(BASE, "/productos/nuevo", accionCrear, cookieA, [base(`ZZ foto borrada ${stamp}`, F.fotoHuerfana)], '{"error":');
  const { data: p10 } = await svc.from("products").select("id").eq("owner_id", A).eq("name", `ZZ foto borrada ${stamp}`);
  check("10. crear un producto con una foto que ya no existe se rechaza con su mensaje", /ya no está disponible/.test(r10.error ?? "") && (p10 ?? []).length === 0, r10.error ?? "SE GUARDÓ");
  const nueva = `${A}/nueva-${stamp}.jpg`;
  await subir("product-photos", nueva);
  const r11 = await llamarAccion(BASE, "/productos/nuevo", accionCrear, cookieA, [base(`ZZ foto buena ${stamp}`, nueva)], '{"error":');
  const { data: p11 } = await svc.from("products").select("photo_path").eq("owner_id", A).eq("name", `ZZ foto buena ${stamp}`).maybeSingle();
  check("11. CONTROL: con una foto que existe se guarda, y con ella", !r11.error && p11?.photo_path === nueva, r11.error ?? JSON.stringify(p11));
  const r12 = await llamarAccion(BASE, "/productos/nuevo", accionCrear, cookieA, [base(`ZZ sin foto ${stamp}`, null)], '{"error":');
  check("12. CONTROL: sin foto se guarda como siempre", !r12.error, r12.error);

  // 13-14. Editing: a NEW photo whose file is gone is refused; the photo the
  // product ALREADY has is never checked -- not even with its file missing,
  // which is what makes this a control: a check on every save would block
  // editing the price of any product whose photo was lost for another reason.
  const { data: pEdit } = await svc.from("products").select("id").eq("owner_id", A).eq("name", `ZZ foto buena ${stamp}`).single();
  const accionEditar = await idDeLaAccion(BASE, `/productos/${pEdit.id}/editar`, "updateProduct", cookieA);
  if (!accionEditar) throw new Error("no encontré `updateProduct` en los chunks de la pantalla de editar");
  const r13 = await llamarAccion(BASE, `/productos/${pEdit.id}/editar`, accionEditar, cookieA, [pEdit.id, base(`ZZ foto buena ${stamp}`, F.fotoHuerfana)], '{"error":');
  const { data: p13 } = await svc.from("products").select("photo_path").eq("id", pEdit.id).single();
  check("13. editar con una foto NUEVA que ya no existe se rechaza, y la ficha conserva la suya", /ya no está disponible/.test(r13.error ?? "") && p13.photo_path === nueva, r13.error ?? JSON.stringify(p13));
  await svc.storage.from("product-photos").remove([nueva]);
  const r14 = await llamarAccion(BASE, `/productos/${pEdit.id}/editar`, accionEditar, cookieA, [pEdit.id, { ...base(`ZZ foto buena ${stamp}`, nueva), priceRetail: "12" }], '{"error":');
  const { data: p14 } = await svc.from("products").select("price_retail").eq("id", pEdit.id).single();
  check("14. CONTROL: con la foto que YA tenía se guarda sin comprobarla", !r14.error && Number(p14.price_retail) === 12, r14.error ?? JSON.stringify(p14));
} catch (e) {
  check("ERROR: la suite se detuvo", false, e instanceof Error ? e.message : String(e));
} finally {
  if (original) await ajustes({ enforce: original.enforce, min_age: original.min_age, scope_owner: original.scope_owner });
  const porBucket = {};
  for (const [b, p] of subidos) (porBucket[b] ??= []).push(p);
  for (const [b, ps] of Object.entries(porBucket)) {
    await svc.storage.from(b).remove(ps).catch(() => null);
    await svc.from("storage_cleanup_log").delete().eq("bucket_id", b).in("name", ps);
  }
  for (const id of usuarios) {
    await svc.from("products").delete().eq("owner_id", id);
    await svc.from("subscription_events").delete().eq("owner_id", id);
    await svc.from("subscriptions").delete().eq("owner_id", id);
    await svc.from("owners").delete().eq("id", id);
    await svc.auth.admin.deleteUser(id);
  }
  console.log(`\n${filas.filter(Boolean).length}/${filas.length} pasan.`);
  process.exit(filas.every(Boolean) ? 0 : 1);
}
