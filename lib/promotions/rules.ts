// THE OWNER'S PROMOTION RULES (CT-184, migration 228): what a promotion may hold and which
// state it is in. Shared by the wizard (errors as he types), the server action (checks
// again: the browser is never trusted with what is published) and `qa/promociones.mjs`.
// The database holds the same limits as constraints and a trigger, so this is the friendly
// first line, not the only one.
//
// NO IMPORTS, on purpose: the QA suite loads this with Node's type stripping.

export const PROMO_NAME_MAX = 60;
export const PROMO_PERCENT_MAX = 90;
export const PROMO_CODE_RE = /^[A-Z0-9]{3,20}$/;

export type PromotionGroupInput = {
  percent: number;
  allProducts: boolean;
  // Chosen products (allProducts false) or excluded ones (allProducts true).
  productIds: string[];
  // The % for the wholesale price (migration 230, owner's decision of 2026-11-28): null = the
  // same as `percent`, 0 = the wholesale price is not discounted.
  wholesalePercent: number | null;
};

export type PromotionInput = {
  id?: string | null;
  name: string;
  bannerPath: string | null;
  startsOn: string; // YYYY-MM-DD, the business's day
  endsOn: string;
  extendedUntil: string | null;
  groups: PromotionGroupInput[];
  code: string | null;
  codePercent: number | null;
  codeMaxUses: number | null;
};

export type PromotionCheck = { ok: true } | { ok: false; field: string; error: string };

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeCode(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\s+/g, "").toUpperCase();
}

export function checkPromotion(p: PromotionInput): PromotionCheck {
  const name = (p.name ?? "").trim();
  if (!name) return { ok: false, field: "name", error: "Ponle un nombre a la promoción." };
  if ([...name].length > PROMO_NAME_MAX) {
    return { ok: false, field: "name", error: `El nombre puede tener hasta ${PROMO_NAME_MAX} caracteres.` };
  }
  if (!ISO_DAY.test(p.startsOn) || !ISO_DAY.test(p.endsOn)) {
    return { ok: false, field: "dates", error: "Elige la fecha de inicio y la de cierre." };
  }
  if (p.endsOn < p.startsOn) {
    return { ok: false, field: "dates", error: "La fecha de cierre no puede ser antes de la de inicio." };
  }
  if (p.extendedUntil != null) {
    if (!ISO_DAY.test(p.extendedUntil)) return { ok: false, field: "extended", error: "Elige la fecha extendida." };
    if (p.extendedUntil <= p.endsOn) {
      return { ok: false, field: "extended", error: "La fecha extendida tiene que ser después del cierre." };
    }
  }
  if (p.groups.length === 0) {
    return { ok: false, field: "groups", error: "Agrega al menos un porcentaje." };
  }
  if (p.groups.filter((g) => g.allProducts).length > 1) {
    return { ok: false, field: "groups", error: "Solo un porcentaje puede ir a «Todos los productos»." };
  }
  const seen = new Set<string>();
  for (const g of p.groups) {
    if (!(g.percent > 0) || g.percent > PROMO_PERCENT_MAX || Math.round(g.percent * 100) !== g.percent * 100) {
      return { ok: false, field: "groups", error: `Cada porcentaje va de 1 a ${PROMO_PERCENT_MAX}.` };
    }
    if (g.wholesalePercent != null) {
      const w = g.wholesalePercent;
      if (!(w >= 0) || w > PROMO_PERCENT_MAX || Math.round(w * 100) !== w * 100) {
        return { ok: false, field: "groups", error: `El porcentaje al mayor va de 0 a ${PROMO_PERCENT_MAX}.` };
      }
    }
    if (!g.allProducts) {
      if (g.productIds.length === 0) {
        return { ok: false, field: "groups", error: `Elige los productos del ${g.percent}%.` };
      }
      for (const id of g.productIds) {
        if (seen.has(id)) {
          return { ok: false, field: "groups", error: "Un producto solo puede estar en un grupo." };
        }
        seen.add(id);
      }
    }
  }
  if (p.code != null) {
    if (!PROMO_CODE_RE.test(p.code)) {
      return { ok: false, field: "code", error: "El código lleva de 3 a 20 letras o números, sin espacios." };
    }
    if (p.codePercent == null || !(p.codePercent > 0) || p.codePercent > PROMO_PERCENT_MAX) {
      return { ok: false, field: "code", error: `El descuento extra va de 1 a ${PROMO_PERCENT_MAX}%.` };
    }
    if (p.codeMaxUses != null && !(Number.isInteger(p.codeMaxUses) && p.codeMaxUses >= 1)) {
      return { ok: false, field: "code", error: "El máximo de pedidos tiene que ser un número entero, 1 o más." };
    }
  }
  return { ok: true };
}

