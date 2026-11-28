"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { storageFileExists } from "@/lib/storage-file-exists";
import { mensajeDeError } from "@/lib/errores-legibles";
import {
  businessToday,
  checkPromotion,
  crosses,
  dayLabel,
  lastDay,
  normalizeCode,
  type PromotionInput,
} from "@/lib/promotions/rules";

// SAVES A PROMOTION (CT-184, migration 228), and ends one early.
//
// EVERYTHING IS DECIDED AGAIN HERE, never taken from the browser as it comes:
//   - the rules of `lib/promotions/rules.ts` (dates, %, one product per group, the code);
//   - EVERY product id must be the owner's own, read with `.eq("owner_id", user.id)` --
//     CLAUDE.md's explicit ownership check; the database's trigger is the second line;
//   - the banner must be a file in the owner's own folder of `logos`, like the cover;
//   - it must not cross another promotion (owner's decision: one at a time). Checked here to
//     say WHICH one and when; the database trigger refuses it anyway, under a lock.
//
// THE WRITE IS ONE CALL, `save_promotion`, which runs as the owner (RLS applies) and writes
// the header, its groups and their products in one transaction.

export type SavePromotionResult = { ok: true; id: string } | { ok: false; error: string; field?: string };

// The same rule as `isOwnPath` in personalizar/actions.ts.
function isOwnPath(ownerId: string, path: string): boolean {
  const prefix = `${ownerId}/`;
  if (!path.startsWith(prefix)) return false;
  const file = path.slice(prefix.length);
  return /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(file) && !file.includes("..");
}

const DB_ERRORS: Record<string, string> = {
  promocion_cruzada: "Se cruza con otra promoción. Solo puede haber una a la vez: elige otras fechas.",
  producto_ajeno: "Uno de los productos ya no está en tu catálogo. Revisa los grupos.",
  exclusion_sin_todos: "Solo se excluyen productos de «Todos los productos».",
  promocion_ajena: "Esa promoción ya no existe.",
  sin_grupos: "Agrega al menos un porcentaje.",
};

