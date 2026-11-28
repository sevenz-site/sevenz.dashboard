# Puts a recorded flow inside the Reel layout of tokens.json and exports the MP4.
#
#   python -I scripts/reels/compose.py <flow> <variant>      variant: primary | secondary
#
# Reads output/reels/work/<flow>/ (written by record.mjs) and writes
# output/reels/<flow>-<variant>.mp4 at the canvas size, with no cover, no closing
# screen and an empty subtitle area: those are added later (owner, 2026-11-27).
import json, os, subprocess, sys
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
DASH = os.path.normpath(os.path.join(HERE, "..", ".."))
FLOW, VARIANT = sys.argv[1], sys.argv[2]
T = json.load(open(os.path.join(HERE, "tokens.json"), encoding="utf-8"))
C, V, P = T["canvas"], T["variants"][VARIANT], T["phone"]
WORK = os.path.join(DASH, "output", "reels", "work", FLOW)
OUT = os.path.join(DASH, "output", "reels", f"{FLOW}-{VARIANT}.mp4")


def background():
    # Drawn at 4x and reduced, so a 1px stroke centred on y=20 lands half on two
    # rows, the way Figma renders a centred stroke.
    S = 4
    im = Image.new("RGB", (C["width"] * S, C["height"] * S), V["background"])
    d = ImageDraw.Draw(im)
    if "ruling" in V:
        r = V["ruling"]
        for y in range(r["from"], r["to"] + 1, r["every"]):
            h = r["stroke"] * S / 2
            d.rectangle([0, y * S - h, C["width"] * S, y * S + h - 1], fill=r["color"])
    if "margins" in V:
        m = V["margins"]
        for x in m["x"]:
            w = m["stroke"] * S / 2
            d.rectangle([x * S - w, 0, x * S + w - 1, C["height"] * S], fill=m["color"])
    return im.resize((C["width"], C["height"]), Image.LANCZOS)


bg_path = os.path.join(WORK, f"bg-{VARIANT}.png")
background().save(bg_path)

# Variable-rate screencast -> constant frame rate, timed by the wall clock.
tl = json.load(open(os.path.join(WORK, "timeline.json"), encoding="utf-8"))
frames, t0 = tl["frames"], tl["frames"][0]["wall"]
end_raw = next((m["wall"] for m in tl["timeline"] if m["name"] == "end"), frames[-1]["wall"] + 1) - t0

# Server waits (record.mjs `server()`, marks ff / ff_end) play at whatever speed makes them
# last FF seconds. `remap` turns a recording time into a video time, for frames and marks.
FF = 1.0
fast, open_at = [], None
for m in tl["timeline"]:
    if m["name"] == "ff":
        open_at = m["wall"] - t0
    elif m["name"] == "ff_end" and open_at is not None:
        a, b = open_at, m["wall"] - t0
        if b - a > FF:
            fast.append((a, b))
        open_at = None


def remap(t):
    out = t
    for a, b in fast:
        if t >= b:
            out -= (b - a) - FF
        elif t > a:
            out -= (t - a) - (t - a) * FF / (b - a)
    return out


end = remap(end_raw)
lst = os.path.join(WORK, "frames.ffconcat")
with open(lst, "w", encoding="utf-8") as f:
    f.write("ffconcat version 1.0\n")
    for i, fr in enumerate(frames):
        nxt = remap(frames[i + 1]["wall"] - t0) if i + 1 < len(frames) else end
        f.write(f"file 'frames/{fr['f']}'\nduration {max(nxt - remap(fr['wall'] - t0), 0.001):.4f}\n")
    f.write(f"file 'frames/{frames[-1]['f']}'\n")

s = P["screen"]
sx, sy = P["x"] + s["x"], P["y"] + s["y"]


def render(start, stop, out):
    fc = ";".join([
        f"[1:v]fps={C['fps']},trim={start:.3f}:{stop:.3f},setpts=PTS-STARTPTS,"
        f"scale={s['width']}:{s['height']}:flags=lanczos,setsar=1[app]",
        f"[0:v][app]overlay={sx}:{sy}:eof_action=pass:shortest=1[v1]",
        f"[v1][2:v]overlay={P['x']}:{P['y']},format=yuv420p[out]",
    ])
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
           "-loop", "1", "-framerate", str(C["fps"]), "-i", bg_path,
           "-f", "concat", "-safe", "0", "-i", lst,
           "-i", os.path.join(HERE, P["asset"]),
           "-filter_complex", fc, "-map", "[out]", "-t", f"{stop - start:.3f}", "-r", str(C["fps"]),
           "-c:v", "libx264", "-profile:v", "high", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p",
           "-movflags", "+faststart", out]
    subprocess.run(cmd, check=True, cwd=WORK)
    print("ok", out, f"{stop - start:.2f}s")


# MAX 25 s PER VIDEO (owner, 2026-11-27: «partir en varios, máximo 25 segundos cada uno»).
# A long flow is cut only at a step boundary, never mid-gesture: the marks the flow sets
# just before each tap. Parts are balanced: with 26 s it is two of ~13, not 23 and a
# 3-second leftover. Each cut takes the boundary nearest to an even share of what is left.
LIMIT = C.get("maxPartSeconds", 25)
marks = sorted({round(remap(m["wall"] - t0), 3) for m in tl["timeline"]
                if m["name"] not in ("ff", "ff_end") and 0 < m["wall"] - t0 < end_raw})
cuts, start = [], 0.0
while end - start > LIMIT:
    left = -(-(end - start) // LIMIT)  # parts still needed, rounded up
    target = start + (end - start) / left
    fits = [m for m in marks if start + 2 < m <= start + LIMIT and end - m >= 2]
    if not fits:
        sys.exit(f"No step boundary within {LIMIT}s after {start:.1f}s: add a mark to the flow.")
    cut = min(fits, key=lambda m: abs(m - target))
    cuts.append((start, cut))
    start = cut
cuts.append((start, end))
for old in [f for f in os.listdir(os.path.dirname(OUT)) if f.startswith(f"{FLOW}-{VARIANT}")]:
    os.remove(os.path.join(os.path.dirname(OUT), old))
if len(cuts) == 1:
    render(0, end, OUT)
else:
    for i, (a, b) in enumerate(cuts, 1):
        render(a, b, OUT.replace(".mp4", f"-parte-{i}.mp4"))
