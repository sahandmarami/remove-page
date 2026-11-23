/**
 * Color utilities shared by the client-side computer-vision engines.
 */

export type RGB = [number, number, number];

/** Weighted euclidean distance (approx. perceptual weighting). */
export function colorDist(a: RGB, b: RGB): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db) / 3;
}

export function hexToRgb(hex: string): RGB {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return [0, 0, 0];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(rgb: RGB): string {
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(rgb[0])}${c(rgb[1])}${c(rgb[2])}`;
}

export function rgbaStr(rgb: RGB, alpha = 1): string {
  return `rgba(${Math.round(rgb[0])},${Math.round(rgb[1])},${Math.round(rgb[2])},${alpha})`;
}

/** Linear interpolation between two colors. */
export function mixRgb(a: RGB, b: RGB, t: number): RGB {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

export interface DominantColorResult {
  color: RGB;
  /** Ratio of border pixels belonging to the dominant bucket (0..1). */
  ratio: number;
}

/**
 * Dominant color sampling of the outer border band of an image.
 * Quantizes border pixels into color buckets and returns the average of
 * the most frequent bucket — a robust estimate for sheet backgrounds.
 */
export function dominantEdgeColor(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  band = 2
): DominantColorResult {
  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>();
  let total = 0;

  const add = (x: number, y: number) => {
    const idx = (y * width + x) * 4;
    const a = data[idx + 3];
    if (a < 8) return;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const cur = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0 };
    cur.r += r;
    cur.g += g;
    cur.b += b;
    cur.n += 1;
    buckets.set(key, cur);
    total += 1;
  };

  for (let y = 0; y < Math.min(band, height); y++) {
    for (let x = 0; x < width; x++) {
      add(x, y);
      add(x, height - 1 - y);
    }
  }
  for (let x = 0; x < Math.min(band, width); x++) {
    for (let y = 0; y < height; y++) {
      add(x, y);
      add(width - 1 - x, y);
    }
  }

  if (total === 0) return { color: [255, 255, 255], ratio: 0 };

  let best: { r: number; g: number; b: number; n: number } | null = null;
  for (const bucket of buckets.values()) {
    if (!best || bucket.n > best.n) best = bucket;
  }
  if (!best) return { color: [255, 255, 255], ratio: 0 };

  return {
    color: [best.r / best.n, best.g / best.n, best.b / best.n],
    ratio: best.n / total,
  };
}

export interface EdgeColorCluster {
  color: RGB;
  /** Share of sampled border pixels belonging to this cluster (0..1). */
  ratio: number;
}

/**
 * Multi-cluster dominant color sampling of the outer border band.
 * Quantizes border pixels into 8-bit-per-channel buckets, then returns the
 * top clusters (>= minShare) as average colors — robust against gradient
 * backgrounds, shadows and multi-tone paper textures.
 */
export function dominantEdgeColors(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  band = 3,
  maxClusters = 3,
  minShare = 0.08
): EdgeColorCluster[] {
  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>();
  let total = 0;

  const add = (x: number, y: number) => {
    const idx = (y * width + x) * 4;
    const a = data[idx + 3];
    if (a < 8) return;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const key = ((r >> 5) << 10) | ((g >> 5) << 5) | (b >> 5);
    const cur = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0 };
    cur.r += r;
    cur.g += g;
    cur.b += b;
    cur.n += 1;
    buckets.set(key, cur);
    total += 1;
  };

  for (let y = 0; y < Math.min(band, height); y++) {
    for (let x = 0; x < width; x++) {
      add(x, y);
      add(x, height - 1 - y);
    }
  }
  for (let x = 0; x < Math.min(band, width); x++) {
    for (let y = 0; y < height; y++) {
      add(x, y);
      add(width - 1 - x, y);
    }
  }

  if (total === 0) return [{ color: [255, 255, 255], ratio: 1 }];

  const sorted = [...buckets.values()].sort((p, q) => q.n - p.n);
  const clusters: EdgeColorCluster[] = [];
  for (const bucket of sorted) {
    const ratio = bucket.n / total;
    if (clusters.length >= maxClusters) break;
    if (clusters.length === 0 || ratio >= minShare) {
      // merge buckets that are already close to an accepted cluster color
      const color: RGB = [bucket.r / bucket.n, bucket.g / bucket.n, bucket.b / bucket.n];
      const near = clusters.some((c) => colorDist(color, c.color) < 24);
      if (!near) clusters.push({ color, ratio });
    }
  }
  if (clusters.length === 0) clusters.push({ color: [255, 255, 255], ratio: 1 });
  return clusters;
}

/** Minimum color distance of a pixel to a set of cluster colors. */
export function minClusterDist(px: RGB, clusters: RGB[]): number {
  let best = Infinity;
  for (const c of clusters) {
    const d = colorDist(px, c);
    if (d < best) best = d;
  }
  return best;
}
