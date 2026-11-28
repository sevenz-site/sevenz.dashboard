// THE OWNER'S PROMOTION RULES (CT-184, migration 228): what a promotion may hold and which
// state it is in. Shared by the wizard (errors as he types), the server action (checks
// again: the browser is never trusted with what is published) and `qa/promociones.mjs`.
// The database holds the same limits as constraints and a trigger, so this is the friendly
// first line, not the only one.
//
// NO IMPORTS, on purpose: the QA suite loads this with Node's type stripping.

export const PROMO_NAME_MAX = 60;
export const PROMO_PERCENT_MAX = 90;

// ===========================================================================
// THE DISCOUNT CODE: OUT OF THIS RELEASE, AND WHAT WAS DECIDED BEFORE IT LEFT
//
// Owner's decision of 2026-11-28: «omitamos el código de descuento, eliminalo de este
// lanzamiento, más adelante lo retomamos, eliminalo de los frames y todo el app. Deja las
// decisiones documentadas hasta el momento para retomar la implementación desde esos
// comentarios». So the wizard has no «Código» step, nothing reads or writes a code, and the
// Figma frames for it (7, and 13 to 15 on the customer's side) were deleted. Resume from here.
//
// WHAT IS STILL IN THE DATABASE, unused: `promotions.code`, `code_percent`, `code_max_uses`
// (migration 228, with the check `promotions_code_shape`), the matching parameters of
// `save_promotion` (always sent null), and `has_code: false` in `get_shared_promotion`.
// Nothing was dropped, so resuming needs no migration to bring the columns back.
//
// DECIDED BY THE OWNER (2026-11-27 and 2026-11-28):
//   - Optional, one per promotion. Letters and digits, 3 to 20, no spaces, stored upper-case
//     and matched case-insensitively (the old check: /^[A-Z0-9]{3,20}$/).
//   - It gives an EXTRA % (1 to 90) taken off the order's total, after each product's own
//     discount («Descuento extra (activar este código es opcional)»).
//   - The customer types it in the order's last form, «¿Quién hace el pedido?», under the
//     address: «Código de descuento (opcional)» with «Aplicar», then «Quitar» once applied and
//     «BLACK25 aplicado: 10% menos en tu pedido.»; a bad one says «Ese código no existe o ya no
//     está vigente.». Below, «Productos con <promo>», «Código BLACK25 (10%) −$4,00», «Total».
//   - Optional limit of uses: a total number of orders. A use counts when the order is
//     RECEIVED; deleting or rejecting that order gives the use back.
//   - In the sale it is a separate line: «Código BLACK25 (10%) −$4,00» («Una línea aparte»),
//     and the sale of an order keeps the code («Sí, también el código»).
//   - A return refunds the line minus the code's %: of a $40 order at 10% ($36), returning a
//     $10 product gives back $9 («$9, con el 10%»).
//   - The owner's DIRECT sale (Nueva venta, fiado or contado) also shows the code field when a
//     code is active, and using it there counts as a use. This reverses «Solo catálogo» for the
//     code only; whether the products' promotion % also applies in a direct sale was NOT
//     decided.
//
// OPEN WHEN IT WAS DROPPED (asked, not answered):
//   - Does the code's % reduce products WITHOUT a promotion in the same order (the frame said
//     «Se resta del total del pedido»), or only the discounted ones?
//   - When the owner adds products or units while registering an order, do they get the code?
//     The owner's general rule (below) suggests not: «si un producto tiene descuento se
//     registra con descuento, sino tiene descuento se registra al precio que tiene».
//   - A frame for the code field in Nueva venta.
//   - Orders in two currencies: presumably one «Código» line per currency, never confirmed.
//   - The ~20 places that re-sum `sale_lines` (receipt, reports, cierre, WhatsApp weekly and
//     monthly rows, admin metrics, `get_shared_balance`) would all have to subtract it; and
//     `sales` is immutable after insert (`sales_guard_update`, migration 180), so the code must
//     be written with the sale or in a child table carrying the same guards.
// ===========================================================================

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
};

export type PromotionCheck = { ok: true } | { ok: false; field: string; error: string };

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

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
