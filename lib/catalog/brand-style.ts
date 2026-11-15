import type { CSSProperties } from "react";
import { normalizeHex, textOn } from "@/lib/catalog/brand-color";

// THE BRAND COLOUR AS TWO CSS VARIABLES, set on the catalogue page and read by what takes
// the colour (CT-170): the header band and the selected category chip. The customer's
// buttons stay black: they took the colour for a few hours on 2026-11-15 («También los
// botones»), and the owner took it back the same day, «mantengamos los botones en negro
// como ya están».
//
//   --catalog-brand             the background
//   --catalog-brand-foreground  the text on it, #272727 or #DADADA, whichever reads
//
// WHY VARIABLES AND NOT A PROP: `CategoryChips` is shared with the owner's own screens (his
// catalogue and the sale). It reads the variable with today's colour as the fallback, so
// outside a customer's catalogue nothing is set and nothing changes.
//
// WHY THE TEXT COLOUR IS DECIDED HERE AGAIN, from the stored colour: the stored colour was
// already adjusted when saved, so this always finds one that passes; computing it from the
// colour, rather than storing it, means the two can never disagree.
//
// Returns undefined when there is no brand colour: the page keeps its own colours.
export function brandCssVars(color: string | null | undefined): CSSProperties | undefined {
  const hex = normalizeHex(color);
  if (!hex) return undefined;
  const text = textOn(hex);
  if (!text) return undefined;
  return { "--catalog-brand": hex, "--catalog-brand-foreground": text } as CSSProperties;
}

// Class fragments, so every piece writes the fallback the same way. Tailwind reads these
// strings from this file, so they must stay whole literals.
//
// THE `color:` HINT IS NOT DECORATION: without it `tailwind-merge` cannot tell that an
// arbitrary background built from a variable is a colour, keeps the button's own
// `bg-primary` as well, and which one wins is down to the order of the generated CSS.
//
// AND NO CLASS IS EVER WRITTEN WITH «...» IN A COMMENT: Tailwind reads comments too, and
// on 2026-11-15 a shortened class in this one generated a rule the CSS parser refused,
// which took the stylesheet of the whole app down in dev.
export const BRAND_BG = "bg-[color:var(--catalog-brand,var(--primary))]";
export const BRAND_TEXT = "text-[color:var(--catalog-brand-foreground,var(--primary-foreground))]";
export const BRAND_BORDER = "border-[color:var(--catalog-brand,var(--primary))]";
