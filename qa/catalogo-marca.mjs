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
//   8. MIGRATION 225, the WhatsApp button and the extra link: the link rule on the pure
//      function (the label must match the host, no shorteners, no WhatsApp links), the
//      database's constraints, what get_shared_catalog returns, and the real action
//      saving a good link and refusing a disguised one without writing anything.
//
// Needs migrations 210, 211 and 225 in the database it points at. Writes only in dev, on the QA owner,
// and puts his branding back as it found it.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolveBrandColor } from "../lib/catalog/brand-color.ts";
import { checkDescription, checkWelcome } from "../lib/catalog/welcome.ts";
import { catalogWhatsappHref, checkExtraLink } from "../lib/catalog/extra-link.ts";
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

const COLUMNAS =
  "brand_color, catalog_cover_path, catalog_welcome, brand_description, catalog_show_address, address, catalog_show_whatsapp, catalog_link_kind, catalog_link_url";
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

  // ── 2'. The brand description (211): private, 500, line breaks, no links ──
  const d = (t) => JSON.stringify(checkDescription(t));
  check(
    "2e. la descripción conserva los párrafos y recorta los huecos",
    d(`  Vendemos víveres.${"\n".repeat(4)}Atendemos  a todo el barrio.  `) ===
      JSON.stringify({ ok: true, text: `Vendemos víveres.${"\n".repeat(2)}Atendemos a todo el barrio.` }),
    d(`  Vendemos víveres.${"\n".repeat(4)}Atendemos  a todo el barrio.  `),
  );
  check("2f. la descripción: 501 se rechazan, 500 pasan, y sin enlaces", !checkDescription("a".repeat(501)).ok && checkDescription("a".repeat(500)).ok && !checkDescription("Visita tienda.com").ok);

  // ── 8a-8f. The extra link (225), on the pure function ───────────────────
  const l = (k, u) => checkExtraLink(k, u);
  check("8a. un Instagram de verdad pasa, con o sin www.", l("instagram", "https://instagram.com/minichino").ok && l("instagram", "https://www.instagram.com/minichino/").ok);
  check(
    "8b. «Instagram» que lleva a otro sitio se rechaza, también disfrazado",
    l("instagram", "https://facebook.com/x").reason === "link_wrong_network" &&
      l("instagram", "https://instagram.com.evil.net/x").reason === "link_wrong_network" &&
      l("instagram", "https://evilinstagram.com/x").reason === "link_wrong_network" &&
      l("instagram", "https://instagram.com@evil.net/x").reason === "link_invalid",
  );
  check("8c. acortadores y enlaces de WhatsApp se rechazan en cualquier tipo", l("website", "https://bit.ly/x").reason === "link_shortener" && l("website", "https://wa.me/584121234567").reason === "link_whatsapp");
  check("8d. sin https:// o sin tipo se rechaza", l("website", "http://tienda.com").reason === "link_not_https" && l("website", "tienda.com").reason === "link_not_https" && l(null, "https://tienda.com").reason === "link_kind_missing");
  check("8e. CONTROL: un sitio web cualquiera con https pasa, y vacío es «sin enlace»", l("website", "https://linktr.ee/minichino").ok && JSON.stringify(l("instagram", "  ")) === JSON.stringify({ ok: true, kind: null, url: null }));
  check(
    "8f. WhatsApp abre con el saludo y solo dígitos; sin número no hay botón",
    catalogWhatsappHref("+58 412-123 4567") === "https://wa.me/584121234567?text=Hola%2C%20vi%20tu%20cat%C3%A1logo%20y%20quiero%20hacerte%20una%20consulta." &&
      catalogWhatsappHref(null) === null &&
      catalogWhatsappHref("sin número") === null,
  );

  // ── 3. As the owner ────────────────────────────────────────────────────
  if (!env.QA_OWNER_EMAIL) throw new Error("falta QA_OWNER_EMAIL en .env.local");
  ({ data: dueno } = await admin.from("owners").select("id").eq("email", env.QA_OWNER_EMAIL).single());
  const { data: otro } = await admin.from("owners").select("id, brand_color").neq("id", dueno.id).limit(1).single();
  ({ data: antes } = await admin.from("owners").select(COLUMNAS).eq("id", dueno.id).single());
  if (!antes) throw new Error("no pude leer la marca del dueño de QA: ¿corrieron las migraciones 210, 211 y 225 en dev?");
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
  const { error: eDesc } = await admin.from("owners").update({ brand_description: "a".repeat(501) }).eq("id", dueno.id);
  check("4c. la base rechaza una descripción de más de 500", Boolean(eDesc), eDesc?.message ?? "¿corrió la 211 en dev?");

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
  // The description is the owner's private text (211, «no lo ve el cliente»): with one
  // saved, nothing the customer receives may carry it.
  await admin.from("owners").update({ brand_description: "ZZ QA descripción privada" }).eq("id", dueno.id);
  const { data: conDesc } = await publico.rpc("get_shared_catalog", { p_token: enlace.token });
  check("5e. la descripción de la marca NO viaja al cliente", conDesc && !JSON.stringify(conDesc).includes("ZZ QA descripción privada") && !("brand_description" in conDesc));

  // ── 8g-8j. Migration 225 in the database and in what the customer receives ──
  const { error: eTipo } = await admin.from("owners").update({ catalog_link_kind: "whatsapp", catalog_link_url: "https://x.com" }).eq("id", dueno.id);
  const { error: eHttp } = await admin.from("owners").update({ catalog_link_kind: "website", catalog_link_url: "http://x.com" }).eq("id", dueno.id);
  const { error: eSuelto } = await admin.from("owners").update({ catalog_link_kind: "website", catalog_link_url: null }).eq("id", dueno.id);
  check("8g. la base rechaza un tipo que no existe, un http:// y un tipo sin enlace", Boolean(eTipo && eHttp && eSuelto), [eTipo?.message, eHttp?.message, eSuelto?.message].join(" | "));
  check("8h. la casilla de WhatsApp nace apagada (lo que tenía el dueño de QA antes de la suite)", antes.catalog_show_whatsapp === false, String(antes.catalog_show_whatsapp));
  const { error: e8i } = await yo
    .from("owners")
    .update({ catalog_show_whatsapp: true, catalog_link_kind: "instagram", catalog_link_url: "https://instagram.com/zzqa" })
    .eq("id", dueno.id);
  const { data: conBotones } = await publico.rpc("get_shared_catalog", { p_token: enlace.token });
  check(
    "8i. el dueño los guarda con su sesión y el cliente los recibe",
    !e8i && conBotones?.catalog_show_whatsapp === true && conBotones?.catalog_link_kind === "instagram" && conBotones?.catalog_link_url === "https://instagram.com/zzqa",
    e8i?.message ?? JSON.stringify({ w: conBotones?.catalog_show_whatsapp, k: conBotones?.catalog_link_kind }),
  );
  await admin.from("owners").update({ catalog_show_whatsapp: false, catalog_link_kind: null, catalog_link_url: null }).eq("id", dueno.id);
  const { data: sinBotones } = await publico.rpc("get_shared_catalog", { p_token: enlace.token });
  check("8j. CONTROL: apagados, el cliente recibe «false» y ningún enlace", sinBotones?.catalog_show_whatsapp === false && sinBotones?.catalog_link_url === null && sinBotones?.catalog_link_kind === null);

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
    const DESC = ["Víveres del barrio.", "Abrimos temprano."].join(String.fromCharCode(10));
    const r7a = await llamarAccion(BASE, "/productos/personalizar", accion, cookie, [
      { brandColor: "#1E88E5", coverPath: cover, welcome: "Abrimos de lunes a sábado.", description: DESC, showAddress: false },
    ]);
    const { data: tras7a } = await admin.from("owners").select(COLUMNAS).eq("id", dueno.id).single();
    // Since 2026-11-15 the colour is registered and NOT applied (frame `2163:955`), so it is
    // stored as picked: until that day this checked the adjusted #3092E7.
    check("7a. la acción guarda el azul tal como se eligió, #1E88E5", r7a.ok === true && tras7a.brand_color === "#1E88E5", JSON.stringify(r7a));
    check("7c. la acción guarda la descripción con su salto de línea", tras7a.brand_description === DESC, JSON.stringify(tras7a.brand_description));
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
    const r7d = await llamarAccion(
      BASE,
      "/productos/personalizar",
      accion,
      cookie,
      [{ brandColor: "#1E88E5", coverPath: cover, welcome: "", description: "Compra en www.tienda.com", showAddress: false }],
      '{"ok":',
    );
    const { data: tras7d } = await admin.from("owners").select("brand_description").eq("id", dueno.id).single();
    check("7d. la acción rechaza una descripción con enlace, y no guarda nada", r7d.ok === false && tras7d.brand_description === DESC, r7d.error);

    // ── 8k-8m. Migration 225 through the real action ─────────────────────
    const base = { brandColor: "#1E88E5", coverPath: cover, welcome: "", description: DESC };
    const r8k = await llamarAccion(BASE, "/productos/personalizar", accion, cookie, [
      { ...base, showWhatsapp: false, linkKind: "tiktok", linkUrl: "https://www.tiktok.com/@zzqa" },
    ]);
    const { data: tras8k } = await admin.from("owners").select(COLUMNAS).eq("id", dueno.id).single();
    check("8k. la acción guarda un TikTok de verdad", r8k.ok === true && tras8k.catalog_link_kind === "tiktok" && tras8k.catalog_link_url === "https://www.tiktok.com/@zzqa", JSON.stringify(r8k));
    const r8l = await llamarAccion(
      BASE,
      "/productos/personalizar",
      accion,
      cookie,
      [{ ...base, showWhatsapp: false, linkKind: "instagram", linkUrl: "https://bit.ly/zzqa" }],
      '{"ok":',
    );
    const { data: tras8l } = await admin.from("owners").select("catalog_link_kind, catalog_link_url").eq("id", dueno.id).single();
    check("8l. la acción rechaza un «Instagram» acortado, y no guarda nada", r8l.ok === false && tras8l.catalog_link_url === "https://www.tiktok.com/@zzqa", r8l.error);
    // An older open tab sends none of the new keys: what the owner saved must survive it.
    const r8m = await llamarAccion(BASE, "/productos/personalizar", accion, cookie, [{ ...base }]);
    const { data: tras8m } = await admin.from("owners").select("catalog_link_url").eq("id", dueno.id).single();
    check("8m. una pestaña vieja que no manda los campos nuevos no borra el enlace", r8m.ok === true && tras8m.catalog_link_url === "https://www.tiktok.com/@zzqa", JSON.stringify(r8m));
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
        brand_description: antes.brand_description,
        catalog_show_address: antes.catalog_show_address,
        address: antes.address,
        catalog_show_whatsapp: antes.catalog_show_whatsapp,
        catalog_link_kind: antes.catalog_link_kind,
        catalog_link_url: antes.catalog_link_url,
      })
      .eq("id", dueno.id);
    if (error) console.error("NO PUDE DEVOLVER la marca del dueño de QA:", error.message);
  }
  if (subidos.length) await admin.storage.from("logos").remove(subidos);
}

const fallos = filas.filter((f) => !f.pasa).length;
console.log(`\n${filas.length - fallos}/${filas.length} pasan.`);
process.exit(fallos ? 1 : 0);
