# Builds assets/phone-galaxy-s22-plus.png from the Figma export of the Reel mockup
# (node «Galaxy-S22+-app.sevenz.site-home», exported at 1x WITH its drop shadow: 643x1307).
#
# Two changes to the export, both decided by the owner on 2026-11-27:
#   1. The app screenshot inside the screen is punched out (transparent), so the
#      recording shows through it.
#   2. The status bar is an empty black strip: clock and icons painted out with the
#      bar's own colour. The camera hole is kept, it is part of the device.
#
# Usage: python -I build-phone-frame.py <figma-export.png>
import json, math, os, sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
T = json.load(open(os.path.join(HERE, "tokens.json"), encoding="utf-8"))["phone"]
im = Image.open(sys.argv[1]).convert("RGBA")
if im.size != (643, 1307):
    sys.exit(f"Expected the 1x export with shadow (643x1307), got {im.size}")
px = im.load()
s = T["screen"]
X0, Y0, X1, Y1, R = s["x"], s["y"], s["x"] + s["width"], s["y"] + s["height"], s["bottomRadius"]
SB_TOP = 24  # top edge of the screen glass, measured on the export
bar = tuple(int(T["statusBar"]["color"][i:i + 2], 16) for i in (1, 3, 5)) + (255,)

def inside_rounded(x, y, top, bottom, r):
    # Inside the screen glass: a rectangle with all four corners rounded to r.
    if not (X0 <= x < X1 and top <= y < bottom):
        return False
    px_, py_ = x + 0.5, y + 0.5
    cx_ = X0 + r if px_ < X0 + r else X1 - r if px_ > X1 - r else None
    cy_ = top + r if py_ < top + r else bottom - r if py_ > bottom - r else None
    return cx_ is None or cy_ is None or math.hypot(px_ - cx_, py_ - cy_) <= r

# The camera: the lighter pixels in the middle of the bar.
cam = [(x, y) for y in range(SB_TOP + 2, Y0 - 2) for x in range(260, 380) if sum(px[x, y][:3]) // 3 > 30]
cx = (min(p[0] for p in cam) + max(p[0] for p in cam)) / 2
cy = (min(p[1] for p in cam) + max(p[1] for p in cam)) / 2
cr = max(max(p[0] for p in cam) - min(p[0] for p in cam), max(p[1] for p in cam) - min(p[1] for p in cam)) / 2 + 3
print(f"camera at ({cx:.1f}, {cy:.1f}) r={cr:.1f}")

for y in range(SB_TOP + 2, Y0):
    for x in range(X0, X1):
        if inside_rounded(x, y, SB_TOP, Y1, R) and math.hypot(x - cx, y - cy) > cr:
            px[x, y] = bar
for y in range(Y0, Y1):
    for x in range(X0, X1):
        if inside_rounded(x, y, SB_TOP, Y1, R):
            px[x, y] = (0, 0, 0, 0)

# The old screenshot's anti-aliased edge survives just outside the hole as a white
# hairline along the bottom corners. Anything light within 3px of the hole becomes bezel.
def near_hole(x, y, m=3):
    return any(inside_rounded(x + dx, y + dy, SB_TOP, Y1, R) for dx in (-m, 0, m) for dy in (-m, 0, m))
for y in range(Y0, min(Y1 + 4, im.height)):
    for x in range(max(X0 - 4, 0), min(X1 + 4, im.width)):
        p = px[x, y]
        if p[3] and (p[0] + p[1] + p[2]) // 3 > 40 and not inside_rounded(x, y, SB_TOP, Y1, R) and near_hole(x, y):
            px[x, y] = (10, 10, 10, p[3])

out = os.path.join(HERE, T["asset"])
os.makedirs(os.path.dirname(out), exist_ok=True)
im.save(out, optimize=True)
print("wrote", out, im.size)