export type PromotionStatus = "scheduled" | "active" | "extended" | "ended";

export const STATUS_LABEL: Record<PromotionStatus, string> = {
  scheduled: "Programada",
  active: "Activa",
  extended: "Extendida",
  ended: "Terminada",
};

// The same rule as `promotion_last_day` in SQL: the extension if any, cut short by
// «Terminar ahora» (the day it was ended no longer counts).
export function lastDay(p: { endsOn: string; extendedUntil: string | null; endedOn: string | null }): string {
  const planned = p.extendedUntil ?? p.endsOn;
  if (!p.endedOn) return planned;
  const prev = addDays(p.endedOn, -1);
  return prev < planned ? prev : planned;
}

export function promotionStatus(
  p: { startsOn: string; endsOn: string; extendedUntil: string | null; endedOn: string | null },
  today: string,
): PromotionStatus {
  const last = lastDay(p);
  if (last < today || last < p.startsOn) return "ended";
  if (today < p.startsOn) return "scheduled";
  if (today > p.endsOn) return "extended";
  return "active";
}

// Two promotions cross when their days touch (owner's decision: one at a time).
export function crosses(
  a: { startsOn: string; last: string },
  b: { startsOn: string; last: string },
): boolean {
  if (a.last < a.startsOn || b.last < b.startsOn) return false;
  return a.startsOn <= b.last && b.startsOn <= a.last;
}

export function addDays(isoDay: string, n: number): string {
  const [y, m, d] = isoDay.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

// The business's day today, in its own time zone (`zonaDelNegocio`'s rule).
export function businessToday(country: string | null | undefined, now: Date = new Date()): string {
  const tz = country === "VE" ? "America/Caracas" : "America/Bogota";
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

// «28 nov – 30 nov 2026», the frames' way of writing a range.
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export function dayLabel(isoDay: string, withYear = false): string {
  const [y, m, d] = isoDay.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}${withYear ? ` ${y}` : ""}`;
}
export function rangeLabel(startsOn: string, endsOn: string): string {
  return `${dayLabel(startsOn)} – ${dayLabel(endsOn, true)}`;
}

// «1 producto», «3 productos», «1 excluido». Written once because the wizard, the detail and
// the list all count products, and «1 excluidos» had slipped into three of them.
export function countOf(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

// How a group reads in the summary and the detail (frames 8 and 9, approved 2026-11-28):
// «20% al detal y al mayor: 125 productos (3 excluidos)», «40% al detal y 30% al mayor: 12
// productos». A wholesale % of 0 reads «sin rebaja al mayor» -- not in the frames, which never
// drew that case; the wording is ours.
export function groupLine(
  g: { percent: number; wholesalePercent: number | null; allProducts: boolean; productIds: string[] },
  covered: number,
): string {
  const w = g.wholesalePercent;
  const pcts =
    w == null || w === g.percent
      ? `${g.percent}% al detal y al mayor`
      : w === 0
        ? `${g.percent}% al detal, sin rebaja al mayor`
        : `${g.percent}% al detal y ${w}% al mayor`;
  const excluded = g.allProducts && g.productIds.length ? ` (${countOf(g.productIds.length, "excluido", "excluidos")})` : "";
  return `${pcts}: ${countOf(covered, "producto", "productos")}${excluded}`;
}

// The products a group really covers: a chosen group its own list; «all» every product not
// chosen in another group, minus its exclusions. One rule for the wizard and the detail.
export function coveredIds<G extends { allProducts: boolean; productIds: string[] }>(
  groups: readonly G[],
  index: number,
  allProductIds: readonly string[],
): string[] {
  const g = groups[index];
  if (!g.allProducts) return g.productIds.filter((id) => allProductIds.includes(id));
  const elsewhere = new Set(groups.filter((o, i) => i !== index && !o.allProducts).flatMap((o) => o.productIds));
  return allProductIds.filter((id) => !elsewhere.has(id) && !g.productIds.includes(id));
}
