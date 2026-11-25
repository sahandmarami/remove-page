#!/usr/bin/env python3
"""Visualize remaining green pixels in the engine output."""
from PIL import Image

def mark(src, dst, scale=None):
    im = Image.open(src).convert("RGBA")
    w, h = im.size
    px = im.load()
    out = Image.new("RGB", (w, h), (30, 30, 30))
    op = out.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 8:
                op[x, y] = (60, 60, 60)  # removed
            elif g - max(r, b) > 12:
                op[x, y] = (255, 0, 0)   # remaining green -> red
            else:
                v = (r + g + b) // 3
                op[x, y] = (v, v, v)
    if scale:
        out = out.resize((int(w * scale), int(h * scale)), Image.NEAREST)
    out.save(dst)
    print("saved", dst, out.size)

mark("/tmp/harness2/sheet-alpha.png", "/tmp/harness2/sheet-greenmap.png", scale=1024 / 5120)
mark("/tmp/harness2/frame2-alpha.png", "/tmp/harness2/frame2-greenmap.png", scale=0.75)
mark("/tmp/harness2/s003-alpha.png", "/tmp/harness2/s003-greenmap.png", scale=0.4)
