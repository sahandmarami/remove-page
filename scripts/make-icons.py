#!/usr/bin/env python3
"""Generate PWA / favicon icon set from the uploaded app logo."""
from PIL import Image
import os

SRC = "/home/z/my-project/upload/file_000000003acc820a8990413f6062d74e.png"
OUT = "/home/z/my-project/public"
os.makedirs(OUT, exist_ok=True)

img = Image.open(SRC).convert("RGBA")
print("source:", img.size, img.mode)

# Trim any fully transparent padding around the square art (keep squareness)
alpha = img.getchannel("A")
bbox = alpha.getbbox()
if bbox:
    # crop to content but keep it square around center
    img_c = img.crop(bbox)
    side = max(img_c.size)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(img_c, ((side - img_c.width) // 2, (side - img_c.height) // 2))
    img = canvas
print("trimmed:", img.size)

def save(size: int, name: str):
    im = img.resize((size, size), Image.LANCZOS)
    path = os.path.join(OUT, name)
    im.save(path, "PNG", optimize=True)
    print("wrote", path, os.path.getsize(path), "bytes")

save(512, "icon-512.png")
save(192, "icon-192.png")
save(180, "apple-touch-icon.png")
save(32, "favicon-32.png")
save(16, "favicon-16.png")

# multi-resolution favicon.ico
ico_sizes = [(16, 16), (32, 32), (48, 48)]
img.resize((48, 48), Image.LANCZOS).save(
    os.path.join(OUT, "favicon.ico"),
    format="ICO",
    sizes=ico_sizes,
)
print("wrote favicon.ico", os.path.getsize(os.path.join(OUT, "favicon.ico")), "bytes")

# maskable icon: same art centered on padded canvas (safe zone 80%)
m = Image.new("RGBA", (512, 512), (12, 13, 22, 255))  # near-black base
inner = img.resize((408, 408), Image.LANCZOS)
m.paste(inner, ((512 - 408) // 2, (512 - 408) // 2), inner)
m.save(os.path.join(OUT, "icon-maskable-512.png"), "PNG", optimize=True)
print("wrote icon-maskable-512.png")

# og image 1200x630 (dark purple gradient + icon centered-left)
from PIL import ImageDraw, ImageFilter
og = Image.new("RGB", (1200, 630), (12, 13, 22))
dr = ImageDraw.Draw(og)
for y in range(630):
    t = y / 630
    r = int(12 + 40 * (1 - t))
    g = int(13 + 6 * (1 - t))
    b = int(22 + 55 * (1 - t))
    dr.line([(0, y), (1200, y)], fill=(r, g, b))
glow = Image.new("RGB", (1200, 630), (0, 0, 0))
gd = ImageDraw.Draw(glow)
gd.ellipse((650, 80, 1250, 680), fill=(88, 28, 235))
glow = glow.filter(ImageFilter.GaussianBlur(180))
og = Image.blend(og, Image.composite(glow, og, Image.new("L", (1200, 630), 110)), 0.45)
icon_big = img.resize((400, 400), Image.LANCZOS)
og.paste(icon_big, (100, 115), icon_big)
og.save(os.path.join(OUT, "og-image.png"), "PNG", optimize=True)
print("wrote og-image.png", os.path.getsize(os.path.join(OUT, "og-image.png")), "bytes")
print("DONE")
