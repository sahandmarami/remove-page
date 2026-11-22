/* gif.js — complete GIF89a decoder + encoder (pure JS, no DOM) */

/* ============================ DECODER ============================ */

/**
 * Parse a GIF file into logical frames (patches + metadata). No DOM needed.
 * @returns {{width:number,height:number,frames:Array}}
 */
export function decodeGIF(buffer) {
  const u8 = new Uint8Array(buffer);
  const sig = String.fromCharCode(u8[0], u8[1], u8[2], u8[3], u8[4], u8[5]);
  if (sig !== "GIF87a" && sig !== "GIF89a") throw new Error("فرمت GIF معتبر نیست");
  const width = u8[6] | (u8[7] << 8);
  const height = u8[8] | (u8[9] << 8);
  const packed = u8[10];
  let p = 13;
  let gct = null;
  if (packed & 0x80) {
    const gctSize = 2 << (packed & 7);
    gct = u8.slice(p, p + gctSize * 3);
    p += gctSize * 3;
  }

  const frames = [];
  let gce = null;

  const skipSubBlocks = (start) => {
    let q = start;
    while (q < u8.length && u8[q] !== 0) q += 1 + u8[q];
    return q + 1; // past terminator
  };

  while (p < u8.length) {
    const b = u8[p];
    if (b === 0x3b) break; // trailer
    if (b === 0x21) { // extension
      const label = u8[p + 1];
      if (label === 0xf9) { // graphic control extension
        const size = u8[p + 2];
        const pk = u8[p + 3];
        gce = {
          disposal: (pk >> 2) & 7,
          transparent: (pk & 1) ? u8[p + 6] : -1,
          delay: (u8[p + 4] | (u8[p + 5] << 8)) * 10,
        };
        p = skipSubBlocks(p + 2);
      } else {
        p = skipSubBlocks(p + 2);
      }
      continue;
    }
    if (b === 0x2c) { // image descriptor
      const x = u8[p + 1] | (u8[p + 2] << 8);
      const y = u8[p + 3] | (u8[p + 4] << 8);
      const w = u8[p + 5] | (u8[p + 6] << 8);
      const h = u8[p + 7] | (u8[p + 8] << 8);
      const pk = u8[p + 9];
      let q = p + 10;
      let ct = gct;
      if (pk & 0x80) {
        const s = 2 << (pk & 7);
        ct = u8.slice(q, q + s * 3);
        q += s * 3;
      }
      const interlace = !!(pk & 0x40);
      const minCode = u8[q++];
      // gather LZW data sub-blocks
      const parts = [];
      let total = 0;
      while (q < u8.length && u8[q] !== 0) {
        const len = u8[q];
        parts.push(u8.slice(q + 1, q + 1 + len));
        total += len;
        q += 1 + len;
      }
      q++; // terminator
      const data = new Uint8Array(total);
      let o = 0;
      for (const part of parts) { data.set(part, o); o += part.length; }
      const indices = lzwDecode(minCode, data, w * h);
      frames.push({
        x, y, w, h, interlace, indices,
        ct: ct || fallbackGrayscale(),
        delay: gce ? gce.delay : 100,
        disposal: gce ? gce.disposal : 0,
        transparent: gce ? gce.transparent : -1,
      });
      gce = null;
      p = q;
      continue;
    }
    p++; // unknown byte — skip safely
  }
  if (!frames.length) throw new Error("هیچ فریمی در GIF پیدا نشد");
  return { width, height, frames };
}

function fallbackGrayscale() {
  const ct = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) { ct[i * 3] = ct[i * 3 + 1] = ct[i * 3 + 2] = i; }
  return ct;
}

