"use client";

import { installSource } from "@/lib/install-source";
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
  //
  // `install_source` (2026-11-20, PL-48 §10): the owner's question for the Play Store,
  // «¿la Play Store trae tenderos nuevos que se quedan, o solo cambia por dónde instalan
  // los que ya teníamos?». If nearly every "play" owner already had an account, the store
  // is convenience rather than acquisition and does not earn more investment (App Store,
  // a polished listing); if it brings new sign-ups that stay, it does.
  // A store install never fires `App Installed` (no `appinstalled` event outside Chrome's
  // own prompt), so this is the only Mixpanel trace of it; install counts live in Play
  // Console. A floor: sent from the browser.
  useEffect(() => {
    const source = installSource();
    if (source === "browser") return;
    try {
      if (sessionStorage.getItem("sevenz:instalada:vista")) return;
      sessionStorage.setItem("sevenz:instalada:vista", "1");
    } catch {
      // Blocked storage: counted on every load, which still answers the question.
    }
    track("App Opened Installed", { install_source: source });
  }, []);

  useEffect(() => {
    // Replaces mixpanel-browser's `track_pageview: true`, which stopped
    // applying when the SDK was removed. Sent per pathname so an in-app
    // navigation counts, which the old init-time-only default did not do.
    track("Page Viewed", { path: pathname });
  }, [pathname]);

  return null;
}
