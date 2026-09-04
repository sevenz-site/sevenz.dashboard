"use client";

import { useEffect } from "react";
import { useUnreadNotifications } from "@/components/dashboard/unread-notifications-context";

// Rendering /notificaciones already marks every row read server-side — that
// happens inside getNotifications(). This just brings the badge in the bottom
// bar down to zero at the same moment, instead of leaving it sitting there
// until the next poll on a page that is literally showing the list.
export function MarkNotificationsSeen() {
  const { clear } = useUnreadNotifications();

  useEffect(() => {
    clear();
  }, [clear]);

  return null;
}
