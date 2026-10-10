"use client";

import { useEffect, useState, useTransition, type ComponentType, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChartColumn, Home, Loader2, Menu, Package, Plus, Users } from "lucide-react";
import { useSidebar } from "@/components/ui/sidebar";
import { useTour } from "@/components/dashboard/tour-context";
import { useUnsavedChangesGuard } from "@/components/unsaved-changes-context";
import { useRevisionEnCurso } from "@/components/import/revision-en-curso";
import { cn } from "@/lib/utils";
import { useGuardiaDeCuentaPausada } from "@/components/dashboard/cuenta-pausada";

// The four places the bar navigates to, in order, before Menú. Exact pathname
// matching, not startsWith: a client's own screen replaces this whole bar
// anyway (see onClientDetail below), so there is no case where a child route
// should light up its parent here.
//
// NOTIFICACIONES LEFT THIS BAR on 2026-10-03, with delivery 3 of the redesign.
// It is not gone: it moved to the Inicio header, where it sits with its own
// unread badge, and `/notificaciones` is still a page the sidebar reaches. What
// it stopped being is one of the things a thumb can reach without reading.
//
// Reportes took the slot. The trade is deliberate: a notification is something
// you are told about (the badge does that from the header), while a report is
// something you have to decide to go and look at, which is exactly what a
// navigation bar is for.
//
// ─────────────────────────────────────────────────────────────────────────
// A FIFTH SLOT, AND IT OVERRULES SOMETHING WRITTEN HERE
//
// Owner's decision, 2026-10-09, from Figma frame 1175:5881: Catálogo joins the
// bar, which goes from four slots to five.
//
// The displaced reason is kept because it was a real measurement, not a whim:
// the bar was held to four on the grounds that four is what a thumb reaches
// without reading, and on 2026-10-03 "Agregar" was moved OUT to a floating
// button partly to protect that budget. Five slots cost touch width — 75px
// each at 375px instead of 93px — and that number is the thing to look at
// again if anybody reports mistaps.
//
// What bought it: a catalogue is the screen the shopkeeper opens mid-sale, with
// a customer in front of them asking a price. The sidebar is two taps and a
// read; the bar is one tap. The entry was in the sidebar until today and comes
// OUT of it in the same change — two doors to the same drawer is the thing
// DESIGN-SYSTEM.md warns about, and it would have been the obvious shortcut.
const DESTINATIONS = [
  { href: "/dashboard", label: "Inicio", icon: Home },
  { href: "/reportes", label: "Reportes", icon: ChartColumn },
  { href: "/productos", label: "Catálogo", icon: Package },
  { href: "/clients", label: "Clientes", icon: Users },
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

// Only the three destinations can be marked — Menú opens a sheet and Agregar is
// an action, so "selected" has no meaning for either. Deliberately exact-match
// only: Malas pagas, Subir libreta and Mi negocio live in the sidebar rather
// than in this bar, and a highlight meaning "somewhere in this section" would
// apply inconsistently across them.
//
// THE MARK IS A PILL **AND** AN UNDERLINE, owner's call on 2026-10-04 when the
// Figma spec and the shipped code disagreed: the spec drew the grey #f5f5f5
// pill (which is `--muted`), delivery 3 had shipped an underline, and the
// answer was both. The pill carries the "you are here" at a glance and the
// underline survives the case the pill is weakest at — a cheap screen in
// sunlight, where a 4% grey against white is the first thing to disappear.
//
// The underline is ALWAYS in the DOM, transparent when inactive. Rendering it
// only for the active item would make every label jump 5px the moment it became
// active, which on a bar of four is four different heights during a single
// navigation. The pill can afford to come and go because it wraps the content
// instead of sitting under it.
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
      <div className="flex flex-col items-center gap-1.5">
        <div
          className={cn(
            "flex flex-col items-center gap-1 rounded-lg px-3 py-1 text-[11px] font-medium transition-colors",
            active ? "bg-muted text-foreground" : "text-muted-foreground",
          )}
        >
          {children}
        </div>
        <span
          aria-hidden="true"
          className={cn("h-0.5 w-6 rounded-full", active ? "bg-foreground" : "bg-transparent")}
        />
      </div>
    </div>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { guard } = useUnsavedChangesGuard();
  const { toggleSidebar } = useSidebar();
  const tour = useTour();
  const overlayOpen = useOverlayOpen();
  const keyboardOpen = useKeyboardOpen();
  const { revisando } = useRevisionEnCurso();

  // Drives the spinner. useLinkStatus can't be used here: this link calls
  // preventDefault so the unsaved-changes guard runs first, and a link whose
  // default was prevented never reports a pending state.
  const [isPending, startTransition] = useTransition();
  const [goingTo, setGoingTo] = useState<string | null>(null);

  // The bar does not render at all on a client's own screen — see below.
  // Note the trailing slash: /clients (the list) keeps its bar, only
  // /clients/<id> loses it.
  const onClientDetail = pathname.startsWith("/clients/");

  // THE FLOATING BUTTON CHANGES WHAT IT DOES ON THE CATALOGUE.
  //
  // Frame 1175:5881 draws a floating "Crear producto" on that screen. It is
  // this same button rather than a second one, and that is what fixes a bug
  // found by running the screen on 2026-10-09: the catalogue had its own
  // "Agregar producto" while this one said "Agregar" and opened **Registrar
  // movimiento** — two controls, one word, two different drawers, and the
  // floating one is the big one.
  //
  // It stays in `MobileNav` and does not move into the page because all four
  // conditions above — a dialog is open, the keyboard is up, a libreta is
  // being reviewed, we are on a client's screen — apply to it exactly as they
  // apply to the bar. A page-owned button would have to copy all four, and the
  // day one of them changed it would survive a keyboard the bar correctly got
  // out of the way of.
  //
  // So it navigates to `?nuevo=1` and the catalogue opens its own dialog from
  // that marker, exactly as Inicio already does. The mechanism is proven,
  // including the two traps `ClientSearchDialog` documents: repeat taps, and
  // clearing the marker through the router rather than `replaceState`.
  const enCatalogo = pathname === "/productos";
  const agregarHref = enCatalogo ? "/productos?nuevo=1" : "/dashboard?nuevo=1";
  const agregarLabel = enCatalogo ? "Crear producto" : "Agregar";
  // Cuenta pausada: ni se navega. Sin esto el boton llevaria a Cartera para
  // que alli saliera el dialogo, y desde Clientes eso es un salto de pantalla
  // que nadie pidio.
  const guardia = useGuardiaDeCuentaPausada();

  // Mientras una libreta leída espera confirmación, la barra se va: son
  // cuatro salidas de un toque junto al pulgar con veintitantos movimientos
  // sin guardar detrás. Todas preguntan antes de salir —van por el mismo
  // guard—, pero un diálogo que salta cuatro veces por error es peor que no
  // tener el atajo. Queda una sola salida, el chevron, y esa sí pregunta.
  if (overlayOpen || keyboardOpen || revisando) return null;

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
        // Replace, never push: for Inicio it keeps the home screen from
        // stacking behind wherever the owner came from (matching the sidebar),
        // and for a client's page it keeps the marked URL out of history, so
        // Back can't land on it and reopen the dialog.
        router.replace(href);
      });
    });
  }

  const glyph = (href: string, Icon: ComponentType<{ className?: string }>) =>
    isPending && goingTo === href ? (
      <Loader2 className="size-6 animate-spin" />
    ) : (
      <Icon className="size-6" />
    );

  // The bar's own classes. The layout reserves exactly this much space, and a
  // variant that measured differently would strand the last row of content.
  const navClass = cn(
    "fixed inset-x-0 bottom-0 z-40 border-t bg-background touch-manipulation md:hidden",
    "pb-[env(safe-area-inset-bottom)]",
  );

  // Nothing at all on a client's own screen — neither the bar nor the floating
  // button. The bar used to carry "Agregar abono" / "Agregar fiado" here, but a
  // phone's own browser chrome — the native notification and address bars —
  // sits in exactly that strip and covered them, so the two actions an owner
  // comes to this screen for could be unreachable. They now live in the page
  // itself, under "Marcar como mala paga", where nothing can overlap them. The
  // screen keeps its own back chevron at the top for getting out.
  if (onClientDetail) return null;

  return (
    <>
      {/* AGREGAR, FLOATING ABOVE THE BAR since 2026-10-03.

          It lives inside this component and not in its own file on purpose:
          every condition above — a dialog is open, the keyboard is up, a
          libreta is being reviewed, we are on a client's screen — applies to it
          exactly as it applies to the bar. A second component would have to
          copy all four, and the day one of them changed, the button would
          survive a keyboard that the bar correctly got out of the way of.

          Why it left the bar: it was the fourth of four equal-looking slots,
          three of which navigate. The only thing on this screen that WRITES
          looked like the three that only move you. Floating, it is the one
          control that is obviously not a destination. */}
      <button
        type="button"
        // Its own marker, not the one the page CTA uses. The tour finds its
        // target with querySelector, which returns whichever matches first in
        // the DOM — two elements sharing a marker means it can highlight the
        // wrong one, or one that isn't on screen.
        // The tour marker only on the movement variant. The tour finds its
        // target with querySelector, which returns whichever matches first in
        // the DOM; a marker on a button that opens a different dialog is a
        // tour that explains the wrong thing.
        data-tour={enCatalogo ? undefined : "new-client-button-mobile"}
        aria-label={enCatalogo ? "Crear producto" : "Agregar movimiento"}
        onClick={() => {
          if (guardia()) return;
          guard(() => {
            // Step 1's tooltip only renders on the dashboard. This code is
            // unreachable from a client's page now that this returns null
            // there, but the guard stays cheap and correct if that changes.
            if (tour.step === 1) tour.advance();
            setGoingTo(agregarHref);
            startTransition(() => router.replace(agregarHref));
          });
        }}
        // Sits one gap above the bar, inside the strip `AppMain` already
        // reserves — so it never covers the last row of a list.
        // Figma spec, 2026-10-04: 56px tall, pill radius, 16 of padding on the
        // label side and 8 on the glyph side — the plus sits in a 40px box of
        // its own, so the smaller padding keeps it optically centred instead of
        // pushed against the edge.
        className={cn(
          "fixed right-4 z-40 flex h-14 items-center gap-1 rounded-full bg-primary py-2 pr-2 pl-4",
          "text-[17px] font-medium text-primary-foreground shadow-lg transition-colors",
          "active:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none md:hidden",
          "bottom-[calc(4rem+env(safe-area-inset-bottom)+1rem)]",
        )}
      >
        {/* Label first, glyph second, from the spec. It reads as a sentence
            that way — "Agregar +" — where the other order reads as an icon
            button that happens to have a word stuck to it. */}
        {agregarLabel}
        <span className="flex size-10 items-center justify-center">
          {isPending && goingTo === agregarHref ? (
            <Loader2 className="size-6 animate-spin" aria-hidden="true" />
          ) : (
            <Plus className="size-6" aria-hidden="true" />
          )}
        </span>
      </button>

      {/* z-40, below the z-50 every Dialog/Sheet/Drawer in this app uses. The
          bar also unmounts while one is open, so this is belt and braces.
          touch-action: manipulation drops the browser's wait for a possible
          double-tap-to-zoom, which otherwise delays every single tap. */}
      <nav className={navClass} aria-label="Navegación principal">
        <div className={cn("flex items-stretch", NAV_HEIGHT_CLASS)}>
          {/* The three destinations, then Menú. All three are anchors rather
              than buttons: Next prefetches a Link's href while it is on screen,
              and this bar always is, so each destination is preloaded before
              the owner ever taps. */}
          {DESTINATIONS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={(e) => navigate(e, item.href)}
              className="flex flex-1"
            >
              <NavItem active={pathname === item.href} className="w-full">
                {glyph(item.href, item.icon)}
                {item.label}
              </NavItem>
            </Link>
          ))}

          {/* Menú. A button and not a link, because it opens the sidebar sheet
              rather than going anywhere — and never marked, for the same
              reason. It is also why it cannot look "active": the sheet is a
              Radix dialog, so opening it unmounts this whole bar.

              THIS IS WHAT LETS THE INICIO HEADER DROP ITS HAMBURGER on a phone.
              The header kept one through delivery 2 precisely because this slot
              did not exist yet; the two must not both ship. */}
          <button
            type="button"
            onClick={() => guard(() => toggleSidebar())}
            className="flex flex-1"
            aria-label="Abrir menú"
          >
            <NavItem active={false} className="w-full">
              <Menu className="size-6" />
              Menú
            </NavItem>
          </button>
        </div>
      </nav>
    </>
  );
}
