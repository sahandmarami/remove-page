/**
 * Harness: validate analyzeSheet (smart grid detection) on the user's real
 * sprite sheets + synthetic edge cases. Produces keyed previews per sheet.
 */
import sharp from "sharp";
import { mkdirSync } from "fs";
import { analyzeSheet, type RawImage } from "../src/lib/cv/smart-sheet";
import { removeBackground } from "../src/lib/cv/bg-removal";

class ImageDataPoly {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  constructor(data: Uint8ClampedArray, w: number, h: number) {
    this.data = data; this.width = w; this.height = h;
  }
}
(globalThis as any).ImageData = ImageDataPoly;

const OUT = "/tmp/smart-harness";
mkdirSync(OUT, { recursive: true });

async function loadRGBA(path: string): Promise<RawImage> {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return {
    data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length),
    width: info.width,
    height: info.height,
  };
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

async function keyCells(name: string, sheet: RawImage, boxes: { x: number; y: number; w: number; h: number }[], bgColor: [number, number, number] | null) {
  const keyed: ImageDataPoly[] = [];
  for (const b of boxes) {
    const buf = new Uint8ClampedArray(b.w * b.h * 4);
    for (let y = 0; y < b.h; y++) {
      for (let x = 0; x < b.w; x++) {
        const si = ((b.y + y) * sheet.width + b.x + x) * 4;
        const di = (y * b.w + x) * 4;
        buf[di] = sheet.data[si];
        buf[di + 1] = sheet.data[si + 1];
        buf[di + 2] = sheet.data[si + 2];
        buf[di + 3] = sheet.data[si + 3];
      }
    }
    const res = removeBackground(new ImageDataPoly(buf, b.w, b.h) as any, {
      feather: 0.5,
      bgColorHint: bgColor,
      removeHoles: true,
    });
    keyed.push(new ImageDataPoly(res.image.data, b.w, b.h));
  }
  const cellW = boxes[0]?.w ?? 1;
  const cellH = boxes[0]?.h ?? 1;
  const stripW = cellW * keyed.length;
  const strip = new Uint8ClampedArray(stripW * cellH * 4);
  keyed.forEach((img, idx) => {
    const ox = idx * cellW;
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const si = (y * img.width + x) * 4;
        const di = (y * stripW + ox + x) * 4;
        const a = img.data[si + 3] / 255;
        strip[di] = img.data[si] * a + 24 * (1 - a);
        strip[di + 1] = img.data[si + 1] * a + 26 * (1 - a);
        strip[di + 2] = img.data[si + 2] * a + 38 * (1 - a);
        strip[di + 3] = 255;
      }
    }
  });
  const small = await sharp(Buffer.from(strip.buffer, strip.byteOffset, strip.length), {
    raw: { width: stripW, height: cellH, channels: 4 },
  }).png().toBuffer();
  await sharp(small).resize({ width: Math.min(1500, stripW) }).png().toFile(`${OUT}/${name}-keyed.png`);
  console.log(`  → ${OUT}/${name}-keyed.png`);
}

function report(name: string, r: ReturnType<typeof analyzeSheet>, W: number, H: number) {
  console.log(`\n=== ${name} (${W}x${H}) ===`);
  console.log(
    `mode=${r.mode} boxes=${r.boxes.length} grid=${r.columns}x${r.rows} cell=${r.cellW}x${r.cellH} conf=${r.confidence.toFixed(2)} bg=[${r.bgColor.map((c) => Math.round(c))}] transparent=${r.transparentSource}`
  );
  const uniqW = new Set(r.boxes.map((b) => b.w)).size;
  const uniqH = new Set(r.boxes.map((b) => b.h)).size;
  console.log(`uniformity: uniqueW=${uniqW} uniqueH=${uniqH} ${r.mode === "grid" ? (uniqW === 1 && uniqH === 1 ? "✓ PERFECT" : "✗ NOT UNIFORM") : "(boxes mode)"}`);
  if (r.boxes.length <= 20) {
    r.boxes.forEach((b, i) =>
      console.log(`  #${String(i + 1).padStart(2)} x=${b.x} y=${b.y} w=${b.w} h=${b.h}`)
    );
  } else {
    r.boxes.slice(0, 4).forEach((b, i) => console.log(`  #${i + 1} x=${b.x} y=${b.y} w=${b.w} h=${b.h}`));
    console.log(`  … ${r.boxes.length - 8} more …`);
    r.boxes.slice(-4).forEach((b, i) => console.log(`  #${r.boxes.length - 4 + i + 1} x=${b.x} y=${b.y} w=${b.w} h=${b.h}`));
  }
}

