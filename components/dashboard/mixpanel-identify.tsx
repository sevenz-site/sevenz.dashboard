"use client";

import { yaEstaInstalada } from "@/lib/install-prompt";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { identifyOwner, track } from "@/lib/mixpanel";

export function MixpanelIdentify({
  ownerId,
  email,
  plan,
}: {
  ownerId: string;
  email: string;
  plan: string;
}) {
  const pathname = usePathname();

  useEffect(() => {
    // Fires immediately now. This used to wait for requestIdleCallback (or a
    // 2s timeout on iOS, which has no such API) because it pulled in 412 KB of
    // analytics SDK that competed with rendering the screen. That SDK is gone:
    // this is a single fetch to our own /api/track, so there is nothing left
    // worth deferring — and deferring actively lost the call on a short visit,
    // which is precisely the visit an owner checking one balance makes.
    identifyOwner(ownerId, { email, plan });
  }, [ownerId, email, plan]);

  // HOW MANY USE THE INSTALLED APP. It is the only real signal on an iPhone, which never
  // says it was installed. Once per tab session. Filed under the owner.
  useEffect(() => {
    if (!yaEstaInstalada()) return;
    try {
      if (sessionStorage.getItem("sevenz:instalada:vista")) return;
      sessionStorage.setItem("sevenz:instalada:vista", "1");
    } catch {
      // Blocked storage: counted on every load, which still answers the question.
    }
    track("App Opened Installed", {});
  }, []);

  useEffect(() => {
    // Replaces mixpanel-browser's `track_pageview: true`, which stopped
    // applying when the SDK was removed. Sent per pathname so an in-app
    // navigation counts, which the old init-time-only default did not do.
    track("Page Viewed", { path: pathname });
  }, [pathname]);

  return null;
}
