"use client";

import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatLedgerAmount, type LedgerDisplay } from "@/lib/exchange-rate/movement-display";
import { formatDocumentId } from "@/lib/format";
import {
  CLIENT_STATUS_BADGE_CLASS,
  CLIENT_STATUS_LABEL,
  MALA_PAGA_BADGE_CLASS,
  type ClientStatus,
} from "@/lib/types";

// Compact-card-only palette for the left status bar — the status itself is
// a CLIENT_STATUS_BADGE_CLASS chip, same as the table, and the bar now
// matches that chip's own color family (a pill's background color doesn't
// translate directly to a 3px stripe, so this is its own map, not a literal
// reuse of the chip classes) rather than diverging for dentro_del_plazo.
const CLIENT_STATUS_ACCENT_CLASS: Record<ClientStatus, string> = {
  sin_deuda: "bg-muted-foreground/30",
  a_favor: "bg-emerald-500",
  dentro_del_plazo: "bg-sky-500",
  plazo_vencido: "bg-amber-500",
  sin_plazo: "bg-amber-500",
  critico: "bg-red-500",
};

// The phone card used for a client wherever one is listed — Cartera, Clientes,
// Malas pagas and Papelera. Extracted from client-table.tsx so the four stay
// identical: the styling here is finely tuned (the name's min-width, the
// document's max-width, which element gives way when all three compete for one
// row) and a second copy of it would drift on the first change.
//
// The shell and the row are separate classes because the wrapper is the
// caller's. Clientes wraps this in a <button>; Papelera needs action buttons
// inside the same card, and a <button> inside a <button> is invalid HTML, so
// it uses a div and stacks this row above its own actions.
// TWO BOXES AND NOT ONE, from the Figma spec of 2026-10-04 (frame
// 1071:18173). The outer one carries the status colour and a radius of 10; the
// inner one is the white card, bordered on three sides. The inner's LEFT
// corners are rounder than the outer's: that is the whole point, because it is
// what makes the white curve away and let the colour show through as a tab,
// instead of a stripe sitting inside the card's padding.
//
// ─────────────────────────────────────────────────────────────────────────
// EL COLOR ES RELLENO Y 4px DE PADDING, NO `border-l-4`
//
// Era un borde de un solo lado hasta el 2026-10-08, y así se rompía la
// esquina. Un `border-left: 4px` junto a un `border-top: 0` **no puede**
// doblar el radio: CSS degrada el grosor en diagonal de 4 a 0, así que la
// franja termina en punta y por el hueco que deja se ve el fondo de la
// página. A tamaño real son dos muescas oscuras, una arriba y otra abajo, y
// es justo lo que se ve ampliado.
//
// Con relleno no hay transición de grosor que degradar: la franja es parte de
// una forma rellena y sus extremos siguen el radio de la caja, enteros.
//
// LAS ESQUINAS DERECHAS DE LA INTERNA VALEN 10, LAS IZQUIERDAS 14, y eso ya no
// es estética. Ahora que la externa está rellena de color, cualquier sitio
// donde la interna se curve más que ella deja ver color — y a la derecha no
// hay franja que enseñar, sería una medialuna de color donde no toca. A la
// derecha coinciden las dos y no se ve nada; a la izquierda la interna se
// curva más y enseña la pestaña, que es lo que se busca.
//
// It takes the status, so it is a function and not a constant. Both call sites
// already had `status` in scope.
export function clientCardShell(status: ClientStatus): string {
  return `group block w-full rounded-[10px] pl-1 text-left ${CLIENT_STATUS_ACCENT_CLASS[status]}`;
}

// `group-active` and not `active`: the pressed element is the caller's button,
// and CSS `:active` reaches ancestors, never descendants. On the inner box it
// would simply never fire.
export const CLIENT_CARD_INNER =
  "rounded-l-[14px] rounded-r-[10px] border-y border-r bg-background transition-colors group-active:bg-accent";

export const CLIENT_CARD_ROW = "flex items-center gap-1.5 px-4 py-2";

