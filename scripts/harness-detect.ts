/**
 * Harness: run the CURRENT detectBoxes pipeline on the user's real sprite
 * sheets to see exactly how the "broken animation" happens.
 * Canvas API is shimmed on top of sharp raw RGBA buffers.
 */
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "fs";
import { detectBoxes, type Box } from "../src/lib/cv/detect-boxes";
import { autoRemoveBackground } from "../src/lib/cv/auto-remove";

class ImageDataPoly {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  constructor(data: Uint8ClampedArray, w: number, h: number) {
    this.data = data;
    this.width = w;
    this.height = h;
  }
}
(globalThis as any).ImageData = ImageDataPoly;

const OUT = "/tmp/detect-harness";
mkdirSync(OUT, { recursive: true });

class CanvasShim {
  private _w = 0;
  private _h = 0;
  private _data: Uint8ClampedArray = new Uint8ClampedArray(4);
  constructor(w: number, h: number) {
    this.resize(w, h);
  }
  private resize(w: number, h: number) {
    this._w = Math.max(1, w);
    this._h = Math.max(1, h);
    this._data = new Uint8ClampedArray(this._w * this._h * 4);
  }
  get width() {
    return this._w;
  }
  set width(v: number) {
    this.resize(v, this._h);
  }
  get height() {
    return this._h;
  }
  set height(v: number) {
    this.resize(this._w, v);
  }
  get data() {
    return this._data;
  }
  getContext(_type: string, _opts?: any) {
    const self = this;
    return {
      getImageData(x: number, y: number, w: number, h: number) {
        const out = new Uint8ClampedArray(w * h * 4);
        for (let row = 0; row < h; row++) {
          const sy = y + row;
          if (sy < 0 || sy >= self.height) continue;
          for (let col = 0; col < w; col++) {
            const sx = x + col;
            if (sx < 0 || sx >= self.width) continue;
            const si = (sy * self.width + sx) * 4;
            const di = (row * w + col) * 4;
            out[di] = self.data![si];
            out[di + 1] = self.data![si + 1];
            out[di + 2] = self.data![si + 2];
            out[di + 3] = self.data![si + 3];
          }
        }
        return new ImageDataPoly(out, w, h);
      },
      drawImage(src: CanvasShim, _dx: number, _dy: number, dw: number, dh: number) {
        // area-average downscale src -> self
        const sw = src.width;
        const sh = src.height;
        for (let dy = 0; dy < dh; dy++) {
          const y0 = Math.floor((dy * sh) / dh);
          const y1 = Math.max(y0 + 1, Math.floor(((dy + 1) * sh) / dh));
          for (let dx = 0; dx < dw; dx++) {
            const x0 = Math.floor((dx * sw) / dw);
            const x1 = Math.max(x0 + 1, Math.floor(((dx + 1) * sw) / dw));
            let r = 0, g = 0, b = 0, a = 0, n = 0;
            for (let sy = y0; sy < y1 && sy < sh; sy++) {
              for (let sx = x0; sx < x1 && sx < sw; sx++) {
                const si = (sy * sw + sx) * 4;
                const al = src.data![si + 3] / 255;
                r += src.data![si] * al;
                g += src.data![si + 1] * al;
                b += src.data![si + 2] * al;
                a += src.data![si + 3];
                n++;
              }
            }
            const di = (dy * dw + dx) * 4;
            const af = a / 255 / Math.max(1, n);
            if (af > 0.001) {
              self.data![di] = r / (a / 255);
              self.data![di + 1] = g / (a / 255);
              self.data![di + 2] = b / (a / 255);
            }
            self.data![di + 3] = a / Math.max(1, n);
          }
        }
      },
    };
  }
}

(globalThis as any).document = {
  createElement(_tag: string) {
    return new CanvasShim(1, 1);
  },
};

async function load(path: string): Promise<CanvasShim> {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const c = new CanvasShim(info.width, info.height);
  c.data.set(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length));
  return c;
}

