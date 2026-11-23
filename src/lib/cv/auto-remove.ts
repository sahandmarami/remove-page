/**
 * Fully-automatic background removal — "drop it in, get a clean cut".
 *
 * The auto pipeline:
 *  1. BACKGROUND DISCOVERY — multi-cluster sampling of the outer border band
 *     (robust against gradients, shadows and vignetting).
 *  2. TOLERANCE CALIBRATION — the color-distance distribution of the border
 *     pixels is measured and the keying tolerance is derived from its median.
 *     A flat studio background (median ≈ 0) gets a tight tolerance so the
 *     subject is never eaten; a noisy/gradient background gets a wider one so
 *     no speckles remain. No manual tuning needed.
 *  3. PRECISION CUT — delegates to the matting pipeline (edge-seeded flood
 *     fill + Sobel edge barrier + closed-form boundary matting + despill),
 *     which produces soft sub-pixel edges with no halo.
 */

import {
  colorDist,
  minClusterDist,
  type RGB,
} from "./color-utils";
import {
  removeBackground,
  type BgRemovalOptions,
  type BgRemovalResult,
} from "./bg-removal";

export interface AutoRemoveOptions {
  /**
   * User-facing sensitivity multiplier applied on top of the auto-calibrated
   * tolerance (0.5 .. 1.8). 1 = fully automatic.
   */
  sensitivity?: number;
  /** Trusted background color hint (skips border discovery when given). */
  bgColorHint?: RGB | null;
  /** Punch out enclosed holes (space between legs/arms). Default true. */
  removeHoles?: boolean;
  /** Feather radius override in px (default 1.0 — soft but crisp). */
  feather?: number;
}

export interface AutoRemoveResult extends BgRemovalResult {
  /** Background clusters used for the cut. */
  clusters: RGB[];
  /** The tolerance the auto-calibrator chose. */
  autoTolerance: number;
}

/** Weighted color distance of one pixel to the nearest cluster. */
function pixelClusterDist(
  data: Uint8ClampedArray,
  p: number,
  clusters: RGB[]
): number {
  const i = p * 4;
  return minClusterDist([data[i], data[i + 1], data[i + 2]], clusters);
}

/**
 * Border-edge-aware background cluster discovery.
 *
 * A candidate cluster is only accepted as BACKGROUND when it genuinely
 * surrounds the frame: it must appear on at least 3 of the 4 border edges,
 * or on 2 edges while covering a big share of the whole border. A subject
 * that merely touches one edge (a nose cone, a foot) can never become a
 * background cluster, so it can never be eaten by the flood fill.
 */
export function discoverBgClusters(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  band = 3,
  maxClusters = 3
): RGB[] {
  interface Bucket {
    r: number; g: number; b: number; n: number;
    top: number; bottom: number; left: number; right: number;
  }
  const buckets = new Map<number, Bucket>();
  const edgeTotal = [0, 0, 0, 0]; // top, bottom, left, right
  let total = 0;

  const add = (x: number, y: number, edge: number) => {
    const i = (y * w + x) * 4;
    if (data[i + 3] < 8) return;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const key = ((r >> 5) << 10) | ((g >> 5) << 5) | (b >> 5);
    const cur = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0, top: 0, bottom: 0, left: 0, right: 0 };
    cur.r += r; cur.g += g; cur.b += b; cur.n += 1;
    if (edge >= 0) {
      if (edge === 0) cur.top += 1;
      else if (edge === 1) cur.bottom += 1;
      else if (edge === 2) cur.left += 1;
      else cur.right += 1;
    }
    buckets.set(key, cur);
    if (edge >= 0) edgeTotal[edge] += 1;
    total += 1;
  };

  const b = Math.min(band, h >> 1, w >> 1);
  const bb = Math.min(band, w >> 1);
  for (let y = 0; y < b; y++) {
    for (let x = 0; x < w; x++) {
      add(x, y, y === 0 ? 0 : -1);
      add(x, h - 1 - y, y === 0 ? 1 : -1);
    }
  }
  for (let x = 0; x < bb; x++) {
    for (let y = 0; y < h; y++) {
      add(x, y, x === 0 ? 2 : -1);
      add(w - 1 - x, y, x === 0 ? 3 : -1);
    }
  }

  if (total === 0) return [[255, 255, 255]];

  const sorted = [...buckets.values()].sort((p, q) => q.n - p.n);

  // merge buckets with similar average colors (gradients / compression noise)
  const merged: Array<{ color: RGB; n: number; top: number; bottom: number; left: number; right: number }> = [];
  for (const bucket of sorted) {
    const color: RGB = [bucket.r / bucket.n, bucket.g / bucket.n, bucket.b / bucket.n];
    let hit = false;
    for (const m of merged) {
      if (colorDist(color, m.color) < 22) {
        m.n += bucket.n;
        m.top += bucket.top; m.bottom += bucket.bottom;
        m.left += bucket.left; m.right += bucket.right;
        hit = true;
        break;
      }
    }
    if (!hit) {
      merged.push({ color, n: bucket.n, top: bucket.top, bottom: bucket.bottom, left: bucket.left, right: bucket.right });
    }
    if (merged.length >= 12) break;
  }

  const accepted: RGB[] = [];
  const edgePixels = Math.max(1, w);
  const edgePixelsV = Math.max(1, h);
  for (const m of merged) {
    if (accepted.length >= maxClusters) break;
    const share = m.n / total;
    const shares = [
      m.top / edgePixels,
      m.bottom / edgePixels,
      m.left / edgePixelsV,
      m.right / edgePixelsV,
    ];
    const edges = shares.filter((s) => s >= 0.15).length;
    const isBg = edges >= 3 || (edges >= 2 && share >= 0.35);
    if (isBg) accepted.push(m.color);
  }

  if (accepted.length === 0) {
    // fallback: overall dominant bucket (always safe to try)
    const best = merged[0];
    return best ? [best.color] : [[255, 255, 255]];
  }
  return accepted;
}

