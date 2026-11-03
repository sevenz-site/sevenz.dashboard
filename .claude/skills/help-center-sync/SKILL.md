---
name: help-center-sync
description: Compare the help centre of sevenz.site (Web/lib/soporte.ts and its step-by-step screenshots in Web/public/ayuda) against what a dashboard release changes, and bring it up to date — rewrite steps, re-take screenshots, add topics for new features, remove topics for features that no longer exist. Called from qa-regression-checklist on every release; also use it whenever the user asks to update, review or fix the «Ayuda» section, even if they don't name this skill.
---

# Help-centre sync

The owner's rule, 2026-11-03: *«La sección de ayuda debe mantenerse
actualizada con los flujos de cada funcionalidad, su paso a paso y
screenshots, así como incluir nuevos flujos, nuevas funcionalidades o
eliminar flujos o funcionalidades que ya no existan»*.

**Why this is a skill and not a reminder.** The day it was written, the guide
had been rewritten against the live app and was found describing a payment
form that no longer existed, a «Mensaje copiado» that only happens on a
desktop, and buttons renamed weeks before — while catalogue, orders and
reports had no topic at all. Nobody had lied: every sentence was true when
written. A help page goes stale the same way a comment does, silently, and
the person who notices is a shopkeeper following steps that lead nowhere.

## What it covers

| Piece | Where |
|---|---|
| Topics, steps, tips, notes | `Web/lib/soporte.ts` (`TEMAS`) |
| One screenshot per step, ring on the control to press | `Web/public/ayuda/<slug>/<n>.webp` |
| Their sizes (generated, never by hand) | `Web/lib/soporte-capturas.ts` |
| One cover per topic for the index | `Web/public/ayuda/portadas/<slug>.webp` |
| The scripts that take all of it | `dashboard/scripts/ayuda/` |

`[[Label]]` in `soporte.ts` is a button or field **exactly as the screen
reads it**. A label that does not match the screen character for character
is a bug, not a style choice.

## Step 1 — What the release changes, in the owner's screens

```sh
git diff origin/main origin/dev --name-only
```

From `dashboard/`. Classify each touched file:

- **UI the owner walks through** — `app/(app)/**`, `components/dashboard/**`,
  `components/**` used by them, user-facing strings in `lib/`. These can
  change a label, a step, the order of steps, or what a screen looks like.
- **A new route or screen** in `app/(app)/` — a candidate NEW topic.
- **A removed route, button or flow** — a candidate topic or step to DELETE.
- **The client's screens** (`app/s/`, `app/c/`, `components/public/`) —
  only matter where a topic shows what the client sees.
- **Nothing visible** (SQL, server actions with no new field, tests) — no
  change to the help centre, and the report says so in one line.

Then, for every visible change, find the topics that mention it:

```sh
grep -n "<old label>" ../Web/lib/soporte.ts
```

**Search by the LABEL that changed, not by the file.** One label lives in
several topics (`[[Registrar]]` opens four of them).

## Step 2 — Read the screen, never the memory

For each affected topic, walk the flow in the dev app and read every label
off the screen. The capture service does both at once:

```sh
cd dashboard/scripts/ayuda
node daemon.mjs          # in the background; needs `npm run dev` on :3000
node c.mjs go /ventas/nueva
node c.mjs ui            # visible buttons, inputs and headings, with text
```

`c.mjs click "<text>"`, `c.mjs type "<label>" "<value>"` and `c.mjs text`
drive it a step at a time. **Git Bash rewrites `/dashboard` into a Windows
path**: run with `MSYS_NO_PATHCONV=1`.

The session is the DEMO business (`seed-demo.mjs`, «Mini abasto El Chino»,
every name invented, phones on the 555 pattern). **Never capture a real
owner's data**: these images are published on a public website.
`seed-demo.mjs` rebuilds it from scratch if the captures have mutated it.

Before writing a sentence about what a button DOES — opens WhatsApp, copies
a message, shares an image — read its handler in the code. On 2026-11-03
«Compartir enlace» was documented as «Mensaje copiado», which is only the
desktop fallback of `navigator.share`.

## Step 3 — Update the text

In `Web/lib/soporte.ts`:

- **Changed step** → rewrite it with the new label, keep its `imagen`.
- **New flow** → a new `Tema`: a slug (Spanish, user-facing, never renamed
  after it ships — Google indexes it), `numero`, `grupo`, a `resumen` that
  says what it is for, the steps, and notes for the edges.
- **Removed flow** → delete the topic, and tell the user its URL will 404.
  Ask whether to redirect it (`Web/public/_redirects`) to the closest topic.
- **A step that cannot be captured** (a weekend-only checkbox, the phone
  browser's own menus, a flow that needs real photos and the AI) has no
  `imagen` and carries a code comment saying why.

Copy rules: in-app voice (neutral, `sevenz-brand-voice`), second person, one
action per step, the label in `[[ ]]`. The step says what to press; the
`pista` says what happens or what to watch out for.

## Step 4 — Re-take the screenshots

One script per topic in `dashboard/scripts/ayuda/temas/<topic>.mjs`. Each
step is a `shot(slug, n, target)`: `target` is the control that gets the ring
(text, or `js:<expression>` for anything text cannot reach).

```sh
node temas/venta.mjs                 # read-only run
node temas/venta.mjs --finalizar     # also completes the flow: WRITES in dev
python sheet.py raw/<slug> raw/sheet.png 6   # contact sheet to REVIEW
python towebp.py                     # → Web/public/ayuda + soporte-capturas.ts
node temas/portadas.mjs <slug>       # the topic's cover, then:
python componer-portadas.py
```

**Look at every contact sheet before converting.** Traps that already cost a
round each, all fixed in the scripts but worth recognising:

| Symptom | Cause |
|---|---|
| A white picture | The page was still loading; raise the `wait` |
| The ring on the wrong control | A sticky header collapsed after measuring. The service re-measures and only scrolls when the target is off screen |
| `00` typed into a button | Text matched a placeholder elsewhere; target the input with `js:` |
| A menu that never opens | Radix opens on `pointerdown`; use `openMenu()` |
| Consent or survey pop-up over the client's view | `clearPopups()` removes it from the picture. Never ACCEPT a consent: it writes it for a demo client |

## Step 5 — Verify, then report

- `npx tsc --noEmit`, and `npm run build` in `Web/`.
- Every topic page loads its images (none 404), and `/ayuda` counts the
  topics it should.
- At 375px: no sideways scroll.

Report as a table (CLAUDE.md): one row per topic touched — updated, added,
removed, or «sin cambios» — with the screenshots re-taken, and every step
that has no picture named with its reason. Then remind the user that **the
help centre ships with `Web/`, a separate deploy** (`npm run build` →
`npx wrangler deploy` → `git push origin main`).

## When the answer is «nothing to do»

Most releases. Say so with the evidence — the list of visible files the diff
touches, and that none of their labels appears in `soporte.ts` — instead of
skipping the step. «No se miró» and «no había nada» look the same in a
report unless the second one shows its work.
