/**
 * Client-side hybrid detection fallback:
 * 1. Dominant background color sampled from the image edges.
 * 2. Foreground binary mask via color distance.
 * 3. Morphological closing (dilate + erode) to merge sprite parts.
 * 4. Connected Component Labeling (BFS) with bounding-box extraction.
 * 5. Iterative box merging for nearby/overlapping fragments.
 *
 * Runs entirely offline on a downscaled working canvas.
 */

import { colorDist, dominantEdgeColor, type RGB } from "./color-utils";

export interface Box {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
}

export interface DetectOptions {
  /** Color distance threshold vs background (default 42). */
  tolerance?: number;
  /** Morphological close radius in working pixels (default 3). */
  closeRadius?: number;
  /** Merge boxes whose padded rects overlap by this gap in px (default 12). */
  mergeGap?: number;
  /** Ignore components smaller than this ratio of image area (default 0.0012). */
  minAreaRatio?: number;
}

let boxCounter = 0;
export function makeBoxId(): string {
  boxCounter += 1;
  return `box-${Date.now().toString(36)}-${boxCounter}`;
}

function dilateRows(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const out = new Uint8Array(src.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let v = 0;
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w - 1, x + r);
      for (let i = x0; i <= x1; i++) {
        if (src[row + i]) {
          v = 1;
          break;
        }
      }
      out[row + x] = v;
    }
  }
  return out;
}

function dilateCols(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const out = new Uint8Array(src.length);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let v = 0;
      const y0 = Math.max(0, y - r);
      const y1 = Math.min(h - 1, y + r);
      for (let i = y0; i <= y1; i++) {
        if (src[i * w + x]) {
          v = 1;
          break;
        }
      }
      out[y * w + x] = v;
    }
  }
  return out;
}

interface RawComponent {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  area: number;
}

function rectsIntersect(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
  gap: number
): boolean {
  return (
    a.x - gap < b.x + b.w + gap &&
    a.x + a.w + gap > b.x - gap &&
    a.y - gap < b.y + b.h + gap &&
    a.y + a.h + gap > b.y - gap
  );
}

function mergeRects(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
): { x: number; y: number; w: number; h: number } {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const x2 = Math.max(a.x + a.w, b.x + b.w);
  const y2 = Math.max(a.y + a.h, b.y + b.h);
  return { x, y, w: x2 - x, h: y2 - y };
}

export interface DetectionResult {
  boxes: Box[];
  bgColor: RGB;
  bgRatio: number;
}

/**
 * Detect sprite bounding boxes on a canvas without any server round-trip.
 */
