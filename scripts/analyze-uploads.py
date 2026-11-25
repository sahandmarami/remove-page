#!/usr/bin/env python3
"""Analyze the two uploaded images: background colors, green lines, green fringe."""
from PIL import Image
from collections import Counter
import sys

def stats(path):
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    px = im.load()
    print(f"\n=== {path}  {w}x{h}")

    # quantized color histogram (>>4 = 16-level buckets)
    cnt = Counter()
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            r, g, b, a = px[x, y]
            if a < 32:
                cnt[("transparent",)] += 1
                continue
            cnt[((r >> 4, g >> 4, b >> 4),)] += 1
    total = sum(cnt.values())
    print("top colors (r>>4,g>>4,b>>4):")
    for c, n in cnt.most_common(10):
        print(f"  bucket {c}: {n}/{total} = {100*n/total:.1f}%")

    # green-dominant opaque pixels: g > r*1.15 and g > b*1.15
    green = 0
    green_samples = Counter()
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            r, g, b, a = px[x, y]
            if a < 32:
                continue
            if g > r * 1.15 + 8 and g > b * 1.15 + 8:
                green += 1
                green_samples[(r >> 4, g >> 4, b >> 4)] += 1
    print(f"green-dominant opaque px (sampled): {green} ({100*green/total:.2f}%)")
    for c, n in green_samples.most_common(6):
        print(f"   green bucket {c}: {n}")

    # corners + edges: what's there?
    for label, pts in {
        "corners": [(2, 2), (w - 3, 2), (2, h - 3), (w - 3, h - 3)],
        "edge-mid": [(w // 2, 1), (w // 2, h - 2), (1, h // 2), (w - 2, h // 2)],
    }.items():
        vals = [px[x, y] for x, y in pts]
        print(f"  {label}: {vals}")

    # alpha stats
    opaque = sum(1 for y in range(0, h, 4) for x in range(0, w, 4) if px[x, y][3] > 200)
    total4 = ((h + 3) // 4) * ((w + 3) // 4)
    print(f"opaque(>200 alpha) sampled: {100*opaque/total4:.1f}%")

    return im

stats("/home/z/my-project/upload/The-bespectacled-scientist-in-a-white-coat-and-dark-skirt-pe.png")
stats("/home/z/my-project/upload/sprite_003.png")
