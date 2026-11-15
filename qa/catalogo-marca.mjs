// qa:catalogo-marca -- the catalogue's branding (CT-170, phase 1, migration 210).
//
//   1. THE COLOUR RULE, on the pure function: the figures measured on 2026-11-12 and
//      written in the item -- #FF0000 -> #C20000 (4.56:1), #1E88E5 -> #3092E7 (4.55:1),
//      #E7F701 untouched with #272727 (12.59:1), #043F01 untouched with #DADADA (8.75:1).
//   2. THE WELCOME RULE: 140 characters, no links, one paragraph.
//   3. AS THE OWNER, with his own session (CLAUDE.md: a suite on a table the owner writes
//      needs one check that runs as him): he can write his branding and cannot touch
//      another business's row.
//   4. THE DATABASE refuses a colour that is not #RRGGBB and a message over 140.
//   5. WHAT THE CUSTOMER RECEIVES, anonymously: the brand in get_shared_catalog, the
//      address ONLY when the owner ticked it; and that the draft's get_catalog_brand is gone.
//   6. THE NIGHTLY CLEANUP keeps a file that is a catalogue cover and still offers one
//      that is not -- the second half is the control: without it, «keep everything»
//      would pass.
//   7. THE REAL SERVER ACTION, over HTTP (needs `npm run dev`): it adjusts #1E88E5 to
//      #3092E7 before storing it, and refuses a welcome message with a link.
//
// Needs migration 210 in the database it points at. Writes only in dev, on the QA owner,
// and puts his branding back as it found it.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolveBrandColor } from "../lib/catalog/brand-color.ts";
import { checkWelcome } from "../lib/catalog/welcome.ts";
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
  process.exit(1);
}

const BASE = process.env.QA_BASE_URL ?? "http://localhost:3000";
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = () =>
  createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

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

const COLUMNAS = "brand_color, catalog_cover_path, catalog_welcome, catalog_show_address, address";
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
let dueno = null;
let antes = null;
const subidos = [];

