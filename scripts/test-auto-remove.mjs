/* test-auto-remove.mjs — verify the auto background-removal engine in Node */
import { strict as assert } from "node:assert";

// ImageData polyfill (bg-removal.ts constructs one)
class ImageDataPoly {
  constructor(data, width, height) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}
if (typeof globalThis.ImageData === "undefined") {
  globalThis.ImageData = ImageDataPoly;
}

const { autoRemoveBackground, calibrateTolerance } = await import(
  "/home/z/my-project/src/lib/cv/auto-remove.ts"
);

function img(w, h, fill) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) fill(d, i * 4, i % w, Math.floor(i / w));
  return new ImageDataPoly(d, w, h);
}

/* ---------- 1. flat dark background + rocket-ish sprite ---------- */
{
  const W = 120, H = 120;
  const src = img(W, H, (d, o, x, y) => {
    // dark navy bg like the user's GIF
    d[o] = 24; d[o + 1] = 28; d[o + 2] = 44; d[o + 3] = 255;
    // white rocket body (rounded)
    const inBody = (x - 60) * (x - 60) / 900 + (y - 55) * (y - 55) / 1600 < 1;
    if (inBody) { d[o] = 240; d[o + 1] = 240; d[o + 2] = 245; }
    // red nose cone
    if (y < 34 && Math.abs(x - 60) < 10 + (34 - y) * 0.8) { d[o] = 220; d[o + 1] = 46; d[o + 2] = 60; }
  });
  const r = autoRemoveBackground(src);
  const px = (x, y) => {
    const i = (y * W + x) * 4;
    return [r.image.data[i], r.image.data[i + 1], r.image.data[i + 2], r.image.data[i + 3]];
  };
  const corner = px(2, 2);
  assert.equal(corner[3], 0, `corner must be transparent, got a=${corner[3]}`);
  const body = px(60, 60);
  assert.equal(body[3], 255, `body must stay opaque, got a=${body[3]}`);
  assert.ok(body[0] > 200, "body color must survive");
  const nose = px(60, 20);
  assert.equal(nose[3], 255, `nose must stay opaque, got a=${nose[3]}`);
  assert.ok(r.removedRatio > 0.5 && r.removedRatio < 0.95, "sane removed ratio: " + r.removedRatio);
  console.log("flat-bg  OK — tol:", r.autoTolerance.toFixed(1), "removed:", (r.removedRatio * 100).toFixed(1) + "%");
}

/* ---------- 2. noisy gradient background (photo-like) ---------- */
{
  const W = 140, H = 140;
  const src = img(W, H, (d, o, x, y) => {
    const g = 190 + Math.round(28 * Math.sin(x / 9) * Math.cos(y / 7)) + ((x * 7 + y * 13) % 9) - 4;
    d[o] = g; d[o + 1] = g - 6; d[o + 2] = g - 12; d[o + 3] = 255;
    const inCircle = (x - 70) * (x - 70) + (y - 70) * (y - 70) < 38 * 38;
    if (inCircle) { d[o] = 30; d[o + 1] = 144; d[o + 2] = 255; }
  });
  const r = autoRemoveBackground(src);
  const a = (x, y) => r.image.data[(y * W + x) * 4 + 3];
  assert.equal(a(2, 2), 0, "gradient corner must be transparent");
  assert.equal(a(70, 70), 255, "circle center must stay opaque");
  // mid-ring noise check: no stray opaque pixels far from the subject
  let strays = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = x - 70, dy = y - 70;
    if (dx * dx + dy * dy > 48 * 48 && a(x, y) > 128) strays++;
  }
  assert.equal(strays, 0, `stray opaque pixels outside subject: ${strays}`);
  console.log("gradient OK — tol:", r.autoTolerance.toFixed(1), "removed:", (r.removedRatio * 100).toFixed(1) + "%");
}

/* ---------- 3. subject touching the border ---------- */
{
  const W = 100, H = 100;
  const src = img(W, H, (d, o, x, y) => {
    d[o] = 250; d[o + 1] = 250; d[o + 2] = 250; d[o + 3] = 255;
    if (x > 40 && y > 30) { d[o] = 200; d[o + 1] = 60; d[o + 2] = 30; } // bleeds to edges
  });
  const r = autoRemoveBackground(src);
  const a = (x, y) => r.image.data[(y * W + x) * 4 + 3];
  assert.equal(a(2, 2), 0, "white bg must go");
  assert.equal(a(90, 90), 255, "subject bleeding to border must survive");
  assert.equal(a(60, 60), 255, "subject interior must survive");
  console.log("border-touch OK — tol:", r.autoTolerance.toFixed(1));
}

/* ---------- 4. calibration sanity ---------- */
{
  const flat = calibrateTolerance(Float32Array.from([0, 1, 0, 2, 1, 0, 1, 2, 0, 1]), 1);
  assert.ok(flat >= 28 && flat <= 60, "flat tol sane: " + flat);
  const noisy = calibrateTolerance(Float32Array.from([14, 18, 22, 16, 20, 15, 19, 21, 17, 18]), 1);
  assert.ok(noisy > flat, "noisy bg needs wider tol");
  assert.ok(noisy <= 120, "tol capped");
  console.log("calibration OK — flat:", flat.toFixed(1), "noisy:", noisy.toFixed(1));
}

console.log("ALL AUTO-REMOVE TESTS PASSED");
