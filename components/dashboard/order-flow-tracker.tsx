"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { track } from "@/lib/mixpanel";
import { newFlowId, readFlow, writeFlow } from "@/lib/analytics/flow-client";

export const orderFlowKey = (orderId: string) => `sevenz:flujo:pedido:${orderId}`;

// THE ORDER REGISTRATION FUNNEL. Owner's request of 2026-11-04: *«pedidos registrados
// y sus eventos para el funnel para registrar un pedido»*. Four screens with a draft
// that dies after two hours, so which one people stop on decides what to shorten.
//
// ONE PLACE FOR ALL THE STEPS: this sits in the layout and reads the route, so a new
// step is measured without touching this file's callers. It counts screens reached,
// and a funnel reads the drop between them. Going back and forward counts each visit
// once per path, not per render. Gestures, so a floor; what was saved is `Order
// Currency Registered`, on the server, joined by this `flow_id`. Filed under the owner.
export function OrderFlowTracker({ orderId }: { orderId: string }) {
  const pathname = usePathname();
  const last = useRef<string | null>(null);

  useEffect(() => {
    if (last.current === pathname) return;
    last.current = pathname;

    const key = orderFlowKey(orderId);
    let flow = readFlow(key);
    if (!flow) {
      flow = { id: newFlowId() };
      writeFlow(key, flow);
      track("Order Registration Started", { flow_id: flow.id, order_id: orderId });
    }

    const step = pathname.endsWith("/confirmar")
      ? "confirm"
      : pathname.endsWith("/pago")
        ? "payment"
        : pathname.endsWith("/cliente")
          ? "client"
          : pathname.endsWith("/registrar")
            ? "blocks"
            : null;
    if (step) track("Order Step Viewed", { flow_id: flow.id, order_id: orderId, step });
  }, [pathname, orderId]);

  return null;
}
