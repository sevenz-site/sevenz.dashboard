"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { normalizeHex } from "@/lib/catalog/brand-color";
import { DESCRIPTION_MAX, checkDescription, checkWelcome, normalizeDescription } from "@/lib/catalog/welcome";
import { storageFileExists } from "@/lib/storage-file-exists";
import { mensajeDeError } from "@/lib/errores-legibles";
import { trackServer } from "@/lib/mixpanel-server";
import type { EventProps } from "@/lib/analytics/events";
import { WELCOME_MAX } from "@/lib/catalog/welcome";
import { checkExtraLink } from "@/lib/catalog/extra-link";

// SAVES «PERSONALIZAR CATÁLOGO» (CT-170, phase 1, frames `2115:21868` and `2115:21966`).
//
// EVERYTHING IS DECIDED AGAIN HERE, never taken from the browser as it comes:
//   - the colour is only checked to be `#RRGGBB` and stored AS PICKED: since 2026-11-15
//     (frame `2163:955`) it is «registrado, no se aplica», so moving it for contrast would
//     only overwrite the owner's real brand colour. Until that day this stored the adjusted
//     colour (`resolveBrandColor`, «ajustarlo y avisar»);
//   - the welcome message through `checkWelcome`: 140 characters, no links;
//   - the brand description through `checkDescription`: 500 characters, line breaks, no
//     links, private to the owner (migration 211);
//   - the cover must be a file in the owner's OWN folder of `logos`, the same rule as the
//     logo (finding 10 of the 2026-11-02 audit: an owner pointing at another business's
//     file), and, when new, a file that still exists (the nightly cleanup, `DM-12`).
//
// THE ROW IS THE OWNER'S, AND THE WRITE SAYS SO: `.eq("id", user.id)` on his session
// client. RLS («owners update own row») is the second line, not the only one (CLAUDE.md,
// «Explicit ownership checks in server actions»).
//
// The address is not written here: it belongs to «Mi negocio». Since 2026-11-18 neither is
// whether the catalogue shows it -- that box moved under the address, at the owner's request,
// and `updateBusinessSettings` saves it. A tab opened before that may still send
// `showAddress`; it is ignored, so saving from it changes nothing about the address.
//
// ── THE EVENTS: «Catalog Customized» and «Catalog Customization Rejected» ─────────────
//
// Approved by the owner on 2026-11-15 («sí al evento»). The question they answer is the
// one under CT-170 itself, *«Como dueño de negocio quiero customizar mi catálogo en función
// de mi marca, información de negocio y productos»*: DOES ANY OWNER ACTUALLY DO IT, AND
// WHICH PART? Phases 2 (sections) and 3 (templates) are the expensive ones; if owners use
// the cover and the welcome and stop there, they wait. Since 2026-11-15 the colour is stored
// and not applied, and the brand description (private) exists to feed the marketing content
// the owner plans to generate: how many write one says whether that has material. The rejections say whether the screen itself is in the way (a link refused, a
// cover lost), which the success count alone cannot tell from «not interested».
//
// Filed under the OWNER, sent from the server after the write (the browser may not
// cooperate: CLAUDE.md's iPhone rule). Yes / no per part, the length of the welcome and the
// list of parts that changed -- never the colour, a text or the address.

export type CatalogBrandingInput = {
  // `#RRGGBB` as picked, or null / "" for no brand colour (the catalogue as before).
  brandColor: string | null;
  // A path in `logos` under the owner's folder, or null for no cover.
  coverPath: string | null;
  welcome: string;
  // Private: never in the catalogue (211). Optional so an older open tab still saves.
  description?: string;
  // Ignored since 2026-11-18: the box is saved from Mi negocio. Kept so an older tab still saves.
  showAddress?: boolean;
  // Migration 225. Optional: a tab opened before them sends none, and then the saved values
  // are kept as they are instead of being switched off by a form that never showed them.
  showWhatsapp?: boolean;
  linkKind?: string | null;
  linkUrl?: string | null;
};

type RejectReason = EventProps["Catalog Customization Rejected"]["reason"];

export type CatalogBrandingResult =
  | { ok: true; appliedColor: string | null }
  | { ok: false; error: string };

// Same rule as `isOwnLogoPath` in `app/(app)/profile/actions.ts`: one file-name segment
// from a closed set of characters, so `<id>/../<other>/x.jpg` cannot pass.
function isOwnPath(ownerId: string, path: string): boolean {
  const prefix = `${ownerId}/`;
  if (!path.startsWith(prefix)) return false;
  const file = path.slice(prefix.length);
  return /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(file) && !file.includes("..");
}

