import { formatCantidad } from "@/lib/products/cantidad";
import { stockState } from "@/lib/products/availability";
import { CLIENT_STATUS_BADGE_CLASS } from "@/lib/types";
import { cn } from "@/lib/utils";

// ═══════════════════════════════════════════════════════════════════════
// THE «Disponible: N» CHIP, FOR BOTH SIDES OF THE APP
//
// Eight screens drew this by hand before 2026-10-29 — the product page, the
// product sheet, the three Reportes sheets, the order line sheet, the two
// order-registration steps, the customer's catalogue card and the customer's
// product page — each with the palette classes copied into the markup.
//
// Copying them is how `chip-de-estado.tsx` ended up painting «Plazo vencido»
// red while the rest of the app painted it amber: every copy was correct on
// its own and the set had stopped agreeing. Its header tells that story. So
// this one IMPORTS `CLIENT_STATUS_BADGE_CLASS` instead of restating it, and
// the day that palette moves, eight screens move with it.
//
// ───────────────────────────────────────────────────────────────────────
// THE CUSTOMER SEES THE FIGURE ONLY WHEN STOCK IS LOW
//
// This is the one place where the two audiences genuinely differ, and the
// difference is a decision, not an implementation detail.
//
// On 2026-10-15 the owner decided his customers never see a count: *«dice si
// hay o no hay, nunca cuánto»*. That decision fixed a real contradiction — the
// catalogue card said «No disponible» while the product page said «Disponible:
// 0» to a customer deciding whether to order.
//
// On 2026-10-29 he deliberately reopened it, told what it reversed, and chose
// to show the figure. SCOPED TO THE AMBER STATE: scarcity is what a figure
// buys the customer, and above the threshold the 2026-10-15 rule still holds,
// so a stranger with the link still cannot read the whole inventory.
//
// AND THE FIGURE IS NOT A PROMISE. Nobody maintains these counts reliably
// (`CT-59`), and the customer's screens still never block on them — ordering
// more than the count says is allowed, and only warned about. A customer who
// reads «Disponible: 2» and gets told later there was one is the cost that
// came with this choice.
//
// ───────────────────────────────────────────────────────────────────────
// WHY AN UNCOUNTED PRODUCT RENDERS NOTHING BY DEFAULT
//
// `product-detail.tsx` already made this call and its reason stands: a chip
// reading «Disponible: —» informs nobody and takes the place of something that
// would. Reportes is the exception and asks for `showUncounted`, because there
// the whole point of the sheet is telling the shopkeeper WHICH products he
// never counted.
// ═══════════════════════════════════════════════════════════════════════

// The shape, shared by every state. Lifted verbatim from the six owner-side
// copies so this swap changes colour and wording, never geometry.
//
// `whitespace-nowrap` is not decoration: «Sin cantidad anotada» wraps inside
// the pill in a narrow column and a split pill reads as a broken screen, not
// as long text. Same lesson as `chip-de-estado.tsx`.
const BASE =
  "inline-flex w-fit shrink-0 items-center whitespace-nowrap rounded-full border px-1.5 py-px text-xs leading-4";

export function StockBadge({
  quantity,
  threshold,
  audience = "owner",
  showUncounted = false,
  className,
}: {
  /** `products.stock_opening`. NULL means nobody counts this product. */
  quantity: number | null;
  /** `owners.low_stock_threshold`. Zero means "don't alert me". */
  threshold: number;
  /** `"customer"` hides the figure except when stock is low — see the header. */
  audience?: "owner" | "customer";
  /** Reportes passes true: naming the uncounted products is that sheet's job. */
  showUncounted?: boolean;
  className?: string;
}) {
  const state = stockState(quantity, threshold);
  const paraCliente = audience === "customer";

  // The customer's wording is NOT the owner's. «Agotado» is stock language a
  // shopkeeper uses about his own shelf; a customer is told whether he can buy
  // it. The two have said it differently since 2026-10-15 and that stays.
  const { estilo, texto } = (() => {
    switch (state) {
      case "uncounted":
        return paraCliente
          ? { estilo: CLIENT_STATUS_BADGE_CLASS.a_favor, texto: "Disponible" }
          : { estilo: CLIENT_STATUS_BADGE_CLASS.sin_deuda, texto: "Sin cantidad anotada" };
      case "out":
        return {
          estilo: CLIENT_STATUS_BADGE_CLASS.critico,
          texto: paraCliente ? "No disponible" : "Agotado",
        };
      case "low":
        // THE ONLY STATE WHERE BOTH SIDES READ THE SAME, figure included.
        // `plazo_vencido` is the amber of the badge the owner pointed at.
        return {
          estilo: CLIENT_STATUS_BADGE_CLASS.plazo_vencido,
          texto: `Disponible: ${formatCantidad(quantity as number)}`,
        };
      case "in_stock":
        return paraCliente
          ? { estilo: CLIENT_STATUS_BADGE_CLASS.a_favor, texto: "Disponible" }
          : {
              estilo: CLIENT_STATUS_BADGE_CLASS.a_favor,
              texto: `Disponible: ${formatCantidad(quantity as number)}`,
            };
    }
  })();

  // The owner's screens hide an uncounted product's chip; the customer's have
  // always drawn a plain «Disponible» for it, so `showUncounted` does not gate
  // that side.
  if (state === "uncounted" && !paraCliente && !showUncounted) return null;

  return <span className={cn(BASE, estilo, className)}>{texto}</span>;
}