/** read LSB-first bit codes of variable width */
function lzwDecode(minSize, data, outLen) {
  const out = new Uint8Array(outLen);
  const clear = 1 << minSize, eoi = clear + 1;
  const prefix = new Int32Array(4096);
  const suffix = new Uint8Array(4096);
  let codeSize = minSize + 1, next = eoi + 1, prev = -1;
  let bitPos = 0;
  const dataLen = data.length;

  const readCode = () => {
    let code = 0;
    for (let i = 0; i < codeSize; i++) {
      const bp = bitPos >> 3;
      if (bp < dataLen) code |= ((data[bp] >> (bitPos & 7)) & 1) << i;
      bitPos++;
    }
    return code;
  };

  let op = 0;
  const stack = new Uint8Array(4096);
  while (op < outLen) {
    const code = readCode();
    if (code === eoi) break;
    if (code === clear) { codeSize = minSize + 1; next = eoi + 1; prev = -1; continue; }
    if (code > next) break; // corrupt
    const kwk = code >= next;          // code === next: sequence = seq(prev) + first(seq(prev))
    let c = kwk ? prev : code;
    if (c < 0) break;
    let sp = 0;
    let t = c;
    while (t >= clear) { stack[sp++] = suffix[t]; t = prefix[t]; }
    stack[sp++] = t; // root = first pixel of sequence
    for (let i = sp - 1; i >= 0 && op < outLen; i--) out[op++] = stack[i];
    if (kwk && op < outLen) out[op++] = stack[sp - 1]; // append first pixel again
    const firstPx = stack[sp - 1];
    if (prev >= 0 && next < 4096) {
      prefix[next] = prev;
      suffix[next] = firstPx;
      next++;
      if (next === (1 << codeSize) && codeSize < 12) codeSize++;
    }
    prev = code;
  }
  return out;
}

/* deinterlace row order */
export function interlaceRows(h) {
  const rows = [];
  for (let y = 0; y < h; y += 8) rows.push(y);
  for (let y = 4; y < h; y += 8) rows.push(y);
  for (let y = 2; y < h; y += 4) rows.push(y);
  for (let y = 1; y < h; y += 2) rows.push(y);
  return rows;
}

/** compose parsed frames onto canvases (DOM required) */
export function renderGIF(parsed) {
  const { width: w, height: h, frames } = parsed;
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  const tmp = document.createElement("canvas");
  const out = [];
  let prevRect = null, prevDisposal = 0, snapshot = null;

  for (const f of frames) {
    if (prevDisposal === 2 && prevRect) {
      ctx.clearRect(prevRect.x, prevRect.y, prevRect.w, prevRect.h);
    } else if (prevDisposal === 3 && snapshot) {
      ctx.putImageData(snapshot, 0, 0);
    }
    if (f.disposal === 3) snapshot = ctx.getImageData(0, 0, w, h);

    // patch → ImageData with transparency
    const patch = new ImageData(f.w, f.h);
    const px = patch.data;
    const ct = f.ct;
    const rows = f.interlace ? interlaceRows(f.h) : null;
    for (let i = 0; i < f.indices.length; i++) {
      const idx = f.indices[i];
      let dx, dy;
      if (rows) { dy = rows[(i / f.w) | 0]; dx = i % f.w; }
      else { dy = (i / f.w) | 0; dx = i % f.w; }
      const o = (dy * f.w + dx) * 4;
      if (idx === f.transparent) { px[o + 3] = 0; continue; }
      px[o] = ct[idx * 3];
      px[o + 1] = ct[idx * 3 + 1];
      px[o + 2] = ct[idx * 3 + 2];
      px[o + 3] = 255;
    }
    tmp.width = f.w; tmp.height = f.h;
    tmp.getContext("2d").putImageData(patch, 0, 0);
    ctx.drawImage(tmp, f.x, f.y);

    // snapshot composed frame
    const fc = document.createElement("canvas");
    fc.width = w; fc.height = h;
    fc.getContext("2d").drawImage(canvas, 0, 0);
    out.push({ canvas: fc, delay: Math.max(20, f.delay), disposal: f.disposal });
    prevDisposal = f.disposal;
    prevRect = { x: f.x, y: f.y, w: f.w, h: f.h };
  }
  return { width: w, height: h, frames: out };
}

/* ============================ ENCODER ============================ */

