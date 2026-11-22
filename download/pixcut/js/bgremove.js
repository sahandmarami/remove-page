/* bgremove.js — edge-seeded flood fill + Sobel barrier, hole removal,
   feather, defringe, despill + chroma key. Pure pixel functions. */

function luminance(data, w, h) {
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    lum[i] = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
  }
  return lum;
}

function sobel(lum, w, h) {
  const mag = new Float32Array(w * h);
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
    }
  }
  return mag;
}

function boxBlurMask(mask, w, h, r) {
  if (r <= 0) return mask;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const win = r * 2 + 1;
  // horizontal
  for (let y = 0; y < h; y++) {
    let acc = 0;
    const row = y * w;
    for (let x = -r; x <= r; x++) acc += mask[row + Math.max(0, Math.min(w - 1, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / win;
      const addX = Math.min(w - 1, x + r + 1), subX = Math.max(0, x - r);
      acc += mask[row + addX] - mask[row + subX];
    }
  }
  // vertical
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.max(0, Math.min(h - 1, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / win;
      const addY = Math.min(h - 1, y + r + 1), subY = Math.max(0, y - r);
      acc += tmp[addY * w + x] - tmp[subY * w + x];
    }
  }
  return out;
}

/** label connected regions with predicate */
function labelRegions(pred, w, h, maxRegions = Infinity) {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const regions = [];
  for (let start = 0; start < w * h && regions.length < maxRegions; start++) {
    if (seen[start] || !pred(start)) continue;
    let sp = 0;
    stack[sp++] = start;
    seen[start] = 1;
    const pixels = [];
    while (sp > 0) {
      const i = stack[--sp];
      pixels.push(i);
      const x = i % w, y = (i / w) | 0;
      const tryN = (j) => { if (!seen[j] && pred(j)) { seen[j] = 1; stack[sp++] = j; } };
      if (x > 0) tryN(i - 1);
      if (x < w - 1) tryN(i + 1);
      if (y > 0) tryN(i - w);
      if (y < h - 1) tryN(i + w);
      if (pixels.length > w * h * 0.5) break; // safety
    }
    regions.push(pixels);
  }
  return regions;
}

/**
 * Remove background: border-seeded flood fill (with gradient continuation),
 * Sobel edge barrier, enclosed hole removal (≤ 8% area), feather, defringe, despill.
 * @param {Uint8ClampedArray} data RGBA
 * @returns {{data:Uint8ClampedArray, filled:number, failed:boolean}}
 */
export function removeBackground(data, w, h, opts = {}) {
  const tolerance = opts.tolerance ?? 40;   // 0..120
  const feather = opts.feather ?? 2;        // 0..10 px
  const defringe = opts.defringe ?? 40;     // 0..100 %
  const despill = opts.despill ?? 0;        // 0..100 %
  const removeHoles = opts.holes ?? true;

  const n = w * h;
  const lum = luminance(data, w, h);
  const mag = sobel(lum, w, h);
  const barrier = 55 + tolerance * 0.25;    // stronger tolerance → weaker barrier

  // ---- background reference color from border ring ----
  let br = 0, bg_ = 0, bb = 0, bn = 0;
  const sampleBorder = (i) => { const o = i * 4; br += data[o]; bg_ += data[o + 1]; bb += data[o + 2]; bn++; };
  for (let x = 0; x < w; x++) { sampleBorder(x); sampleBorder((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { sampleBorder(y * w); sampleBorder(y * w + w - 1); }
  const bgColor = { r: br / bn, g: bg_ / bn, b: bb / bn };

  const tolDist = tolerance * 3.4;          // max RGB distance ≈ 441
  const distToBg = (o) => {
    const dr = data[o] - bgColor.r, dg = data[o + 1] - bgColor.g, db = data[o + 2] - bgColor.b;
    return Math.sqrt(dr * dr + dg * dg + db * db);
  };

  // ---- BFS fill from border seeds ----
  const filled = new Uint8Array(n);
  const queue = new Int32Array(n);
  let qh = 0, qt = 0;
  const seed = (i) => {
    if (!filled[i] && distToBg(i * 4) < tolDist * 0.9) { filled[i] = 1; queue[qt++] = i; }
  };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }

  while (qh < qt) {
    const i = queue[qh++];
    const x = i % w, y = (i / w) | 0;
    const tryN = (j) => {
      if (filled[j]) return;
      // Sobel edge barrier — strong edges block the fill
      if (mag[j] > barrier && distToBg(j * 4) > tolDist * 0.55) return;
      const d = distToBg(j * 4);
      if (d < tolDist) { filled[j] = 1; queue[qt++] = j; return; }
      // gradient continuation: very similar to the pixel we came from
      const o = j * 4, po = i * 4;
      const dr = data[o] - data[po], dg = data[o + 1] - data[po + 1], db = data[o + 2] - data[po + 2];
      if (Math.sqrt(dr * dr + dg * dg + db * db) < tolDist * 0.35) { filled[j] = 1; queue[qt++] = j; }
    };
    if (x > 0) tryN(i - 1);
    if (x < w - 1) tryN(i + 1);
    if (y > 0) tryN(i - w);
    if (y < h - 1) tryN(i + w);
    if (qt >= n) break;
  }

  let fillCount = 0;
  for (let i = 0; i < n; i++) if (filled[i]) fillCount++;
  const fillRatio = fillCount / n;
  const failed = fillRatio < 0.02 || fillRatio > 0.97;

  // ---- enclosed hole removal (≤ 8% of image area) ----
  if (removeHoles && !failed) {
    const holeMax = n * 0.08;
    const isBgLike = (i) => !filled[i] && distToBg(i * 4) < tolDist * 1.15;
    const regions = labelRegions(isBgLike, w, h, 512);
    for (const pixels of regions) {
      if (pixels.length > holeMax) continue;
      for (const i of pixels) filled[i] = 1;
    }
  }

  // ---- alpha mask ----
  let alpha = new Float32Array(n);
  for (let i = 0; i < n; i++) alpha[i] = filled[i] ? 0 : 255;

  // ---- feather (blur alpha) ----
  if (feather > 0) {
    const blurred = boxBlurMask(alpha, w, h, Math.round(feather));
    for (let i = 0; i < n; i++) alpha[i] = blurred[i];
  }

  // ---- defringe: push edge colors toward interior color ----
  if (defringe > 0 && !failed) {
    const r = 2 + Math.round((defringe / 100) * 2);
    const strength = defringe / 100;
    const outRgb = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const o = i * 4, o3 = i * 3;
      outRgb[o3] = data[o]; outRgb[o3 + 1] = data[o + 1]; outRgb[o3 + 2] = data[o + 2];
    }
    const blended = new Float32Array(n * 3);
    blended.set(outRgb);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const a = alpha[i];
        if (a <= 0 || a >= 250) continue;
        // gather opaque neighbors
        let sr = 0, sg = 0, sb = 0, cnt = 0;
        for (let dy = -r; dy <= r; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= h) continue;
          for (let dx = -r; dx <= r; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= w) continue;
            const j = ny * w + nx;
            if (alpha[j] >= 250) {
              const o3 = j * 3;
              sr += outRgb[o3]; sg += outRgb[o3 + 1]; sb += outRgb[o3 + 2]; cnt++;
            }
          }
        }
        if (cnt >= 2) {
          const o3 = i * 3;
          blended[o3] = outRgb[o3] * (1 - strength) + (sr / cnt) * strength;
          blended[o3 + 1] = outRgb[o3 + 1] * (1 - strength) + (sg / cnt) * strength;
          blended[o3 + 2] = outRgb[o3 + 2] * (1 - strength) + (sb / cnt) * strength;
        }
      }
    }
    // write back blended colors
    for (let i = 0; i < n; i++) {
      const o = i * 4, o3 = i * 3;
      data[o] = blended[o3]; data[o + 1] = blended[o3 + 1]; data[o + 2] = blended[o3 + 2];
    }
  }

  // ---- despill (green/blue spill removal near edges) ----
  if (despill > 0) {
    const s = despill / 100;
    const isGreen = bgColor.g >= bgColor.r && bgColor.g >= bgColor.b;
    const isBlue = bgColor.b >= bgColor.r && bgColor.b >= bgColor.g;
    for (let i = 0; i < n; i++) {
      if (alpha[i] <= 0) continue;
      const o = i * 4;
      if (isGreen) {
        const spill = data[o + 1] - Math.max(data[o], data[o + 2]);
        if (spill > 0) data[o + 1] -= spill * s;
      } else if (isBlue) {
        const spill = data[o + 2] - Math.max(data[o], data[o + 1]);
        if (spill > 0) data[o + 2] -= spill * s;
      }
    }
  }

  // ---- apply alpha ----
  if (!failed) {
    for (let i = 0; i < n; i++) data[i * 4 + 3] = alpha[i];
  }
  return { data, filled: fillRatio, failed };
}

