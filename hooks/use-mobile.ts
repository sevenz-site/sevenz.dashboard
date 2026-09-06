import * as React from "react"

const MOBILE_BREAKPOINT = 768

// The viewport is an external source of truth that the server cannot see, which
// is precisely what useSyncExternalStore exists for: it takes a separate server
// snapshot, and React uses that same snapshot for the first client render too,
// so hydration cannot disagree.
//
// This used to read window.innerWidth in a useState initializer. That runs
// during the client's first render, so on any screen under 768px it returned
// true while the server had rendered false — and <Sidebar> swaps between two
// entirely different trees on that boolean, a desktop <aside> or a mobile
// <Sheet>. Measured on /dashboard at 375px, the server sent one
// data-slot="sidebar" and the client rendered zero: a hydration mismatch on
// every phone load, which is nearly all of this app's traffic. React's response
// is to discard the server HTML for that subtree and re-render it on the
// client, so the cost is real work on the slowest devices, not just a console
// error.
//
// Reporting false before mount costs nothing visible. The desktop branch is
// `hidden md:block`, so below 768px it is display:none whether or not it is in
// the DOM — the frame before hydration completes looks identical either way.
// The initializer was avoiding a flash that CSS had already prevented.

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

// Read on every render after mount and compared by value, so it must return a
// primitive — a fresh object here would loop forever.
function getSnapshot() {
  return window.innerWidth < MOBILE_BREAKPOINT
}

// No viewport exists yet. False means "render the desktop tree", which CSS then
// hides on a narrow screen.
function getServerSnapshot() {
  return false
}

export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
