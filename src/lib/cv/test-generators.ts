/**
 * One-click test asset generators (no upload required):
 *  - sample sprite sheet drawn on a canvas
 *  - green-screen animation recorded client-side via MediaRecorder
 *  - animated GIF encoded with gifenc
 */

export function createCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, outer: number, inner: number, points = 5) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI * i) / points - Math.PI / 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function drawHeart(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  ctx.beginPath();
  ctx.moveTo(cx, cy + s * 0.32);
  ctx.bezierCurveTo(cx + s * 0.5, cy - s * 0.28, cx + s * 0.48, cy - s * 0.62, cx, cy - s * 0.24);
  ctx.bezierCurveTo(cx - s * 0.48, cy - s * 0.62, cx - s * 0.5, cy - s * 0.28, cx, cy + s * 0.32);
  ctx.closePath();
}

function roundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** A demo sprite sheet with 6 distinct items on a slate background. */
export function generateSampleSheet(): HTMLCanvasElement {
  const w = 1080;
  const h = 560;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d")!;

  // slate background + subtle grid
  const bgGrad = ctx.createLinearGradient(0, 0, w, h);
  bgGrad.addColorStop(0, "#151726");
  bgGrad.addColorStop(1, "#101223");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(148,163,184,0.08)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= w; x += 60) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y <= h; y += 60) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  const cellW = w / 3;
  const cellH = h / 2;
  const centers = [
    [cellW * 0.5, cellH * 0.5],
    [cellW * 1.5, cellH * 0.5],
    [cellW * 2.5, cellH * 0.5],
    [cellW * 0.5, cellH * 1.5],
    [cellW * 1.5, cellH * 1.5],
    [cellW * 2.5, cellH * 1.5],
  ];

  // 1 — cyan star
  {
    const [cx, cy] = centers[0];
    const g = ctx.createLinearGradient(cx - 70, cy - 70, cx + 70, cy + 70);
    g.addColorStop(0, "#67e8f9");
    g.addColorStop(1, "#0891b2");
    ctx.fillStyle = g;
    ctx.shadowColor = "rgba(34,211,238,0.55)";
    ctx.shadowBlur = 24;
    drawStar(ctx, cx, cy, 88, 38);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath();
    ctx.arc(cx - 18, cy - 12, 9, 0, Math.PI * 2);
    ctx.fill();
  }

  // 2 — magenta heart
  {
    const [cx, cy] = centers[1];
    const g = ctx.createLinearGradient(cx, cy - 80, cx, cy + 80);
    g.addColorStop(0, "#f472b6");
    g.addColorStop(1, "#be185d");
    ctx.fillStyle = g;
    drawHeart(ctx, cx, cy + 8, 150);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.beginPath();
    ctx.ellipse(cx - 26, cy - 26, 16, 10, -0.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // 3 — purple potion
  {
    const [cx, cy] = centers[2];
    // bottle body
    const g = ctx.createRadialGradient(cx - 14, cy + 6, 6, cx, cy + 20, 66);
    g.addColorStop(0, "#c084fc");
    g.addColorStop(1, "#7c3aed");
    ctx.fillStyle = g;
    roundedRectPath(ctx, cx - 52, cy - 10, 104, 118, 34);
    ctx.fill();
    // neck
    ctx.fillStyle = "#a78bfa";
    ctx.fillRect(cx - 16, cy - 78, 32, 74);
    // cork
    ctx.fillStyle = "#d6b98c";
    ctx.fillRect(cx - 20, cy - 96, 40, 24);
    // shine
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.beginPath();
    ctx.ellipse(cx - 24, cy + 30, 10, 26, 0.3, 0, Math.PI * 2);
    ctx.fill();
  }

  // 4 — metallic shield
  {
    const [cx, cy] = centers[3];
    const g = ctx.createLinearGradient(cx - 70, cy - 80, cx + 70, cy + 80);
    g.addColorStop(0, "#a5b4fc");
    g.addColorStop(0.5, "#6366f1");
    g.addColorStop(1, "#312e81");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 86);
    ctx.lineTo(cx + 70, cy - 58);
    ctx.lineTo(cx + 62, cy + 34);
    ctx.quadraticCurveTo(cx, cy + 92, cx - 62, cy + 34);
    ctx.lineTo(cx - 70, cy - 58);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#c7d2fe";
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.fillStyle = "#e0e7ff";
    ctx.beginPath();
    ctx.moveTo(cx, cy - 44);
    ctx.lineTo(cx + 26, cy + 8);
    ctx.lineTo(cx, cy + 52);
    ctx.lineTo(cx - 26, cy + 8);
    ctx.closePath();
    ctx.fill();
  }

  // 5 — mushroom
  {
    const [cx, cy] = centers[4];
    // stem
    ctx.fillStyle = "#e2e8f0";
    roundedRectPath(ctx, cx - 26, cy - 6, 52, 88, 20);
    ctx.fill();
    // cap
    const g = ctx.createRadialGradient(cx - 20, cy - 44, 8, cx, cy - 24, 80);
    g.addColorStop(0, "#fb7185");
    g.addColorStop(1, "#9f1239");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx, cy - 26, 84, 56, 0, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    // dots
    ctx.fillStyle = "#fef2f2";
    for (const [dx, dy, r] of [
      [-38, -44, 11],
      [8, -58, 9],
      [40, -40, 12],
      [-8, -30, 7],
    ] as const) {
      ctx.beginPath();
      ctx.arc(cx + dx, cy + dy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 6 — lightning bolt
  {
    const [cx, cy] = centers[5];
    const g = ctx.createLinearGradient(cx - 40, cy - 90, cx + 40, cy + 90);
    g.addColorStop(0, "#fde047");
    g.addColorStop(1, "#f59e0b");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(cx + 34, cy - 92);
    ctx.lineTo(cx - 30, cy + 6);
    ctx.lineTo(cx - 2, cy + 6);
    ctx.lineTo(cx - 22, cy + 92);
    ctx.lineTo(cx + 36, cy - 12);
    ctx.lineTo(cx + 6, cy - 12);
    ctx.closePath();
    ctx.fill();
    ctx.shadowColor = "rgba(250,204,21,0.6)";
    ctx.shadowBlur = 18;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  return canvas;
}

/** Records a short green-screen animation client-side with MediaRecorder. */
export function recordTestVideo(): Promise<{ url: string; blob: Blob }> {
  return new Promise((resolve, reject) => {
    if (typeof MediaRecorder === "undefined") {
      reject(new Error("مرورگر شما از MediaRecorder پشتیبانی نمی‌کند"));
      return;
    }
    const w = 480;
    const h = 480;
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext("2d")!;

    const durationMs = 3000;
    const start = performance.now();

    const drawFrame = (now: number) => {
      const t = ((now - start) / 1000) % 3;

      // green screen
      ctx.fillStyle = "#00b140";
      ctx.fillRect(0, 0, w, h);

      // floor shadow
      const bx = w / 2 + Math.sin(t * 2.1) * 120;
      const by = h / 2 + Math.sin(t * 3.3) * 90;
      ctx.fillStyle = "rgba(0,60,20,0.35)";
      ctx.beginPath();
      ctx.ellipse(bx, h - 64, 64 - Math.sin(t * 3.3) * 12, 14, 0, 0, Math.PI * 2);
      ctx.fill();

      // orbiting ring
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, 150, t * 1.4, t * 1.4 + Math.PI * 1.3);
      ctx.stroke();

      // bouncing purple orb with face
      const squash = 1 + Math.sin(t * 3.3) * 0.18;
      const rx = 52;
      const ry = 52 / squash;
      const g = ctx.createRadialGradient(bx - 16, by - 18, 6, bx, by, rx + 10);
      g.addColorStop(0, "#d8b4fe");
      g.addColorStop(0.6, "#a855f7");
      g.addColorStop(1, "#6b21a8");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(bx, by, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();

      // eyes track motion
      const ex = Math.sin(t * 2.1) * 6;
      ctx.fillStyle = "#0f172a";
      ctx.beginPath();
      ctx.ellipse(bx - 16 + ex, by - 10, 7, 10, 0, 0, Math.PI * 2);
      ctx.ellipse(bx + 16 + ex, by - 10, 7, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#0f172a";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(bx + ex, by + 12 + Math.sin(t * 3.3) * 4, 16, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();

      // spinning satellite
      const sa = t * 2.4;
      const sx = w / 2 + Math.cos(sa) * 150;
      const sy = h / 2 + Math.sin(sa) * 150;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(sa * 2);
      ctx.fillStyle = "#22d3ee";
      roundedRectPath(ctx, -14, -14, 28, 28, 6);
      ctx.fill();
      ctx.restore();
    };

    let stream: MediaStream;
    try {
      stream = canvas.captureStream(30);
    } catch {
      reject(new Error("captureStream در این مرورگر پشتیبانی نمی‌شود"));
      return;
    }

    const candidates = [
      'video/webm;codecs="vp9"',
      'video/webm;codecs="vp8"',
      "video/webm",
    ];
    let mimeType = "";
    for (const c of candidates) {
      if (MediaRecorder.isTypeSupported(c)) {
        mimeType = c;
        break;
      }
    }

    let recorder: MediaRecorder;
    try {
      recorder = mimeType
        ? new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 })
        : new MediaRecorder(stream);
    } catch {
      reject(new Error("ساخت MediaRecorder ناموفق بود"));
      return;
    }

    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType || "video/webm" });
      resolve({ url: URL.createObjectURL(blob), blob });
    };
    recorder.onerror = () => reject(new Error("خطا در ضبط ویدیوی تستی"));

    // draw first frame before starting so the recorder captures content
    drawFrame(start);
    recorder.start(250);

    const loop = (now: number) => {
      const elapsed = now - start;
      drawFrame(now);
      if (elapsed < durationMs) {
        requestAnimationFrame(loop);
      } else {
        recorder.stop();
      }
    };
    requestAnimationFrame(loop);
  });
}

