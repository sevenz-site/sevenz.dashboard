"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { track } from "@/lib/mixpanel";

// DO PEOPLE OPEN THE DETAIL OF A TRANSACTION? Owner's request of 2026-11-04: *«Apertura
// del detalle de transacción»*. It decides how much that screen deserves.
//
// ONE PLACE FOR EVERY DOOR. A row of the history, a search result, a card inside a split
// and the screen after a return all land here, so counting at the arrival cannot miss
// one the way counting at each tap would. What that costs: it cannot say which door.
// A gesture, so a floor. Filed under the owner.
export function TransactionDetailTracker() {
  const pathname = usePathname();
  const last = useRef<string | null>(null);

  useEffect(() => {
    if (last.current === pathname) return;
    last.current = pathname;
    track("Transaction Detail Opened", { kind: pathname.includes("/venta/") ? "cash_sale" : "movement" });
  }, [pathname]);

  return null;
}