async function main() {
  // --- real sheets ---
  const plague = await loadRGBA("/home/z/my-project/upload/The-plague-doctor-in-a-dark-purple-cloak,-pointed-hat,-and-b.png");
  const r1 = analyzeSheet(plague);
  report("plague", r1, plague.width, plague.height);
  await keyCells("plague", plague, r1.boxes, r1.bgColor);

  const bald = await loadRGBA("/home/z/my-project/upload/The-bald,-mustache-wearing-older-man-in-a-brown-vest-and-dar.png");
  const r2 = analyzeSheet(bald);
  report("bald", r2, bald.width, bald.height);
  await keyCells("bald", bald, r2.boxes, r2.bgColor);

  const wizard = await loadRGBA("/home/z/my-project/upload/The-pixel-art-wizard-in-a-purple-robe-and-pointed-hat-perfor.png");
  const r3 = analyzeSheet(wizard);
  report("wizard", r3, wizard.width, wizard.height);
  await keyCells("wizard", wizard, r3.boxes, r3.bgColor);

  // --- synthetic 2-row grid (stack plague halves) to test multi-row ---
  {
    const cw = 2560, ch = 640;
    const buf = new Uint8ClampedArray(cw * ch * 2 * 4);
    const bg = [125, 125, 125, 255];
    for (let i = 0; i < buf.length; i += 4) {
      buf[i] = bg[0]; buf[i + 1] = bg[1]; buf[i + 2] = bg[2]; buf[i + 3] = 255;
    }
    for (let row = 0; row < 2; row++) {
      const srcX0 = row * 2560;
      for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
          const si = (y * plague.width + srcX0 + x) * 4;
          const di = ((row * ch + y) * cw + x) * 4;
          buf[di] = plague.data[si];
          buf[di + 1] = plague.data[si + 1];
          buf[di + 2] = plague.data[si + 2];
          buf[di + 3] = plague.data[si + 3];
        }
      }
    }
    const grid: RawImage = { data: buf, width: cw, height: ch * 2 };
    const r4 = analyzeSheet(grid);
    report("grid2x4-synthetic", r4, grid.width, grid.height);
    if (r4.boxes.length > 0 && r4.mode === "grid") {
      await keyCells("grid2x4", grid, r4.boxes.slice(0, 8), r4.bgColor);
    }
  }

  // --- margin-ed sheet (outer gray margins) ---
  {
    const margin = 100;
    const w2 = plague.width + margin * 2;
    const buf = new Uint8ClampedArray(w2 * plague.height * 4);
    for (let i = 0; i < buf.length; i += 4) {
      buf[i] = 125; buf[i + 1] = 125; buf[i + 2] = 125; buf[i + 3] = 255;
    }
    for (let y = 0; y < plague.height; y++) {
      for (let x = 0; x < plague.width; x++) {
        const si = (y * plague.width + x) * 4;
        const di = (y * w2 + margin + x) * 4;
        buf[di] = plague.data[si];
        buf[di + 1] = plague.data[si + 1];
        buf[di + 2] = plague.data[si + 2];
        buf[di + 3] = plague.data[si + 3];
      }
    }
    const margined: RawImage = { data: buf, width: w2, height: plague.height };
    const r6 = analyzeSheet(margined);
    report("margined", r6, margined.width, margined.height);
  }

  // --- transparent sheet ---
  try {
    const s003 = await loadRGBA("/home/z/my-project/upload/sprite_003.png");
    const r5 = analyzeSheet(s003);
    report("transparent-s003", r5, s003.width, s003.height);
  } catch (e) {
    console.log("s003 skipped:", (e as Error).message);
  }

  console.log("\npreviews in", OUT);
}
void main();
