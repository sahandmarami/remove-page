/**
 * Dedicated background-removal engine.
 *
 * Pipeline:
 *  1. Background color estimation from the outer border (dominant sampling).
 *  2. Sobel gradient map used as an EDGE BARRIER: the seed flood-fill can
 *     never punch through strong edges, so removal can't leak inside the
 *     garment / character details.
 *  3. Flood-fill (BFS, 4-neighbour) seeded from every border pixel whose
 *     color is within tolerance of the background.
 *  4. Enclosed INTERNAL HOLES (space between arms/legs) are detected as
 *     connected background-colored regions NOT connected to the border and
 *     are removed only when their area is under the configurable cap
 *     (default 8%) so clothes never get punctured.
 *  5. Alpha feather (separable box blur) for soft matte edges.
 *  6. Defringe / Despill: un-mixes the background color out of semi
 *     transparent edge pixels and suppresses the background's dominant
 *     channel spill (green/blue halo) on near-edge pixels.
 */

import { colorDist, dominantEdgeColor, type RGB } from "./color-utils";

export interface BgRemovalOptions {
  /** Color distance tolerance vs background (8..140). */
  tolerance: number;
  /** Sobel magnitude threshold used as flood barrier (0..255). */
  edgeBarrier: number;
  /** Feather blur radius in px (0..10). */
  feather: number;
  /** Defringe / despill strength (0..1). */
  defringe: number;
  /** Remove enclosed internal holes. */
  removeHoles: boolean;
  /** Max hole area as percent of total image area (default 8). */
  holeMaxPercent: number;
}

export const DEFAULT_BG_OPTIONS: BgRemovalOptions = {
  tolerance: 40,
  edgeBarrier: 30,
  feather: 1.2,
  defringe: 0.65,
  removeHoles: true,
  holeMaxPercent: 8,
};

export interface BgRemovalResult {
  image: ImageData;
  bgColor: RGB;
  bgRatio: number;
  removedRatio: number;
}

function sobelMagnitude(gray: Float32Array, w: number, h: number): Float32Array {
  const mag = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const tl = gray[i - w - 1];
      const t = gray[i - w];
      const tr = gray[i - w + 1];
      const l = gray[i - 1];
      const r = gray[i + 1];
      const bl = gray[i + w - 1];
      const b = gray[i + w];
      const br = gray[i + w + 1];
      const gx = tr + 2 * r + br - (tl + 2 * l + bl);
      const gy = bl + 2 * b + br - (tl + 2 * t + tr);
      mag[i] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return mag;
}

function boxBlurAlpha(
  alpha: Float32Array,
  w: number,
  h: number,
  radius: number
): Float32Array {
  if (radius < 0.5) return alpha;
  const r = Math.max(1, Math.round(radius));
  const tmp = new Float32Array(alpha.length);
  // horizontal
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += alpha[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / (2 * r + 1);
      const out = alpha[row + Math.min(w - 1, Math.max(0, x - r))];
      const inc = alpha[row + Math.min(w - 1, Math.max(0, x + r + 1))];
      sum += inc - out;
    }
  }
  // vertical
  const out = new Float32Array(alpha.length);
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / (2 * r + 1);
      const o = tmp[Math.min(h - 1, Math.max(0, y - r)) * w + x];
      const inc = tmp[Math.min(h - 1, Math.max(0, y + r + 1)) * w + x];
      sum += inc - o;
    }
  }
  return out;
}

/**
 * Removes the background from an ImageData using the hybrid
 * flood-fill + edge-barrier algorithm. Returns a new ImageData.
 */
