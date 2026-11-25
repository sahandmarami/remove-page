/**
 * Harness: run the upgraded auto bg-removal engine on the user's scientist
 * sprite sheet (gray bg + green guide lines) and the transparent
 * sprite_003.png (green residue at edges). Exports previews + metrics.
 */
import sharp from "sharp";
import { readFileSync, mkdirSync } from "fs";
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

const OUT = "/tmp/harness2";
mkdirSync(OUT, { recursive: true });

async function loadRGBA(path: string) {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return new ImageDataPoly(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), info.width, info.height);
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
  return sharp(Buffer.from(buf.buffer, buf.byteOffset, buf.length), {
    raw: { width: img.width, height: img.height, channels: 4 },
  }).png().toFile(path);
}

function metrics(img: ImageDataPoly, label: string) {
  const { data, width, height } = img;
  let opaque = 0, green = 0, grayBg = 0, semi = 0;
  for (let i = 0; i < data.length; i += 8) { // sample every 2nd pixel
    const a = data[i + 3];
    if (a < 8) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (a < 250) semi++;
    opaque++;
    if (g - Math.max(r, b) > 12) green++;
    if (Math.abs(r - 127) < 18 && Math.abs(g - 127) < 18 && Math.abs(b - 127) < 18) grayBg++;
  }
  const pct = (n: number) => ((n / Math.max(1, opaque)) * 100).toFixed(2) + "%";
  console.log(`${label}: opaque(sampled)=${opaque} green=${pct(green)} grayBgLeft=${pct(grayBg)} semiTransparent=${pct(semi)}`);
  return { green, grayBg, opaque };
}

async function run(name: string, path: string, crop?: { left: number, top: number, width: number, height: number }) {
  console.log(`\n=== ${name} ===`);
  let img = await loadRGBA(path);
  if (crop) {
    const full = img;
    const buf = new Uint8ClampedArray(crop.width * crop.height * 4);
    for (let y = 0; y < crop.height; y++)
      for (let x = 0; x < crop.width; x++) {
        const si = ((crop.top + y) * full.width + crop.left + x) * 4;
        const di = (y * crop.width + x) * 4;
        buf[di] = full.data[si]; buf[di + 1] = full.data[si + 1];
        buf[di + 2] = full.data[si + 2]; buf[di + 3] = full.data[si + 3];
      }
    img = new ImageDataPoly(buf, crop.width, crop.height);
  }
  metrics(img, "input ");
  const t0 = Date.now();
  const res = autoRemoveBackground(img as any, { removeHoles: true });
  const ms = Date.now() - t0;
  console.log(`engine: tol=${(res as any).autoTolerance?.toFixed(1)} removed=${(res.removedRatio * 100).toFixed(1)}% clusters=${JSON.stringify((res as any).clusters?.map((c: number[]) => c.map(Math.round)))} ${ms}ms`);
  const out = new ImageDataPoly(res.image.data, res.image.width, res.image.height);
  metrics(out, "output");
  await savePng(out, `${OUT}/${name}-alpha.png`);
  await savePng(out, `${OUT}/${name}-ondark.png`, [24, 26, 38]);
  await savePng(out, `${OUT}/${name}-onwhite.png`, [255, 255, 255]);
  return out;
}

async function main() {
  // full sheet 5120x640
  await run("sheet", "/home/z/my-project/upload/The-bespectacled-scientist-in-a-white-coat-and-dark-skirt-pe.png");
  // single frame crop (what sheet-cutter produces): frame 2 at x=640
  await run("frame2", "/home/z/my-project/upload/The-bespectacled-scientist-in-a-white-coat-and-dark-skirt-pe.png", { left: 640, top: 0, width: 640, height: 640 });
  // transparent input with green residue
  await run("s003", "/home/z/my-project/upload/sprite_003.png");
  console.log("\npreviews in", OUT);
}
void main();
