import type { ComponentProps } from "react";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { ChipDeEstado } from "@/components/dashboard/chip-de-estado";

// THE BIG TOTAL ROW AT THE FOOT OF A TRANSACTION'S SUMMARY: a 16 semibold label
// on the left, the figure on the right with its bolivars under it and the
// book's flag beside it, separated from what is above by a line.
//
// One component since 2026-11-03, when the owner asked for it in two more
// places at once — «Total» under a fiado's products and «Total por cobrar» in
// an abono, «con la misma UI que en el detalle del fiado». It was written by
// hand three times already (the fiado's «Total por cobrar» and the «Total» of
// the cash-sale detail, owner's and client's), and CLAUDE.md's rule is that a
// visual value shown in two screens or more is born in a component: copied, the
// copies drift apart without anything saying so.
//
// The decision of WHICH figure goes here stays with each screen. This only
// draws it.

type Moneda = ComponentProps<typeof CurrencyFlagIcon>["currency"];

export function FilaDeTotal({
  rotulo,
  cifra,
  bolivares = null,
  moneda = null,
  tono = "neutro",
  aFavor = false,
}: {
  rotulo: string;
  /** Already formatted, in the book's currency. */
  cifra: string;
  /** The bolivars line, with its qualifier («… hoy», «… al día del pago»). */
  bolivares?: string | null;
  moneda?: Moneda | null;
  /** «debe» paints the figure red, «a_favor» green, «neutro» leaves it ink. */
  tono?: "debe" | "a_favor" | "neutro";
  /** A credit balance is written without a minus and explained by the «A
   *  favor» chip under the bolivars (owner's rule of 2026-10-23). */
  aFavor?: boolean;
}) {
  const color = tono === "debe" ? "text-destructive" : tono === "a_favor" ? "text-money-in" : "";
  return (
    <div className="flex items-center justify-between gap-4 border-t pt-3">
      <span className="text-base font-semibold">{rotulo}</span>
      <span className="flex items-center gap-2">
        <span className="flex flex-col items-end">
          <span className={`text-base font-semibold tabular-nums ${color}`}>{cifra}</span>
          {bolivares ? <span className="text-xs text-muted-foreground tabular-nums">{bolivares}</span> : null}
          {aFavor ? (
            <span className="pt-0.5">
              <ChipDeEstado estado="a_favor" />
            </span>
          ) : null}
        </span>
        {moneda ? <CurrencyFlagIcon currency={moneda} className="size-4 shrink-0" /> : null}
      </span>
    </div>
  );
}