/** Encodes a bouncing-star animated GIF (green background, chroma-key ready). */
export function encodeTestGif(): Promise<{ url: string; blob: Blob; frames: number }> {
  return new Promise((resolve, reject) => {
    (async () => {
      try {
        const { GIFEncoder, quantize, applyPalette } = await import("gifenc");
        const size = 320;
        const frameCount = 12;
        const encoder = GIFEncoder();

        for (let f = 0; f < frameCount; f++) {
          const t = f / frameCount;
          const canvas = createCanvas(size, size);
          const ctx = canvas.getContext("2d")!;

          ctx.fillStyle = "#00b140";
          ctx.fillRect(0, 0, size, size);

          const cx = size / 2 + Math.sin(t * Math.PI * 2) * 70;
          const bounce = Math.abs(Math.sin(t * Math.PI * 2));
          const cy = size - 90 - bounce * 140;
          const squash = 1 + (1 - bounce) * 0.25;

          ctx.fillStyle = "rgba(0,70,25,0.4)";
          ctx.beginPath();
          ctx.ellipse(cx, size - 58, 40 - (1 - bounce) * 8, 9, 0, 0, Math.PI * 2);
          ctx.fill();

          const g = ctx.createLinearGradient(cx - 45, cy - 45, cx + 45, cy + 45);
          g.addColorStop(0, "#a5f3fc");
          g.addColorStop(1, "#0891b2");
          ctx.fillStyle = g;
          ctx.beginPath();
          for (let i = 0; i < 10; i++) {
            const r = i % 2 === 0 ? 44 : 19;
            const a = (Math.PI * i) / 5 - Math.PI / 2 + t * Math.PI * 4;
            const x = cx + Math.cos(a) * r;
            const y = cy + Math.sin(a) * r * squash;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.fill();

          const imageData = ctx.getImageData(0, 0, size, size);
          const palette = quantize(imageData.data, 128);
          const index = applyPalette(imageData.data, palette);
          encoder.writeFrame(index, size, size, { palette, delay: 90 });
        }

        encoder.finish();
        const bytes = encoder.bytes();
        const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: "image/gif" });
        resolve({ url: URL.createObjectURL(blob), blob, frames: frameCount });
      } catch (err) {
        reject(err instanceof Error ? err : new Error("خطای ناشناخته در ساخت گیف"));
      }
    })();
  });
}
