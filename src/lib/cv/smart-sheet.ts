/**
 * SMART SPRITE-SHEET ANALYZER — the "AI" that understands sheet layout.
 *
 * Given any sprite sheet (uniform grid, single strip, touching sprites,
 * grid-lines in the background, transparent or solid background) it works
 * out the FRAME GRID automatically and returns cutting cells that are
 * perfectly uniform in size — the property the Animator needs for a smooth,
 * jitter-free flipbook.
 *
 * Pipeline (pure functions, no canvas dependency — runs anywhere):
 *  1. Background discovery — multi-cluster sampling of the border band
 *     (solid, gradient, transparent or multi-tone backgrounds).
 *  2. Foreground mask — color distance to the clusters, with alpha handling
 *     for already-transparent sheets.
 *  3. Projection profiles — per-column / per-row foreground histograms.
 *  4. Band segmentation — occupied runs in the profiles become candidate
 *     sprite bands; thin structures (grid lines, 1-6px scan strokes) never
 *     form a band because of minimum-run widths.
 *  5. PITCH INFERENCE — the heart: band start offsets are analyzed for a
 *     uniform period (median start-to-start distance). The strongest
 *     candidate is validated against the image size (period must tile the
 *     sheet edge-to-edge, the way sprite sheets are authored) and against
 *     an autocorrelation of the profile. When validated → GRID MODE.
 *  6. GRID MODE cuts the whole sheet into identical cells anchored at the
 *     sheet edge (k * pitch), keeping every cell that contains artwork.
 *  7. Fallback → per-sprite boxes (component-like band merging), still
 *     order-correct and gap-merged.
 *
 * Frames are returned LEFT→RIGHT, TOP→BOTTOM (sprite sheets are authored
 * LTR regardless of UI language — animation order follows the artwork).
 */

import { dominantEdgeColors, minClusterDist, type RGB } from "./color-utils";
import { makeBoxId, type Box } from "./detect-boxes";

export interface RawImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface SmartSheetOptions {
  /** Color distance threshold vs background (default 42). */
  tolerance?: number;
  /** Working-resolution cap on the longest side (default 1600). */
  maxWork?: number;
  /** Force maximum columns (skips pitch inference when known). */
  columns?: number;
  /** Force rows (default auto). */
  rows?: number;
}

export interface SmartSheetResult {
  /** "grid" = uniform cells (perfect for animation), "boxes" = per-sprite. */
  mode: "grid" | "boxes";
  /** Cutting boxes, LTR top-to-bottom order. Grid mode ⇒ all same size. */
  boxes: Box[];
  /** Grid description when mode === "grid". */
  columns: number;
  rows: number;
  cellW: number;
  cellH: number;
  /** Dominant background color (pass to removeBackground as hint). */
  bgColor: RGB;
  bgRatio: number;
  /** True when the sheet already has transparency (alpha-based mask). */
  transparentSource: boolean;
  /** Human-readable confidence of the grid inference (0..1). */
  confidence: number;
}

interface Band {
  start: number;
  end: number; // exclusive
}

