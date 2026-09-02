"use client";

import { useEffect, useState, useTransition, type ComponentType, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, Loader2, Menu, Plus } from "lucide-react";
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

// Only Cartera can carry the "selected" pill — Agregar is an action (it
// doesn't represent "where you are"), and Menú opens a sheet rather than
// navigating anywhere. Deliberately exact-match only: Malas pagas, Mi negocio
// and a client's detail page all live one tap away in the menu now rather than
// in the bar itself, and a highlight that meant "somewhere in this section"
// would apply inconsistently across them — a client's page would light up
// Cartera while Malas pagas lit up nothing, for two screens that are equally
// one tap from the menu.
function NavItem({
  active,
  children,
  className,
  ...props
}: {
  active: boolean;
  children: ReactNode;
  className?: string;
} & Record<string, unknown>) {
  return (
    <div className={cn("flex flex-1 items-center justify-center", className)} {...props}>
      <div
        className={cn(
          "flex flex-col items-center gap-1 rounded-lg px-3 py-1 text-[11px] font-medium transition-colors",
          // Soft gray pill behind icon+label together, not just the icon —
          // reads as one unit and matches how the sidebar already marks its
          // own active item. Text stays foreground-dark rather than switching
          // to the muted color the inactive items use, since the pill itself
          // is what signals selection here.
          active ? "bg-muted text-foreground" : "text-muted-foreground",
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { setOpenMobile } = useSidebar();
  const { guard } = useUnsavedChangesGuard();
  const tour = useTour();
  const overlayOpen = useOverlayOpen();
  const keyboardOpen = useKeyboardOpen();

  // Drives the spinner. useLinkStatus can't be used here: this link calls
  // preventDefault so the unsaved-changes guard runs first, and a link whose
  // default was prevented never reports a pending state.
  const [isPending, startTransition] = useTransition();
  const [goingTo, setGoingTo] = useState<string | null>(null);

  // On a client's page the bar becomes the two actions that screen is for.
  // "Agregar" there meant "pick a client", which read as a bug when one is
  // already on screen. Marking the current URL rather than navigating keeps
  // the owner on the record they are looking at; the dialog strips the marker
  // once it closes.
  const onClientDetail = pathname.startsWith("/clients/");
  const agregarHref = "/dashboard?nuevo=1";
  const abonoHref = `${pathname}?movimiento=abono`;
  const fiadoHref = `${pathname}?movimiento=fiado`;

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
        // Replace, never push: for Cartera it keeps the home screen from
        // stacking behind wherever the owner came from (matching the sidebar),
        // and for a client's page it keeps the marked URL out of history, so
        // Back can't land on it and reopen the dialog.
        router.replace(href);
      });
    });
  }

  const glyph = (href: string, Icon: ComponentType<{ className?: string }>) =>
    isPending && goingTo === href ? (
      <Loader2 className="size-5 animate-spin" />
    ) : (
      <Icon className="size-5" />
    );

  // The bar's own classes, shared by both variants so the height and the
  // safe-area padding stay identical — the layout reserves exactly this much
  // space, and a variant that measured differently would strand the last row
  // of content on one route but not another.
  const navClass = cn(
    "fixed inset-x-0 bottom-0 z-40 border-t bg-background touch-manipulation md:hidden",
    "pb-[env(safe-area-inset-bottom)]",
  );

  if (onClientDetail) {
    // Deliberately only these two: on a client's screen these are the actions
    // that matter, and the page keeps its own "← Cartera" link at the top.
    // Abono left, Fiado right, mirroring the page's own primary/secondary
    // hierarchy — fiar is the common action, abono the secondary one.
    const actionClass =
      "flex h-10 flex-1 items-center justify-center gap-1.5 rounded-md text-sm font-medium transition-colors active:opacity-80";
    return (
      <nav className={navClass} aria-label="Acciones del cliente">
        <div className={cn("flex items-center gap-2 px-3", NAV_HEIGHT_CLASS)}>
          <Link
            href={abonoHref}
            onClick={(e) => navigate(e, abonoHref)}
            className={cn(actionClass, "border bg-background text-foreground")}
          >
            {/* Never disabled here. The bar has no access to this client's
                balance, so rather than guess it always offers the action and
                the dialog answers — it opens and explains when the client owes
                nothing, instead of silently doing something else. */}
            {glyph(abonoHref, Plus)}
            Agregar abono
          </Link>
          <Link
            href={fiadoHref}
            onClick={(e) => navigate(e, fiadoHref)}
            className={cn(actionClass, "bg-primary text-primary-foreground")}
          >
            {glyph(fiadoHref, Plus)}
            Agregar fiado
          </Link>
        </div>
      </nav>
    );
  }

  return (
    // z-40, below the z-50 every Dialog/Sheet/Drawer in this app uses. The bar
    // also unmounts while one is open, so this is belt and braces.
    // touch-action: manipulation drops the browser's wait for a possible
    // double-tap-to-zoom, which otherwise delays every single tap.
    <nav className={navClass} aria-label="Navegación principal">
      <div className={cn("flex items-stretch", NAV_HEIGHT_CLASS)}>
        {/* Left: Cartera. Still an anchor rather than a button: Next
            prefetches a Link's href while it is on screen, and this bar is
            always on screen, so the destination is preloaded before the
            owner ever taps. */}
        <Link
          href="/dashboard"
          onClick={(e) => navigate(e, "/dashboard")}
          className="flex flex-1"
        >
          <NavItem active={pathname === "/dashboard"} className="w-full">
            {glyph("/dashboard", LayoutDashboard)}
            Cartera
          </NavItem>
        </Link>

        {/* Center: Agregar. Never carries the active pill — it's an action,
            not a place, so "selected" has no meaning for it. */}
        <Link
          href={agregarHref}
          // Its own marker, not the one the page CTA uses. The tour finds its
          // target with querySelector, which returns whichever matches first
          // in the DOM — two elements sharing a marker means it can highlight
          // the wrong one, or one that isn't on screen.
          data-tour="new-client-button-mobile"
          onClick={(e) =>
            navigate(e, agregarHref, () => {
              // Only advance the tour on the dashboard: step 1's tooltip only
              // renders there, so advancing from a client's page would
              // silently consume a step the owner never saw.
              if (!onClientDetail && tour.step === 1) tour.advance();
            })
          }
          className="flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors active:bg-accent"
        >
          <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            {isPending && goingTo === agregarHref ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <Plus className="size-5" />
            )}
          </span>
          Agregar
        </Link>

        {/* Right: Menú. Local state only — no navigation, so nothing to guard
            and nothing to wait for. Never carries the active pill: opening
            the sheet is transient, not a place the owner "is". */}
        <button
          type="button"
          onClick={() => setOpenMobile(true)}
          className="flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors active:bg-accent"
        >
          <Menu className="size-5" />
          Menú
        </button>
      </div>
    </nav>
  );
}
