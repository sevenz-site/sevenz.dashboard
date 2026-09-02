# Sevenz UI rules

Extracted from the Cartera and client-detail redesigns. These are the defaults
for any new screen, dialog or form — deviating from one is a decision worth
stating, not an accident.

## Screen structure

**Sections are introduced by a title, not a divider.**

```tsx
<h2 className="mt-10 text-xl font-semibold">Cartera pendiente</h2>
```

- `text-xl font-semibold` — one title style, everywhere. There is no "small
  section label" variant; if a heading feels too heavy, the section probably
  doesn't need one.
- `mt-10` — 40px above each title. That gap is what separates one part of a
  screen from the next. Nothing else is used for that job.
- The title names **what is actually underneath it**. "Historial de
  movimientos" means a list of movements; a list of clients is "Clientes". The
  same name must not label two different screens.

**Content inside a section goes in an outlined card.**

```tsx
<div className="rounded-lg border bg-muted/30 px-3 py-2">
```

Every card on a screen uses this exact combination, so the rate calculator, the
balance cards and a client's info block read as one family.

## Buttons

- **Every labelled button is 40px tall** (`h-10`) — `default`, `sm` and `lg`
  differ only in padding and type size. A button is the same height in a
  dialog, a form, a page and the bottom bar.
- `xs` (24px) is the deliberate escape hatch for genuinely tight spots.
- `icon-*` sizes stay square; they have no label to align to.
- Primary action filled, secondary outlined. On a client's screen: "Agregar
  fiado" filled, "Agregar abono" outlined.

**Known gap:** `Input` and `SelectTrigger` are still 32px, so a button beside a
field in the same row is visibly taller. Most obvious on the signup WhatsApp
row. Worth unifying, not yet done.

## Icon buttons inside cards

Stacked in a column on the right of the card, `size-4`, `text-muted-foreground`
turning `text-foreground` on hover. Always carry `aria-label`, and `aria-pressed`
when they toggle something.

Where lucide has no "off" variant of an icon — the chart toggle, for instance —
carry the state in colour and `aria-pressed` rather than inventing a glyph.

## Empty values

Keep the row and show `—`. Every record then has the same shape, and a missing
phone or address is itself visible rather than silently absent.

## Numbers, dates and money

- Amounts: `Intl.NumberFormat("es-VE", { minimumFractionDigits: 2,
  maximumFractionDigits: 2 })`. Use **one formatter for every number in a
  cell** — `toFixed()` beside a formatted number prints an English decimal
  point next to a Spanish comma.
- The unit goes **on the amount**, not only in the column header: `Bs. 801,18`.
  Without it, a number beside a percentage reads as a second percentage.
- Dates: `es-VE` (`2 sept. 2026`, shorter than `es-CO`'s `2 de sept de 2026`),
  12-hour with `a. m.` / `p. m.`
- **Always pass an explicit `timeZone`.** Vercel runs UTC; formatting without
  one showed a Colombian owner 12:15 p. m. for a 7:15 a. m. event. Use the
  owner's country: `America/Caracas` or `America/Bogota`.

## Responsive

- Mobile stacks, `sm:` and up sits side by side. The bottom nav is the
  exception at `md:` (see below).
- **Decide layout with CSS media queries, not `useIsMobile`.** The hook resolves
  after hydration, so a JS-gated element pops in a beat late and shoves content
  — worst on the cheap phones this app runs on. Reserve the hook for behaviour
  that genuinely cannot be expressed in CSS.
- An iPhone in landscape is **812px wide** and therefore gets the desktop
  layout. Anything that depends on the breakpoint must survive a rotation.
- The bottom nav is `md:hidden` (768px). The client screen's own layout splits
  at `sm:` (640px). These do not align — between 640 and 768 both the desktop
  layout and the bottom bar are visible. Known, not yet reconciled.
- On a client's screen below `sm`, the app header is replaced by a contextual
  bar. Ayuda and Notificaciones are then only reachable from Cartera.

## Traps that have actually bitten this codebase

**Never rely on `flex` and `hidden` in one class list.** Which wins is decided
by stylesheet order, not class order. Render conditionally instead.

**Wide content scrolls in its own box**, never the page:
`min-w-0 overflow-auto`. `min-w-0` is load-bearing — a flex child defaults to
`min-width: auto` and will push the whole page sideways rather than scroll.

**A fixed panel must be bounded to the space it has.** The rate popover grew
past the viewport and its inputs ended up off-screen. Use
`max-h-[var(--radix-popover-content-available-height)]` with `overflow-y-auto`.

**Overlays live at `z-50`.** Anything fixed that must sit under them — the
bottom bar — is `z-40`.

**Radix leaves dialogs mounted after closing**, flipping `data-state` to
`closed`. Test `[role="dialog"][data-state="open"]`, never mere presence, or
whatever you toggle stays toggled forever.

**One `data-tour` marker per visible target.** The tour resolves with
`querySelector`, which returns the first match in the DOM — duplicate the
marker and it can highlight a hidden element, stalling onboarding.

## Before calling UI work done

Render it and **measure at 375px**, not just at desktop width. Check
`scrollWidth > clientWidth` for horizontal overflow, and check the longest
realistic content — a long name, a long amount — not the happy path. Every
layout bug in this file was found by rendering, none by reading.

The browser preview emulates **width only**. It has no home indicator, no iOS
keyboard and no collapsing Safari toolbar, so `env(safe-area-inset-*)`,
keyboard behaviour and fixed-element stability can only be confirmed on a real
phone. Say so rather than reporting them as verified.