export async function saveCatalogBranding(input: CatalogBrandingInput): Promise<CatalogBrandingResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    trackServer("Catalog Customization Rejected", "anonymous-catalog-branding", { reason: "no_session" });
    return { ok: false, error: "Tu sesión expiró. Vuelve a entrar." };
  }
  const rechazar = (reason: RejectReason, error: string): CatalogBrandingResult => {
    trackServer("Catalog Customization Rejected", user.id, { reason }, user.email);
    return { ok: false, error };
  };

  let brandColor: string | null = null;
  if (input.brandColor && input.brandColor.trim()) {
    brandColor = normalizeHex(input.brandColor);
    if (!brandColor) return rechazar("invalid_color", "Ese color no es válido. Elígelo de nuevo.");
  }

  const welcome = checkWelcome(input.welcome);
  if (!welcome.ok) {
    const tooLong = [...(input.welcome ?? "").replace(/\s+/g, " ").trim()].length > WELCOME_MAX;
    return rechazar(tooLong ? "welcome_too_long" : "welcome_has_link", welcome.error);
  }

  const description = checkDescription(input.description);
  if (!description.ok) {
    const tooLong = [...normalizeDescription(input.description)].length > DESCRIPTION_MAX;
    return rechazar(tooLong ? "description_too_long" : "description_has_link", description.error);
  }

  const coverPath = input.coverPath && input.coverPath.trim() ? input.coverPath.trim() : null;
  if (coverPath && !isOwnPath(user.id, coverPath)) {
    return rechazar("invalid_cover", "La portada no es válida. Vuelve a subirla.");
  }

  // Migration 225: the extra link, through the same rule the screen and the page use.
  const sendsContact = input.showWhatsapp !== undefined || input.linkUrl !== undefined;
  const link = checkExtraLink(input.linkKind, input.linkUrl);
  if (!link.ok) return rechazar(link.reason, link.error);

  const { data: before, error: readError } = await supabase
    .from("owners")
    .select(
      sendsContact
        ? "brand_color, catalog_cover_path, catalog_welcome, brand_description, catalog_show_address, whatsapp, catalog_show_whatsapp, catalog_link_kind, catalog_link_url"
        : "brand_color, catalog_cover_path, catalog_welcome, brand_description, catalog_show_address",
    )
    .eq("id", user.id)
    .single<{
      brand_color: string | null;
      catalog_cover_path: string | null;
      catalog_welcome: string | null;
      brand_description: string | null;
      catalog_show_address: boolean | null;
      whatsapp?: string | null;
      catalog_show_whatsapp?: boolean | null;
      catalog_link_kind?: string | null;
      catalog_link_url?: string | null;
    }>();
  if (readError) {
    return rechazar("db_error", mensajeDeError("guardar tu catálogo", readError, "profile"));
  }

  const previousCover = (before?.catalog_cover_path as string | null) ?? null;
  if (coverPath && coverPath !== previousCover && !(await storageFileExists("logos", coverPath))) {
    return rechazar("cover_gone", "La portada que subiste ya no está disponible. Vuelve a subirla y guarda de nuevo.");
  }

  // The box can only be ON with a number to open: an owner with no WhatsApp in Mi negocio
  // would publish a button that goes nowhere. The screen disables it; this is the second line.
  const showWhatsapp = Boolean(input.showWhatsapp);
  if (sendsContact && showWhatsapp && !(before?.whatsapp ?? "").replace(/\D/g, "")) {
    return rechazar("whatsapp_missing", "Agrega tu número de WhatsApp en Mi negocio para mostrar el botón.");
  }

  const { error } = await supabase
    .from("owners")
    .update({
      brand_color: brandColor,
      catalog_cover_path: coverPath,
      catalog_welcome: welcome.text,
      brand_description: description.text,
      ...(sendsContact
        ? { catalog_show_whatsapp: showWhatsapp, catalog_link_kind: link.kind, catalog_link_url: link.url }
        : {}),
    })
    .eq("id", user.id);
  if (error) {
    return rechazar("db_error", mensajeDeError("guardar tu catálogo", error, "profile"));
  }

  // The replaced cover's file, only after the new value is saved, and only if it was in
  // the owner's own folder. Not his problem if it fails: at worst a file stays, and the
  // nightly cleanup takes it a week later.
  if (previousCover && previousCover !== coverPath && isOwnPath(user.id, previousCover)) {
    const { error: removeError } = await supabase.storage.from("logos").remove([previousCover]);
    if (removeError) console.error("saveCatalogBranding: remove old cover", removeError);
  }

  revalidatePath("/productos/personalizar");

  // After the write, and it cannot undo it: `trackServer` swallows its own failures.
  const changed = [
    (before?.brand_color ?? null) !== brandColor && "color",
    previousCover !== coverPath && "cover",
    (before?.catalog_welcome ?? null) !== welcome.text && "welcome",
    (before?.brand_description ?? null) !== description.text && "description",
    sendsContact && Boolean(before?.catalog_show_whatsapp) !== showWhatsapp && "whatsapp",
    sendsContact &&
      ((before?.catalog_link_url ?? null) !== link.url || (before?.catalog_link_kind ?? null) !== link.kind) &&
      "link",
  ].filter((x): x is string => Boolean(x));
  trackServer(
    "Catalog Customized",
    user.id,
    {
      has_color: Boolean(brandColor),
      has_cover: Boolean(coverPath),
      has_welcome: Boolean(welcome.text),
      welcome_length: welcome.text ? [...welcome.text].length : 0,
      has_description: Boolean(description.text),
      description_length: description.text ? [...description.text].length : 0,
      // The saved value, read from the row: since 2026-11-18 this screen no longer sets it.
      show_address: Boolean(before?.catalog_show_address),
      // Migration 225 (2026-11-26). The kind, never the URL: which networks owners point
      // at says whether the list of four is the right one.
      show_whatsapp: sendsContact ? showWhatsapp : Boolean(before?.catalog_show_whatsapp),
      link_kind: sendsContact ? link.kind : null,
      changed,
    },
    user.email,
  );
  return { ok: true, appliedColor: brandColor };
}
