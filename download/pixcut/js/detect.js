/* detect.js — client-side object detection: background estimation + flood fill + CCL */

/**
 * Detect object bounding boxes on RGBA pixel data.
 * Pure function — works on {Uint8ClampedArray, w, h}.
 */
export function detectObjects(data, w, h, opts = {}) {
  const maxDim = opts.maxDim || 256;
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const sw = Math.max(8, Math.round(w * scale));
  const sh = Math.max(8, Math.round(h * scale));

  // ---- downscale (box average) ----
  const small = new Float32Array(sw * sh * 3);
  const counts = new Float32Array(sw * sh);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(sh - 1, (y * sh / h) | 0);
    for (let x = 0; x < w; x++) {
      const sx = Math.min(sw - 1, (x * sw / w) | 0);
      const si = sy * sw + sx, si3 = si * 3;
      const i = (y * w + x) * 4;
      small[si3] += data[i]; small[si3 + 1] += data[i + 1]; small[si3 + 2] += data[i + 2];
      counts[si]++;
    }
  }
  for (let i = 0; i < sw * sh; i++) {
    const c = counts[i] || 1, i3 = i * 3;
    small[i3] /= c; small[i3 + 1] /= c; small[i3 + 2] /= c;
  }

  const boxes = detectOnSmall(small, sw, sh, opts);

  // ---- map back to full res + pad ----
  const pad = Math.max(2, Math.round(Math.max(w, h) * 0.015));
  const out = [];
  for (const b of boxes) {
    let x = Math.round(b.x / scale) - pad;
    let y = Math.round(b.y / scale) - pad;
    let bw = Math.round(b.w / scale) + pad * 2;
    let bh = Math.round(b.h / scale) + pad * 2;
    x = Math.max(0, Math.min(w, x)); y = Math.max(0, Math.min(h, y));
    bw = Math.max(8, Math.min(w - x, bw));
    bh = Math.max(8, Math.min(h - y, bh));
    out.push({ x, y, w: bw, h: bh, score: b.score });
    if (out.length >= 12) break;
  }
  return out;
}

function detectOnSmall(px, sw, sh, opts) {
  const n = sw * sh;
  const tol = opts.tolerance ?? 60;

  // ---- background color: histogram of border pixels ----
  const hist = new Map();
  const addHist = (i) => {
    const i3 = i * 3;
    const key = ((px[i3] >> 4) << 8) | ((px[i3 + 1] >> 4) << 4) | (px[i3 + 2] >> 4);
    const e = hist.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    e.n++; e.r += px[i3]; e.g += px[i3 + 1]; e.b += px[i3 + 2];
    hist.set(key, e);
  };
  for (let x = 0; x < sw; x++) { addHist(x); addHist((sh - 1) * sw + x); }
  for (let y = 0; y < sh; y++) { addHist(y * sw); addHist(y * sw + sw - 1); }
  let bgKey = -1, bestN = 0;
  for (const [k, e] of hist) if (e.n > bestN) { bestN = e.n; bgKey = k; }
  const bg = { r: 0, g: 0, b: 0 };
  if (bgKey >= 0) {
    const e = hist.get(bgKey);
    bg.r = e.r / e.n; bg.g = e.g / e.n; bg.b = e.b / e.n;
  }
  const bgTotalN = [...hist.values()].reduce((s, e) => s + e.n, 0);
  const borderDominant = bestN / Math.max(1, bgTotalN) > 0.5;

  // ---- flood fill background from borders ----
  const bgMask = new Uint8Array(n);
  const queue = new Int32Array(n);
  let qh = 0, qt = 0;
  const dist = (i) => {
    const i3 = i * 3;
    const dr = px[i3] - bg.r, dg = px[i3 + 1] - bg.g, db = px[i3 + 2] - bg.b;
    return Math.sqrt(dr * dr + dg * dg + db * db);
  };
  const pushSeed = (i) => { if (!bgMask[i] && dist(i) < tol * 1.2) { bgMask[i] = 1; queue[qt++] = i; } };
  for (let x = 0; x < sw; x++) { pushSeed(x); pushSeed((sh - 1) * sw + x); }
  for (let y = 0; y < sh; y++) { pushSeed(y * sw); pushSeed(y * sw + sw - 1); }
  while (qh < qt) {
    const i = queue[qh++];
    const x = i % sw, y = (i / sw) | 0;
    const tryN = (j) => { if (!bgMask[j] && dist(j) < tol) { bgMask[j] = 1; queue[qt++] = j; } };
    if (x > 0) tryN(i - 1);
    if (x < sw - 1) tryN(i + 1);
    if (y > 0) tryN(i - sw);
    if (y < sh - 1) tryN(i + sw);
  }

  let fgCount = 0;
  for (let i = 0; i < n; i++) if (!bgMask[i]) fgCount++;
  const fgRatio = fgCount / n;

  let boxes = [];
  if (borderDominant && fgRatio > 0.02 && fgRatio < 0.96) {
    // ---- CCL on foreground ----
    const minArea = Math.max(12, n * 0.004);
    const labels = ccl(i => !bgMask[i], sw, sh);
    for (const c of labels) {
      if (c.area < minArea) continue;
      boxes.push({ x: c.x, y: c.y, w: c.w, h: c.h, score: c.area / n });
    }
    boxes = mergeBoxes(boxes);
  } else {
    // ---- fallback: Sobel energy regions ----
    boxes = energyBoxes(px, sw, sh);
  }
  if (!boxes.length) {
    boxes = [{ x: Math.round(sw * 0.06), y: Math.round(sh * 0.06), w: Math.round(sw * 0.88), h: Math.round(sh * 0.88), score: 1 }];
  }
  return boxes.sort((a, b) => b.w * b.h - a.w * a.h).slice(0, 12);
}

