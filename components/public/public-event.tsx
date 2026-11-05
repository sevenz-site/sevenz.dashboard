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
export function CatalogOpenedEvent({ token }: { token: string }) {
  let fromBalance = false;
  try {
    fromBalance = typeof window !== "undefined" && Boolean(sessionStorage.getItem(CLAVE_VOLVER_AL_SALDO));
  } catch {
    // Blocked storage: it counts as a direct visit.
  }
  return <PublicEventOnMount token={token} code="catalog_opened" props={{ from_balance: fromBalance }} />;
}
