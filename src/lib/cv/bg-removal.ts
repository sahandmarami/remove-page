/**
 * Dedicated background-removal engine — precision matting pipeline.
 *
 * Pipeline:
 *  1. Background estimation: multi-cluster sampling of the outer border
 *     (handles gradients / shadows), or a trusted color hint passed from
 *     the sheet detector (important for tight crops whose border is mostly
 *     sprite pixels).
 *  2. Sobel gradient map used as an EDGE BARRIER: the seed flood-fill can
 *     never punch through strong edges, so removal can't leak inside the
 *     character details.
 *  3. Flood-fill (BFS, 4-neighbour) seeded from every border pixel whose
 *     color is within tolerance of ANY background cluster.
 *  4. Enclosed INTERNAL HOLES (space between arms/legs) are detected as
 *     connected background-colored regions NOT connected to the border and
 *     are removed only when their area is under the configurable cap
 *     (default 8%) so clothes never get punctured.
 *  5. BOUNDARY MATTING: every kept pixel touching the removed area gets a
 *     closed-form alpha estimate — its color is projected onto the segment
 *     between the background cluster and the nearest solid foreground
 *     pixel. This replaces the old "binary cut + heavy blur" look with a
 *     true sub-pixel soft edge and kills the white/colorful halo.
 *  6. Light feather blur for extra smoothness (small radius).
 *  7. Defringe / Despill: un-mixes the background color out of semi
 *     transparent edge pixels and suppresses the background's dominant
 *     channel spill (green/blue halo) on near-edge pixels.
 */

import { colorDist, dominantEdgeColors, minClusterDist, type RGB } from "./color-utils";

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
  /**
   * Trusted background color hint (e.g. measured on the full sheet before
   * cropping). When provided it overrides border sampling — crucial for
   * tight crops where the border may contain mostly foreground pixels.
   */
  bgColorHint?: RGB | null;
  /**
   * Pre-discovered background clusters (auto engine). When provided it
   * replaces the internal border sampling entirely.
   */
  bgClusters?: RGB[] | null;
}

export const DEFAULT_BG_OPTIONS: BgRemovalOptions = {
  tolerance: 40,
  edgeBarrier: 26,
  feather: 0.8,
  defringe: 0.75,
  removeHoles: true,
  holeMaxPercent: 8,
  bgColorHint: null,
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

/** Dist to nearest bg cluster, treating already-transparent as bg (0). */
function fgConfidence(od: Uint8ClampedArray, p: number, clusters: RGB[]): number {
  const i = p * 4;
  if (od[i + 3] < 8) return 0;
  return minClusterDist([od[i], od[i + 1], od[i + 2]], clusters);
}

/**
 * Closed-form boundary matting for one boundary pixel:
 * alpha = clamp( dot(px-bg, fg-bg) / |fg-bg|^2 ), 0..1
 * and the foreground color is re-derived by un-mixing the background.
 */
function matteBoundaryPixel(
  od: Uint8ClampedArray,
  p: number,
  bg: RGB,
  fg: RGB
): void {
  const i = p * 4;
  const dr = fg[0] - bg[0];
  const dg = fg[1] - bg[1];
  const db = fg[2] - bg[2];
  const len2 = dr * dr + dg * dg + db * db;
  if (len2 < 1) return;

  const px = od[i];
  const pg = od[i + 1];
  const pb = od[i + 2];
  const dp = (px - bg[0]) * dr + (pg - bg[1]) * dg + (pb - bg[2]) * db;
  const t = Math.max(0, Math.min(1, dp / len2));

  const a = Math.round(255 * t);
  if (a <= 6) {
    od[i + 3] = 0; // effectively background
    return;
  }
  od[i + 3] = a;
  if (a >= 250) return; // fully opaque, keep original color

  // un-mix: fg = bg + (px - bg) / t   (guard tiny t)
  const inv = Math.min(1 / Math.max(t, 0.12), 8);
  od[i] = Math.max(0, Math.min(255, bg[0] + (px - bg[0]) * inv));
  od[i + 1] = Math.max(0, Math.min(255, bg[1] + (pg - bg[1]) * inv));
  od[i + 2] = Math.max(0, Math.min(255, bg[2] + (pb - bg[2]) * inv));
}

/** Find the nearest solid (opaque, non-boundary) foreground color around p. */
function nearestSolidFg(
  od: Uint8ClampedArray,
  p: number,
  w: number,
  h: number,
  solid: Uint8Array
): RGB | null {
  const x = p % w;
  const y = (p - x) / w;
  for (let r = 1; r <= 3; r++) {
    let best: RGB | null = null;
    let bestD = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= h) continue;
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue; // ring only
        const nx = x + dx;
        if (nx < 0 || nx >= w) continue;
        const np = ny * w + nx;
        if (!solid[np]) continue;
        const ni = np * 4;
        const d =
          Math.abs(od[ni] - od[p * 4]) +
          Math.abs(od[ni + 1] - od[p * 4 + 1]) +
          Math.abs(od[ni + 2] - od[p * 4 + 2]);
        if (d < bestD) {
          bestD = d;
          best = [od[ni], od[ni + 1], od[ni + 2]];
        }
      }
    }
    if (best) return best;
  }
  return null;
}

