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

### Un popup en portal dentro de un Dialog de Radix no recibe toques

Un Dialog modal de Radix pone `pointer-events: none` en el `<body>` y solo lo
reactiva dentro de su propio contenido. Un popup montado en un portal
**hermano** —de otra librería, o de Radix pero fuera de su árbol de capas—
hereda ese `none`, y los toques lo atraviesan.

Medido el 2026-09-20 con el Combobox de Base UI dentro del buscador de
Cartera, que vive en un `Sheet`, y `Sheet` es Radix Dialog:

```js
getComputedStyle(document.body).pointerEvents  // "none"
getComputedStyle(item).pointerEvents           // "none"
document.elementFromPoint(x, y)                // el chip "Estado", de detrás
```

**Por qué esto es peor que un fallo normal:** la lista se ve perfecta, no hay
error en consola, y con teclado funciona —las flechas y Enter no pasan por el
puntero—. Falla solo al tocar con el dedo, es decir en el teléfono, que es
donde trabajan los tenderos. Una revisión en escritorio lo da por bueno.

**Qué hacer.** Un `Popover` de Radix no lo sufre: es una `DismissableLayer`, y
Radix le devuelve `pointer-events: auto` a sus propias capas. Comprobado en el
selector de país, que es Popover + cmdk dentro del diálogo de nuevo cliente y
funciona sin parche alguno. Un popup que no monta en portal tampoco lo sufre,
porque nunca sale del árbol al que Radix sí enciende los eventos — es lo que
hace hoy el buscador de clientes.

La regla, más allá del componente: **al meter un popup de una librería dentro
de otra, lo primero que se prueba es un toque real** —`elementFromPoint` sobre
el elemento, no una captura—, no que se vea bien.

Base UI se instaló y se quitó el mismo día por esto. La alternativa no fue
"otra librería mejor": fue quitar el portal, que es lo que hacía posible el
fallo.
### Un solo buscador de clientes, en dos formas

La forma la decide **si el resultado se ve desde donde estás escribiendo**, no
el gusto:

- **`ClientSearchInline`** (`client-search-sheet.tsx`) — Clientes, Malas pagas,
  Papelera. Campo y chips en la pantalla, y nada que se despliegue: el
  resultado son las tarjetas de abajo, a dos centímetros del campo. Un
  desplegable ahí enseñaría lo mismo dos veces y taparía justo lo que acaba de
  filtrar.
- **`ClientSearchCartera`** (`client-search-cartera.tsx`) — solo Cartera. Ahí
  la lista queda al final del documento, detrás de las tarjetas de capital y
  la tira de tasas: escribir y no ver nada cambiar se lee como que el buscador
  está roto. Las coincidencias salen justo debajo del campo, flotando sobre la
  pantalla en vez de empujarla.

**Las coincidencias son siempre `ClientResultList`** (`client-result-list.tsx`):
nombre + documento, la misma en Cartera y en el diálogo de "Agregar
movimiento". Vivía como marcado suelto dentro del diálogo y se extrajo el
2026-09-20 al llevarla a Cartera — dos copias de una lista de personas y
cédulas se separan en cuanto alguien retoca una, y el documento es lo que
distingue a tres Marías del mismo barrio.

**Cartera busca Y filtra**, que es lo que la diferencia del diálogo. El diálogo
solo encuentra y abre; en Cartera el texto va al estado compartido, así que la
cartera del final queda recortada al mismo criterio. El efecto secundario que
conviene conocer: hay que vaciar el campo para recuperar la cartera entera, y
por eso el aspa está siempre a mano.

**Mientras la lista está abierta se apartan "Agregar movimiento" y las
tarjetas de capital**
(`HideWhileResults`). La lista flota justo encima de ellos: un toque en el
último resultado que se pase unos píxeles abriría el alta de un movimiento en
vez de la ficha del cliente, y el dueño acabaría escribiendo un fiado cuando
lo que quería era mirar una cuenta.

Se aparta el bloque entero de tarjetas, también la única de un negocio
colombiano: ocupa el mismo sitio que las dos de uno venezolano y la lista la
tapa igual.

Ese "está abierta" se calcula **en el proveedor, una sola vez**, y lo leen el
buscador y el botón. Si cada uno lo dedujera por su cuenta, bastaría que uno
cambiara de criterio para dejar el botón visible bajo una lista abierta — es
decir, para reintroducir justo el error que esto evita. Y el apagado va con
retardo por lo de siempre: el toque desenfoca el campo, y un botón que
reaparece en ese instante vuelve a ocupar el sitio donde el dedo ya está
bajando.

Los chips van **pegados a la lista que ordenan**, nunca junto al campo cuando
los dos están lejos. En Cartera vivieron un rato arriba del todo, a una
pantalla de distancia de lo que tocaban: elegir "Plazo vencido" no enseñaba
ningún cambio.
### Al buscar se aparta el subtítulo, nunca el título

En Clientes, Malas pagas y Papelera, mientras el campo de búsqueda tiene el
foco **y solo en teléfono**, se oculta el subtítulo de la pantalla. El título
se queda, y la barra inferior también. Lo gobierna
`search-focus-context.tsx` (`HideWhileSearching`), porque el campo vive en la
lista y el título lo pinta cada página, que es un Server Component.

**El título nunca se va.** Es lo que dice en qué pantalla estás, y perderlo al
escribir desorienta más de lo que las dos líneas que ocupa llegan a estorbar.
Se probó ocultándolo el 2026-09-20 y se revirtió el mismo día.

