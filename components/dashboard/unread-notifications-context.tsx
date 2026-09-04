"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { getUnreadNotificationCount } from "@/app/(app)/actions";

const UNREAD_POLL_MS = 20_000;

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
      const startedAt = generationRef.current;
      const count = await getUnreadNotificationCount();
      if (!cancelled && generationRef.current === startedAt) setUnreadCount(count);
    }
    refresh();
    const interval = setInterval(refresh, UNREAD_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
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
