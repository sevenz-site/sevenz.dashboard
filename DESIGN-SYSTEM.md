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
  color doesn't translate to a 3px stripe, but keyed to match each status's
  chip color family — `dentro_del_plazo` first shipped as a green bar against
  its own sky-blue chip and got corrected once seen side by side.
  `bg-background` (plain white), not the `bg-muted/30` every other outlined
  card on this app uses — this card is meant to sit on a page, not blend into
  one.
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

**Estas reglas aplican a los DOS repos: `Sevenz/dashboard` y `Sevenz/Web`
(sevenz.site y la calculadora).** Cada uno tiene su propia copia de
`components/ui/button.tsx`, así que un cambio aquí se debe allá.

- **Every labelled button is 40px tall** (`h-10`) — `default`, `sm` and `lg`
  differ only in padding and type size. A button is the same height in a
  dialog, a form, a page and the bottom bar.
- `xs` (24px) is the deliberate escape hatch for genuinely tight spots.
- `icon-*` sizes stay square; they have no label to align to.
- Primary action filled, secondary outlined. On a client's screen: "Agregar
  fiado" filled, "Agregar abono" outlined.
- **Un botón abraza su contenido.** No se estira a `w-full` salvo que ocupe una
  fila entera por diseño —el "Agregar movimiento" del teléfono, por ejemplo—.
  Un botón de ancho completo debajo de una imagen se lee como una barra, no
  como una acción.

**Deriva encontrada el 2026-09-07:** la web nunca siguió la regla de los 40px.
Su `button.tsx` tenía `default: h-8`, `sm: h-7` y `lg: h-9` — 32, 28 y 36px —
mientras el dashboard llevaba 40 en los tres. Nadie lo notó porque las dos
copias del componente viven en repos distintos y esta regla solo estaba escrita
en uno. Corregido: los nueve botones de sevenz.site y de la calculadora miden
40px, verificado en el navegador.

**Los buscadores de clientes miden 40px** (`h-10` sobre el `Input`), decidido
el 2026-09-20: comparten vecindad con botones y con 32 se veían hundidos al
lado de ellos, y el disparador de Cartera ya medía 40 — el mismo buscador
tenía dos alturas según la pantalla.

**Known gap:** el resto de los `Input` y los `SelectTrigger` siguen en 32px,
así que un botón junto a un campo en la misma fila se ve más alto. Lo más
visible, la fila de WhatsApp del signup. La altura del buscador se subió en su
propio componente y NO en `components/ui/input.tsx` a propósito: tocar la base
mueve el alta de cliente, los movimientos y el signup a la vez, y eso merece
una pasada con sus propias pruebas, no ir de polizón en un cambio del
buscador.

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

## The document field takes digits and nothing else

Every place that asks for a client's cédula uses `DocumentIdInput`, never a
bare `Input`. There are four: registering a client, editing one, the import
review table, and the modal on the public share link.

**The stored value is digits.** No prefix, no dots, no letters. That is what
keeps "pendiente" and "no tiene" out of the column — a shopkeeper in a hurry
will type anything to get past a required field, and junk there is what breaks
matching a person to a record later.

**Venezuela shows a "V-" cue beside the box.** Outside the input, never part of
the value. Colombia shows nothing: a Colombian cédula is plain digits, and half
the businesses on Sevenz are Colombian.

A first version stored the prefix and was dropped before release, on
2026-09-17. Worth knowing why, so nobody rebuilds it:

- Every Venezuelan record carried the same letter, so the field said nothing.
- The country already lives in `clients.document_country`, since migration 035.
- `normalizeDocumentId` had to strip the letter again to compare two records,
  so it was written only to be ignored — and it broke duplicate detection on
  the way in, silently, until a test caught it.

**A value with letters is left exactly as it is.** The field falls back to a
plain box with a note. Showing a foreign "E-12345678" in a digits box would
drop the E the next time anyone saved the form, which is losing a real fact
about a person by accident. Of the 158 documents in production, 154 are already
bare digits and 4 are something else.

## Traps that have actually bitten this codebase

