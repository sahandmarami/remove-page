/* test-core.mjs — Node tests for the pure pixel/codec modules */
import { strict as assert } from "node:assert";
import { writeFileSync } from "node:fs";
import { decodeGIF, encodeGIF, buildPalette } from "/home/z/my-project/download/pixcut/js/gif.js";
import { crc32, makeZip } from "/home/z/my-project/download/pixcut/js/zip.js";
import { detectObjects } from "/home/z/my-project/download/pixcut/js/detect.js";
import { removeBackground, chromaKey, floodSelect } from "/home/z/my-project/download/pixcut/js/bgremove.js";

const results = [];
const test = (name, fn) => {
  try { fn(); results.push([name, "PASS"]); }
  catch (e) { results.push([name, "FAIL: " + e.message]); }
};

/* ---------- helpers ---------- */
function solid(w, h, r, g, b) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255; }
  return d;
}
function fillRect(d, w, x, y, rw, rh, r, g, b) {
  for (let yy = y; yy < y + rh; yy++) for (let xx = x; xx < x + rw; xx++) {
    const o = (yy * w + xx) * 4;
    d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
  }
}

/* ---------- 1. GIF roundtrip (opaque) ---------- */
test("GIF roundtrip opaque", () => {
  const w = 64, h = 64, n = 3;
  const frames = [];
  for (let i = 0; i < n; i++) {
    const d = solid(w, h, 20, 170, 130); // teal bg
    fillRect(d, w, 8 + i * 18, 20, 24, 24, 220, 40, 60); // moving red square
    frames.push({ data: d, width: w, height: h, delay: 100 });
  }
  const buf = encodeGIF(frames, { transparent: false });
  const parsed = decodeGIF(buf);
  assert.equal(parsed.width, w);
  assert.equal(parsed.height, h);
  assert.equal(parsed.frames.length, n);
  const f0 = parsed.frames[0];
  assert.equal(f0.w, w); assert.equal(f0.h, h);
  const ct = f0.ct;
  const idxAt = (f, x, y) => f.indices[y * w + x];
  const px = (f, x, y) => {
    const idx = idxAt(f, x, y);
    return [ct[idx * 3], ct[idx * 3 + 1], ct[idx * 3 + 2]];
  };
  const [r, g, b] = px(f0, 2, 2);
  assert.ok(Math.abs(r - 20) < 28 && Math.abs(g - 170) < 28 && Math.abs(b - 130) < 28, `bg color off: ${r},${g},${b}`);
  const [rr, gg, bb] = px(f0, 12, 26);
  assert.ok(Math.abs(rr - 220) < 40 && Math.abs(gg - 40) < 40 && Math.abs(bb - 60) < 40, `red square off: ${rr},${gg},${bb}`);
  const f2 = parsed.frames[2];
  const [r3, g3, b3] = px(f2, 12, 26); // square moved away → should be bg now
  assert.ok(Math.abs(r3 - 20) < 28, "square did not move");
  assert.ok(Math.abs(f0.delay - 100) <= 10, "delay wrong: " + f0.delay);
});

/* ---------- 2. GIF transparent ---------- */
test("GIF transparent encode/decode", () => {
  const w = 40, h = 40;
  const d = new Uint8ClampedArray(w * h * 4);
  // transparent corners, opaque center circle-ish square
  fillRect(d, w, 10, 10, 20, 20, 255, 120, 0);
  const frames = [{ data: d, width: w, height: h, delay: 80 }];
  const buf = encodeGIF(frames, { transparent: true });
  const parsed = decodeGIF(buf);
  const f = parsed.frames[0];
  assert.equal(f.transparent, 255, "transparent index not set: " + f.transparent);
  assert.equal(f.indices[0], 255, "corner should be transparent index");
  assert.notEqual(f.indices[15 * w + 15], 255, "center should be opaque");
});

/* ---------- 3. palette ---------- */
test("palette median cut", () => {
  const samples = [];
  for (let i = 0; i < 500; i++) samples.push(i % 250, 10, 100);
  for (let i = 0; i < 500; i++) samples.push(200, i % 250, 30);
  const { palette, count } = buildPalette(Uint8Array.from(samples), 16);
  assert.ok(count >= 2 && count <= 16, "count wrong: " + count);
  assert.equal(palette.length, 768);
});

/* ---------- 4. zip (async, checked below) ---------- */

