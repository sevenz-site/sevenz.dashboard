import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// THE DISCOUNTED PRICE AND ITS «−X%» CHIP (CT-184, frames `2300:21627`, 10 to 16), shared by
// the catalogue grid, the product page and the cart so the three cannot drift (CLAUDE.md, a
// visual value in two screens is born in a component). The figures are decided by
// `lib/promotions/pricing.ts`; this only draws them.
//
// The chip is DARK (#272727 on white text), not the brand orange: the orange does not go as
// text on white (DESIGN-SYSTEM.md), and red is reserved for «Crítico».

export function PromoChip({ percent, className }: { percent: number; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full bg-[#272727] px-2 py-0.5 text-xs leading-4 font-medium text-white tabular-nums",
        className,
      )}
    >
      −{formatPct(percent)}%
    </span>
  );
}

// The new price as `children` (already formatted, with its flag if the screen uses one) and
// the old one struck through after it. Without `before`, only the price.
export function PromoPrice({
  children,
  before,
  className,
  beforeClassName,
}: {
  children: ReactNode;
  before?: string | null;
  className?: string;
  beforeClassName?: string;
}) {
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-1.5", className)}>
      {children}
      {before ? (
        <s className={cn("text-xs font-normal text-muted-foreground tabular-nums", beforeClassName)}>
          <span className="sr-only">Antes </span>
          {before}
        </s>
      ) : null}
    </span>
  );
}

function formatPct(p: number): string {
  return Number.isInteger(p) ? String(p) : p.toFixed(2).replace(".", ",").replace(/,?0+$/, "");
}
