# Sevenz UI rules

Extracted from the Cartera and client-detail redesigns. These are the defaults
for any new screen, dialog or form — deviating from one is a decision worth
stating, not an accident.

## Screen structure

**Sections are introduced by a title, not a divider.**

```tsx
<h2 className="mt-1 text-xl font-semibold">Cartera pendiente</h2>
```

- `text-xl font-semibold` — one title style, everywhere. There is no "small
  section label" variant; if a heading feels too heavy, the section probably
  doesn't need one.
- **20px above each title, measured on screen** — the separation between one
  part of a screen and the next. Nothing else is used for that job.
- **A margin adds to a flex gap, it does not collapse into it.** These pages are
  flex columns with `gap-4` (16px), so `mt-1` (4px) is what produces 20px. Quote
  what a ruler would show, never the token: the first version of this rule said
  "40px" while `mt-10` inside the same `gap-4` column actually rendered 56px.
- Below the title stays at the container's 16px, so the heading reads as
  attached to the content it introduces rather than floating between blocks.
- The title names **what is actually underneath it**. "Historial de
  movimientos" means a list of movements; a list of clients is "Clientes". The
  same name must not label two different screens.

**Two heading levels, and only two.**

| Level | Style | What it is |
|---|---|---|
| `h1` | `text-2xl font-semibold` | The screen's own name — "Malas pagas", or the client's name. Cartera uses the greeting in this slot. One per screen, at most. |
| `h2` | `text-xl font-semibold` + 20px above | A section within the screen — "Cartera pendiente", "Clientes", "Puntaje de crédito". |

A screen with a single block of content still gets its `h2` if that block is a
distinct thing — "Malas pagas" names the screen, "Clientes" names the list on
it. Skipping it because there is only one section is how screens end up
inconsistent with each other.

**Content inside a section goes in an outlined card.**

```tsx
<div className="rounded-lg border bg-muted/30 px-3 py-2">
```

Every card on a screen uses this exact combination, so the rate calculator, the
balance cards and a client's info block read as one family.

## Contextual bar (phone only)

A screen reached *from* somewhere — a client, Malas pagas — replaces the app
header below `sm` with its own bar, rather than stacking a second one on a
screen that can least afford the height. `AppHeader` hides itself on those
routes; the screen renders the bar.

```tsx
<div className="flex items-center border-b pb-3 sm:hidden">
  <Button variant="ghost" size="icon" asChild className="-ml-2">
    <Link href="/dashboard" aria-label="Volver a Cartera">
      <ChevronLeft className="size-5" />
    </Link>
  </Button>
</div>
```

- **Back is a bare `ChevronLeft`**, never a labelled button. The destination is
  named in `aria-label`, not on screen.
- It carries the same `border-b` the app header does, and must be **full-bleed**:
  `main` wraps every page in `p-4`, so without `-mx-4 -mt-4 px-4` the rule stops
  16px short of both edges and the bar floats below the top — visibly not a
  header. The negative margins cancel that padding; `px-4` puts the contents
  back on the page's own inset.
- `size="icon"` (32px), matching the share and message buttons that sit beside
  it on a client's screen. Below the 44px commonly recommended for touch —
  accepted for consistency within the bar, worth revisiting if it proves fiddly
  on a real phone.
- The client screen keeps this bar at every width, because it also carries
  share and message. Malas pagas hides it from `sm` up, where the real header
  returns and a lone back button would duplicate the sidebar.

## Lists: cards on a phone, table from md up

A list of records is a **table from `md` (768px) up and cards below it** — the
same rows, the same filters and sorting above them, switched with CSS.

- `md`, not `sm`, so a screen either behaves like a phone or it doesn't: the
  bottom nav switches at the same width.
- The card carries only what the table shows at that width. Before adding a
  field to a card, check whether the table already hides it above `md` —
  Puntaje, Último abono and Acciones are `hidden md:table-cell`, so the client
  card drops nothing a phone ever had.
- The whole card is one button that opens the record, with a `ChevronRight` on
  the right to say so. No per-record action buttons: they compete with the
  tap-anywhere gesture on the smallest screen, and they live on the record's
  own page.
- **A card carries less than a table row, not the same content restyled.** The
  `Bs.` line and the leading icons were tried on the client card and removed:
  name, document, amounts and status is already dense on a 375px screen, and
  each extra element costs more than it adds. The `Bs.` line stays in the table,
  where there is room. Reviewing it on a real screen settled this; arguing it
  beforehand did not.
- **The client card is one row, not a stack.** Left to right: a `3px`
  `self-stretch` status-color bar, the identity block (`flex-1`: name · document
  on one line, the status chip below, a "Mala paga" chip alongside it when
  flagged), the amounts block (right-aligned, one row per currency, the code
  — `USD`/`EUR` — inline after the figure and dropped entirely for a COP
  owner), then the chevron. The status chip is the same
  `CLIENT_STATUS_BADGE_CLASS` pill the table uses — a plain-text version was
  tried here and reverted once it was on screen next to real data. The bar is
  its own accent (`CLIENT_STATUS_ACCENT_CLASS`), since a pill's own background
  color doesn't translate to a 3px stripe; `dentro_del_plazo` reads green on
  the bar (matching the reference this layout was built from) against sky
  blue on the chip itself, matching the table. `bg-background` (plain white),
  not the `bg-muted/30` every other outlined card on this app uses — this
  card is meant to sit on a page, not blend into one.
- **The name gets a protected minimum, not an equal share.** A long name, the
  (rare) "revisar" tag, and a real document number all fit on one line by
  every non-name segment being capped or shrinkable — but a plain equal
  shrink still crushes the name to a couple of letters, since a shrink-0
  sibling forces 100% of the squeeze onto whatever the one flexible item is.
  The name carries `min-w-[64px]` so it always shows something legible; the
  document (`max-w-10`, ~40px) is what gives way first, down to just its
  leading digits or the `·` alone in the worst case — acceptable, since the
  full document is one tap away on the client's own page.
- To drop the secondary `Bs.` line elsewhere `ExchangeRateBalanceDisplay` is
  used, pass `showSecondary={false}` — **never `ledger={null}`**, which also
  silently reformats a USD figure with the COP formatter. This card formats
  amounts directly with `formatLedgerAmount` instead of that component, since
  its label-above-amount shape doesn't fit a single inline row.

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
