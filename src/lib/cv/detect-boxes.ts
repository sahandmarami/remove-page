/**
 * Client-side hybrid detection fallback — precision edition:
 * 1. Multi-cluster dominant background colors sampled from the image edges
 *    (handles gradients / shadows / textured paper).
 * 2. Foreground binary mask via min color distance to the clusters.
 * 3. Morphological closing (dilate + erode) to merge sprite parts.
 * 4. Connected Component Labeling (BFS) with bounding-box extraction.
 * 5. Iterative box merging for nearby/overlapping fragments.
 * 6. FULL-RESOLUTION SHRINK-WRAP refinement: every box edge is walked
 *    inward/outward on the original image until it hugs the artwork —
 *    the box no longer keeps the padding of the downscaled analysis pass.
 *
 * Runs entirely offline.
 */

import { colorDist, dominantEdgeColors, minClusterDist, type RGB } from "./color-utils";

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
  /**
   * Trusted background colors (e.g. sampled once and reused). When omitted,
   * clusters are estimated from the image border.
   */
  bgColors?: RGB[] | null;
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

/** Full-res strip inspector: lazily reads 1px columns/rows from the source. */
class StripInspector {
  private cache = new Map<string, { fg: number; n: number }>();
  constructor(
    private source: HTMLCanvasElement,
    private clusters: RGB[],
    private tolerance: number
  ) {}

  private read(x: number, y0: number, y1: number): Uint8ClampedArray | null {
    if (x < 0 || x >= this.source.width || y0 >= y1) return null;
    const ctx = this.source.getContext("2d", { willReadFrequently: true })!;
    const h = y1 - y0;
    return ctx.getImageData(x, y0, 1, h).data;
  }

  private readRow(y: number, x0: number, x1: number): Uint8ClampedArray | null {
    if (y < 0 || y >= this.source.height || x0 >= x1) return null;
    const ctx = this.source.getContext("2d", { willReadFrequently: true })!;
    const wpx = x1 - x0;
    return ctx.getImageData(x0, y, wpx, 1).data;
  }

  /** Ratio (0..1) of foreground-looking pixels in a 1px column. */
  colFgRatio(x: number, y0: number, y1: number): number {
    const key = `c${x}:${y0}-${y1}`;
    const hit = this.cache.get(key);
    if (hit) return hit.fg / hit.n;
    const d = this.read(x, y0, y1);
    if (!d) return 1; // out of bounds → treat as content, don't shrink past
    let fg = 0;
    let n = 0;
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      n += 1;
      if (d[i + 3] < 16) continue;
      if (minClusterDist([d[i], d[i + 1], d[i + 2]], this.clusters) > this.tolerance) fg += 1;
    }
    this.cache.set(key, { fg, n });
    return n === 0 ? 1 : fg / n;
  }

  /** Ratio (0..1) of foreground-looking pixels in a 1px row segment. */
  rowFgRatio(y: number, x0: number, x1: number): number {
    const key = `r${y}:${x0}-${x1}`;
    const hit = this.cache.get(key);
    if (hit) return hit.fg / hit.n;
    const d = this.readRow(y, x0, x1);
    if (!d) return 1;
    let fg = 0;
    let n = 0;
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      n += 1;
      if (d[i + 3] < 16) continue;
      if (minClusterDist([d[i], d[i + 1], d[i + 2]], this.clusters) > this.tolerance) fg += 1;
    }
    this.cache.set(key, { fg, n });
    return n === 0 ? 1 : fg / n;
  }
}

interface RRect {
  x: number;
  y: number;
  x2: number;
  y2: number;
}

/**
 * Shrink-wrap one full-resolution rect: walk each edge inward while the
 * strip is (almost) empty background, then walk outward while the adjacent
 * strip is clearly still foreground. Result: boxes hug the sprite contour.
 */
