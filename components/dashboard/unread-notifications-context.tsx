"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { getUnreadNotificationCount } from "@/app/(app)/actions";

// 60s, not 20s. This fires in every open tab for as long as it stays open, so
// it's the one request whose volume tracks how many owners have the app open
// rather than what any of them are doing: at 1,000 open tabs, 20s meant 50
// polls a second before anyone had registered a single fiado. A notification
// badge does not need 20-second freshness.
const UNREAD_POLL_MS = 60_000;

type UnreadNotificationsValue = {
  unreadCount: number;
  // Zeroes the badge the moment the owner actually looks at the list. The
  // server marks the rows read as part of getNotifications(), so the next
  // poll agrees — this just avoids the badge sitting there for up to a full
  // poll interval after they've been read.
  clear: () => void;
};

const UnreadNotificationsContext = createContext<UnreadNotificationsValue>({
  unreadCount: 0,
  clear: () => {},
});

// One poll for the whole app. Both readers of this count — the desktop
// header's bell and the phone bar's Notificaciones badge — are mounted at
// the same time (each is only CSS-hidden at the other's breakpoint), so a
// poll inside each of them meant two identical requests every 20s at every
// screen size, and the hidden one's was pure waste.
export function UnreadNotificationsProvider({
  initialCount,
  children,
}: {
  initialCount: number;
  children: React.ReactNode;
}) {
  const [unreadCount, setUnreadCount] = useState(initialCount);
  // Bumped by clear(). A poll that started before a clear and lands after it
  // would otherwise put the old count straight back on screen, and the badge
  // would sit there until the next poll — visible, and reads as a bug.
  const generationRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      // Nothing to update while nobody can see the badge. On a phone this is
      // most of the time: switching apps or locking the screen hides the tab,
      // and iOS keeps that tab alive in the background — without this check a
      // phone in someone's pocket keeps polling all day.
      if (document.visibilityState === "hidden") return;
      const startedAt = generationRef.current;
      const count = await getUnreadNotificationCount();
      if (!cancelled && generationRef.current === startedAt) setUnreadCount(count);
    }

    // Coming back to the tab is exactly when a stale badge is most visible, so
    // catch up immediately rather than waiting out the rest of the interval.
    function onVisible() {
      if (document.visibilityState === "visible") refresh();
    }

    refresh();
    const interval = setInterval(refresh, UNREAD_POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const clear = useCallback(() => {
    generationRef.current += 1;
    setUnreadCount(0);
  }, []);

  return (
    <UnreadNotificationsContext.Provider value={{ unreadCount, clear }}>
      {children}
    </UnreadNotificationsContext.Provider>
  );
}

export function useUnreadNotifications() {
  return useContext(UnreadNotificationsContext);
}