/**
 * Chroma key by color distance in CbCr plane with softness ramp + despill.
 * @param {Uint8ClampedArray} data RGBA (modified in place)
 */
export function chromaKey(data, w, h, opts = {}) {
  const key = opts.key ?? { r: 0, g: 180, b: 80 };
  const sensitivity = opts.sensitivity ?? 35;  // 0..120 → distance threshold
  const softness = opts.softness ?? 25;        // 1..80
  const despill = opts.despill ?? 0;           // 0..100

  const toCbCr = (r, g, b) => {
    const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
    return [cb, cr];
  };
  const [kcb, kcr] = toCbCr(key.r, key.g, key.b);
  const thresh = sensitivity * 2.2;
  const soft = Math.max(1, softness) * 1.6;

  const n = w * h;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const [cb, cr] = toCbCr(data[o], data[o + 1], data[o + 2]);
    const d = Math.sqrt((cb - kcb) * (cb - kcb) + (cr - kcr) * (cr - kcr));
    let a = 255;
    if (d <= thresh) a = 0;
    else if (d < thresh + soft) a = ((d - thresh) / soft) * 255;
    // partial alpha → keep luminance detail
    data[o + 3] = Math.min(data[o + 3], a);
  }

  if (despill > 0) {
    const s = despill / 100;
    const keyIsGreen = key.g >= key.r && key.g >= key.b;
    const keyIsBlue = key.b >= key.r && key.b >= key.g;
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      if (data[o + 3] === 0) continue;
      if (keyIsGreen) {
        const spill = data[o + 1] - Math.max(data[o], data[o + 2]);
        if (spill > 0) data[o + 1] -= spill * s;
      } else if (keyIsBlue) {
        const spill = data[o + 2] - Math.max(data[o], data[o + 1]);
        if (spill > 0) data[o + 2] -= spill * s;
      }
    }
  }
  return data;
}

/** flood fill similar-colored region from a seed point (for magic wand) */
export function floodSelect(data, w, h, sx, sy, tolerance = 35) {
  const n = w * h;
  const start = sy * w + sx;
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return new Uint8Array(n);
  const so = start * 4;
  const tr = data[so], tg = data[so + 1], tb = data[so + 2];
  const tol = tolerance * 2.6;
  const mask = new Uint8Array(n);
  const queue = new Int32Array(n);
  let qh = 0, qt = 0;
  const sim = (i) => {
    const o = i * 4;
    const dr = data[o] - tr, dg = data[o + 1] - tg, db = data[o + 2] - tb;
    return Math.sqrt(dr * dr + dg * dg + db * db) < tol;
  };
  if (sim(start)) { mask[start] = 1; queue[qt++] = start; }
  while (qh < qt) {
    const i = queue[qh++];
    const x = i % w, y = (i / w) | 0;
    const tryN = (j) => { if (!mask[j] && sim(j)) { mask[j] = 1; queue[qt++] = j; } };
    if (x > 0) tryN(i - 1);
    if (x < w - 1) tryN(i + 1);
    if (y > 0) tryN(i - w);
    if (y < h - 1) tryN(i + w);
  }
  return mask;
}
