"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Building2, LayoutDashboard, Menu, Plus } from "lucide-react";
import { useSidebar } from "@/components/ui/sidebar";
import { useTour } from "@/components/dashboard/tour-context";
import { cn } from "@/lib/utils";

// Shown only below md. Deliberately a CSS media query rather than the
// useIsMobile hook: the hook resolves after hydration, so the bar would pop in
// a beat after the page paints and shove the content up — on every load, and
// worst on the cheap phones this app is used from. CSS is applied before the
// first frame.
//
// An iPhone in landscape is 812px wide, so it crosses this breakpoint and gets
// the desktop layout. That is the existing behaviour of every other responsive
// piece in the app and was left alone on purpose; the tour is made resilient to
// the switch instead (see useTour below).
const NAV_HEIGHT_CLASS = "h-16";

function useOverlayOpen() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Must test data-state, not mere presence. Radix leaves the dialog node in
    // the DOM after closing and only flips data-state to "closed" — testing
    // presence alone means the bar hides at the first dialog and NEVER comes
    // back, stranding the owner with no navigation at all. Caught by opening
    // and closing a dialog, not by reading the code.
    const check = () =>
      setOpen(document.querySelector('[role="dialog"][data-state="open"]') !== null);
    const observer = new MutationObserver(check);
    // attributes as well as childList: the node stays put and only the
    // attribute changes, so a childList-only observer never fires on close.
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-state"],
    });
    check();
    return () => observer.disconnect();
  }, []);

  return open;
}

function useKeyboardOpen() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const vv = window.visualViewport;
    // No signal available: keep the bar visible. A bar that shouldn't be there
    // is cosmetic; a missing one removes navigation.
    if (!vv) return;

    // iOS doesn't resize the page when the keyboard appears — it overlays it,
    // and the visual viewport shrinks while the layout viewport doesn't. That
    // gap is the only reliable signal. Focus events look tempting but fire for
    // buttons and selects too, and miss dismissal.
    const onResize = () => setOpen(vv.height < window.innerHeight * 0.75);
    vv.addEventListener("resize", onResize);
    onResize();
    return () => vv.removeEventListener("resize", onResize);
  }, []);

  return open;
}

export function MobileNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { setOpenMobile } = useSidebar();
  const tour = useTour();
  const overlayOpen = useOverlayOpen();
  const keyboardOpen = useKeyboardOpen();

  if (overlayOpen || keyboardOpen) return null;

  const itemClass = (active: boolean) =>
    cn(
      "flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors",
      active ? "text-foreground" : "text-muted-foreground",
    );

  return (
    <nav
      // z-40, below the z-50 every Dialog/Sheet/Drawer in this app uses. The
      // bar also unmounts while one is open, so this is belt and braces.
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 border-t bg-background md:hidden",
        "pb-[env(safe-area-inset-bottom)]",
      )}
      aria-label="Navegación principal"
    >
      <div className={cn("flex items-stretch", NAV_HEIGHT_CLASS)}>
        <button
          type="button"
          onClick={() => setOpenMobile(true)}
          className={itemClass(false)}
        >
          <Menu className="size-5" />
          Menú
        </button>

        <Link href="/dashboard" className={itemClass(pathname === "/dashboard")}>
          <LayoutDashboard className="size-5" />
          Cartera
        </Link>

        <Link href="/profile" className={itemClass(pathname.startsWith("/profile"))}>
          <Building2 className="size-5" />
          Mi negocio
        </Link>

        <button
          type="button"
          // Its own marker, not the one the page CTA uses. The tour finds its
          // target with querySelector, which returns whichever matches first in
          // the DOM — two elements sharing a marker means it can highlight the
          // wrong one, or one that isn't on screen.
          data-tour="new-client-button-mobile"
          onClick={() => {
            if (tour.step === 1) tour.advance();
            // Cartera is where the movement will appear, and it already holds
            // the client list and rate context the dialog needs. The marker in
            // the address is cleared by the dashboard once it opens, so a
            // reload can't reopen the dialog on its own.
            router.push("/dashboard?nuevo=1");
          }}
          className={itemClass(false)}
        >
          <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Plus className="size-5" />
          </span>
          Agregar
        </button>
      </div>
    </nav>
  );
}
