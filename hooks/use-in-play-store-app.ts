"use client";

import { useSyncExternalStore } from "react";
import { installSource } from "@/lib/install-source";

// Whether this tab runs inside the Play Store app (PL-48), read once: where the tab was
// opened from does not change mid-session.
//
// THE SERVER CANNOT KNOW, so the caller decides what renders before hydration, and the
// two callers want opposite things on purpose:
//
// - `false` for a convenience («Instalar app» in the sidebar): the browser, where almost
//   everyone is, renders as it always has, and only the store app drops it afterwards.
// - `true` for anything Google's payments policy forbids inside its app (decision D2,
//   2026-11-18: no button or link that leads to paying outside Google Play). Rendered
//   from the server with the store wording, so the store app never shows the WhatsApp
//   button, not even for the instant before hydration. The browser pays the opposite
//   instant: the sentence, then the button. Only a paused or ending-trial account sees
//   either, and a flash of text is the cheaper of the two.
export function useInPlayStoreApp(assumeOnServer: boolean): boolean {
  return useSyncExternalStore(
    subscribeNothing,
    () => installSource() === "play",
    () => assumeOnServer,
  );
}

function subscribeNothing() {
  return () => {};
}
