"use client";

import type { ReactNode } from "react";
import { track } from "@/lib/mixpanel";

// «¿El dueño le escribe a quien hizo el pedido?» Planned in the event workbook on
// 2026-11-04 and built at the owner's request of 2026-11-05. If almost nobody taps it, orders
// are being closed without a conversation and the order screen already says enough; if
// almost everyone does, the order is missing something they have to go and ask.
//
// In its own client component because the order page renders on the server and a tap does
// not exist there. A gesture, so the number is a floor. Filed under the owner.
export function OrderContactLink({
  orderId,
  href,
  className,
  children,
}: {
  orderId: string;
  href: string;
  className: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      onClick={() => track("Order Customer Contacted", { order_id: orderId })}
    >
      {children}
    </a>
  );
}
