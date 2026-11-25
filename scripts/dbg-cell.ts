import sharp from "sharp";
import { mkdirSync } from "fs";
import { analyzeSheet, type RawImage } from "../src/lib/cv/smart-sheet";
import { removeBackground } from "../src/lib/cv/bg-removal";

class ImageDataPoly {
  data: Uint8ClampedArray; width: number; height: number;
  constructor(data: Uint8ClampedArray, w: number, h: number) { this.data = data; this.width = w; this.height = h; }
}
(globalThis as any).ImageData = ImageDataPoly;
const OUT = "/tmp/dbg-cell"; mkdirSync(OUT, { recursive: true });

async function loadRGBA(path: string): Promise<RawImage> {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
}
async function savePng(img: ImageDataPoly, path: string, bg?: [number, number, number]) {
  let buf = img.data;
  if (bg) {
    buf = new Uint8ClampedArray(img.data);
    for (let i = 0; i < buf.length; i += 4) {
      const a = buf[i + 3] / 255;
      buf[i] = buf[i] * a + bg[0] * (1 - a);
      buf[i + 1] = buf[i + 1] * a + bg[1] * (1 - a);
      buf[i + 2] = buf[i + 2] * a + bg[2] * (1 - a);
      buf[i + 3] = 255;
    }
  }
  return sharp(Buffer.from(buf.buffer, buf.byteOffset, buf.length), { raw: { width: img.width, height: img.height, channels: 4 } }).png().toFile(path);
}

async function main() {
  const sheet = await loadRGBA("/home/z/my-project/upload/The-plague-doctor-in-a-dark-purple-cloak,-pointed-hat,-and-b.png");
  const r = analyzeSheet(sheet);
  console.log("bgColor:", r.bgColor, "mode:", r.mode, "boxes:", r.boxes.length);
  const b = r.boxes[3]; // frame 4
  console.log("cell:", b);
  const buf = new Uint8ClampedArray(b.w * b.h * 4);
  for (let y = 0; y < b.h; y++)
    for (let x = 0; x < b.w; x++) {
      const si = ((b.y + y) * sheet.width + b.x + x) * 4;
      const di = (y * b.w + x) * 4;
      buf[di] = sheet.data[si]; buf[di + 1] = sheet.data[si + 1]; buf[di + 2] = sheet.data[si + 2]; buf[di + 3] = sheet.data[si + 3];
    }
  const crop = new ImageDataPoly(buf, b.w, b.h);
  await savePng(crop, `${OUT}/crop.png`, [200, 200, 200]);
  console.log("crop opaque sample:", buf[100 * b.w * 4 + 300 * 4 + 3], buf[(300 * b.w + 100) * 4 + 3]);
  for (const opts of [
    { label: "hint", o: { feather: 0.5, bgColorHint: r.bgColor } },
    { label: "nohint", o: { feather: 0.5 } },
    { label: "noguide", o: { feather: 0.5, bgColorHint: r.bgColor, removeGuideLines: false } },
  ]) {
    const t0 = Date.now();
    const res = removeBackground(crop as any, opts.o);
    const out = new ImageDataPoly(res.image.data, b.w, b.h);
    let opaque = 0;
    for (let i = 3; i < out.data.length; i += 4) if (out.data[i] > 128) opaque++;
    console.log(`${opts.label}: removed=${(res.removedRatio * 100).toFixed(1)}% opaqueKept=${((opaque / (b.w * b.h)) * 100).toFixed(1)}% ${Date.now() - t0}ms`);
    await savePng(out, `${OUT}/keyed-${opts.label}.png`, [24, 26, 38]);
  }
}
void main();