export async function savePromotion(raw: PromotionInput): Promise<SavePromotionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Tu sesión expiró. Vuelve a entrar." };

  const input: PromotionInput = {
    ...raw,
    name: (raw.name ?? "").trim(),
    code: raw.code ? normalizeCode(raw.code) : null,
    codePercent: raw.code ? raw.codePercent : null,
    codeMaxUses: raw.code ? raw.codeMaxUses : null,
    groups: (raw.groups ?? []).map((g) => ({
      percent: Number(g.percent),
      wholesalePercent: g.wholesalePercent == null ? null : Number(g.wholesalePercent),
      allProducts: Boolean(g.allProducts),
      productIds: [...new Set(g.productIds ?? [])],
    })),
  };
  const check = checkPromotion(input);
  if (!check.ok) return { ok: false, error: check.error, field: check.field };

  // Every product id, the owner's own.
  const ids = [...new Set(input.groups.flatMap((g) => g.productIds))];
  if (ids.length > 0) {
    const { data: own, error } = await supabase
      .from("products")
      .select("id")
      .eq("owner_id", user.id)
      .in("id", ids);
    if (error) return { ok: false, error: mensajeDeError("guardar la promoción", error, "promociones") };
    if ((own ?? []).length !== ids.length) {
      return { ok: false, error: DB_ERRORS.producto_ajeno, field: "groups" };
    }
  }

  // The banner, and the one it replaces.
  let previousBanner: string | null = null;
  if (input.id) {
    const { data: before, error } = await supabase
      .from("promotions")
      .select("banner_path")
      .eq("id", input.id)
      .eq("owner_id", user.id)
      .maybeSingle();
    if (error) return { ok: false, error: mensajeDeError("guardar la promoción", error, "promociones") };
    if (!before) return { ok: false, error: DB_ERRORS.promocion_ajena };
    previousBanner = (before.banner_path as string | null) ?? null;
  }
  if (input.bannerPath) {
    if (!isOwnPath(user.id, input.bannerPath)) return { ok: false, error: "El banner no es válido. Vuelve a subirlo.", field: "banner" };
    if (input.bannerPath !== previousBanner && !(await storageFileExists("logos", input.bannerPath))) {
      return { ok: false, error: "El banner que subiste ya no está disponible. Vuelve a subirlo.", field: "banner" };
    }
  }

  // One at a time: name the one it crosses.
  const { data: owner } = await supabase.from("owners").select("country").eq("id", user.id).single();
  const country = (owner?.country as string | null) ?? null;
  const { data: others, error: othersError } = await supabase
    .from("promotions")
    .select("id, name, starts_on, ends_on, extended_until, ended_at")
    .eq("owner_id", user.id);
  if (othersError) return { ok: false, error: mensajeDeError("guardar la promoción", othersError, "promociones") };
  const mine = { startsOn: input.startsOn, last: input.extendedUntil ?? input.endsOn };
  for (const o of others ?? []) {
    if (o.id === input.id) continue;
    // The business's day it was ended on, not the UTC one.
    const endedOn = o.ended_at ? businessToday(country, new Date(o.ended_at)) : null;
    const last = lastDay({ endsOn: o.ends_on, extendedUntil: o.extended_until, endedOn });
    if (crosses(mine, { startsOn: o.starts_on, last })) {
      return {
        ok: false,
        field: "dates",
        error: `Se cruza con «${o.name}», del ${dayLabel(o.starts_on)} al ${dayLabel(last)}. Solo puede haber una promoción a la vez: elige otras fechas.`,
      };
    }
  }

  const { data: id, error } = await supabase.rpc("save_promotion", {
    p_id: input.id ?? null,
    p_name: input.name,
    p_banner_path: input.bannerPath,
    p_starts_on: input.startsOn,
    p_ends_on: input.endsOn,
    p_extended_until: input.extendedUntil,
    // Ignored since migration 230 (the wholesale price is always discounted); still sent because
    // it is in the function's signature.
    p_includes_wholesale: true,
    p_code: input.code,
    p_code_percent: input.codePercent,
    p_code_max_uses: input.codeMaxUses,
    p_groups: input.groups.map((g) => ({
      percent: g.percent,
      wholesale_percent: g.wholesalePercent,
      all_products: g.allProducts,
      include: g.allProducts ? [] : g.productIds,
      exclude: g.allProducts ? g.productIds : [],
    })),
  });
  if (error) {
    const known = Object.keys(DB_ERRORS).find((k) => error.message.includes(k));
    if (known) return { ok: false, error: DB_ERRORS[known] };
    return { ok: false, error: mensajeDeError("guardar la promoción", error, "promociones") };
  }

  // The replaced banner's file, only after the new value is saved. Not the owner's problem
  // if it fails: the nightly cleanup takes it a week later.
  if (previousBanner && previousBanner !== input.bannerPath && isOwnPath(user.id, previousBanner)) {
    const { error: removeError } = await supabase.storage.from("logos").remove([previousBanner]);
    if (removeError) console.error("savePromotion: remove old banner", removeError);
  }

  // "layout": the list AND every page under it (detail, edit). The bare path refreshed only
  // the list, and the detail kept saying «Activa» after «Terminar ahora» (QA of 2026-11-28).
  revalidatePath("/productos/promociones", "layout");
  return { ok: true, id: id as string };
}

// «Terminar ahora» (frame 9): the promotion stops at this moment. Orders already received
// keep their prices; new ones are at list price.
export async function endPromotion(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Tu sesión expiró. Vuelve a entrar." };
  const { data, error } = await supabase
    .from("promotions")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", id)
    .eq("owner_id", user.id)
    .is("ended_at", null)
    .select("id");
  if (error) return { ok: false, error: mensajeDeError("terminar la promoción", error, "promociones") };
  if (!data || data.length === 0) return { ok: false, error: "Esa promoción ya había terminado." };
  // "layout": the list AND every page under it (detail, edit). The bare path refreshed only
  // the list, and the detail kept saying «Activa» after «Terminar ahora» (QA of 2026-11-28).
  revalidatePath("/productos/promociones", "layout");
  return { ok: true };
}