function shrinkWrap(
  insp: StripInspector,
  sw: number,
  sh: number,
  rect: RRect
): RRect {
  // clamp to image
  let { x, y, x2, y2 } = rect;
  x = Math.max(0, Math.min(sw - 1, Math.round(x)));
  y = Math.max(0, Math.min(sh - 1, Math.round(y)));
  x2 = Math.max(x + 4, Math.min(sw, Math.round(x2)));
  y2 = Math.max(y + 4, Math.min(sh, Math.round(y2)));

  const maxSide = Math.max(x2 - x, y2 - y);
  // how far edges may move inward (trim empty margin)
  const shrinkBudget = Math.max(6, Math.min(48, Math.round(maxSide * 0.12)));
  // how far edges may move outward (grab cut-off anti-aliased edges)
  const expandBudget = Math.max(2, Math.min(14, Math.round(maxSide * 0.04)));

  // ---- shrink pass ----
  let budget = shrinkBudget;
  while (budget-- > 0 && x2 - x > 8 && insp.colFgRatio(x, y, y2) < 0.015) x++;
  budget = shrinkBudget;
  while (budget-- > 0 && x2 - x > 8 && insp.colFgRatio(x2 - 1, y, y2) < 0.015) x2--;
  budget = shrinkBudget;
  while (budget-- > 0 && y2 - y > 8 && insp.rowFgRatio(y, x, x2) < 0.015) y++;
  budget = shrinkBudget;
  while (budget-- > 0 && y2 - y > 8 && insp.rowFgRatio(y2 - 1, x, x2) < 0.015) y2--;

  // ---- expand pass (re-capture anti-aliased borders) ----
  budget = expandBudget;
  while (budget-- > 0 && x > 0 && insp.colFgRatio(x - 1, y, y2) > 0.3) x--;
  budget = expandBudget;
  while (budget-- > 0 && x2 < sw && insp.colFgRatio(x2, y, y2) > 0.3) x2++;
  budget = expandBudget;
  while (budget-- > 0 && y > 0 && insp.rowFgRatio(y - 1, x, x2) > 0.3) y--;
  budget = expandBudget;
  while (budget-- > 0 && y2 < sh && insp.rowFgRatio(y2, x, x2) > 0.3) y2++;

  return { x, y, x2, y2 };
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
  // higher working resolution → finer initial boxes (refined on full res later)
  const scale = Math.min(1, 1400 / Math.max(sw, sh));
  const w = Math.max(2, Math.round(sw * scale));
  const h = Math.max(2, Math.round(sh * scale));

  const work = document.createElement("canvas");
  work.width = w;
  work.height = h;
  const wctx = work.getContext("2d", { willReadFrequently: true })!;
  wctx.drawImage(source, 0, 0, w, h);
  const img = wctx.getImageData(0, 0, w, h);
  const data = img.data;

  // --- background clusters (hint wins) ---
  let clusters: RGB[];
  let bgRatio: number;
  if (options.bgColors && options.bgColors.length > 0) {
    clusters = options.bgColors;
    bgRatio = 1;
  } else {
    const found = dominantEdgeColors(data, w, h, 3, 3, 0.1);
    clusters = found.map((c) => c.color);
    bgRatio = found[0]?.ratio ?? 0;
  }

  // --- foreground binary mask ---
  let fg: Uint8Array<ArrayBufferLike> = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    if (data[i + 3] < 16) continue; // already transparent
    if (minClusterDist([data[i], data[i + 1], data[i + 2]], clusters) > tolerance) fg[p] = 1;
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

  // --- full-resolution shrink-wrap refinement ---
  const insp = new StripInspector(source, clusters, tolerance);
  const boxes: Box[] = rects.map((r) => {
    const fx = r.x / scale;
    const fy = r.y / scale;
    const fx2 = (r.x + r.w) / scale;
    const fy2 = (r.y + r.h) / scale;
    const refined = shrinkWrap(insp, sw, sh, { x: fx, y: fy, x2: fx2, y2: fy2 });
    // 1px safety pad so anti-aliased borders are never clipped
    const px = Math.max(0, refined.x - 1);
    const py = Math.max(0, refined.y - 1);
    const px2 = Math.min(sw, refined.x2 + 1);
    const py2 = Math.min(sh, refined.y2 + 1);
    return {
      id: makeBoxId(),
      x: Math.round(px),
      y: Math.round(py),
      w: Math.max(4, Math.round(px2 - px)),
      h: Math.max(4, Math.round(py2 - py)),
      label: undefined,
    };
  });

  return { boxes, bgColor: clusters[0], bgRatio };
}
