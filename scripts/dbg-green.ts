import sharp from "sharp";
import { mkdirSync } from "fs";
import { autoRemoveBackground } from "../src/lib/cv/auto-remove";

class ImageDataPoly {
  data: Uint8ClampedArray; width: number; height: number;
  constructor(data: Uint8ClampedArray, w: number, h: number) { this.data = data; this.width = w; this.height = h; }
}
(globalThis as any).ImageData = ImageDataPoly;
mkdirSync("/tmp/green-check", { recursive: true });

async function main() {
  const { data, info } = await sharp("/home/z/my-project/upload/sprite_001.webp").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const img = new ImageDataPoly(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), info.width, info.height);
  const res = autoRemoveBackground(img as any, { removeHoles: true, feather: 1.0 });
  const out = new ImageDataPoly(res.image.data, res.image.width, res.image.height);
  // edge-ring green analysis: pixels near transparent zones
  let edgeGreen = 0, edgeTotal = 0, greenSpecks = 0;
  const { width: w, height: h } = out;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const i = p * 4;
      const a = out.data[i + 3];
      if (a < 8) continue;
      const nearTransparent =
        (x > 0 && out.data[(p - 1) * 4 + 3] < 8) || (x < w - 1 && out.data[(p + 1) * 4 + 3] < 8) ||
        (y > 0 && out.data[(p - w) * 4 + 3] < 8) || (y < h - 1 && out.data[(p + w) * 4 + 3] < 8);
      if (!nearTransparent) continue;
      edgeTotal++;
      const r = out.data[i], g = out.data[i + 1], b = out.data[i + 2];
      if (g - Math.max(r, b) > 14) edgeGreen++;
    }
  }
  for (let i = 0; i < out.data.length; i += 16) {
    const a = out.data[i + 3];
    if (a < 100) continue;
    const r = out.data[i], g = out.data[i + 1], b = out.data[i + 2];
    if (g - Math.max(r, b) > 30) greenSpecks++;
  }
  console.log(`sprite_001: ${w}x${h} tol=${res.autoTolerance.toFixed(1)} removed=${(res.removedRatio * 100).toFixed(1)}%`);
  console.log(`edge ring pixels: ${edgeTotal}, green-tinted: ${edgeGreen} (${((edgeGreen / Math.max(1, edgeTotal)) * 100).toFixed(2)}%)`);
  console.log(`strong green specks (opaque): ${greenSpecks}`);
  // composite on white for visual check
  const buf = new Uint8ClampedArray(out.data);
  for (let i = 0; i < buf.length; i += 4) {
    const a = buf[i + 3] / 255;
    buf[i] = buf[i] * a + 255 * (1 - a);
    buf[i + 1] = buf[i + 1] * a + 255 * (1 - a);
    buf[i + 2] = buf[i + 2] * a + 255 * (1 - a);
    buf[i + 3] = 255;
  }
  await sharp(Buffer.from(buf.buffer, buf.byteOffset, buf.length), { raw: { width: w, height: h, channels: 4 } }).png().toFile("/tmp/green-check/sprite001-white.png");
  console.log("→ /tmp/green-check/sprite001-white.png");
}
void main();
