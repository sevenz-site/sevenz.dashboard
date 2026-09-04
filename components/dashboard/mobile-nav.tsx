"use client";

import { useEffect, useState, useTransition, type ComponentType, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bell, Loader2, Plus, Users, Wallet } from "lucide-react";
import { useTour } from "@/components/dashboard/tour-context";
import { useUnreadNotifications } from "@/components/dashboard/unread-notifications-context";
import { useUnsavedChangesGuard } from "@/components/unsaved-changes-context";
import { cn } from "@/lib/utils";
import { BADGE_MAX } from "@/lib/types";

// The three places the bar navigates to, in order, before Agregar. Exact
// pathname matching, not startsWith: a client's own screen replaces this
// whole bar anyway (see onClientDetail below), so there is no case where a
// child route should light up its parent here.
const DESTINATIONS = [
  { href: "/dashboard", label: "Cartera", icon: Wallet },
  { href: "/clients", label: "Clientes", icon: Users },
  { href: "/notificaciones", label: "Notificaciones", icon: Bell },
] as const;

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

// Only the three destinations carry the "selected" pill — Agregar is an
// action, not a place, so "selected" has no meaning for it. Deliberately
// exact-match only: Malas pagas, Importar cartera and Mi negocio live in the
// sidebar rather than in this bar, and a highlight meaning "somewhere in this
// section" would apply inconsistently across them.
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
  const { guard } = useUnsavedChangesGuard();
  const { unreadCount } = useUnreadNotifications();
  const tour = useTour();
  const overlayOpen = useOverlayOpen();
  const keyboardOpen = useKeyboardOpen();

  // Drives the spinner. useLinkStatus can't be used here: this link calls
  // preventDefault so the unsaved-changes guard runs first, and a link whose
  // default was prevented never reports a pending state.
  const [isPending, startTransition] = useTransition();
  const [goingTo, setGoingTo] = useState<string | null>(null);

  // The bar does not render at all on a client's own screen — see below.
  // Note the trailing slash: /clients (the list) keeps its bar, only
  // /clients/<id> loses it.
  const onClientDetail = pathname.startsWith("/clients/");
  const agregarHref = "/dashboard?nuevo=1";

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

  // Nothing at all on a client's own screen. The bar used to carry "Agregar
  // abono" / "Agregar fiado" here, but a phone's own browser chrome — the
  // native notification and address bars — sits in exactly that strip and
  // covered them, so the two actions an owner comes to this screen for could
  // be unreachable. They now live in the page itself, under "Marcar como mala
  // paga", where nothing can overlap them. The screen keeps its own back
  // chevron at the top for getting out.
  if (onClientDetail) return null;

  return (
    // z-40, below the z-50 every Dialog/Sheet/Drawer in this app uses. The bar
    // also unmounts while one is open, so this is belt and braces.
    // touch-action: manipulation drops the browser's wait for a possible
    // double-tap-to-zoom, which otherwise delays every single tap.
    <nav className={navClass} aria-label="Navegación principal">
      <div className={cn("flex items-stretch", NAV_HEIGHT_CLASS)}>
        {/* The three destinations, then Agregar. All anchors rather than
            buttons: Next prefetches a Link's href while it is on screen, and
            this bar always is, so each destination is preloaded before the
            owner ever taps. Menú is gone from here — the sidebar opens from
            the header's own trigger now, which is why that trigger exists on
            a phone at all. */}
        {DESTINATIONS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            onClick={(e) => navigate(e, item.href)}
            className="flex flex-1"
          >
            <NavItem active={pathname === item.href} className="w-full">
              {/* The unread badge hangs off the icon, so it needs a
                  positioned box of its own — the pill around icon+label is
                  the wrong anchor, it would float the count out over the
                  neighbouring item. */}
              <span className="relative">
                {glyph(item.href, item.icon)}
                {item.href === "/notificaciones" && unreadCount > 0 ? (
                  <span className="absolute -top-1.5 -right-2 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-medium text-white">
                    {unreadCount > BADGE_MAX ? `${BADGE_MAX}+` : unreadCount}
                  </span>
                ) : null}
              </span>
              {item.label}
            </NavItem>
          </Link>
        ))}

        {/* Agregar. Never carries the active pill — it's an action, not a
            place, so "selected" has no meaning for it. */}
        <Link
          href={agregarHref}
          // Its own marker, not the one the page CTA uses. The tour finds its
          // target with querySelector, which returns whichever matches first
          // in the DOM — two elements sharing a marker means it can highlight
          // the wrong one, or one that isn't on screen.
          data-tour="new-client-button-mobile"
          onClick={(e) =>
            navigate(e, agregarHref, () => {
              // Step 1's tooltip only renders on the dashboard. This code is
              // unreachable from a client's page now that the bar returns null
              // there, but the guard stays cheap and correct if that changes.
              if (tour.step === 1) tour.advance();
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
      </div>
    </nav>
  );
}
