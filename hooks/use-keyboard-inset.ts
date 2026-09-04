"use client";

import { useEffect, useState } from "react";

// How much of the layout viewport the on-screen keyboard is covering, and how
// much height is actually visible.
//
// Anything anchored with `fixed bottom-0` is anchored to the LAYOUT viewport,
// which on Android (interactive-widget=resizes-visual, the Chrome/Brave
// default) and on iOS does not shrink when the keyboard appears — the keyboard
// is painted over it. So a bottom sheet ends up behind the keyboard, and a
// max-height in vh/dvh still measures the whole screen, pushing the sheet's top
// off the top edge. Declaring interactive-widget=resizes-content asks the
// browser to shrink the layout viewport instead, but it is not honoured
// everywhere, so this measures the truth directly rather than trusting it.
//
// visualViewport is the only reliable signal: its height excludes the keyboard,
// and offsetTop covers the case where the browser has scrolled the visual
// viewport within the layout one.
export function useKeyboardInset() {
  const [inset, setInset] = useState(0);
  const [visibleHeight, setVisibleHeight] = useState<number | null>(null);

  useEffect(() => {
    const vv = window.visualViewport;
    // No signal: leave the sheet on its CSS defaults rather than guessing.
    if (!vv) return;

    const update = () => {
      setInset(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
      setVisibleHeight(Math.round(vv.height));
    };

    update();
    vv.addEventListener("resize", update);
    // The keyboard can also move the visual viewport without resizing it,
    // which is what happens when focus jumps between inputs.
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return { inset, visibleHeight };
}
