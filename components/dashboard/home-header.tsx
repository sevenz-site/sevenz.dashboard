"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Bell, Store } from "lucide-react";
import { NotificationsButton } from "@/components/dashboard/notifications-button";
import { SidebarMenuTrigger } from "@/components/dashboard/sidebar-menu-trigger";
import { useUnreadNotifications } from "@/components/dashboard/unread-notifications-context";
import { useSearchResultsOpen } from "@/components/dashboard/client-filter-context";
import { BADGE_MAX } from "@/lib/types";

// THE INICIO HEADER — delivery 2 of the 2026-10-03 redesign
//
// One dark block that swallows the app bar on this screen: brand, menu,
// notifications, greeting, business name, last sign-in and the search field. On
// `/dashboard` the layout's `AppHeader` hides itself on purpose (see its own
// note), because two stacked bars on a phone cost ~110px of the 667 there are.
//
// ─────────────────────────────────────────────────────────────────────────
// NOT ONE SEMANTIC TOKEN IN THIS FILE, and that isn't purism
//
// The background is `--brand-primary`, which is the same value in light and in
// dark. On a surface that does NOT invert, a colour that DOES is exactly what
// breaks contrast without anyone noticing: `text-muted-foreground` on this grey
// is grey on grey in the light theme. Hence `white/70` and `--brand-secondary`
// instead of tokens. It is the two-layer rule in `DESIGN-SYSTEM.md`, and the
// numbers come from `npm run qa:contraste`.
//
// ─────────────────────────────────────────────────────────────────────────
// WHY THIS IS ONE `sticky` ELEMENT AND NOT THREE
//
// The first version made the brand row and the search field sticky separately,
// letting the greeting scroll away between them: zero JavaScript and zero jump.
// It does not work, and the reason is easy to miss: **a `sticky` element only
// sticks inside its containing block**. If that block is the dark div — 168px
// tall — then past 168px of scroll both rows come unstuck and leave with it.
// The header would stay pinned exactly until it starts to be needed.
//
// Sticking the WHOLE block makes its containing block the screen's column,
// which runs to the bottom — so it stays up for the whole page. The price is
// that the greeting has to hide via state, which is what follows.
const COLLAPSE_AT = 64; // scrolling down: past this, the greeting goes
const EXPAND_AT = 24; // scrolling up: and it only returns near the very top

// The hysteresis (64 against 24) is not fine-tuning, it is what prevents
// flicker. With a single threshold, the jump the collapse itself produces can
// leave the scroll just below that threshold, which expands, which jumps again.
//
// And the other guard, the one that matters: IT ONLY COLLAPSES IF THE PAGE HAS
// SOMEWHERE TO SCROLL. Hiding the greeting shortens the document by ~56px; in
// the cartera of an owner with two clients that is enough for the browser to
// clamp the scroll below EXPAND_AT and reopen the header by itself. If what is
// left of the page cannot absorb the collapse, there is nothing to gain by
// collapsing.
const MIN_SCROLL_ROOM = 160;

