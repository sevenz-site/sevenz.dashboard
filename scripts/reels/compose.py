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
end = next((m["wall"] for m in tl["timeline"] if m["name"] == "end"), frames[-1]["wall"] + 1) - t0
lst = os.path.join(WORK, "frames.ffconcat")
with open(lst, "w", encoding="utf-8") as f:
    f.write("ffconcat version 1.0\n")
    for i, fr in enumerate(frames):
        nxt = frames[i + 1]["wall"] - t0 if i + 1 < len(frames) else end
        f.write(f"file 'frames/{fr['f']}'\nduration {max(nxt - (fr['wall'] - t0), 0.001):.4f}\n")
    f.write(f"file 'frames/{frames[-1]['f']}'\n")

s = P["screen"]
sx, sy = P["x"] + s["x"], P["y"] + s["y"]
fc = ";".join([
    f"[1:v]fps={C['fps']},scale={s['width']}:{s['height']}:flags=lanczos,setsar=1[app]",
    f"[0:v][app]overlay={sx}:{sy}:eof_action=pass:shortest=1[v1]",
    f"[v1][2:v]overlay={P['x']}:{P['y']},format=yuv420p[out]",
])
cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
       "-loop", "1", "-framerate", str(C["fps"]), "-i", bg_path,
       "-f", "concat", "-safe", "0", "-i", lst,
       "-i", os.path.join(HERE, P["asset"]),
       "-filter_complex", fc, "-map", "[out]", "-t", f"{end:.3f}", "-r", str(C["fps"]),
       "-c:v", "libx264", "-profile:v", "high", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p",
       "-movflags", "+faststart", OUT]
subprocess.run(cmd, check=True, cwd=WORK)
print("ok", OUT, f"{end:.2f}s")