export function detectBoxes(
  source: HTMLCanvasElement,
  options: DetectOptions = {}
): DetectionResult {
  const tolerance = options.tolerance ?? 42;
  const closeRadius = options.closeRadius ?? 3;
  const mergeGap = options.mergeGap ?? 12;
  const minAreaRatio = options.minAreaRatio ?? 0.0012;

  const sw = source.width;
  const sh = source.height;
  const scale = Math.min(1, 900 / Math.max(sw, sh));
  const w = Math.max(2, Math.round(sw * scale));
  const h = Math.max(2, Math.round(sh * scale));

  const work = document.createElement("canvas");
  work.width = w;
  work.height = h;
  const wctx = work.getContext("2d", { willReadFrequently: true })!;
  wctx.drawImage(source, 0, 0, w, h);
  const img = wctx.getImageData(0, 0, w, h);
  const data = img.data;

  const bg = dominantEdgeColor(data, w, h, 2);

  // --- foreground binary mask ---
  let fg: Uint8Array<ArrayBufferLike> = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    if (data[i + 3] < 16) continue; // already transparent
    const dist = colorDist([data[i], data[i + 1], data[i + 2]], bg.color);
    if (dist > tolerance) fg[p] = 1;
  }

  // --- morphological closing (dilate -> erode) ---
  if (closeRadius > 0) {
    fg = dilateRows(fg, w, h, closeRadius);
    fg = dilateCols(fg, w, h, closeRadius);
    // erode = dilate of inverted mask
    let inv: Uint8Array<ArrayBufferLike> = new Uint8Array(fg.length);
    for (let i = 0; i < fg.length; i++) inv[i] = fg[i] ? 0 : 1;
    inv = dilateRows(inv, w, h, closeRadius);
    inv = dilateCols(inv, w, h, closeRadius);
    const closed = new Uint8Array(fg.length);
    for (let i = 0; i < fg.length; i++) closed[i] = inv[i] ? 0 : 1;
    fg = closed;
  }

  // --- connected component labeling (BFS, 4-neighbourhood) ---
  const labels = new Int32Array(w * h);
  const queue = new Int32Array(w * h);
  const components: RawComponent[] = [];
  const minArea = Math.max(80, minAreaRatio * w * h);

  for (let p = 0; p < fg.length; p++) {
    if (!fg[p] || labels[p]) continue;
    const compId = components.length + 1;
    let head = 0;
    let tail = 0;
    queue[tail++] = p;
    labels[p] = compId;
    const comp: RawComponent = {
      minX: w,
      minY: h,
      maxX: 0,
      maxY: 0,
      area: 0,
    };
    while (head < tail) {
      const cur = queue[head++];
      const cx = cur % w;
      const cy = (cur - cx) / w;
      comp.area += 1;
      if (cx < comp.minX) comp.minX = cx;
      if (cx > comp.maxX) comp.maxX = cx;
      if (cy < comp.minY) comp.minY = cy;
      if (cy > comp.maxY) comp.maxY = cy;

      // neighbours
      if (cx > 0 && fg[cur - 1] && !labels[cur - 1]) {
        labels[cur - 1] = compId;
        queue[tail++] = cur - 1;
      }
      if (cx < w - 1 && fg[cur + 1] && !labels[cur + 1]) {
        labels[cur + 1] = compId;
        queue[tail++] = cur + 1;
      }
      if (cy > 0 && fg[cur - w] && !labels[cur - w]) {
        labels[cur - w] = compId;
        queue[tail++] = cur - w;
      }
      if (cy < h - 1 && fg[cur + w] && !labels[cur + w]) {
        labels[cur + w] = compId;
        queue[tail++] = cur + w;
      }
    }
    components.push(comp);
  }

  // --- build rects, filter noise ---
  type WRect = { x: number; y: number; w: number; h: number };
  let rects: WRect[] = [];
  for (const c of components) {
    const bw = c.maxX - c.minX + 1;
    const bh = c.maxY - c.minY + 1;
    if (c.area < minArea) continue;
    if (bw < 8 || bh < 8) continue;
    rects.push({ x: c.minX, y: c.minY, w: bw, h: bh });
  }

  // --- iterative merge of nearby / overlapping fragments ---
  let merged = true;
  let guard = 0;
  while (merged && guard < 40) {
    merged = false;
    guard += 1;
    outer: for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        if (rectsIntersect(rects[i], rects[j], mergeGap)) {
          rects[i] = mergeRects(rects[i], rects[j]);
          rects.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }

  // sort row-major (top-to-bottom, then right-to-left reading order for RTL sheets)
  rects.sort((a, b) => {
    const rowTol = Math.max(8, Math.min(a.h, b.h) * 0.4);
    const ra = a.y + a.h / 2;
    const rb = b.y + b.h / 2;
    if (Math.abs(ra - rb) <= rowTol) return b.x - a.x; // RTL: right first
    return ra - rb;
  });

  // --- map back to source resolution ---
  const pad = 2;
  const boxes: Box[] = rects.map((r) => {
    const x = Math.max(0, r.x / scale - pad);
    const y = Math.max(0, r.y / scale - pad);
    const x2 = Math.min(sw, (r.x + r.w) / scale + pad);
    const y2 = Math.min(sh, (r.y + r.h) / scale + pad);
    return {
      id: makeBoxId(),
      x: Math.round(x),
      y: Math.round(y),
      w: Math.max(4, Math.round(x2 - x)),
      h: Math.max(4, Math.round(y2 - y)),
      label: undefined,
    };
  });

  return { boxes, bgColor: bg.color, bgRatio: bg.ratio };
}
