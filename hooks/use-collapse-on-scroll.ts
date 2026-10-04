"use client";

import { useEffect, useState } from "react";

// THE DARK HEADERS COLLAPSE THE SAME WAY, SO THEY SHARE THE RULE
//
// Inicio's header (`home-header.tsx`) and the one on Clientes, Malas pagas and
// Papelera (`screen-header.tsx`) both pin themselves to the top and drop their
// tallest block once the owner scrolls. The three guards below are what make
// that behave, and none of them is obvious — which is exactly why this is one
// hook and not two copies of twelve lines.
//
// It owns no layout. It answers one question: should the collapsible part be
// hidden right now?
const COLLAPSE_AT = 64; // scrolling down: past this, the block goes
const EXPAND_AT = 24; // scrolling up: and it only returns near the very top

// The hysteresis (64 against 24) is not fine-tuning, it is what prevents
// flicker. With a single threshold, the jump the collapse itself produces can
// leave the scroll just below that threshold, which expands, which jumps again.
//
// And the other guard, the one that matters: IT ONLY COLLAPSES IF THE PAGE HAS
// SOMEWHERE TO SCROLL. Hiding the block shortens the document; on a list with
// three rows that is enough for the browser to clamp the scroll below EXPAND_AT
// and reopen the header by itself. If what is left of the page cannot absorb
// the collapse, there is nothing to gain by collapsing.
const MIN_SCROLL_ROOM = 160;

export function useCollapseOnScroll(frozen: boolean): boolean {
  const [collapsed, setCollapsed] = useState(false);

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
        const y = window.scrollY;
        const room = document.documentElement.scrollHeight - window.innerHeight;
        setCollapsed((prev) => {
          if (room < MIN_SCROLL_ROOM) return false;
          return prev ? y > EXPAND_AT : y > COLLAPSE_AT;
        });
      });
    };

    // Once on mount: a screen gets entered from a client's page with the page
    // already scrolled more often than it seems.
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [frozen]);

  return collapsed;
}
