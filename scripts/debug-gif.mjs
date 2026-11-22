import { encodeGIF, decodeGIF } from "/home/z/my-project/download/pixcut/js/gif.js";

function fillRect(d, w, x, y, rw, rh, r, g, b, a = 255) {
  for (let yy = y; yy < y + rh; yy++) for (let xx = x; xx < x + rw; xx++) {
    const o = (yy * w + xx) * 4;
    d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = a;
  }
}
function solid(w, h, r, g, b) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255; }
  return d;
}

// transparent test
const w = 40, h = 40;
const d = new Uint8ClampedArray(w * h * 4);
fillRect(d, w, 10, 10, 20, 20, 255, 120, 0);
const frames = [{ data: d, width: w, height: h, delay: 80 }];
const buf = encodeGIF(frames, { transparent: true });
console.log("bytes:", buf.byteLength);
const u8 = new Uint8Array(buf);
console.log("header:", String.fromCharCode(...u8.slice(0, 6)));
console.log("LSD packed:", u8[10].toString(2), "bg:", u8[11]);
let p = 13 + 256 * 3;
console.log("after GCT @", p, "byte:", u8[p].toString(16), u8[p + 1].toString(16));
const parsed = decodeGIF(buf);
console.log("decoded frames:", parsed.frames.length);
const f = parsed.frames[0];
console.log("frame0:", { x: f.x, y: f.y, w: f.w, h: f.h, delay: f.delay, disposal: f.disposal, transparent: f.transparent });
console.log("indices sample:", [...f.indices.slice(0, 12)], "center:", f.indices[20 * w + 20]);

// multi-frame opaque roundtrip width-check
const W = 64, H = 64, N = 3;
const frames2 = [];
for (let i = 0; i < N; i++) {
  const dd = solid(W, H, 20, 170, 130);
  fillRect(dd, W, 8 + i * 18, 20, 24, 24, 220, 40, 60);
  frames2.push({ data: dd, width: W, height: H, delay: 100 });
}
const buf2 = encodeGIF(frames2, { transparent: false });
const parsed2 = decodeGIF(buf2);
console.log("\nmultiframe decoded:", parsed2.frames.length);
for (const [i, ff] of parsed2.frames.entries()) {
  const ct = ff.ct;
  const px = (x, y) => { const idx = ff.indices[y * W + x]; return [ct[idx * 3], ct[idx * 3 + 1], ct[idx * 3 + 2]]; };
  console.log(`frame ${i}: corner=`, px(2, 2), "centerOfOldSquare=", px(12, 26));
}
