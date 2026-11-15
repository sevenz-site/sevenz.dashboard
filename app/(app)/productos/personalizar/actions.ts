"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { resolveBrandColor } from "@/lib/catalog/brand-color";
import { checkWelcome } from "@/lib/catalog/welcome";
import { storageFileExists } from "@/lib/storage-file-exists";
import { mensajeDeError } from "@/lib/errores-legibles";
import { trackServer } from "@/lib/mixpanel-server";
import type { EventProps } from "@/lib/analytics/events";
import { WELCOME_MAX } from "@/lib/catalog/welcome";

// SAVES «PERSONALIZAR CATÁLOGO» (CT-170, phase 1, frames `2115:21868` and `2115:21966`).
//
// EVERYTHING IS DECIDED AGAIN HERE, never taken from the browser as it comes:
//   - the colour goes through `resolveBrandColor`, so what is stored is always a colour
//     that carries readable text, whatever the form sent («ajustarlo y avisar»);
//   - the welcome message through `checkWelcome`: 140 characters, no links;
//   - the cover must be a file in the owner's OWN folder of `logos`, the same rule as the
//     logo (finding 10 of the 2026-11-02 audit: an owner pointing at another business's
//     file), and, when new, a file that still exists (the nightly cleanup, `DM-12`).
//
// THE ROW IS THE OWNER'S, AND THE WRITE SAYS SO: `.eq("id", user.id)` on his session
// client. RLS («owners update own row») is the second line, not the only one (CLAUDE.md,
// «Explicit ownership checks in server actions»).
//
// The address itself is not written here: it belongs to «Mi negocio». This screen only
// decides whether the catalogue shows it.
//
// ── THE EVENTS: «Catalog Customized» and «Catalog Customization Rejected» ─────────────
//
// Approved by the owner on 2026-11-15 («sí al evento»). The question they answer is the
// one under CT-170 itself, *«Como dueño de negocio quiero customizar mi catálogo en función
// de mi marca, información de negocio y productos»*: DOES ANY OWNER ACTUALLY DO IT, AND
// WHICH PART? Phases 2 (sections) and 3 (templates) are the expensive ones; if owners set a
// colour and stop there, they wait, and if covers and welcomes are what gets used, they
// lead. The rejections say whether the screen itself is in the way (a link refused, a
// cover lost), which the success count alone cannot tell from «not interested».
//
// Filed under the OWNER, sent from the server after the write (the browser may not
// cooperate: CLAUDE.md's iPhone rule). Yes / no per part, the length of the welcome and the
// list of parts that changed -- never the colour, the text or the address.

export type CatalogBrandingInput = {
  // `#RRGGBB` as picked, or null / "" for no brand colour (the catalogue as before).
  brandColor: string | null;
  // A path in `logos` under the owner's folder, or null for no cover.
  coverPath: string | null;
  welcome: string;
  showAddress: boolean;
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
  let colorAdjusted = false;
  if (input.brandColor && input.brandColor.trim()) {
    const resolved = resolveBrandColor(input.brandColor);
    if (!resolved) return rechazar("invalid_color", "Ese color no es válido. Elígelo de nuevo.");
    brandColor = resolved.applied;
    colorAdjusted = resolved.adjusted;
  }

  const welcome = checkWelcome(input.welcome);
  if (!welcome.ok) {
    const tooLong = [...(input.welcome ?? "").replace(/\s+/g, " ").trim()].length > WELCOME_MAX;
    return rechazar(tooLong ? "welcome_too_long" : "welcome_has_link", welcome.error);
  }

  const coverPath = input.coverPath && input.coverPath.trim() ? input.coverPath.trim() : null;
  if (coverPath && !isOwnPath(user.id, coverPath)) {
    return rechazar("invalid_cover", "La portada no es válida. Vuelve a subirla.");
  }

  const { data: before, error: readError } = await supabase
    .from("owners")
    .select("brand_color, catalog_cover_path, catalog_welcome, catalog_show_address")
    .eq("id", user.id)
    .single();
  if (readError) {
    return rechazar("db_error", mensajeDeError("guardar tu catálogo", readError, "profile"));
  }

  const previousCover = (before?.catalog_cover_path as string | null) ?? null;
  if (coverPath && coverPath !== previousCover && !(await storageFileExists("logos", coverPath))) {
    return rechazar("cover_gone", "La portada que subiste ya no está disponible. Vuelve a subirla y guarda de nuevo.");
  }

  const { error } = await supabase
    .from("owners")
    .update({
      brand_color: brandColor,
      catalog_cover_path: coverPath,
      catalog_welcome: welcome.text,
      catalog_show_address: Boolean(input.showAddress),
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
    Boolean(before?.catalog_show_address) !== Boolean(input.showAddress) && "show_address",
  ].filter((x): x is string => Boolean(x));
  trackServer(
    "Catalog Customized",
    user.id,
    {
      has_color: Boolean(brandColor),
      color_adjusted: colorAdjusted,
      has_cover: Boolean(coverPath),
      has_welcome: Boolean(welcome.text),
      welcome_length: welcome.text ? [...welcome.text].length : 0,
      show_address: Boolean(input.showAddress),
      changed,
    },
    user.email,
  );
  return { ok: true, appliedColor: brandColor };
}
