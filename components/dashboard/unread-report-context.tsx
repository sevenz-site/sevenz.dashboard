"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { getAssistantNoteUnread } from "@/app/(app)/reportes/actions";
import { cn } from "@/lib/utils";

// THE RED DOT ON «REPORTES» (owner's request of 2026-11-25): whether today's
// assistant analysis is still waiting to be read. What «unread» means, and why it
// needs no column, is in `lib/reports/assistant/unread.ts`.
//
// A CONTEXT, LIKE THE NOTIFICATIONS BADGE, because two bars read it at once (the
// phone's bottom bar and the desktop sidebar, each CSS-hidden at the other's width)
// and the assistant clears it from inside Reportes. The layout does not re-render on
// a client navigation, so without `clear()` the dot would stay on until a full reload
// after the owner had already read the note.
//
// NO TIMER, unlike the notifications badge: the answer changes once a day, at
// midnight in Venezuela. It is re-asked only when a hidden tab comes back, which is
// exactly the phone left in a pocket overnight, and only while there is no dot (once
// on, only reading the note turns it off).

type UnreadReportValue = {
  unread: boolean;
  clear: () => void;
};

const UnreadReportContext = createContext<UnreadReportValue>({ unread: false, clear: () => {} });

export function UnreadReportProvider({
  initialUnread,
  children,
}: {
  initialUnread: boolean;
  children: React.ReactNode;
}) {
  const [unread, setUnread] = useState(initialUnread);
  const unreadRef = useRef(initialUnread);
  // Bumped by clear(), so a check that started before the owner read the note
  // cannot put the dot back after it.
  const generationRef = useRef(0);

  useEffect(() => {
    unreadRef.current = unread;
  }, [unread]);

  useEffect(() => {
    let cancelled = false;
    async function onVisible() {
      if (document.visibilityState !== "visible" || unreadRef.current) return;
      const startedAt = generationRef.current;
      try {
        const next = await getAssistantNoteUnread();
        if (!cancelled && generationRef.current === startedAt) setUnread(next);
      } catch {
        // No network: keep what is on screen, the next return to the tab asks again.
      }
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const clear = useCallback(() => {
    generationRef.current += 1;
    setUnread(false);
  }, []);

  return <UnreadReportContext.Provider value={{ unread, clear }}>{children}</UnreadReportContext.Provider>;
}

export function useUnreadReport() {
  return useContext(UnreadReportContext);
}

// THE DOT ITSELF, one component for the two bars (CLAUDE.md: a visual value that
// shows on more than one screen is born in a component).
//
// Same red (`bg-destructive`) and same corner as the notifications badge, which is
// what «igual al de notificaciones» asked for. WITHOUT A NUMBER: there is one
// analysis a day, so a count would always read «1» and say nothing the dot does not.
// Smaller than the badge (10px against 16px) for the same reason: the badge is sized
// to hold a digit. The `ring` in the background colour keeps it from merging with the
// icon's strokes, which the badge does not need because its white digit does that.
export function UnreadReportDot({ className }: { className?: string }) {
  const { unread } = useUnreadReport();
  if (!unread) return null;
  return (
    <span
      className={cn("size-2.5 rounded-full bg-destructive ring-2 ring-background", className)}
      role="status"
      aria-label="Reporte nuevo sin leer"
    />
  );
}