export function HomeHeader({
  firstName,
  businessName,
  lastSignIn,
  children,
}: {
  firstName: string | null;
  businessName: string;
  // Already formatted on the server, in the owner's country's timezone: Vercel
  // runs in UTC, and formatting here would show a Colombian owner 12:15 p. m.
  // for a sign-in that happened at 7:15 a. m. their time.
  lastSignIn: string | null;
  // The search field. It arrives as a child rather than being imported here
  // because it needs `ClientFilterProvider`'s state, which the page mounts: the
  // match list and the cartera at the bottom have to filter by the same thing.
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  // The same `focused` that decides whether the dropdown is drawn. WHILE THE
  // OWNER IS TYPING, SCROLL DOES NOT COUNT: on iOS, opening the keyboard
  // resizes the window and scrolls the page to bring the field into view — that
  // is, it fires a scroll the owner never made. Without this freeze, tapping
  // the search field would collapse the header and move the field at the exact
  // moment the finger has just landed on it.
  const { focused } = useSearchResultsOpen();

  useEffect(() => {
    if (focused) return;

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

    // Once on mount: Inicio gets entered from a client's page with the page
    // already scrolled more often than it seems.
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [focused]);

  return (
    // `-mx-4 -mt-4` against `AppMain`'s `p-4`: the header runs edge to edge. It
    // is the same device the other screens' contextual bars use. `z-20` puts it
    // over the page and under dialogs and sheets, which live at z-50 — same as
    // the `AppHeader` it replaces.
    <header className="sticky top-0 z-20 -mx-4 -mt-4 flex flex-col gap-3 bg-brand-primary px-4 pt-3 pb-4">
      <div className="flex items-center gap-2">
        {/* DESKTOP ONLY since delivery 3. On a phone the bottom bar now carries
            "Menú", which opens this same sidebar, so a hamburger up here would
            be the second door to one room.

            It stays from md up because the bottom bar is `md:hidden`: on a
            desktop there is no bar, and without this the owner could not reopen
            a collapsed rail from Inicio at all. The two are one control split
            across the breakpoint, not a leftover.

            It is the hamburger and not the panel glyph the app uses elsewhere
            on desktop. One glyph on one surface costs less than two different
            icons for the same action, and the rail keeps its own control on
            every other screen. */}
        <SidebarMenuTrigger className="-ml-2 hidden shrink-0 text-white md:flex hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/40" />
        {/* The secondary variant of the logo: #DADADA plus the brand orange. It
            has been in `public/` since delivery 1 waiting for exactly this —
            the primary one is dark grey and would not show on #272727. */}
        <Image
          src="/logo-secundary.svg"
          alt="Sevenz"
          width={111}
          height={40}
          className="h-7 w-auto"
          priority
        />
        <div className="ml-auto shrink-0">
          {/* Desktop: the usual popover, with its list inside. Phone: a link to
              /notificaciones, because a 320px popover anchored to the corner of
              a 375px screen has nowhere to land. It is the same split the app
              already made, except the phone now has a door in the header too
              and not only in the bottom bar. */}
          <div className="hidden md:block">
            <NotificationsButton className="text-white hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/40" />
          </div>
          <Link
            href="/notificaciones"
            className="relative flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-white outline-none transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/40 md:hidden"
          >
            <Bell className="size-4 shrink-0" aria-hidden="true" />
            Notificaciones
            <UnreadBadge />
          </Link>
        </div>
      </div>

      {/* What goes away on scroll. It disappears at once, unanimated: animating
          the exit moves the screen while the owner is already reading, and on a
          cheap phone it stutters. Same call as `HideWhileSearching`.

          The ~56px jump on collapse is inherent to any header that shrinks, and
          it is the price of keeping the search field up top. The two guards
          above exist so it happens ONCE and not in a loop. */}
      {collapsed ? null : (
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            {/* `first_name` is required by both signup and "Mi negocio", in the
                browser and on the server, so it is treated as present. The
                guard is only for a row that predates that rule: rendering
                "¡Hola !" would be worse than dropping the name. */}
            <p className="text-2xl font-semibold text-white">
              ¡Hola{firstName ? ` ${firstName}` : ""}!
            </p>
            {/* At both widths now. It used to be `md:hidden` because the app bar
                carried the business name from md up and showing it twice read
                as a mistake; on this screen that bar is gone, so this is the
                only place the owner sees which business they are in. */}
            <p className="flex items-center gap-1.5 text-sm text-white/70">
              <Store className="size-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{businessName}</span>
            </p>
          </div>
          {lastSignIn ? (
            /* `shrink-0` and `whitespace-nowrap` together are what keep this at
               two lines. As a plain flex child a long name squeezes it into
               four: "Última conexión: / 12 sept. 2026, 11:45 p. / m." The
               greeting wraps instead, and that reads fine. */
            <p className="shrink-0 text-right text-xs leading-tight whitespace-nowrap text-white/70">
              Última conexión:
              <br />
              {lastSignIn}
            </p>
          ) : null}
        </div>
      )}

      {children}
    </header>
  );
}

// The badge, in its own component for one concrete reason: to subscribe to the
// context in here and not in the header. If `HomeHeader` read
// `useUnreadNotifications()`, every change to that number would re-render the
// whole header — search field included, with the owner typing in it.
function UnreadBadge() {
  const { unreadCount } = useUnreadNotifications();
  if (unreadCount <= 0) return null;
  return (
    // Identical to the bottom bar's, on purpose: it is the same notice seen
    // from two places and it has to be the same red dot.
    //
    // It carried a `ring-2 ring-brand-primary` for half an hour, on the grounds
    // that the red did not reach the 3:1 WCAG 1.4.11 asks of a graphic that
    // means something. Two things were wrong and `npm run qa:contraste` said
    // both: the red against #272727 is 3,14:1 — it passes on its own — and a
    // ring in the exact colour of the header it is drawn on is invisible, so it
    // was fixing nothing. The white number inside sits at 4,76:1, which is the
    // one that is genuinely tight: if anyone lightens that red, it falls first.
    <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-medium text-white">
      {unreadCount > BADGE_MAX ? `${BADGE_MAX}+` : unreadCount}
    </span>
  );
}
