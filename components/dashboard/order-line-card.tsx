import type { ReactNode } from "react";

// ONE LINE OF `1/3 Confirmar pedido`, AS A SHAPE — frame `1652:12831`, and
// since 2026-11-19 the added-product cards of section `2210:22223`.
//
// It was written inline in the page until that day. Two kinds of card now share
// it -- the line the customer ordered, drawn by the server, and the product the
// shopkeeper added, drawn by the browser from the draft -- and the frames draw
// them identically except for «Cantidad del pedido». Two copies of these classes
// would drift the first time somebody retouched one, which is the repo's rule
// about a visual value that appears in more than one place.
//
// PURE LAYOUT, no hooks, so both a server page and a client component can mount
// it. Every slot is optional; what fills them decides the card's behaviour.
export function OrderLineCard({
  nombre,
  chip,
  aviso,
  cantidad,
  stepper,
  importe,
  children,
}: {
  nombre: ReactNode;
  /** The stock chip next to the name. */
  chip?: ReactNode;
  /** A red line under the name (the product left the catalogue). */
  aviso?: ReactNode;
  /** «Cantidad del pedido: N». Absent on an added product: nobody ordered it. */
  cantidad?: ReactNode;
  /** «−» and «+», in their own row under the name. */
  stepper?: ReactNode;
  /** The amount and its flag, on the right. */
  importe: ReactNode;
  /** What goes under the top row: the customer's comment, «Cambiar». */
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{nombre}</p>
            {chip}
          </div>
          {aviso}
          {cantidad}
          {stepper ? <div className="pt-2">{stepper}</div> : null}
        </div>
        {importe}
      </div>
      {children}
    </div>
  );
}