**`Input` ignora tu tamaño de fuente desde 768px.** `components/ui/input.tsx`
trae `md:text-sm` en su clase base. Si le pasas `text-2xl` por `className`,
`tailwind-merge` sí elimina el `text-base` que choca —mismo grupo— pero **no
toca `md:text-sm`**, porque una variante responsive es otro grupo. Y Tailwind
emite las variantes responsive DESPUÉS de las utilidades base, así que a partir
de 768px gana la del componente.

Encontrado el 2026-09-07 en la calculadora: los montos, que debían ser lo más
grande de la tarjeta, se renderizaban a **14px en escritorio** y a 24px en
móvil. Llevaba así desde que se escribió. Pasó desapercibido porque toda la
verificación de este proyecto se hace a 375px, donde el bug no existe.

Regla: si le cambias el tamaño de fuente a un `Input`, pasa también la variante
—`text-2xl md:text-2xl`— o no se lo cambias. Y **mide `getComputedStyle` en las
dos anchuras**, no solo en la del teléfono: un tamaño puede estar correcto en
una y perdido en la otra, y una captura de móvil nunca lo va a mostrar.



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

**A third-party component painted one thing with a literal instead of a token,
and only that thing broke.** Sonner routes every part of a toast through
`--normal-bg` / `--normal-text`, which `components/ui/sonner.tsx` maps to our
popover tokens — except the description, hardcoded `#3f3f3f` in light and
`#e8e8e8` in a theme sonner resolves *itself*. `next-themes`' provider is
mounted nowhere in this app, so sonner fell back to `system`, read the phone's
OS preference and picked its dark literal while our tokens stayed light.
Measured 2026-09-08 on the shipped build: title 19.8:1, description **1.23:1**
on the same white card. When a colour and the surface behind it come from two
different sources, they will eventually disagree; state both from the same
token pair (`color-mix(in oklab, var(--popover-foreground) 76%, var(--popover))`)
so the pair cannot come apart.

### Un Server Component no puede pasar una función como `children`

Encontrado el 2026-09-20 construyendo el buscador de Cartera. `ClientSearchSheet`
recibía `children` como render prop —`(close) => <Lista onNavigate={close} />`—
para que la vista previa pudiera cerrar la hoja al abrir un cliente. Compila,
pasa el typecheck, y revienta en ejecución con un **500 en la pantalla
principal**:

```
Error: Functions are not valid as a child of Client Component
```

`app/(app)/dashboard/page.tsx` es un Server Component, y React no puede
serializar una función a través de esa frontera. El typecheck no lo ve porque
no es un error de tipos: el tipo es correcto y el transporte no.

La regla, entonces: **un componente cliente que quiera dar algo a sus hijos
—cerrarse, su estado, lo que sea— lo pasa por contexto, no como prop**, en
cuanto exista la posibilidad de que quien lo monte sea una página. El patrón
render prop sigue siendo válido *entre* componentes cliente: `FilterChip`, en
`client-filters.tsx`, lo usa y funciona, porque quien lo monta es la hoja y no
la página.

### Un solo buscador de clientes, en dos formas

Las cuatro listas —Cartera, Clientes, Malas pagas, Papelera— usan
`components/dashboard/client-search-sheet.tsx` y ninguna otra cosa. El archivo
exporta dos formas, y cuál toca lo decide **la distancia entre el campo y la
lista que filtra**, no el gusto:

- **`ClientSearchInline`** — Clientes, Malas pagas, Papelera. Campo de verdad y
  chips justo debajo, en la propia pantalla. La lista está a continuación, así
  que se filtra a la vista y no hay nada que abrir ni que cerrar. Es la forma
  por defecto.
- **`ClientSearchSheet`** — solo Cartera. Ahí el campo va arriba del todo y la
  lista queda al final, detrás de las tarjetas de capital y la tira de tasas.
  Escribir y no ver nada cambiar, porque lo que cambia está a una pantalla de
  distancia, se lee como que el buscador está roto; por eso Cartera abre una
  hoja que trae el resultado consigo.

**Donde la lista se ve, un modal sobra.** Las tres primeras pantallas nacieron
con la hoja el 2026-09-20 y se corrigieron el mismo día: obligaban a abrir algo
para filtrar una lista que ya estaba delante.

El bloque `<ClientFilters>` que vivía sobre cada lista se **borró** el
2026-09-20 al migrar la última pantalla, en vez de dejarlo sin usar: dos
bloques de filtros sobre el mismo estado es exactamente como vuelven a
separarse, que es el problema que el componente compartido existía para
resolver.