/** Runs of occupied columns/rows from a projection profile. */
function findBands(
  profile: Float32Array,
  threshold: number,
  minWidth: number,
  mergeGap: number
): Band[] {
  const n = profile.length;
  const occupied = new Uint8Array(n);
  for (let i = 0; i < n; i++) occupied[i] = profile[i] > threshold ? 1 : 0;

  // close small holes between adjacent occupied runs (mergeGap)
  const closed = new Uint8Array(n);
  let i = 0;
  while (i < n) {
    if (!occupied[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && occupied[j]) j++;
    // look ahead: is there another run within mergeGap?
    let k = j;
    while (k < n && !occupied[k] && k - j < mergeGap) k++;
    if (k < n && occupied[k] && k - j < mergeGap) {
      // bridge the gap
      for (let t = i; t < k; t++) closed[t] = 1;
      i = k;
    } else {
      for (let t = i; t < j; t++) closed[t] = 1;
      i = j;
    }
  }

  const bands: Band[] = [];
  let s = -1;
  for (let t = 0; t < n; t++) {
    if (closed[t] && s < 0) s = t;
    if ((!closed[t] || t === n - 1) && s >= 0) {
      const e = closed[t] && t === n - 1 ? n : t;
      if (e - s >= minWidth) bands.push({ start: s, end: e });
      s = -1;
    }
  }
  return bands;
}

/** Median of an array (input not required sorted). */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const arr = [...values].sort((a, b) => a - b);
  const mid = arr.length >> 1;
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

/** Relative dispersion (std/mean) — low means "uniform period". */
function dispersion(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return Infinity;
  const variance =
    values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / values.length;
  return Math.sqrt(variance) / mean;
}

/**
 * Autocorrelation peak of a profile — finds the dominant period even when
 * sprites touch each other (no gaps → band splitting can't help).
 * Returns the best period in px and its prominence (0..1+).
 */
function autocorrelationPeriod(
  profile: Float32Array,
  minPeriod: number,
  maxPeriod: number
): { period: number; prominence: number } {
  const n = profile.length;
  // zero-mean
  let mean = 0;
  for (let i = 0; i < n; i++) mean += profile[i];
  mean /= n;
  const z = new Float32Array(n);
  for (let i = 0; i < n; i++) z[i] = profile[i] - mean;

  let energy = 0;
  for (let i = 0; i < n; i++) energy += z[i] * z[i];
  if (energy < 1e-6) return { period: 0, prominence: 0 };

  let bestPeriod = 0;
  let bestScore = 0;
  let runnerUp = 0;
  const scores: Array<{ lag: number; score: number }> = [];
  for (let lag = minPeriod; lag <= Math.min(maxPeriod, n - 1); lag++) {
    let sum = 0;
    for (let i = 0; i + lag < n; i++) sum += z[i] * z[i + lag];
    const score = sum / energy;
    scores.push({ lag, score });
    if (score > bestScore) {
      runnerUp = bestScore;
      bestScore = score;
      bestPeriod = lag;
    } else if (score > runnerUp) {
      runnerUp = score;
    }
  }
  if (bestPeriod === 0) return { period: 0, prominence: 0 };
  // prominence: how much the best peak stands out vs nearby lags
  let localAvg = 0;
  let localN = 0;
  for (const { lag, score } of scores) {
    if (Math.abs(lag - bestPeriod) > bestPeriod * 0.25) {
      localAvg += score;
      localN++;
    }
  }
  const base = localN > 0 ? localAvg / localN : 0;
  const prominence = Math.max(0, bestScore - base);
  void runnerUp;
  return { period: bestPeriod, prominence };
}

/**
 * Infer the uniform column pitch of a sheet from column bands.
 * Returns the pitch and how trustworthy it is (0..1).
 */
function inferPitch(
  bands: Band[],
  profileLen: number,
  minCell: number,
  maxCell: number
): { pitch: number; confidence: number; anchor: number } {
  if (bands.length === 0) return { pitch: 0, confidence: 0, anchor: 0 };

  // candidate 1: median start-to-start distance
  const starts = bands.map((b) => b.start);
  const diffs: number[] = [];
  for (let i = 1; i < starts.length; i++) {
    const d = starts[i] - starts[i - 1];
    if (d >= minCell && d <= maxCell) diffs.push(d);
  }

  let bestPitch = 0;
  let bestConf = 0;
  let bestAnchor = bands[0].start;

  const tryCandidate = (pitch: number, anchor: number, voteShare: number) => {
    if (pitch < minCell || pitch > maxCell) return;
    // how many band starts align with anchor + k*pitch (±tolerance)?
    const tol = Math.max(3, pitch * 0.08);
    let aligned = 0;
    for (const s of starts) {
      const k = Math.round((s - anchor) / pitch);
      if (k < 0) continue;
      if (Math.abs(s - (anchor + k * pitch)) <= tol) aligned++;
    }
    const alignScore = aligned / starts.length;
    const conf = alignScore * voteShare;
    if (conf > bestConf) {
      bestConf = conf;
      bestPitch = pitch;
      bestAnchor = anchor;
    }
  };

  if (diffs.length >= 1) {
    const med = median(diffs);
    const disp = dispersion(diffs);
    // tight spacing → strong vote; loose → weak
    const vote = disp < 0.04 ? 1 : disp < 0.1 ? 0.85 : disp < 0.18 ? 0.6 : 0.35;
    tryCandidate(med, bands[0].start, vote);
    // also try pitch = W / round(W / med) — the "sheet edge aligned" variant
    const nEstimate = Math.round(profileLen / med);
    if (nEstimate >= 2) {
      tryCandidate(profileLen / nEstimate, 0, vote);
    }
  }

  // candidate 2: full-width tiling for single-band sheets (touching sprites)
  if (bands.length === 1) {
    for (let n = Math.max(2, Math.floor(profileLen / maxCell)); n <= Math.floor(profileLen / minCell); n++) {
      const pitch = profileLen / n;
      // only plausible if the single band covers most of the width
      const cover = (bands[0].end - bands[0].start) / profileLen;
      if (cover > 0.75) {
        const conf = 0.3; // weak: only the band width supports it
        if (conf > bestConf) {
          bestConf = conf;
          bestPitch = pitch;
          bestAnchor = 0;
        }
      }
      void pitch;
    }
  }

  return { pitch: bestPitch, confidence: bestConf, anchor: bestAnchor };
}

/** Union of two rects. */
function unionRect(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const x2 = Math.max(a.x + a.w, b.x + b.w);
  const y2 = Math.max(a.y + a.h, b.y + b.h);
  return { x, y, w: x2 - x, h: y2 - y };
}

/**
 * Analyze a sprite sheet and return uniform animation-ready cutting boxes.
 */
export function analyzeSheet(
  image: RawImage,
  options: SmartSheetOptions = {}
): SmartSheetResult {
  const tolerance = options.tolerance ?? 42;
  const maxWork = options.maxWork ?? 1600;

  const sw = image.width;
  const sh = image.height;
  const scale = Math.min(1, maxWork / Math.max(sw, sh));
  const w = Math.max(4, Math.round(sw * scale));
  const h = Math.max(4, Math.round(sh * scale));

  // --- downscale into working pixels ---
  const work = new Uint8ClampedArray(w * h * 4);
  {
    const sxRatio = sw / w;
    const syRatio = sh / h;
    for (let y = 0; y < h; y++) {
      const y0 = Math.floor(y * syRatio);
      const y1 = Math.max(y0 + 1, Math.floor((y + 1) * syRatio));
      for (let x = 0; x < w; x++) {
        const x0 = Math.floor(x * sxRatio);
        const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sxRatio));
        let r = 0, g = 0, b = 0, a = 0, n = 0;
        for (let sy = y0; sy < y1 && sy < sh; sy++) {
          for (let sx = x0; sx < x1 && sx < sw; sx++) {
            const si = (sy * sw + sx) * 4;
            const al = image.data[si + 3] / 255;
            r += image.data[si] * al;
            g += image.data[si + 1] * al;
            b += image.data[si + 2] * al;
            a += image.data[si + 3];
            n++;
          }
        }
        const di = (y * w + x) * 4;
        const aAvg = a / Math.max(1, n);
        const alSum = a / 255; // total alpha weight
        if (alSum > 0.004) {
          work[di] = r / alSum;
          work[di + 1] = g / alSum;
          work[di + 2] = b / alSum;
        }
        work[di + 3] = aAvg;
      }
    }
  }

  // --- background clusters ---
  const found = dominantEdgeColors(work, w, h, 3, 3, 0.1);
  const clusters: RGB[] = found.map((c) => c.color);
  const bgRatio = found[0]?.ratio ?? 0;

  // how transparent is the sheet? (count fully transparent pixels)
  let transparentCount = 0;
  for (let p = 0; p < w * h; p++) {
    if (work[p * 4 + 3] < 16) transparentCount++;
  }
  const transparentSource = transparentCount > w * h * 0.08;

  // --- foreground mask ---
  const fg = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    if (work[i + 3] < 16) continue;
    if (transparentSource) {
      fg[p] = 1; // on transparent sheets any non-empty pixel is content
    } else if (
      minClusterDist([work[i], work[i + 1], work[i + 2]], clusters) > tolerance
    ) {
      fg[p] = 1;
    }
  }

  // --- projection profiles ---
  const colFg = new Float32Array(w);
  const rowFg = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (fg[row + x]) {
        colFg[x] += 1;
        rowFg[y] += 1;
      }
    }
  }
  // light smoothing (kills 1-2px noise, keeps band structure)
  const smooth = (src: Float32Array, radius: number) => {
    const out = new Float32Array(src.length);
    for (let i = 0; i < src.length; i++) {
      let s = 0;
      let n = 0;
      for (let k = Math.max(0, i - radius); k <= Math.min(src.length - 1, i + radius); k++) {
        s += src[k];
        n++;
      }
      out[i] = s / n;
    }
    return out;
  };
  const colS = smooth(colFg, 1);
  const rowS = smooth(rowFg, 1);

  // --- row bands (sprite rows) ---
  const rowThr = Math.max(2, h * 0.006);
  const rowMinW = Math.max(6, Math.round(h * 0.03));
  const rowGap = Math.max(2, Math.round(h * 0.012));
  let rowBands = findBands(rowS, rowThr, rowMinW, rowGap);
  if (rowBands.length === 0) {
    // degenerate: mask nearly empty — take the full frame as one band
    rowBands = [{ start: 0, end: h }];
  }

  // --- column bands, merged across all row bands ---
  const colThr = Math.max(2, h * 0.004);
  const colMinW = Math.max(4, Math.round(w * 0.012));
  const colGap = Math.max(2, Math.round(w * 0.008));
  const colBandsGlobal = findBands(colS, colThr, colMinW, colGap);

  const minCell = Math.max(12, Math.round(w * 0.03));
  const maxCell = Math.round(w * 0.95);

  // ---------- decide the layout ----------
  const bgColor = clusters[0];
  const mkBox = (x: number, y: number, bw: number, bh: number): Box => ({
    id: makeBoxId(),
    x: Math.round(x),
    y: Math.round(y),
    w: Math.max(4, Math.round(bw)),
    h: Math.max(4, Math.round(bh)),
  });

  // full-resolution content bounds helper (used by boxes fallback)
  const contentBoundsFull = (band: Band, axis: "row"): Box => {
    // walk the full-res image to tighten one band (row or column)
    if (axis === "row") {
      const fy = Math.round(band.start / scale);
      const fy2 = Math.round(band.end / scale);
      return mkBox(0, fy, sw, Math.max(4, fy2 - fy));
    }
    return mkBox(0, 0, sw, sh);
  };
  void contentBoundsFull;

  // grid inference on columns
  const forcedCols = options.columns ?? 0;
  const forcedRows = options.rows ?? 0;

  let columns = 0;
  let colPitch = 0;
  let colConf = 0;
  let colAnchor = 0;

  if (forcedCols >= 1) {
    columns = forcedCols;
    colPitch = w / columns;
    colConf = 1;
    colAnchor = 0;
  } else {
    const inferred = inferPitch(colBandsGlobal, w, minCell, maxCell);
    colPitch = inferred.pitch / scale; // to full-res px
    colConf = inferred.confidence;
    colAnchor = inferred.anchor / scale;
    columns = colPitch > 0 ? Math.round(sw / colPitch) : 0;
    if (colPitch > 0 && columns >= 1) {
      // validate: sheet width must tile cleanly (sprite sheets are authored edge-to-edge)
      const tileErr = Math.abs(columns * colPitch - sw) / sw;
      if (tileErr > 0.06) {
        colConf *= 0.4;
        columns = Math.max(1, Math.round(sw / colPitch));
        colPitch = sw / columns;
      }
    }
    // touching-sprite strips: no usable bands → autocorrelation on the
    // column profile finds the dominant period (works even without gaps)
    if (colPitch === 0 && colBandsGlobal.length === 1) {
      const band = colBandsGlobal[0];
      const cover = (band.end - band.start) / w;
      if (cover > 0.8 && w > h * 1.6) {
        const minP = Math.max(8, Math.round(h * 0.4)); // cells are rarely < 0.4× height
        const maxP = Math.min(w - 2, Math.round(w * 0.95));
        const ac = autocorrelationPeriod(colS, minP, maxP);
        if (ac.period > 0 && ac.prominence > 0.1) {
          const pitchFull = (ac.period / scale);
          const cols = Math.round(sw / pitchFull);
          const tileErr = Math.abs(cols * pitchFull - sw) / sw;
          if (cols >= 2 && tileErr <= 0.03) {
            colPitch = sw / cols;
            columns = cols;
            colConf = Math.min(0.85, 0.35 + ac.prominence);
            colAnchor = 0;
          }
        }
      }
    }
  }

  // rows: band-based first, then square-cell stacked-row hypothesis
  let rows = forcedRows >= 1 ? forcedRows : rowBands.length;
  let rowPitch = 0;
  let rowConf = 1;
  if (forcedRows >= 1) {
    rows = forcedRows;
    rowPitch = sh / forcedRows;
  } else if (rows >= 2) {
    const rowStarts = rowBands.map((b) => b.start / scale);
    const rowDiffs: number[] = [];
    for (let i = 1; i < rowStarts.length; i++) {
      const d = rowStarts[i] - rowStarts[i - 1];
      if (d > 8) rowDiffs.push(d);
    }
    const med = median(rowDiffs);
    if (med > 8) {
      const disp = dispersion(rowDiffs);
      if (disp < 0.15 && Math.abs(rows * med - sh) / sh < 0.08) {
        rows = Math.max(rows, Math.round(sh / med));
        rowPitch = sh / rows;
        rowConf = 0.85;
      } else {
        rowPitch = 0; // irregular rows — no uniform grid vertically
        rowConf = 0.4;
      }
    } else {
      rowPitch = 0;
    }
  }

  // square-cell hypothesis: sprites stacked so tightly that the row profile
  // never separates them, but the sheet height is an exact multiple of the
  // column pitch. Every phantom row must contain artwork, otherwise it is
  // just a tall single-row sheet with empty margins.
  if (forcedRows < 1 && colPitch > 0 && colConf >= 0.5 && rows === 1) {
    const k = Math.round(sh / colPitch);
    if (k >= 2 && Math.abs(k * colPitch - sh) / sh <= 0.02) {
      let allRowsHaveContent = true;
      for (let r = 0; r < k && allRowsHaveContent; r++) {
        const wy0 = Math.max(0, Math.floor(((r * colPitch) / sh) * h));
        const wy1 = Math.min(h, Math.ceil((((r + 1) * colPitch) / sh) * h));
        let any = 0;
        for (let y = wy0; y < wy1; y++) {
          const row = y * w;
          for (let x = 0; x < w; x++) if (fg[row + x]) any++;
        }
        if (any < Math.max(6, w * 0.01)) allRowsHaveContent = false;
      }
      if (allRowsHaveContent) {
        rows = k;
        rowPitch = sh / k;
        rowConf = 0.8;
      }
    }
  }

  const gridReady =
    columns >= 1 && colConf >= 0.5 && rows >= 1 && (rowPitch > 0 || rows === 1);

  if (gridReady) {
    // ---------- GRID MODE: identical cells, edge-anchored ----------
    const cellWf = sw / columns;
    const cellHf = rowPitch > 0 ? sh / rows : sh / Math.max(1, rows);
    const boxes: Box[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < columns; c++) {
        const cx = c * cellWf;
        const cy = r * (rowPitch > 0 ? rowPitch : cellHf);
        // does this cell contain any content at working res?
        const wx0 = Math.max(0, Math.floor((cx / sw) * w));
        const wx1 = Math.min(w, Math.ceil(((cx + cellWf) / sw) * w));
        const wy0 = Math.max(0, Math.floor((cy / sh) * h));
        const wy1 = Math.min(h, Math.ceil(((cy + cellHf) / sh) * h));
        let any = 0;
        for (let y = wy0; y < wy1; y++) {
          for (let x = wx0; x < wx1; x++) {
            if (fg[y * w + x]) any++;
          }
        }
        if (any >= Math.max(4, (wx1 - wx0) * 0.004)) {
          boxes.push(mkBox(cx, cy, cellWf, cellHf));
        }
      }
    }
    // single-cell sheet: still return the content band, not empty margins
    if (columns === 1 && rows === 1 && boxes.length === 1) {
      // tighten to content bounds on full res for a lone sprite
      const cb = fullContentBounds(image, tolerance, clusters, transparentSource);
      if (cb) {
        boxes[0] = { ...boxes[0], ...cb, id: boxes[0].id };
      }
    }
    return {
      mode: "grid",
      boxes,
      columns,
      rows,
      cellW: Math.round(cellWf),
      cellH: Math.round(cellHf),
      bgColor,
      bgRatio,
      transparentSource,
      confidence: Math.min(1, colConf * (rows === 1 ? 1 : rowConf)),
    };
  }

  // ---------- FALLBACK: per-band boxes (irregular layout) ----------
  const boxes: Box[] = [];
  if (rowBands.length === 1 && colBandsGlobal.length >= 1) {
    // single strip: one box per column band, tightened per band
    const rb = rowBands[0];
    for (const cb of colBandsGlobal) {
      boxes.push(
        mkBox(
          cb.start / scale,
          rb.start / scale,
          (cb.end - cb.start) / scale,
          (rb.end - rb.start) / scale
        )
      );
    }
  } else {
    // multi-row irregular: per row band × global column bands intersected
    for (const rb of rowBands) {
      // column bands within this row only (recompute profile restricted to band)
      const bandH = rb.end - rb.start;
      const localCol = new Float32Array(w);
      for (let x = 0; x < w; x++) {
        let n = 0;
        for (let y = rb.start; y < rb.end; y++) if (fg[y * w + x]) n++;
        localCol[x] = n;
      }
      const localBands = findBands(
        smooth(localCol, 1),
        Math.max(2, bandH * 0.02),
        colMinW,
        colGap
      );
      for (const cb of localBands) {
        boxes.push(
          mkBox(
            cb.start / scale,
            rb.start / scale,
            (cb.end - cb.start) / scale,
            bandH / scale
          )
        );
      }
    }
  }

  return {
    mode: "boxes",
    boxes,
    columns: 0,
    rows: 0,
    cellW: 0,
    cellH: 0,
    bgColor,
    bgRatio,
    transparentSource,
    confidence: 0,
  };
}

/** Full-resolution content bounds (used for single-sprite sheets). */
function fullContentBounds(
  image: RawImage,
  tolerance: number,
  clusters: RGB[],
  transparentSource: boolean
): { x: number; y: number; w: number; h: number } | null {
  const { data, width: sw, height: sh } = image;
  let minX = sw, minY = sh, maxX = -1, maxY = -1;
  const stepX = Math.max(1, Math.floor(sw / 900));
  const stepY = Math.max(1, Math.floor(sh / 900));
  for (let y = 0; y < sh; y += stepY) {
    for (let x = 0; x < sw; x += stepX) {
      const i = (y * sw + x) * 4;
      if (data[i + 3] < 16) continue;
      if (transparentSource || minClusterDist([data[i], data[i + 1], data[i + 2]], clusters) > tolerance) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const pad = 2;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(sw - 1, maxX + pad);
  maxY = Math.min(sh - 1, maxY + pad);
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}