export function ClientCardBody({
  name,
  documentId,
  status,
  hasPendingReview = false,
  isFlagged,
  balance,
  balanceUsd,
  balanceEur,
  ledger,
  note,
}: {
  name: string;
  documentId: string | null;
  status: ClientStatus;
  hasPendingReview?: boolean;
  isFlagged: boolean;
  // A CO owner's debt is `balance` (COP); a VE owner's is the two independent
  // per-currency balances, which are never summed. `ledger` non-null is what
  // says which of the two this owner is.
  balance: number;
  balanceUsd: number;
  balanceEur: number;
  ledger: LedgerDisplay | null;
  // An extra muted line under the badges. Papelera puts the hiding date here;
  // the other three screens pass nothing.
  note?: React.ReactNode;
}) {
  const usd = formatLedgerAmount(balanceUsd, "USD", ledger);
  const eur = formatLedgerAmount(balanceEur, "EUR", ledger);
  const cop = formatLedgerAmount(balance, null, null);

  // ONE FIGURE, THE BIGGER ONE, from the spec of 2026-10-04 plus the owner's
  // call the same day. The card used to stack both ledgers; now the larger one
  // carries the row and the other is reduced to a mark.
  //
  // "Bigger" compares the raw amounts and does NOT convert to bolívares first,
  // which is the same rule the capital card uses — the two must agree or the
  // list and the total would foreground different currencies for the same
  // shop. Known limit: the two rates sit about 12% apart, so raw and converted
  // only disagree when the two debts are within that of each other, and what
  // changes then is which one goes first, never what is shown — both carry
  // their code and the mark says the other exists.
  const twoLedgers = ledger !== null && balanceUsd > 0 && balanceEur > 0;
  const bigger = ledger === null ? null : balanceUsd >= balanceEur ? "USD" : "EUR";
  const amount = ledger === null ? cop : bigger === "USD" ? usd : eur;

  return (
    <>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {/* Name, document and status on three lines, from the spec. They shared
            one row until 2026-10-04, which needed a tuned pecking order for who
            gave way when a long name, a real document and the "revisar" badge
            all competed for the same line. Stacking them removes the problem
            rather than balancing it. */}
        <span className="truncate text-lg font-medium text-foreground">{name}</span>
        <span className="truncate text-[13px] text-muted-foreground">
          {formatDocumentId(documentId)}
        </span>
        <div className="flex flex-wrap items-center gap-1">
          <Badge variant="outline" className={CLIENT_STATUS_BADGE_CLASS[status]}>
            {CLIENT_STATUS_LABEL[status]}
          </Badge>
          {isFlagged ? (
            <Badge variant="outline" className={MALA_PAGA_BADGE_CLASS}>
              Mala paga
            </Badge>
          ) : null}
          {hasPendingReview ? (
            <Badge variant="outline" className="text-[10px]">
              revisar
            </Badge>
          ) : null}
        </div>
        {note ? <p className="text-[11.5px] text-muted-foreground">{note}</p> : null}
      </div>

      <p className="flex shrink-0 items-baseline gap-1">
        <span className="text-xl text-foreground tabular-nums">{amount.primary}</span>
        {bigger ? (
          <span className="text-[11px] font-medium text-muted-foreground">{bigger}</span>
        ) : null}
        {/* THE MARK, when the client owes in both ledgers. Measured in dev on
            2026-10-04: 4 of the 45 clients with debt owe in two currencies, and
            one of them owes $102,22 next to €4.000 — with a single figure and
            no mark, those $102 would simply vanish from the list. It is not
            there to be read, it is there so the figure beside it does not look
            like the whole debt. */}
        {twoLedgers ? (
          <span className="text-[11px] font-medium text-muted-foreground">
            +<span className="sr-only">y también debe en la otra moneda</span>
          </span>
        ) : null}
      </p>

      <ChevronRight className="size-[15px] shrink-0 text-muted-foreground" aria-hidden="true" />
    </>
  );
}
