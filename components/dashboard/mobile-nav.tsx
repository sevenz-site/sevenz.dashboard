"use client";

import { useEffect, useState, useTransition, type ComponentType, type MouseEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Building2, LayoutDashboard, Loader2, Menu, Plus } from "lucide-react";
import { useSidebar } from "@/components/ui/sidebar";
import { useTour } from "@/components/dashboard/tour-context";
import { useUnsavedChangesGuard } from "@/components/unsaved-changes-context";
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
// the switch instead.
const NAV_HEIGHT_CLASS = "h-16";

function useOverlayOpen() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Must test data-state, not mere presence. Radix leaves the dialog node in
    // the DOM after closing and only flips data-state to "closed" — testing
    // presence alone means the bar hides at the first dialog and NEVER comes
    // back, stranding the owner with no navigation at all.
    const check = () =>
      setOpen(document.querySelector('[role="dialog"][data-state="open"]') !== null);
    const observer = new MutationObserver(check);
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

const itemClass = (active: boolean) =>
  cn(
    "flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium",
    // Instant press feedback, applied by the browser before any JavaScript
    // runs — the tap is acknowledged even while the page is still loading.
    "transition-colors active:bg-accent",
    active ? "text-foreground" : "text-muted-foreground",
  );

export function MobileNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { setOpenMobile } = useSidebar();
  const { guard } = useUnsavedChangesGuard();
  const tour = useTour();
  const overlayOpen = useOverlayOpen();
  const keyboardOpen = useKeyboardOpen();

  // Drives the spinner. useLinkStatus can't be used here: these links call
  // preventDefault so the unsaved-changes guard runs first, and a link whose
  // default was prevented never reports a pending state.
  const [isPending, startTransition] = useTransition();
  const [goingTo, setGoingTo] = useState<string | null>(null);

  if (overlayOpen || keyboardOpen) return null;

  // Mirrors the sidebar's own link behaviour exactly, including the guard.
  // Without it the bar walked straight out of "Mi negocio" with unsaved edits
  // and no warning — the sidebar asks, so the bar has to ask too, or which
  // control you happened to use decides whether your work survives.
  function navigate(event: MouseEvent<HTMLAnchorElement>, href: string, before?: () => void) {
    // Let modifier and middle clicks open a new tab as usual.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    guard(() => {
      before?.();
      setGoingTo(href);
      startTransition(() => {
        // Cartera is the app's home screen — replacing rather than pushing
        // keeps it from stacking behind whatever screen the owner came from,
        // matching how the sidebar navigates there.
        if (href.startsWith("/dashboard")) router.replace(href);
        else router.push(href);
      });
    });
  }

  const glyph = (href: string, Icon: ComponentType<{ className?: string }>) =>
    isPending && goingTo === href ? (
      <Loader2 className="size-5 animate-spin" />
    ) : (
      <Icon className="size-5" />
    );

  return (
    <nav
      // z-40, below the z-50 every Dialog/Sheet/Drawer in this app uses. The
      // bar also unmounts while one is open, so this is belt and braces.
      // touch-action: manipulation drops the browser's wait for a possible
      // double-tap-to-zoom, which otherwise delays every single tap.
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 border-t bg-background touch-manipulation md:hidden",
        "pb-[env(safe-area-inset-bottom)]",
      )}
      aria-label="Navegación principal"
    >
      <div className={cn("flex items-stretch", NAV_HEIGHT_CLASS)}>
        {/* Local state, no navigation — nothing to guard and nothing to wait for. */}
        <button type="button" onClick={() => setOpenMobile(true)} className={itemClass(false)}>
          <Menu className="size-5" />
          Menú
        </button>

        {/* Still anchors rather than buttons: Next prefetches a Link's href
            while it is on screen, and this bar is always on screen, so both
            destinations are preloaded before the owner ever taps. */}
        <Link
          href="/dashboard"
          onClick={(e) => navigate(e, "/dashboard")}
          className={itemClass(pathname === "/dashboard")}
        >
          {glyph("/dashboard", LayoutDashboard)}
          Cartera
        </Link>

        <Link
          href="/profile"
          onClick={(e) => navigate(e, "/profile")}
          className={itemClass(pathname.startsWith("/profile"))}
        >
          {glyph("/profile", Building2)}
          Mi negocio
        </Link>

        <Link
          href="/dashboard?nuevo=1"
          // Its own marker, not the one the page CTA uses. The tour finds its
          // target with querySelector, which returns whichever matches first in
          // the DOM — two elements sharing a marker means it can highlight the
          // wrong one, or one that isn't on screen.
          data-tour="new-client-button-mobile"
          onClick={(e) =>
            navigate(e, "/dashboard?nuevo=1", () => {
              if (tour.step === 1) tour.advance();
            })
          }
          className={itemClass(false)}
        >
          <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            {isPending && goingTo === "/dashboard?nuevo=1" ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <Plus className="size-5" />
            )}
          </span>
          Agregar
        </Link>
      </div>
    </nav>
  );
}