/**
 * Removes the background from an ImageData using the hybrid
 * flood-fill + edge-barrier + boundary-matting algorithm.
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

  // --- background clusters: hint wins, then provided clusters, then border sampling ---
  let clusters: RGB[];
  let bgRatio: number;
  if (opts.bgColorHint) {
    clusters = [opts.bgColorHint];
    bgRatio = 1;
  } else if (opts.bgClusters && opts.bgClusters.length > 0) {
    clusters = opts.bgClusters;
    bgRatio = 1;
  } else {
    const found = dominantEdgeColors(data, w, h, 3, 3, 0.1);
    clusters = found.map((c) => c.color);
    bgRatio = found[0]?.ratio ?? 0;
  }
  // dominant cluster (first) is used for defringe/spill
  const bgColor = clusters[0];

  // grayscale + sobel barrier
  const gray = new Float32Array(total);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  const mag = sobelMagnitude(gray, w, h);
  const barrier = new Uint8Array(total);
  for (let p = 0; p < total; p++) barrier[p] = mag[p] > opts.edgeBarrier ? 1 : 0;

  // --- edge-seeded flood fill with barrier + multi-cluster tolerance ---
  const removed = new Uint8Array(total);
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  const trySeed = (p: number) => {
    if (visited[p] || barrier[p]) return;
    const i = p * 4;
    if (od[i + 3] < 8) {
      visited[p] = 1;
      removed[p] = 1; // already transparent counts as removed
      return;
    }
    if (minClusterDist([od[i], od[i + 1], od[i + 2]], clusters) <= opts.tolerance) {
      visited[p] = 1;
      removed[p] = 1;
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

  let removedCount = 0;
  for (let p = 0; p < total; p++) {
    if (removed[p]) {
      od[p * 4 + 3] = 0;
      removedCount += 1;
    }
  }

  // --- enclosed internal holes (between arms/legs) with area cap ---
  if (opts.removeHoles) {
    const holeVisited = new Uint8Array(total);
    const cap = (opts.holeMaxPercent / 100) * total;
    for (let p = 0; p < total; p++) {
      if (removed[p] || holeVisited[p]) continue;
      if (fgConfidence(od, p, clusters) > opts.tolerance * 0.92) continue;

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
          if (n < 0 || holeVisited[n] || removed[n]) continue;
          if (fgConfidence(od, n, clusters) > opts.tolerance * 0.92) continue;
          holeVisited[n] = 1;
          queue[hTail++] = n;
        }
      }

      // Only enclosed (not touching border) regions under the area cap are
      // punched out — this is what keeps garments intact.
      if (!touchesBorder && region.length <= cap) {
        for (const rp of region) {
          od[rp * 4 + 3] = 0;
          removed[rp] = 1;
        }
        removedCount += region.length;
      }
    }
  }

  // --- boundary matting: soft alpha + un-mixed colors on the fg edge ring ---
  // solid = opaque pixels that are NOT on the boundary (reference fg colors)
  const boundary = new Uint8Array(total);
  const solid = new Uint8Array(total);
  for (let p = 0; p < total; p++) {
    if (removed[p]) continue;
    const x = p % w;
    const y = (p - x) / w;
    const isBoundary =
      (x > 0 && removed[p - 1]) ||
      (x < w - 1 && removed[p + 1]) ||
      (y > 0 && removed[p - w]) ||
      (y < h - 1 && removed[p + w]);
    if (isBoundary) boundary[p] = 1;
    else solid[p] = od[p * 4 + 3] >= 250 ? 1 : 0;
  }

  for (let p = 0; p < total; p++) {
    if (!boundary[p]) continue;
    const fg = nearestSolidFg(od, p, w, h, solid);
    if (fg) matteBoundaryPixel(od, p, bgColor, fg);
  }

  // --- feather the alpha channel (small radius — matting did the work) ---
  if (opts.feather >= 0.5) {
    const alpha = new Float32Array(total);
    for (let p = 0; p < total; p++) alpha[p] = od[p * 4 + 3];
    const blurred = boxBlurAlpha(alpha, w, h, opts.feather);
    for (let p = 0; p < total; p++) od[p * 4 + 3] = blurred[p];
  }

  // --- defringe / despill ---
  if (opts.defringe > 0.01) {
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
        const nearBg = minClusterDist(px, clusters) < opts.tolerance * 1.35;
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
    bgRatio,
    removedRatio: removedCount / total,
  };
}
