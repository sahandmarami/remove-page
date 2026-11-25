/** Debug: run engine on s003, count remaining greens directly from result. */
import sharp from "sharp";
import { readFileSync } from "fs";
import { autoRemoveBackground } from "../src/lib/cv/auto-remove";

class ImageDataPoly {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  constructor(data: Uint8ClampedArray, w: number, h: number) {
    this.data = data; this.width = w; this.height = h;
  }
}
(globalThis as any).ImageData = ImageDataPoly;
(globalThis as any).__dbg = {};

async function main() {
  const path = "/home/z/my-project/upload/sprite_003.png";
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const img = new ImageDataPoly(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), info.width, info.height);
  const res: any = autoRemoveBackground(img as any, { removeHoles: true });
  const od = res.image.data;
  let faint = 0, solid = 0, punched = 0;
  for (let i = 0; i < od.length; i += 4) {
    const a = od[i + 3];
    if (a === 0) { punched++; continue; }
    const r = od[i], g = od[i + 1], b = od[i + 2];
    if (g - Math.max(r, b) > 12) {
      if (a < 96) faint++; else solid++;
    }
  }
  console.log("punch count:", (globalThis as any).__dbg.punch);
  console.log("removed:", (res.removedRatio * 100).toFixed(1) + "%");
  console.log("faint greens (a<96):", faint, " solid greens (a>=96):", solid, " transparent px:", punched);
}
void main();
