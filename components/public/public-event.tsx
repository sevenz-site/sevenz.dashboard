"use client";

import { forwardRef, useEffect, useRef, type ComponentProps } from "react";
import Link from "next/link";
import type { PublicEventCode } from "@/lib/analytics/public-events";
import { CLAVE_VOLVER_AL_SALDO } from "@/components/public/back-to-balance";

// `track()` does not work here: it needs a session. Everything on `/s` and `/c`
// goes through `/api/public-event`, which decides what an event is. See that route.
//
// Fired from the browser and never while the server renders, so link previews and
// crawlers are not counted as people. On iOS it can still be lost: the numbers are
// a floor, not a count.
export function sendPublicEvent(token: string, code: PublicEventCode, props?: Record<string, unknown>) {
  try {
    void fetch("/api/public-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, code, props }),
      // Survives the tap that also navigates away.
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Analytics never reaches the client's screen.
  }
}

// ONCE PER TAB SESSION AND PER THING, not per render: reloading a balance is not
// opening it again. `sessionStorage` can refuse, and then the ref still stops a
// double send while the page lives.
export function PublicEventOnMount({
  token,
  code,
  props,
  onceKey = "",
}: {
  token: string;
  code: PublicEventCode;
  props?: Record<string, unknown>;
  onceKey?: string;
}) {
  const sent = useRef(false);
  const payload = useRef(props);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    const key = `sevenz:evento:${code}:${token}:${onceKey}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      // Private mode or blocked storage: send it anyway.
    }
    sendPublicEvent(token, code, payload.current);
  }, [token, code, onceKey]);

  return null;
}

// A plain link that says it was tapped, for server-rendered pages.
export const PublicEventLink = forwardRef<
  HTMLAnchorElement,
  ComponentProps<typeof Link> & { token: string; code: PublicEventCode }
>(function PublicEventLink({ token, code, onClick, ...rest }, ref) {
  return (
    <Link
      ref={ref}
      {...rest}
      onClick={(event) => {
        sendPublicEvent(token, code);
        onClick?.(event);
      }}
    />
  );
});

// `from_balance` says whether the visit came from the client's own balance link,
// which only the tab knows: `catalog-strip.tsx` leaves this mark when tapped.
function cameFromBalance(): boolean {
  try {
    return typeof window !== "undefined" && Boolean(sessionStorage.getItem(CLAVE_VOLVER_AL_SALDO));
  } catch {
    // Blocked storage: it counts as a direct visit.
    return false;
  }
}

export function CatalogOpenedEvent({ token }: { token: string }) {
  return <PublicEventOnMount token={token} code="catalog_opened" props={{ from_balance: cameFromBalance() }} />;
}

// THE PRODUCT CARRIES `from_balance` TOO, since 2026-11-05: a card on the balance
// now lands here without passing through the index, so `Catalog Link Opened` never
// fires for that visit. Without this property those clients would look like people
// who opened a shared product link.
//
// «¿Cuántos clientes que entran desde su saldo agregan un producto?» decides whether
// the strip earns its place on the balance. The mark lasts the whole tab, so it means
// "this visit started on the balance", the same as on `Catalog Link Opened`.
export function CatalogProductOpenedEvent({ token, productId }: { token: string; productId: string }) {
  return (
    <PublicEventOnMount
      token={token}
      code="catalog_product_opened"
      onceKey={productId}
      props={{ product_id: productId, from_balance: cameFromBalance() }}
    />
  );
}
