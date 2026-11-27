# Reels: recorded app flows inside the Figma layout

The owner adds the cover, the closing screen and the subtitles later. This folder only
produces the recording of the flow inside the phone, on one of the two layouts from Figma
(file `8JRMGlo45ZZhqdqd67pL7B`, page Foundations): **primary** `2296:20414` (dark) and
**secondary** `2294:25584` (notebook paper). The owner names the variant for each flow.

| File | What it is |
|---|---|
| `tokens.json` | Every layout value read from the frames: canvas, backgrounds, phone position, screen, subtitle area, recording viewport, tap marker |
| `assets/phone-galaxy-s22-plus.png` | The frame's phone, with the screen punched out and an empty black status bar |
| `build-phone-frame.py` | Rebuilds that asset from a 1x Figma export of the phone (with its shadow) |
| `flows/<flow>.mjs` | One flow: what to tap and type, with named marks |
| `record.mjs` | Records a flow in headless Chrome. Dev only, demo business, magic link, no password |
| `compose.py` | Puts the recording in the layout and exports the MP4 |

## A new flow

1. Write `flows/<flow>.mjs` (copy `calculadora-de-tasa.mjs`).
2. `npm run dev` in `dashboard/` (it must point at the **dev** branch, `vzqppwrwnmlbrxizskdh`).
3. `node scripts/reels/record.mjs <flow>`
4. `python -I scripts/reels/compose.py <flow> <primary|secondary>`

The MP4 lands in `output/reels/<flow>-<variant>.mp4` (git-ignored), and the working files
in `output/reels/work/<flow>/`. If the frames change in Figma, update `tokens.json` (and
rebuild the phone asset if the phone changed). The scripts read nothing else.
