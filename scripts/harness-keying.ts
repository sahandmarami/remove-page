/**
 * Harness: reproduce the site's keying pipeline on the user's rocket GIF
 * and export result frames for visual A/B inspection (no DOM needed).
 */
import { parseGIF, decompressFrames } from "gifuct-js";
import sharp from "sharp";
import { readFileSync, mkdirSync } from "fs";
import { autoRemoveBackground } from "../src/lib/cv/auto-remove";

// --- polyfill ImageData for the cv modules (they only use it as a container) ---
class ImageDataPoly {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  constructor(data: Uint8ClampedArray | number, w?: number, h?: number) {
    if (typeof data === "number") {
      this.width = data; this.height = w!;
      this.data = new Uint8ClampedArray(data * w! * 4);
    } else {
      this.data = data; this.width = w!; this.height = h!;
    }
  }
}
(globalThis as any).ImageData = ImageDataPoly;

const GIF = "/home/z/my-project/upload/file_000000002278820a8c32b4cc1650793a.gif";
const OUT = "/tmp/harness";
mkdirSync(OUT, { recursive: true });

interface RawFrame { data: Uint8ClampedArray; width: number; height: number; delayMs: number }

function decodeGif(buf: ArrayBuffer): { width: number; height: number; frames: RawFrame[] } {
  const gif = parseGIF(buf);
  const raw = decompressFrames(gif, true) as any[];
  console.log("decodeGif: raw frames:", raw.length, "first:", raw[0] && Object.keys(raw[0]));
  const width = gif.lsd.width, height = gif.lsd.height;
  let comp = new Uint8ClampedArray(width * height * 4); // opaque-ish canvas
  let pendingDisposal = 0;
  let pendingRect: any = null;
  let saved: Uint8ClampedArray | null = null;
  const frames: RawFrame[] = [];
  for (const rf of raw) {
    if (!rf?.dims?.patch) continue;
    const { top, left, width: pw, height: ph } = rf.dims;
    const disposal = rf.disposalType ?? 0;
    if (pendingDisposal === 2 && pendingRect) {
      for (let y = pendingRect.top; y < pendingRect.top + pendingRect.height; y++)
        for (let x = pendingRect.left; x < pendingRect.left + pendingRect.width; x++) {
          const i = (y * width + x) * 4;
          comp[i + 3] = 0;
        }
    } else if (pendingDisposal === 3 && saved) {
      comp = new Uint8ClampedArray(saved);
    }
    saved = null;
    if (disposal === 3) saved = new Uint8ClampedArray(comp);
    // draw patch (gifuct patch is RGBA already)
    for (let y = 0; y < ph; y++)
      for (let x = 0; x < pw; x++) {
        const si = (y * pw + x) * 4;
        const di = ((top + y) * width + left + x) * 4;
        comp[di] = rf.patch[si];
        comp[di + 1] = rf.patch[si + 1];
        comp[di + 2] = rf.patch[si + 2];
        comp[di + 3] = rf.patch[si + 3];
      }
    frames.push({ data: new Uint8ClampedArray(comp), width, height, delayMs: Math.max(20, rf.delay ?? 100) });
    pendingDisposal = disposal;
    pendingRect = rf.dims;
  }
  return { width, height, frames };
}

function savePng(raw: { data: Uint8ClampedArray; width: number; height: number }, path: string, bg?: [number, number, number]) {
  let buf = raw.data;
  if (bg) {
    buf = new Uint8ClampedArray(raw.data);
    for (let i = 0; i < buf.length; i += 4) {
      const a = buf[i + 3] / 255;
      buf[i] = buf[i] * a + bg[0] * (1 - a);
      buf[i + 1] = buf[i + 1] * a + bg[1] * (1 - a);
      buf[i + 2] = buf[i + 2] * a + bg[2] * (1 - a);
      buf[i + 3] = 255;
    }
  }
  return sharp(Buffer.from(buf.buffer, buf.byteOffset, buf.length), { raw: { width: raw.width, height: raw.height, channels: 4 } }).png().toFile(path);
}

async function main() {
  const rb = readFileSync(GIF);
  const ab = rb.buffer.slice(rb.byteOffset, rb.byteOffset + rb.byteLength) as ArrayBuffer;
  const { width, height, frames } = decodeGif(ab);
  console.log("gif", width, height, "frames:", frames.length);
  if (frames.length === 0) throw new Error("no frames decoded");

  for (const [label, feather, defringe] of [
    ["current", 1.0, 0.85],   // what the site ships today
  ] as const) {
    const f0 = frames[0];
    const img = new ImageDataPoly(new Uint8ClampedArray(f0.data), width, height);
    const t0 = Date.now();
    const res = autoRemoveBackground(img as any, { feather, removeHoles: true, defringe } as any);
    console.log(label, "tolerance:", (res as any).autoTolerance, "removed:", (res.removedRatio * 100).toFixed(1) + "%", Date.now() - t0 + "ms");
    await savePng({ data: res.image.data, width, height }, `${OUT}/${label}-alpha.png`);
    await savePng({ data: res.image.data, width, height }, `${OUT}/${label}-gray.png`, [160, 160, 160]);
  }
}
void main();