/**
 * Collect the color distances of border-band pixels to the nearest
 * background cluster. Background pixels land near 0, subject pixels far away.
 */
export function borderDistances(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  clusters: RGB[],
  band = 3
): Float32Array {
  const out: number[] = [];
  const push = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    if (data[i + 3] < 8) return;
    out.push(minClusterDist([data[i], data[i + 1], data[i + 2]], clusters));
  };
  const b = Math.min(band, h >> 1, w >> 1);
  const bb = Math.min(band, w >> 1);
  for (let y = 0; y < b; y++) {
    for (let x = 0; x < w; x++) {
      push(x, y);
      push(x, h - 1 - y);
    }
  }
  for (let x = 0; x < bb; x++) {
    for (let y = 0; y < h; y++) {
      push(x, y);
      push(w - 1 - x, y);
    }
  }
  return Float32Array.from(out);
}

/**
 * Median-based tolerance calibration.
 * - Clean flat background → median ≈ 0 → tight tolerance, subject untouched.
 * - Grainy/gradient background → larger median → wider tolerance, no speckles.
 */
export function calibrateTolerance(dists: Float32Array, mult = 1): number {
  if (dists.length === 0) return 40;
  const sorted = Float32Array.from(dists).sort();
  const median = sorted[Math.floor(sorted.length / 2)];
  const p70 = sorted[Math.floor(sorted.length * 0.7)];
  // base grows slowly with noise, then the user multiplier is applied
  const base = Math.max(30, Math.min(86, median * 2.1 + 12 + p70 * 0.35));
  return Math.max(18, Math.min(120, base * mult));
}

/**
 * One-call automatic background removal on an ImageData.
 */
export function autoRemoveBackground(
  src: ImageData,
  opts: AutoRemoveOptions = {}
): AutoRemoveResult {
  const sensitivity = Math.max(0.5, Math.min(1.8, opts.sensitivity ?? 1));

  // 1 — background discovery (hint wins when provided)
  const hint = opts.bgColorHint ?? null;
  const clusters: RGB[] = hint
    ? [hint]
    : discoverBgClusters(src.data, src.width, src.height);
  if (clusters.length === 0) clusters.push([255, 255, 255]);

  // 2 — tolerance calibration from the border distance distribution
  const dists = borderDistances(src.data, src.width, src.height, clusters);
  let tolerance = calibrateTolerance(dists, sensitivity);
  // safety refinement: at the chosen tolerance the border must still be
  // majority-background. If a big part of the border is subject (tight
  // framing), walk the tolerance down so the subject is never eaten.
  if (dists.length > 0) {
    const sorted = Float32Array.from(dists).sort();
    const fracBelow = (t: number) => {
      let lo = 0, hi = sorted.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sorted[mid] <= t) lo = mid + 1;
        else hi = mid;
      }
      return lo / sorted.length;
    };
    let guard = 0;
    while (fracBelow(tolerance) < 0.55 && tolerance > 24 && guard++ < 8) {
      tolerance = Math.max(24, tolerance * 0.85);
    }
  }

  // 3 — precision cut with the matting pipeline
  const args: Partial<BgRemovalOptions> = {
    tolerance,
    edgeBarrier: 26,
    feather: opts.feather ?? 1.0,
    defringe: 0.85,
    removeHoles: opts.removeHoles ?? true,
    holeMaxPercent: 10,
    bgColorHint: hint,
    bgClusters: clusters,
  };
  const r = removeBackground(src, args);
  return { ...r, clusters, autoTolerance: tolerance };
}
