"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

// THE DARK HEADERS COLLAPSE THE SAME WAY, SO THEY SHARE THE RULE
//
// Inicio's header (`home-header.tsx`) and the one on Clientes, Malas pagas and
// Papelera (`screen-header.tsx`) both pin themselves to the top and drop their
// tallest block once the owner scrolls. This hook owns no layout: it answers one
// question, should that block be hidden right now, and hands back the ref it
// needs to measure it.
//
// ─────────────────────────────────────────────────────────────────────────
// THE FLICKER, AND WHY THE THRESHOLD IS NOT A CONSTANT
//
// Reported on 2026-10-04 on a short list, and measured in dev the same day. The
// header oscillated at about 1 Hz, forever:
//
//   ms 26   expanded (268px)   scrollY 80
//   ms 53   collapsed (198px)  scrollY 10     <- the browser moved the scroll
//   ms 99   expanded           scrollY 78
//   ms 126  collapsed          scrollY 8
//
// The 70px drop is exactly the height of the block being hidden, and it is not
// the page running out of room: it is SCROLL ANCHORING. When content above the
// viewport shrinks, Chrome and Firefox shift the scroll position by the same
// amount so what you are looking at does not jump. Then this hook read that
// shifted position, saw it below the expand threshold, expanded — which gave
// the 70px back, which put the scroll where it was, which collapsed again.
//
// A feedback loop: the decision changed its own input.
//
// THE FIX IS ARITHMETIC, NOT A BIGGER DEAD ZONE. Collapsing can move the scroll
// down by at most the block's height `h`. So if we only ever collapse above
// `h + EXPAND_AT`, the position after the shift can never land under the expand
// threshold, and the loop cannot start. That makes the threshold depend on the
// content, which is why it is measured instead of guessed — the subtitle wraps
// to two lines on Malas pagas and Papelera and to one on Clientes.
//
// It holds on iOS too, for a different reason: Safari does not implement scroll
// anchoring at all, so there the position simply does not move. Either way the
// state is stable after one change.
//
// What was tried and is NOT here: a `MIN_SCROLL_ROOM` guard that refused to
// collapse on short pages. It had its own loop — collapsing shortened the
// document, which pushed the page under the guard, which forced it open, which
// made it long enough again. A guard against oscillation that oscillates.
const EXPAND_AT = 8;

// Breathing room on top of `h + EXPAND_AT`, so the two states are not decided
// one pixel apart.
const MARGIN = 16;

// Until the block has been measured. Deliberately large enough to be safe for
// any of the headers: too high only means the first collapse comes late, while
// too low would reopen the loop this file exists to close.
const BEFORE_MEASURED = 160;

export function useCollapseOnScroll(frozen: boolean) {
  const [collapsed, setCollapsed] = useState(false);
  // The element that disappears. The caller puts this on the wrapper around it.
  const collapsibleRef = useRef<HTMLDivElement | null>(null);
  const heightRef = useRef(0);

  // Measured while it is on screen, after every expanded render: a longer
  // business name or a wrapped subtitle changes it, and a stale height would
  // put the threshold back under the loop's floor.
  useLayoutEffect(() => {
    if (!collapsed && collapsibleRef.current) {
      heightRef.current = collapsibleRef.current.offsetHeight;
    }
  });

  const decide = useCallback(() => {
    const y = window.scrollY;
    const h = heightRef.current;
    const collapseAt = h > 0 ? h + EXPAND_AT + MARGIN : BEFORE_MEASURED;
    setCollapsed((prev) => (prev ? y > EXPAND_AT : y > collapseAt));
  }, []);

  useEffect(() => {
    // FROZEN WHILE THE OWNER IS TYPING. On iOS, opening the keyboard resizes
    // the window and scrolls the page to bring the field into view — that is,
    // it fires a scroll the owner never made. Without this, tapping the search
    // field collapses the header and moves the field at the exact moment the
    // finger has just landed on it.
    if (frozen) return;

    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        decide();
      });
    };

    // Once on mount: a screen gets entered from a client's page with the page
    // already scrolled more often than it seems.
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    // Rotating the phone, or the keyboard opening and closing, changes what
    // counts as scrolled without a scroll ever firing.
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [frozen, decide]);

  return { collapsed, collapsibleRef };
}
