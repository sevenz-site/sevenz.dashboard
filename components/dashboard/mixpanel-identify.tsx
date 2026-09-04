"use client";

import { useEffect } from "react";
import { identifyOwner } from "@/lib/mixpanel";

export function MixpanelIdentify({
  ownerId,
  email,
  plan,
}: {
  ownerId: string;
  email: string;
  plan: string;
}) {
  useEffect(() => {
    // Waits for the browser to be idle before pulling in 412 KB of analytics,
    // so it can't compete with rendering the screen the owner actually came
    // for. requestIdleCallback doesn't exist on iOS Safari — which is most of
    // this app's traffic — so the timeout isn't a nicety, it's the path most
    // owners take.
    const idle = window.requestIdleCallback;
    const run = () => identifyOwner(ownerId, { email, plan });

    if (typeof idle === "function") {
      const handle = idle(run, { timeout: 3_000 });
      return () => window.cancelIdleCallback?.(handle);
    }
    const timer = setTimeout(run, 2_000);
    return () => clearTimeout(timer);
  }, [ownerId, email, plan]);

  return null;
}