function report(name: string, boxes: Box[], W: number, H: number) {
  const widths = boxes.map((b) => b.w);
  const heights = boxes.map((b) => b.h);
  const uniW = new Set(widths).size;
  const uniH = new Set(heights).size;
  console.log(`\n=== ${name} (${W}x${H}) → ${boxes.length} boxes ===`);
  console.log(`unique widths=${uniW} unique heights=${uniH}`);
  boxes.forEach((b, i) =>
    console.log(
      `  #${String(i + 1).padStart(2)} x=${b.x} y=${b.y} w=${b.w} h=${b.h}  (right=${b.x + b.w})`
    )
  );
}

async function keyAll(name: string, src: CanvasShim, boxes: Box[], bgColor: any) {
  // simulate sheet-cutter processCrop on each box, then compose a preview strip
  const previews: { w: number; h: number; img: ImageDataPoly }[] = [];
  for (let i = 0; i < Math.min(boxes.length, 20); i++) {
    const b = boxes[i];
    const crop = new CanvasShim(b.w, b.h);
    // cropToCanvas equivalent: drawImage with source rect is not used —
    // sheet-cutter crops by drawImage(src, sx,sy,sw,sh, 0,0,sw,sh); emulate:
    const ctx = crop.getContext("2d");
    for (let y = 0; y < b.h; y++) {
      for (let x = 0; x < b.w; x++) {
        const si = ((b.y + y) * src.width + b.x + x) * 4;
        const di = (y * b.w + x) * 4;
        crop.data![di] = src.data![si];
        crop.data![di + 1] = src.data![si + 1];
        crop.data![di + 2] = src.data![si + 2];
        crop.data![di + 3] = src.data![si + 3];
      }
    }
    const img = ctx.getImageData(0, 0, b.w, b.h);
    const res = autoRemoveBackground(img as any, { feather: 0.5, bgColorHint: bgColor });
    previews.push({ w: b.w, h: b.h, img: new ImageDataPoly(res.image.data, b.w, b.h) });
  }
  // composite on dark bg for visual check
  const cellW = Math.max(...previews.map((p) => p.w));
  const cellH = Math.max(...previews.map((p) => p.h));
  const strip = new Uint8ClampedArray(cellW * cellH * previews.length * 4);
  previews.forEach((p, idx) => {
    const ox = idx * cellW + Math.floor((cellW - p.w) / 2);
    const oy = Math.floor((cellH - p.h) / 2);
    for (let y = 0; y < p.h; y++) {
      for (let x = 0; x < p.w; x++) {
        const si = (y * p.w + x) * 4;
        const di = ((oy + y) * cellW * previews.length + ox + x) * 4;
        const a = p.img.data[si + 3] / 255;
        strip[di] = p.img.data[si] * a + 24 * (1 - a);
        strip[di + 1] = p.img.data[si + 1] * a + 26 * (1 - a);
        strip[di + 2] = p.img.data[si + 2] * a + 38 * (1 - a);
        strip[di + 3] = 255;
      }
    }
  });
  await sharp(Buffer.from(strip.buffer, strip.byteOffset, strip.length), {
    raw: { width: cellW * previews.length, height: cellH, channels: 4 },
  })
    .png()
    .toFile(`${OUT}/${name}-current-keyed.png`);
  console.log(`  → ${OUT}/${name}-current-keyed.png (${previews.length} frames, cell ${cellW}x${cellH})`);
}

async function main() {
  const sheets: Array<[string, string]> = [
    ["plague", "/home/z/my-project/upload/The-plague-doctor-in-a-dark-purple-cloak,-pointed-hat,-and-b.png"],
    ["bald", "/home/z/my-project/upload/The-bald,-mustache-wearing-older-man-in-a-brown-vest-and-dar.png"],
    ["wizard", "/home/z/my-project/upload/The-pixel-art-wizard-in-a-purple-robe-and-pointed-hat-perfor.png"],
  ];
  for (const [name, path] of sheets) {
    const c = await load(path);
    const t0 = Date.now();
    const res = detectBoxes(c as any, { tolerance: 42 });
    console.log(`detect ${name}: ${Date.now() - t0}ms bg=`, res.bgColor, `ratio=${res.bgRatio.toFixed(2)}`);
    report(name, res.boxes, c.width, c.height);
    await keyAll(name, c, res.boxes, res.bgColor);
  }
  console.log("\npreviews in", OUT);
}
void main();