try {
  // ── 1. The colour ──────────────────────────────────────────────────────
  const caso = (hex) => {
    const r = resolveBrandColor(hex);
    return r ? `${r.applied} ${r.text} ${r.contrast.toFixed(2)}${r.adjusted ? " ajustado" : ""}` : "null";
  };
  check("1a. el rojo #FF0000 se ajusta a #C20000, texto claro, 4,56:1", caso("#FF0000") === "#C20000 #DADADA 4.56 ajustado", caso("#FF0000"));
  check("1b. el azul #1E88E5 se ajusta a #3092E7, texto oscuro, 4,55:1", caso("#1E88E5") === "#3092E7 #272727 4.55 ajustado", caso("#1E88E5"));
  check("1c. CONTROL: el amarillo #E7F701 no se toca, texto oscuro, 12,59:1", caso("#E7F701") === "#E7F701 #272727 12.59", caso("#E7F701"));
  check("1d. CONTROL: el verde #043F01 no se toca, texto claro, 8,75:1", caso("#043F01") === "#043F01 #DADADA 8.75", caso("#043F01"));
  check("1e. lo que no es un color no se acepta", caso("rojo") === "null" && caso("red;background:url(x)") === "null", caso("rojo"));

  // ── 2. The welcome message ─────────────────────────────────────────────
  const w = (t) => JSON.stringify(checkWelcome(t));
  check("2a. un saludo normal pasa, en un solo párrafo", w("  Abrimos\n\nde lunes a sábado  ") === JSON.stringify({ ok: true, text: "Abrimos de lunes a sábado" }), w("  Abrimos\n\nde lunes a sábado  "));
  check("2b. con un enlace se rechaza", !checkWelcome("Paga en https://x.io").ok && !checkWelcome("www.tienda.com").ok && !checkWelcome("tienda.ve").ok);
  check("2c. CONTROL: «Sr.Pérez» y «etc.lunes» no son enlaces", checkWelcome("Sr.Pérez atiende, etc.lunes").ok);
  check("2d. 141 caracteres se rechazan y 140 pasan", !checkWelcome("a".repeat(141)).ok && checkWelcome("a".repeat(140)).ok);

  // ── 3. As the owner ────────────────────────────────────────────────────
  if (!env.QA_OWNER_EMAIL) throw new Error("falta QA_OWNER_EMAIL en .env.local");
  ({ data: dueno } = await admin.from("owners").select("id").eq("email", env.QA_OWNER_EMAIL).single());
  const { data: otro } = await admin.from("owners").select("id, brand_color").neq("id", dueno.id).limit(1).single();
  ({ data: antes } = await admin.from("owners").select(COLUMNAS).eq("id", dueno.id).single());
  if (!antes) throw new Error("no pude leer la marca del dueño de QA: ¿corrió la migración 210 en dev?");
  const { data: enlace } = await admin.from("catalog_share_links").select("token").eq("owner_id", dueno.id).single();
  if (!enlace) throw new Error("el dueño de QA no tiene enlace de catálogo");

  const yo = await comoDueno(env.QA_OWNER_EMAIL);
  const cover = `${dueno.id}/cover-zz-qa-${Date.now()}.jpg`;
  await admin.storage.from("logos").upload(cover, JPG, { contentType: "image/jpeg", upsert: true });
  subidos.push(cover);

  const { error: eYo } = await yo
    .from("owners")
    .update({ brand_color: "#043F01", catalog_cover_path: cover, catalog_welcome: "ZZ QA bienvenida", catalog_show_address: false, address: "ZZ QA Calle 1" })
    .eq("id", dueno.id);
  const { data: leido } = await yo.from("owners").select(COLUMNAS).eq("id", dueno.id).single();
  check("3a. el dueño guarda su marca con su propia sesión", !eYo && leido?.brand_color === "#043F01" && leido?.catalog_cover_path === cover, eYo?.message);

  const { data: tocadas } = await yo.from("owners").update({ brand_color: "#FF00FF" }).eq("id", otro.id).select("id");
  const { data: otroDespues } = await admin.from("owners").select("brand_color").eq("id", otro.id).single();
  check("3b. no puede tocar la marca de otro negocio", (tocadas ?? []).length === 0 && otroDespues.brand_color === otro.brand_color);

  // ── 4. The database ────────────────────────────────────────────────────
  const { error: eFormato } = await admin.from("owners").update({ brand_color: "red" }).eq("id", dueno.id);
  const { error: eLargo } = await admin.from("owners").update({ catalog_welcome: "a".repeat(141) }).eq("id", dueno.id);
  check("4a. la base rechaza un color que no es #RRGGBB", Boolean(eFormato), eFormato?.message);
  check("4b. la base rechaza un mensaje de más de 140", Boolean(eLargo), eLargo?.message);

  // ── 5. What the customer receives ──────────────────────────────────────
  const publico = anon();
  const { data: sinDir } = await publico.rpc("get_shared_catalog", { p_token: enlace.token });
  check(
    "5a. el catálogo trae el color, la portada y la bienvenida",
    sinDir?.brand_color === "#043F01" && sinDir?.catalog_cover_path === cover && sinDir?.catalog_welcome === "ZZ QA bienvenida",
  );
  check("5b. sin la casilla, la dirección NO viaja", sinDir?.catalog_address === null, String(sinDir?.catalog_address));
  await admin.from("owners").update({ catalog_show_address: true }).eq("id", dueno.id);
  const { data: conDir } = await publico.rpc("get_shared_catalog", { p_token: enlace.token });
  check("5c. CONTROL: con la casilla, la dirección viaja", conDir?.catalog_address === "ZZ QA Calle 1", String(conDir?.catalog_address));
  // get_catalog_brand existed in a draft of 210 and is dropped by it (the buttons stayed
  // black): if it still answers, 210 has not been re-run in this database.
  const { error: eQuitada } = await publico.rpc("get_catalog_brand", { p_token: enlace.token });
  check("5d. la función get_catalog_brand ya no existe", Boolean(eQuitada), eQuitada?.code ?? "TODAVÍA EXISTE: vuelve a correr la 210");

  // ── 6. The nightly cleanup ─────────────────────────────────────────────
  const suelta = `${dueno.id}/cover-zz-qa-suelta-${Date.now()}.jpg`;
  await admin.storage.from("logos").upload(suelta, JPG, { contentType: "image/jpeg", upsert: true });
  subidos.push(suelta);
  const { data: siguen } = await admin.rpc("storage_orphan_recheck", { p_bucket: "logos", p_names: [cover, suelta] });
  const sobran = (siguen ?? []).map((r) => (typeof r === "string" ? r : Object.values(r)[0]));
  check("6a. la limpieza no da por abandonada una portada en uso", !sobran.includes(cover), JSON.stringify(sobran));
  check("6b. CONTROL: una portada que nadie usa sí sale como abandonada", sobran.includes(suelta));

  // ── 7. The real server action ──────────────────────────────────────────
  const cookie = await cookieDeDueno(env, dueno.id);
  const accion = await idDeLaAccion(BASE, "/productos/personalizar", "saveCatalogBranding", cookie).catch(() => null);
  if (!accion) {
    check("7. la acción de verdad", false, `no encontré saveCatalogBranding en ${BASE}: esta sección necesita \`npm run dev\``);
  } else {
    const r7a = await llamarAccion(BASE, "/productos/personalizar", accion, cookie, [
      { brandColor: "#1E88E5", coverPath: cover, welcome: "Abrimos de lunes a sábado.", showAddress: false },
    ]);
    const { data: tras7a } = await admin.from("owners").select(COLUMNAS).eq("id", dueno.id).single();
    check("7a. la acción guarda el azul ya ajustado, #3092E7", r7a.ok === true && tras7a.brand_color === "#3092E7", JSON.stringify(r7a));
    const r7b = await llamarAccion(
      BASE,
      "/productos/personalizar",
      accion,
      cookie,
      [{ brandColor: "#1E88E5", coverPath: cover, welcome: "Paga en https://x.io", showAddress: false }],
      '{"ok":',
    );
    const { data: tras7b } = await admin.from("owners").select("catalog_welcome").eq("id", dueno.id).single();
    check("7b. la acción rechaza una bienvenida con enlace, y no guarda nada", r7b.ok === false && tras7b.catalog_welcome === "Abrimos de lunes a sábado.", r7b.error);
  }
} catch (error) {
  check("la suite terminó", false, error instanceof Error ? error.message : String(error));
} finally {
  if (dueno && antes) {
    const { error } = await admin
      .from("owners")
      .update({
        brand_color: antes.brand_color,
        catalog_cover_path: antes.catalog_cover_path,
        catalog_welcome: antes.catalog_welcome,
        catalog_show_address: antes.catalog_show_address,
        address: antes.address,
      })
      .eq("id", dueno.id);
    if (error) console.error("NO PUDE DEVOLVER la marca del dueño de QA:", error.message);
  }
  if (subidos.length) await admin.storage.from("logos").remove(subidos);
}

const fallos = filas.filter((f) => !f.pasa).length;
console.log(`\n${filas.length - fallos}/${filas.length} pasan.`);
process.exit(fallos ? 1 : 0);
