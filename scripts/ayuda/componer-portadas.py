# Builds the cover of each help topic: its real app screen (raw-portadas/<slug>.png,
# from temas/portadas.mjs) inside a dark phone, on the card's grey, the phone
# bleeding off the bottom edge like the web v3 illustrations.
# Output: Web/public/ayuda/portadas/<slug>.webp, 1120x630 (the card's 16:9 at 2x).
import glob, os
from PIL import Image, ImageDraw, ImageFilter

SRC = os.path.join(os.path.dirname(__file__), "raw-portadas")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "Web", "public", "ayuda", "portadas")
os.makedirs(OUT, exist_ok=True)

W, H = 1120, 630
BG = (244, 244, 244)
SCREEN_W = 400
BEZEL = 12
TOP = 56
R_SCREEN, R_PHONE = 46, 60

def rounded_mask(size, r):
    m = Image.new("L", size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], r, fill=255)
    return m

for f in sorted(glob.glob(os.path.join(SRC, "*.png"))):
    slug = os.path.basename(f)[:-4]
    shot = Image.open(f).convert("RGB")
    sh = round(shot.height * SCREEN_W / shot.width)
    shot = shot.resize((SCREEN_W, sh), Image.LANCZOS)

    pw, ph = SCREEN_W + 2 * BEZEL, sh + 2 * BEZEL
    x, y = (W - pw) // 2, TOP

    cover = Image.new("RGB", (W, H), BG)

    # Soft shadow under the phone.
    shadow = Image.new("L", (W, H + 200), 0)
    ImageDraw.Draw(shadow).rounded_rectangle([x + 6, y + 18, x + pw - 6, y + ph], R_PHONE, fill=70)
    shadow = shadow.filter(ImageFilter.GaussianBlur(22))
    cover.paste((0, 0, 0), (0, 0), shadow.crop((0, 0, W, H)))

    phone = Image.new("RGB", (pw, ph), (24, 24, 24))
    phone.paste(shot, (BEZEL, BEZEL), rounded_mask((SCREEN_W, sh), R_SCREEN))
    # A thin lighter rim so the dark bezel reads as an object on the grey.
    rim = Image.new("L", (pw, ph), 0)
    ImageDraw.Draw(rim).rounded_rectangle([0, 0, pw - 1, ph - 1], R_PHONE, outline=255, width=2)
    phone.paste((70, 70, 70), (0, 0), rim)
    cover.paste(phone, (x, y), rounded_mask((pw, ph), R_PHONE))

    p = os.path.join(OUT, f"{slug}.webp")
    cover.save(p, "WEBP", quality=82, method=6)
    print(f"{slug}: {os.path.getsize(p) // 1024} KB")