/** connected component labeling with predicate, returns bboxes+area */
function ccl(pred, w, h) {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const comps = [];
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || !pred(start)) continue;
    let sp = 0;
    stack[sp++] = start;
    seen[start] = 1;
    let minX = w, minY = h, maxX = 0, maxY = 0, area = 0;
    while (sp > 0) {
      const i = stack[--sp];
      const x = i % w, y = (i / w) | 0;
      area++;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      const tryN = (j) => { if (!seen[j] && pred(j)) { seen[j] = 1; stack[sp++] = j; } };
      if (x > 0) tryN(i - 1);
      if (x < w - 1) tryN(i + 1);
      if (y > 0) tryN(i - w);
      if (y < h - 1) tryN(i + w);
    }
    comps.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, area });
  }
  return comps;
}

function mergeBoxes(boxes) {
  let changed = true;
  while (changed) {
    changed = false;
    outer:
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        const gap = 1;
        const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        const inter = ix > gap && iy > gap ? ix * iy : 0;
        const minArea = Math.min(a.w * a.h, b.w * b.h);
        // merge only when boxes significantly overlap (parts of same object),
        // or one contains the other — slight bbox overlap of separate objects stays split
        if (inter > minArea * 0.3) {
          const nx = Math.min(a.x, b.x), ny = Math.min(a.y, b.y);
          const nw = Math.max(a.x + a.w, b.x + b.w) - nx;
          const nh = Math.max(a.y + a.h, b.y + b.h) - ny;
          boxes[i] = { x: nx, y: ny, w: nw, h: nh, score: (a.score || 0) + (b.score || 0) };
          boxes.splice(j, 1);
          changed = true;
          break outer;
        }
      }
    }
  }
  return boxes;
}

/** fallback: boxes around high-gradient regions */
function energyBoxes(px, w, h) {
  // luminance
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const i3 = i * 3;
    lum[i] = 0.299 * px[i3] + 0.587 * px[i3 + 1] + 0.114 * px[i3 + 2];
  }
  // sobel magnitude
  const mag = new Float32Array(w * h);
  let sum = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        -lum[i - w - 1] - 2 * lum[i - 1] - lum[i + w - 1] +
        lum[i - w + 1] + 2 * lum[i + 1] + lum[i + w + 1];
      const gy =
        -lum[i - w - 1] - 2 * lum[i - w] - lum[i - w + 1] +
        lum[i + w - 1] + 2 * lum[i + w] + lum[i + w + 1];
      mag[i] = Math.abs(gx) + Math.abs(gy);
      sum += mag[i];
    }
  }
  const mean = sum / Math.max(1, w * h);
  const thresh = Math.max(40, mean * 3);
  const binary = new Uint8Array(w * h);
  let cnt = 0;
  for (let i = 0; i < w * h; i++) if (mag[i] > thresh) { binary[i] = 1; cnt++; }
  if (cnt < w * h * 0.004) return [];
  // dilate to connect strokes
  const dil = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!binary[i]) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h) dil[ny * w + nx] = 1;
    }
  }
  const minArea = Math.max(40, w * h * 0.01);
  const comps = ccl(i => dil[i], w, h);
  let boxes = comps.filter(c => c.area >= minArea).map(c => ({ x: c.x, y: c.y, w: c.w, h: c.h, score: c.area / (w * h) }));
  boxes = mergeBoxes(boxes);
  return boxes.slice(0, 12);
}
