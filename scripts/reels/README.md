# Reels: recorded app flows inside the Figma layout

The owner adds the cover, the closing screen and the subtitles later. This folder only
produces the recording of each flow inside the phone, on one of the two layouts from Figma
(file `8JRMGlo45ZZhqdqd67pL7B`, page Foundations): **primary** `2296:20414` (dark) and
**secondary** `2294:25584` (notebook paper). Ayuda topics alternate: odd numbers on
secondary, even on primary (owner, 2026-11-27). No video is longer than 25 s: a long flow
is cut into parts at step boundaries.

| File | What it is |
|---|---|
| `tokens.json` | Every layout value read from the frames: canvas, backgrounds, phone, screen, subtitle area, recording viewport, tap marker, 25 s cap |
| `flows.json` | One entry per Ayuda topic: its number, its background, whether it saves, and why a topic is skipped |
| `flows/<slug>.mjs` | One flow: what to tap and type, with named marks (the only places a video may be cut) |
| `record.mjs` | Records a flow in headless Chrome. Dev only, demo business, magic link, no password |
| `compose.py` | Puts the recording in the layout, speeds up server waits, cuts at 25 s, exports the MP4s |
| `run.mjs` | Records and composes every flow (or the ones named), restoring the demo after each |
| `demo-state.mjs` | Snapshot and exact restore of the dev demo business, rows and Storage files |
| `dev-no-sends.mjs` | `next dev` with WhatsApp, email and Mixpanel switched off (preview `dashboard-dev-no-sends`) |
| `assets/` | The frame's phone (screen punched out, black status bar) and the drawn demo cover |
| `build-phone-frame.py` | Rebuilds the phone asset from a 1x Figma export (with its shadow) |

## Recording

1. Start the preview **`dashboard-dev-no-sends`**, never plain `npm run dev`: flows save
   sales and abonos, and dev has the Kapso key, so a plain server could send a real
   WhatsApp to a demo client's number. `.env.local` must point at the **dev** branch
   (`vzqppwrwnmlbrxizskdh`); the scripts refuse anything else.
   **If another session is editing the app in this folder**, serve a clean copy instead,
   or the videos show (and break on) its uncommitted work, as on 2026-11-27: `git worktree
   add --detach <dir> origin/dev`, copy `.env.local` into it, `npm ci` there (a linked
   `node_modules` makes Turbopack panic), and run `node scripts/reels/dev-no-sends.mjs
   --dir <dir>`. The recorder keeps running from this folder.
2. `node scripts/reels/run.mjs` (all) or `node scripts/reels/run.mjs <slug>`.

The MP4s land in `output/reels/<slug>-<variant>[-parte-N].mp4` (git-ignored); working files
in `output/reels/work/`. Every flow that saves runs between a snapshot and a restore, and the
run stops if the demo does not come back identical.

## A new flow

Write `flows/<slug>.mjs` (any existing one is the model) and add it to `flows.json`. In the
flow: `r.mark()` before each step, `r.server(() => r.waitFor(...))` around waits on the
server (they play fast in the video), `r.menu` + `r.pick` for Radix menus and selects, and
`r.queueFile` before a tap that opens a file picker. `r.tap` refuses to tap a target that
something else is covering: a covered tap once ticked a client's WhatsApp consent.