Dos detalles que ya costaron una pasada:

- El disparador **no es un `<input>` de verdad**. Un input real abre el teclado
  del teléfono *antes* de que exista la hoja, y el navegador recoloca las dos
  cosas a destiempo. Es una caja que lo parece; el input vive dentro, con
  `autoFocus`.
- Los chips van en una fila con `overflow-x-auto` y cada chip lleva
  `shrink-0`. Sin `shrink-0`, flex comprime los chips para que quepan y recorta
  justo la etiqueta que lleva el valor activo (`Desde 1000`), que es la única
  señal de que la lista está filtrada.

## El naranja de la marca es `--brand`, y no es `amber`

`#F66B02` — el mismo de `logo.svg` y de `icon.svg`. Vive en `globals.css` como
`--brand`, así que en clases se usa `text-brand`, `bg-brand`, `ring-brand`.

**Nunca se incrusta el hex suelto en un componente.** Estuvo sin token hasta el
2026-09-18 —solo había grises— y la primera pieza que lo necesitó fue el banner
de feedback de `/s/[token]`. Un hex suelto en un archivo es cómo empieza la
deriva: al segundo sitio ya nadie sabe cuál es el bueno.

**Y no se sustituye por `amber`.** En este código `amber-500/600` ya significa
**"plazo vencido"** — `client-card.tsx`, `balance-card.tsx`,
`credit-score-radial-chart.tsx`. Usarlo para un acento de marca haría que un
aviso de cobro y una invitación se vieran igual.

**Hoy solo va sobre superficies oscuras**, que se ven igual en claro y en
oscuro; por eso `--brand` tiene el mismo valor en los dos temas. Sobre fondo
blanco **no pasa el piso de contraste de abajo**: si algún día hace falta ahí,
hay que oscurecerlo en `globals.css` primero, no en el componente.

## Contrast floor

Text must clear **4.5:1** against the surface it actually sits on, and UI
borders that carry meaning must clear 3:1 — WCAG 2.2 AA, criteria 1.4.3 and
1.4.11. Measure it against the *computed* background, not the page background:
a toast, a popover and a card can all be different surfaces.

Measured on white (`#ffffff`) as of 2026-09-08:

| Token | Colour | Ratio | |
|---|---|---|---|
| `--foreground` / `--popover-foreground` | `#0a0a0a` | 19.8:1 | pass |
| toast description (after the fix) | `#3a3a3a` | 11.37:1 | pass |
| `--muted-foreground` | `#737373` | 4.74:1 | pass, with no margin |
| `--destructive` | `#e7000b` | 4.77:1 | pass, with no margin |
| `--ring` (light) | `#868686` | 3.64:1 | pass — was `#a1a1a1` at 2.59:1 |
| `--ring` (dark) | `#a1a1a1` | 7.63:1 | pass — was `#737373`, darker than the light one |

`--muted-foreground` clears the bar by 0.24. Do not darken the surface behind
it or lighten the token without re-measuring; it is the one that will fail
first.

**Measure the colour that gets DRAWN, not the token.** The ring row above said
2.58:1 and failed for months, and the real number was worse: every one of the
twelve components applied it as `focus-visible:ring-ring/50`, at half opacity,
so what a person actually saw was **1.54:1 in light and 1.87:1 in dark** — the
dark theme passed on the token and failed on the screen. Fixed 2026-09-14 by
dropping the `/50` everywhere and re-picking both tokens. A token measured
without its opacity is not a measurement.

The focus ring is also the one token whose failure nobody reports: it is
`focus-visible`, so it only appears when navigating by keyboard, and everyone
testing with a finger never sees it at all.

## Before calling UI work done

Render it and **measure at 375px**, not just at desktop width. Check
`scrollWidth > clientWidth` for horizontal overflow, and check the longest
realistic content — a long name, a long amount — not the happy path. Every
layout bug in this file was found by rendering, none by reading.

The browser preview emulates **width only**. It has no home indicator, no iOS
keyboard and no collapsing Safari toolbar, so `env(safe-area-inset-*)`,
keyboard behaviour and fixed-element stability can only be confirmed on a real
phone. Say so rather than reporting them as verified.