export function removeBackground(
  src: ImageData,
  options: Partial<BgRemovalOptions> = {}
): BgRemovalResult {
  const opts: BgRemovalOptions = { ...DEFAULT_BG_OPTIONS, ...options };
  const w = src.width;
  const h = src.height;
  const total = w * h;
  const data = src.data;

  const out = new ImageData(new Uint8ClampedArray(data), w, h);
  const od = out.data;

  const bg = dominantEdgeColor(data, w, h, 2);
  const bgColor = bg.color;

  // grayscale + sobel barrier
  const gray = new Float32Array(total);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  const mag = sobelMagnitude(gray, w, h);
  const barrier = new Uint8Array(total);
  for (let p = 0; p < total; p++) barrier[p] = mag[p] > opts.edgeBarrier ? 1 : 0;

  // --- edge-seeded flood fill with barrier + tolerance ---
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  const trySeed = (p: number) => {
    if (visited[p] || barrier[p]) return;
    const i = p * 4;
    if (od[i + 3] < 8) {
      visited[p] = 1; // already transparent counts as removed
      return;
    }
    const dist = colorDist([od[i], od[i + 1], od[i + 2]], bgColor);
    if (dist <= opts.tolerance) {
      visited[p] = 1;
      queue[tail++] = p;
    }
  };

  for (let x = 0; x < w; x++) {
    trySeed(x);
    trySeed((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    trySeed(y * w);
    trySeed(y * w + w - 1);
  }

  while (head < tail) {
    const p = queue[head++];
    const x = p % w;
    const y = (p - x) / w;
    if (x > 0) trySeed(p - 1);
    if (x < w - 1) trySeed(p + 1);
    if (y > 0) trySeed(p - w);
    if (y < h - 1) trySeed(p + w);
  }

  let removed = 0;
  for (let p = 0; p < total; p++) {
    if (visited[p]) {
      od[p * 4 + 3] = 0;
      removed += 1;
    }
  }

  // --- enclosed internal holes (between arms/legs) with area cap ---
  if (opts.removeHoles) {
    const holeVisited = new Uint8Array(total);
    const cap = (opts.holeMaxPercent / 100) * total;
    for (let p = 0; p < total; p++) {
      if (visited[p] || holeVisited[p]) continue;
      const i = p * 4;
      if (od[i + 3] === 0) continue;
      const dist = colorDist([od[i], od[i + 1], od[i + 2]], bgColor);
      if (dist > opts.tolerance * 0.92) continue;

      // BFS this candidate region
      let hHead = 0;
      let hTail = 0;
      const region: number[] = [];
      holeVisited[p] = 1;
      queue[hTail++] = p;
      let touchesBorder = false;
      while (hHead < hTail) {
        const cur = queue[hHead++];
        region.push(cur);
        const cx = cur % w;
        const cy = (cur - cx) / w;
        if (cx === 0 || cy === 0 || cx === w - 1 || cy === h - 1) touchesBorder = true;
        const nb = [cx > 0 ? cur - 1 : -1, cx < w - 1 ? cur + 1 : -1, cy > 0 ? cur - w : -1, cy < h - 1 ? cur + w : -1];
        for (const n of nb) {
          if (n < 0 || holeVisited[n] || visited[n]) continue;
          const ni = n * 4;
          if (od[ni + 3] === 0) continue;
          const nd = colorDist([od[ni], od[ni + 1], od[ni + 2]], bgColor);
          if (nd > opts.tolerance * 0.92) continue;
          holeVisited[n] = 1;
          queue[hTail++] = n;
        }
      }

      // Only enclosed (not touching border) regions under the area cap are
      // punched out — this is what keeps garments intact.
      if (!touchesBorder && region.length <= cap) {
        for (const rp of region) od[rp * 4 + 3] = 0;
        removed += region.length;
      }
    }
  }

  // --- feather the alpha channel ---
  if (opts.feather >= 0.5) {
    const alpha = new Float32Array(total);
    for (let p = 0; p < total; p++) alpha[p] = od[p * 4 + 3];
    const blurred = boxBlurAlpha(alpha, w, h, opts.feather);
    for (let p = 0; p < total; p++) od[p * 4 + 3] = blurred[p];
  }

  // --- defringe / despill ---
  if (opts.defringe > 0.01) {
    // dominant channel of the background (spill channel)
    const [br, bgg, bb] = bgColor;
    const bgMax = Math.max(br, bgg, bb);
    const spillChannel =
      bgMax === bgg && bgg - Math.max(br, bb) > 24
        ? 1
        : bgMax === br && br - Math.max(bgg, bb) > 24
          ? 0
          : bgMax === bb && bb - Math.max(br, bgg) > 24
            ? 2
            : -1;

    const strength = opts.defringe;
    for (let p = 0; p < total; p++) {
      const i = p * 4;
      const a = od[i + 3];
      if (a === 0) continue;

      // Un-mix bg from semi-transparent (feathered) pixels: c = (px - bg*(1-a))/a
      if (a < 250) {
        const af = a / 255;
        for (let c = 0; c < 3; c++) {
          const px = od[i + c];
          const unmixed = (px - bgColor[c] * (1 - af)) / af;
          od[i + c] = px + (unmixed - px) * strength;
        }
      }

      // Suppress the background's dominant channel spill on near-bg pixels
      const sc = spillChannel;
      if (sc >= 0) {
        const pr = od[i];
        const pg = od[i + 1];
        const pb = od[i + 2];
        const px: RGB = [pr, pg, pb];
        const nearBg = colorDist(px, bgColor) < opts.tolerance * 1.35;
        if (nearBg || a < 250) {
          const others =
            sc === 0 ? Math.max(pg, pb) : sc === 1 ? Math.max(pr, pb) : Math.max(pr, pg);
          const val = sc === 0 ? pr : sc === 1 ? pg : pb;
          if (val > others) {
            const target = others + (val - others) * (1 - strength);
            if (sc === 0) od[i] = target;
            else if (sc === 1) od[i + 1] = target;
            else od[i + 2] = target;
          }
        }
      }
    }
  }

  return {
    image: out,
    bgColor,
    bgRatio: bg.ratio,
    removedRatio: removed / total,
  };
}