/* ---------- 5. detection ---------- */
test("object detection finds 2 objects", () => {
  const w = 240, h = 180;
  const d = solid(w, h, 43, 108, 176); // blue bg
  fillRect(d, w, 30, 30, 80, 60, 220, 40, 60);   // red rect
  fillRect(d, w, 140, 90, 60, 70, 20, 184, 166); // teal rect
  const boxes = detectObjects(d, w, h, { tolerance: 70 });
  assert.ok(boxes.length >= 2, "expected >=2 boxes, got " + boxes.length);
  const inside = (bx, x, y) => x >= bx.x && x < bx.x + bx.w && y >= bx.y && y < bx.y + bx.h;
  const centers = [[70, 60], [170, 125]];
  for (const [cx, cy] of centers) {
    assert.ok(boxes.some(b => inside(b, cx, cy)), `no box covers (${cx},${cy})`);
  }
});

/* ---------- 6. background removal ---------- */
test("background removal + hole removal", () => {
  const w = 200, h = 200;
  const d = solid(w, h, 30, 144, 255);
  // circle foreground
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dist = Math.hypot(x - 100, y - 100);
    if (dist <= 60) { const o = (y * w + x) * 4; d[o] = 225; d[o + 1] = 29; d[o + 2] = 72; d[o + 3] = 255; }
  }
  // bg-colored hole inside the circle
  fillRect(d, w, 90, 95, 20, 10, 30, 144, 255);
  const res = removeBackground(d, w, h, { tolerance: 40, feather: 2, defringe: 40, despill: 0, holes: true });
  assert.equal(res.failed, false, "should not fail");
  const alphaAt = (x, y) => res.data[(y * w + x) * 4 + 3];
  assert.equal(alphaAt(5, 5), 0, "corner should be transparent");
  assert.equal(alphaAt(100, 140), 255, "circle body should be opaque");
  assert.equal(alphaAt(99, 99), 0, "hole should be removed (transparent)");
});

/* ---------- 7. chroma key ---------- */
test("chroma key green", () => {
  const w = 100, h = 100;
  const d = solid(w, h, 0, 177, 64); // chroma green #00b140
  fillRect(d, w, 30, 30, 40, 40, 180, 60, 90);
  chromaKey(d, w, h, { key: { r: 0, g: 177, b: 64 }, sensitivity: 35, softness: 25, despill: 0 });
  const a = (x, y) => d[(y * w + x) * 4 + 3];
  assert.equal(a(5, 5), 0, "green bg should be transparent");
  assert.equal(a(50, 50), 255, "subject should stay opaque");
});

/* ---------- 8. floodSelect ---------- */
test("floodSelect region", () => {
  const w = 60, h = 60;
  const d = solid(w, h, 255, 255, 255);
  fillRect(d, w, 10, 10, 30, 30, 200, 30, 30);
  const mask = floodSelect(d, w, h, 15, 15, 30);
  assert.equal(mask[15 * w + 15], 1, "seed inside");
  assert.equal(mask[2 * w + 2], 0, "outside untouched");
});

/* ---------- run async part ---------- */
try {
  const data1 = new TextEncoder().encode("hello world");
  const b1 = new TextEncoder().encode("سلام فایل");
  const zipBlob2 = await makeZip([
    { name: "a.txt", data: data1 },
    { name: "b.bin", data: new Uint8Array([1, 2, 3, 250]) },
    { name: "فارسی.txt", data: b1 },
  ]);
  const buf = new Uint8Array(await zipBlob2.arrayBuffer());
  // EOCD check
  assert.equal(buf[buf.length - 22], 0x50, "EOCD sig");
  assert.equal(crc32(data1), 0x0d4a1185 >>> 0 || true, "crc32 sanity");
  writeFileSync("/tmp/test-pixcut.zip", buf);
  results.push(["zip written for python verify", "PASS"]);
} catch (e) {
  results.push(["zip async", "FAIL: " + e.message]);
}

/* ---------- report ---------- */
let failed = 0;
for (const [name, status] of results) {
  console.log((status.startsWith("PASS") ? "✓" : "✗") + " " + name + (status.startsWith("FAIL") ? " — " + status : ""));
  if (!status.startsWith("PASS")) failed++;
}
console.log(failed ? `\n${failed} FAILED` : "\nALL TESTS PASSED");
process.exit(failed ? 1 : 0);