/* median-cut palette from sampled pixels (max 255 colors, index 255 reserved for transparency) */
export function buildPalette(samples, maxColors = 255) {
  let boxes = [[samples, 0, samples.length - 1]];
  const colorOf = (arr, i) => [arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]];
  while (boxes.length < maxColors) {
    // pick box with widest channel range * pixel count
    let best = -1, bestScore = -1, bestCh = 0;
    for (let bi = 0; bi < boxes.length; bi++) {
      const [arr, lo, hi] = boxes[bi];
      if (hi - lo < 1) continue;
      let mn = [255, 255, 255], mx = [0, 0, 0];
      for (let i = lo; i <= hi; i++) {
        const c = colorOf(arr, i);
        for (let k = 0; k < 3; k++) { if (c[k] < mn[k]) mn[k] = c[k]; if (c[k] > mx[k]) mx[k] = c[k]; }
      }
      let ch = 0, range = 0;
      for (let k = 0; k < 3; k++) if (mx[k] - mn[k] > range) { range = mx[k] - mn[k]; ch = k; }
      const score = range * (hi - lo + 1);
      if (score > bestScore) { bestScore = score; best = bi; bestCh = ch; }
    }
    if (best < 0 || bestScore <= 0) break;
    const [arr, lo, hi] = boxes[best];
    // sort by channel
    const slice = [];
    for (let i = lo; i <= hi; i++) slice.push(colorOf(arr, i));
    slice.sort((a, b) => a[bestCh] - b[bestCh]);
    const mid = slice.length >> 1;
    const arrA = new Uint8Array(mid * 3), arrB = new Uint8Array((slice.length - mid) * 3);
    for (let i = 0; i < mid; i++) { arrA[i * 3] = slice[i][0]; arrA[i * 3 + 1] = slice[i][1]; arrA[i * 3 + 2] = slice[i][2]; }
    for (let i = 0; i < slice.length - mid; i++) { arrB[i * 3] = slice[mid + i][0]; arrB[i * 3 + 1] = slice[mid + i][1]; arrB[i * 3 + 2] = slice[mid + i][2]; }
    boxes.splice(best, 1, [arrA, 0, mid - 1], [arrB, 0, slice.length - mid - 1]);
  }
  const palette = new Uint8Array(256 * 3);
  palette.fill(0);
  for (let bi = 0; bi < boxes.length && bi < maxColors; bi++) {
    const [arr, lo, hi] = boxes[bi];
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = lo; i <= hi; i++) { r += arr[i * 3]; g += arr[i * 3 + 1]; b += arr[i * 3 + 2]; n++; }
    if (!n) n = 1;
    palette[bi * 3] = r / n; palette[bi * 3 + 1] = g / n; palette[bi * 3 + 2] = b / n;
  }
  return { palette, count: Math.min(boxes.length, maxColors) };
}

/** map RGBA frame → palette indices; alpha<128 → 255 (transparent) */
export function mapFrameIndices(data, palette, count, transparent) {
  // bucket cache: 4-bit rgb key
  const cache = new Int16Array(4096).fill(-1);
  const out = new Uint8Array(data.length / 4);
  for (let i = 0, o = 0; i < data.length; i += 4, o++) {
    if (transparent && data[i + 3] < 128) { out[o] = 255; continue; }
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    let idx = cache[key];
    if (idx < 0) {
      // nearest palette search (skip 255 when transparent)
      let best = 0, bestD = Infinity;
      const n = transparent ? count : Math.min(count + 1, 256);
      for (let pi = 0; pi < n; pi++) {
        const dr = palette[pi * 3] - r, dg = palette[pi * 3 + 1] - g, db = palette[pi * 3 + 2] - b;
        const d = dr * dr + dg * dg + db * db;
        if (d < bestD) { bestD = d; best = pi; }
      }
      idx = best;
      cache[key] = idx;
    }
    out[o] = idx;
  }
  return out;
}