Lo que se gana depende de la pantalla: en Papelera el subtítulo son tres
líneas y se nota; en Clientes es una sola y casi no. Se aplica igual en las
tres, porque un comportamiento que cambia de pantalla en pantalla se aprende
peor que uno que siempre hace lo mismo.

**El rótulo "Clientes" solo lo lleva Cartera.** En Malas pagas y Papelera se
borró el 2026-09-20: el título de la pantalla ya dice de qué lista se trata, y
debajo hay tarjetas con nombre y saldo que no necesitan que se las presente.
Cartera sí lo conserva, porque ahí la lista es una sección más entre otras
—capital, tasas— y sin rótulo quedaría pegada a los totales.

Esa cabecera de Cartera es **solo título y salida**: `Clientes` a la izquierda
y "Ver todos" a la derecha. **Los chips van en su propia fila, debajo.**
Estuvieron un rato compartiendo fila con "Ver todos", en el sitio del título,
y se leía como si "Ordenar por" fuese el nombre de la sección.

**El retardo de 180ms al salir no es cosmético, y es la única parte delicada.**
El dueño toca la tarjeta de un cliente; eso quita el foco del campo. Si el
subtítulo volviera en ese instante, el contenido baja ENTRE que el dedo toca y
que el navegador decide sobre qué elemento fue el clic — y abre la ficha del
cliente de arriba. Devolver la cabecera solo después de que el clic se
resuelva lo evita. Al entrar no hay retardo: apartarse tiene que sentirse
inmediato.

Lo que hace este fallo peligroso es que **con ratón no aparece**: un clic de
ratón es instantáneo y gana la carrera. Solo se ve tocando con el dedo. La
prueba, entonces, es tocar la SEGUNDA tarjeta de la lista y comprobar que
abre esa y no la primera. Y sigue haciendo falta aunque ahora se mueva menos:
en Papelera el subtítulo son tres líneas, más que de sobra.

De md hacia arriba no se oculta nada: sobra sitio y no hay teclado que se coma
media pantalla.
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

## Las tarjetas oscuras son oscuras en los dos temas

Dos piezas de la app son oscuras a propósito: el aviso "Instala Sevenz en tu
teléfono" (`components/install-app.tsx`) y el globo del recorrido de
bienvenida (`components/dashboard/tour-tooltip.tsx`). Las dos usan
`bg-[#272727]` literal y colores de texto `white/N`, no tokens.

No es descuido. Una pieza oscura en medio de una pantalla clara está diciendo
"esto de aquí es lo nuevo, mírame", y eso solo funciona si contrasta con lo
que la rodea. Con `bg-popover` el globo sería blanco sobre blanco en tema
claro y dejaría de hacer lo único que tiene que hacer.

Y por eso el texto tampoco puede ir en tokens: **sobre un fondo fijo, un token
que cambia con el tema es exactamente lo que rompe el contraste sin que nadie
se entere.**

Medido sobre `#272727` el 2026-09-20:

| Color | Ratio | |
|---|---|---|
| blanco (título) | 14,94:1 | pass |
| `white/70` (cuerpo) | 8,04:1 | pass |
| `white/60` (paso, Saltar) | 6,36:1 | pass |
| `--brand` `#F66B02` (acción) | 5,00:1 | pass |

El naranja es el que va más justo. Si alguien aclara ese fondo, es el primero
que cae: vuelve a medirlo antes de tocarlo.

**El globo del recorrido es solo para onboarding.** No es un tooltip de uso
general: para una ayuda contextual normal está el popover del sistema, que sí
sigue el tema.

## Un icono de marca entra con `currentColor`, no con su color

`components/icons/whatsapp.tsx` es el patrón. Un SVG que llega de diseño trae
su color escrito dentro (`fill="#126400"` en este caso). Al meterlo en la app
ese color se cambia por `currentColor` y el archivo original se guarda tal cual
en `public/icons/`, con un comentario en el componente diciendo que los dos
tienen que moverse juntos.

**Por qué, y no es purismo.** El mismo icono sale hoy en cinco sitios con
cuatro colores distintos: verde esmeralda en "Contactar vía WhatsApp" del
enlace público, el verde de marca `#128C4A` en "Compartir saldo", y el color
del texto en el botón de la cabecera del cliente y en "Escríbenos para
reactivarla". Con el color clavado, los cinco serían el mismo verde oscuro —
y en tema oscuro ese verde cae sobre un fondo casi negro, que es justo el sitio
donde nadie lo habría mirado. Medido el 2026-09-20: con `currentColor`, el
icono del enlace público pasa solo de `emerald-700` a `emerald-400` al cambiar
de tema, exactamente igual que el texto al que acompaña.

**El `viewBox` no se cuadra.** El de WhatsApp es 21×24. Con `size-4` la caja
mide 16×16 y el dibujo entra centrado a 14×14, porque `preserveAspectRatio`
vale `xMidYMid meet` por defecto: se comprobó que `escalaX === escalaY`. Pasarlo
a `0 0 24 24` para que llene la caja lo deformaría, y recortarlo a mano es
reescribir el trazado que mandó diseño.

**El icono va al lado que ya tenga su pareja.** "Contactar vía WhatsApp" en
`/s/[token]` lo lleva detrás del texto porque "Compartir saldo vía WhatsApp"
en la ficha del cliente ya lo llevaba así: son los dos lados del mismo trato y
espejados se leían como dos cosas distintas.

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
