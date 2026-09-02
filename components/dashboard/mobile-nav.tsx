"use client";

import { useEffect, useState, type ComponentType } from "react";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { Building2, LayoutDashboard, Loader2, Menu, Plus } from "lucide-react";
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

// Must live inside the Link: useLinkStatus reports the pending state of its
// enclosing Link. Without this the button looks dead while the page loads, so
// the owner taps again — and each extra tap queues more work, making it slower
// still. That was the rage-click.
function NavLinkBody({
  icon: Icon,
  label,
  emphasis,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  emphasis?: boolean;
}) {
  const { pending } = useLinkStatus();
  const glyph = pending ? <Loader2 className="size-5 animate-spin" /> : <Icon className="size-5" />;

  return (
    <>
      {emphasis ? (
        <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
          {glyph}
        </span>
      ) : (
        glyph
      )}
      {label}
    </>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  const tour = useTour();
  const overlayOpen = useOverlayOpen();
  const keyboardOpen = useKeyboardOpen();

  if (overlayOpen || keyboardOpen) return null;

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
        {/* Local state, no navigation — nothing to wait for. */}
        <button type="button" onClick={() => setOpenMobile(true)} className={itemClass(false)}>
          <Menu className="size-5" />
          Menú
        </button>

        {/* Kept as Links rather than router.push so Next keeps prefetching
            them. The bar is permanently on screen, so both destinations are
            preloaded before the owner ever taps — which matters far more on
            mobile data than any code here. */}
        <Link href="/dashboard" className={itemClass(pathname === "/dashboard")}>
          <NavLinkBody icon={LayoutDashboard} label="Cartera" />
        </Link>

        <Link href="/profile" className={itemClass(pathname.startsWith("/profile"))}>
          <NavLinkBody icon={Building2} label="Mi negocio" />
        </Link>

        <Link
          href="/dashboard?nuevo=1"
          // Its own marker, not the one the page CTA uses. The tour finds its
          // target with querySelector, which returns whichever matches first in
          // the DOM — two elements sharing a marker means it can highlight the
          // wrong one, or one that isn't on screen.
          data-tour="new-client-button-mobile"
          onClick={() => {
            if (tour.step === 1) tour.advance();
          }}
          className={itemClass(false)}
        >
          <NavLinkBody icon={Plus} label="Agregar" emphasis />
        </Link>
      </div>
    </nav>
  );
}