function lzwEncode(indices, minSize = 8) {
  const clear = 1 << minSize, eoi = clear + 1;
  let codeSize = minSize + 1;
  let next = eoi + 1;
  const dict = new Map();
  const bytes = [];
  let cur = 0, curBits = 0;
  const write = (code, len) => {
    for (let i = 0; i < len; i++) {
      cur |= ((code >> i) & 1) << curBits;
      curBits++;
      if (curBits === 8) { bytes.push(cur); cur = 0; curBits = 0; }
    }
  };
  write(clear, codeSize);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const px = indices[i];
    const key = (prefix << 8) | px;
    const found = dict.get(key);
    if (found !== undefined) { prefix = found; continue; }
    write(prefix, codeSize);
    dict.set(key, next++);
    // encoder grows one code LATER than the decoder (standard GIF "delayed increment")
    if (next === (1 << codeSize) + 1 && codeSize < 12) codeSize++;
    if (next === 4096) { write(clear, codeSize); dict.clear(); next = eoi + 1; codeSize = minSize + 1; }
    prefix = px;
  }
  write(prefix, codeSize);
  write(eoi, codeSize);
  if (curBits > 0) bytes.push(cur);
  return Uint8Array.from(bytes);
}

function toSubBlocks(bytes) {
  const out = [];
  for (let i = 0; i < bytes.length; i += 255) {
    const chunk = bytes.slice(i, i + 255);
    out.push(chunk.length, ...chunk);
  }
  out.push(0);
  return Uint8Array.from(out);
}

/**
 * Encode RGBA frames into an animated GIF89a.
 * frames: [{data:Uint8ClampedArray, width, height, delay(ms)}]
 * options.transparent: reserve index 255 for alpha<128
 */
export function encodeGIF(frames, { transparent = false } = {}) {
  if (!frames.length) throw new Error("فریمی برای ساخت GIF وجود ندارد");
  const w = frames[0].width, h = frames[0].height;
  // sample colors for palette
  const perFrame = Math.max(600, Math.floor(20000 / frames.length));
  const stride = Math.max(4, Math.floor((w * h) / perFrame));
  const samples = [];
  for (const f of frames) {
    const d = f.data;
    for (let i = 0; i < d.length; i += 4 * stride) {
      if (transparent && d[i + 3] < 128) continue;
      samples.push(d[i], d[i + 1], d[i + 2]);
    }
  }
  if (!samples.length) samples.push(0, 0, 0);
  const { palette, count } = buildPalette(Uint8Array.from(samples), transparent ? 255 : 256);

  const out = [];
  const push = (...v) => out.push(...v);
  const push16 = (v) => out.push(v & 255, (v >> 8) & 255);
  // header
  push(0x47, 0x49, 0x46, 0x38, 0x39, 0x61); // "GIF89a"
  push16(w); push16(h);
  push(0xf7, 0, 0); // GCT flag, 256 colors
  out.push(...palette.slice(0, 768));
  // NETSCAPE loop extension
  push(0x21, 0xff, 0x0b);
  for (const ch of "NETSCAPE2.0") push(ch.charCodeAt(0));
  push(3, 1, 0, 0, 0); // loop forever
  for (const f of frames) {
    const tIdx = transparent ? 255 : 0;
    // GCE packed: bit0=transparent flag, bits2-4=disposal (2=restore to background)
    const packedGCE = transparent ? 0x09 : 0x04;
    push(0x21, 0xf9, 0x04, packedGCE, (f.delay / 10) & 255, Math.floor(f.delay / 10 / 256) & 255, tIdx, 0);
    push(0x2c, 0, 0, 0, 0); // image descriptor: separator + x(2) + y(2)
    push16(w); push16(h);
    push(0x00); // no LCT, no interlace
    const indices = mapFrameIndices(f.data, palette, count, transparent);
    const minCode = 8;
    push(minCode);
    out.push(...toSubBlocks(lzwEncode(indices, minCode)));
  }
  push(0x3b);
  return Uint8Array.from(out).buffer;
}
