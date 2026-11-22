/* ui-anim.js — module 3: flipbook player, sprite sheet builder, export system */
import { qs, qsa, App, toast, download, downloadCanvas, canvasToBlob, clamp, fmtBytes } from "./util.js";
import { makeZip } from "./zip.js";

const A = {
  idx: 0, playing: false, fps: 12,
  bg: "checker", customColor: "#8b5cf6",
  raf: 0, acc: 0, last: 0,
  cols: 4, gap: 4, scale: 100,
  sheet: null,
};

/* ================= flipbook ================= */

function bgStyle() {
  switch (A.bg) {
    case "white": return "#ffffff";
    case "black": return "#000000";
    case "green": return "#00b140";
    case "custom": return A.customColor;
    default: return null; // checker
  }
}

function renderFlip() {
  const stage = qs("#flipStage");
  const cv = qs("#flipCanvas");
  const dpr = window.devicePixelRatio || 1;
  const rect = stage.getBoundingClientRect();
  if (rect.width < 4) return;
  cv.width = Math.round(rect.width * dpr);
  cv.height = Math.round(rect.height * dpr);
  cv.style.width = rect.width + "px";
  cv.style.height = rect.height + "px";
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = rect.width, H = rect.height;
  ctx.clearRect(0, 0, W, H);
  const bg = bgStyle();
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H); }
  else {
    // checker
    const s = 16;
    const c1 = "#94a3b855", c2 = "#94a3b822";
    for (let y = 0; y < H; y += s) for (let x = 0; x < W; x += s) {
      ctx.fillStyle = ((x / s + y / s) & 1) ? c1 : c2;
      ctx.fillRect(x, y, s, s);
    }
  }
  const f = App.frames[A.idx];
  if (f) {
    const k = Math.min(W / f.canvas.width, H / f.canvas.height) * 0.92;
    const dw = f.canvas.width * k, dh = f.canvas.height * k;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(f.canvas, (W - dw) / 2, (H - dh) / 2, dw, dh);
  }
  qs("#flipPos").textContent = `${A.idx + 1} / ${App.frames.length}`;
}

function setPlaying(p) {
  A.playing = p;
  qs("#btnPlay use").setAttribute("href", p ? "#i-pause" : "#i-play");
  if (p) {
    A.last = performance.now();
    A.acc = 0;
    cancelAnimationFrame(A.raf);
    const loop = (now) => {
      if (!A.playing) return;
      const dt = (now - A.last) / 1000;
      A.last = now;
      A.acc += dt;
      const step = 1 / A.fps;
      let advanced = false;
      while (A.acc >= step) {
        A.acc -= step;
        A.idx = (A.idx + 1) % Math.max(1, App.frames.length);
        advanced = true;
      }
      if (advanced) renderFlip();
      A.raf = requestAnimationFrame(loop);
    };
    A.raf = requestAnimationFrame(loop);
  } else {
    cancelAnimationFrame(A.raf);
  }
}

function checkFrames() {
  const has = App.frames.length > 0;
  qs("#animEmpty").classList.toggle("hidden", has);
  qs("#animWork").classList.toggle("hidden", !has);
  if (has) {
    qs("#flipCount").textContent = `${App.frames.length} فریم`;
    A.idx = clamp(A.idx, 0, App.frames.length - 1);
    renderFlip();
    renderSheet();
  }
}

/* ================= sprite sheet ================= */

function buildSheet() {
  const frames = App.frames;
  if (!frames.length) return null;
  const cellBase = Math.max(...frames.map(f => Math.max(f.canvas.width, f.canvas.height)));
  const k = A.scale / 100;
  const cell = Math.max(2, Math.round(cellBase * k));
  const cols = clamp(A.cols, 1, frames.length || 1);
  const rows = Math.ceil(frames.length / cols);
  const c = document.createElement("canvas");
  c.width = cols * cell + A.gap * (cols + 1);
  c.height = rows * cell + A.gap * (rows + 1);
  const ctx = c.getContext("2d");
  frames.forEach((f, i) => {
    const col = i % cols, row = (i / cols) | 0;
    const k2 = cell / cellBase;
    const dw = f.canvas.width * k2, dh = f.canvas.height * k2;
    ctx.drawImage(
      f.canvas,
      A.gap + col * (cell + A.gap) + (cell - dw) / 2,
      A.gap + row * (cell + A.gap) + (cell - dh) / 2,
      dw, dh
    );
  });
  return { canvas: c, cell, cols, rows, frameW: cell, frameH: cell };
}

function renderSheet() {
  const built = buildSheet();
  A.sheet = built;
  if (!built) return;
  const cv = qs("#sheetCanvas");
  const kk = Math.min(1, 520 / built.canvas.width);
  cv.width = Math.max(2, Math.round(built.canvas.width * kk));
  cv.height = Math.max(2, Math.round(built.canvas.height * kk));
  cv.style.width = cv.width + "px";
  cv.getContext("2d").drawImage(built.canvas, 0, 0, cv.width, cv.height);
}

function sheetJson() {
  const built = A.sheet;
  if (!built) return null;
  const prefix = (qs("#expPrefix").value.trim() || "frame").replace(/[^\w\-]/g, "") || "frame";
  const frames = [];
  for (let i = 0; i < App.frames.length; i++) {
    const col = i % built.cols, row = (i / built.cols) | 0;
    const x = built.gap + col * (built.cell + built.gap);
    const y = built.gap + row * (built.cell + built.gap);
    frames.push({
      name: `${prefix}_${String(i + 1).padStart(3, "0")}`,
      frame: { x, y, w: built.frameW, h: built.frameH },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: built.frameW, h: built.frameH },
      sourceSize: { w: built.frameW, h: built.frameH },
    });
  }
  return {
    frames,
    meta: {
      app: "PixCut Studio",
      version: "1.0",
      image: "sprite-sheet.png",
      format: "RGBA8888",
      size: { w: built.canvas.width, h: built.canvas.height },
      scale: "1",
      frameCount: App.frames.length,
      columns: built.cols,
      rows: built.rows,
      spacing: built.gap,
    },
  };
}

function sheetTres() {
  const built = A.sheet;
  if (!built) return null;
  const n = App.frames.length;
  const subs = [];
  const framesArr = [];
  for (let i = 0; i < n; i++) {
    const col = i % built.cols, row = (i / built.cols) | 0;
    const x = built.gap + col * (built.cell + built.gap);
    const y = built.gap + row * (built.cell + built.gap);
    subs.push(
      `[sub_resource type="AtlasTexture" id="AtlasTexture_${i + 1}"]\n` +
      `atlas = ExtResource("1_sheet")\n` +
      `region = Rect2(${x}, ${y}, ${built.frameW}, ${built.frameH})\n`
    );
    framesArr.push(`{\n"duration": 1.0,\n"texture": SubResource("AtlasTexture_${i + 1}")\n}`);
  }
  const tres =
    `[gd_resource type="SpriteFrames" load_steps=${n + 2} format=3]\n\n` +
    `[ext_resource type="Texture2D" path="res://sprite-sheet.png" id="1_sheet"]\n\n` +
    subs.join("\n") + "\n\n[resource]\nanimations = [{\n" +
    `"frames": [${framesArr.join(", ")}],\n` +
    `"loop": true,\n"name": &"default",\n"speed": ${A.fps}\n` +
    `}]\n`;
  return tres;
}

/* ================= exports ================= */

function nameFor(i) {
  const prefix = (qs("#expPrefix").value.trim() || "frame").replace(/[^\w\-]/g, "") || "frame";
  return `${prefix}_${String(i + 1).padStart(3, "0")}`;
}

async function dlCurrent() {
  const f = App.frames[A.idx];
  if (!f) return;
  const fmt = qs("#expFmt").value;
  const q = +qs("#expQ").value / 100;
  const { ext, size } = await downloadCanvas(f.canvas, nameFor(A.idx) + (fmt === "webp" ? ".webp" : ".png"), fmt === "webp" ? "image/webp" : "image/png", q);
  toast(`فریم ${A.idx + 1} دانلود شد (${fmtBytes(size)})`, "ok");
}

async function dlAll() {
  const fmt = qs("#expFmt").value;
  const q = +qs("#expQ").value / 100;
  toast(`در حال دانلود ${App.frames.length} فایل...`, "info");
  let count = 0;
  for (let i = 0; i < App.frames.length; i++) {
    const { blob, type } = await canvasToBlob(App.frames[i].canvas, fmt === "webp" ? "image/webp" : "image/png", q);
    download(blob, nameFor(i) + (type === "image/webp" ? ".webp" : ".png"));
    count++;
    await new Promise(r => setTimeout(r, 170));
    if (i === 9) {
      toast("بقیه‌ی فایل‌ها در حال دانلود است — اگر مرورگر اجازه نداد از ZIP استفاده کنید", "info", 3600);
    }
  }
  toast(`${count} فایل دانلود شد`, "ok");
}

async function dlZip() {
  toast("در حال ساخت ZIP...", "info");
  const fmt = qs("#expFmt").value;
  const q = +qs("#expQ").value / 100;
  const files = [];
  for (let i = 0; i < App.frames.length; i++) {
    const { blob } = await canvasToBlob(App.frames[i].canvas, fmt === "webp" ? "image/webp" : "image/png", q);
    const ext = blob.type === "image/webp" ? "webp" : "png";
    files.push({ name: nameFor(i) + "." + ext, data: blob });
  }
  const zip = await makeZip(files);
  download(zip, "pixcut-frames.zip");
  toast(`${files.length} فایل در ZIP دانلود شد (${fmtBytes(zip.size)})`, "ok");
}

/* ================= wiring ================= */

export function initAnim() {
  document.addEventListener("app:frames-updated", checkFrames);

  qs("#btnPlay").addEventListener("click", () => setPlaying(!A.playing));
  qs("#btnPrev").addEventListener("click", () => { setPlaying(false); A.idx = (A.idx - 1 + App.frames.length) % Math.max(1, App.frames.length); renderFlip(); });
  qs("#btnNext").addEventListener("click", () => { setPlaying(false); A.idx = (A.idx + 1) % Math.max(1, App.frames.length); renderFlip(); });
  qs("#rgFps").addEventListener("input", e => {
    A.fps = +e.target.value;
    qs("#fpsVal").textContent = e.target.value;
  });

  qsa("#bgSeg .seg-btn").forEach(b => b.addEventListener("click", () => {
    qsa("#bgSeg .seg-btn").forEach(x => x.classList.remove("active"));
    b.classList.add("active");
    A.bg = b.dataset.bg;
    qs("#flipStage").classList.toggle("checker", A.bg === "checker");
    renderFlip();
  }));
  qs("#bgCustom").addEventListener("input", e => { A.customColor = e.target.value; if (A.bg === "custom") renderFlip(); });

  const sheetDeb = (() => { let t; return () => { clearTimeout(t); t = setTimeout(renderSheet, 120); }; })();
  qs("#rgCols").addEventListener("input", e => { A.cols = +e.target.value; qs("#rgColsV").textContent = e.target.value; sheetDeb(); });
  qs("#rgGap").addEventListener("input", e => { A.gap = +e.target.value; qs("#rgGapV").textContent = e.target.value; sheetDeb(); });
  qs("#rgScale").addEventListener("input", e => { A.scale = +e.target.value; qs("#rgScaleV").textContent = e.target.value; sheetDeb(); });

  qs("#btnSheetPng").addEventListener("click", async () => {
    if (!A.sheet) return;
    const { size } = await downloadCanvas(A.sheet.canvas, "sprite-sheet.png", "image/png");
    toast(`اسپرایت‌شیت PNG دانلود شد (${fmtBytes(size)})`, "ok");
  });
  qs("#btnSheetWebp").addEventListener("click", async () => {
    if (!A.sheet) return;
    const { ext, size } = await downloadCanvas(A.sheet.canvas, "sprite-sheet.webp", "image/webp", 0.95);
    toast(`اسپرایت‌شیت ${ext.toUpperCase()} دانلود شد (${fmtBytes(size)})`, "ok");
  });
  qs("#btnSheetJson").addEventListener("click", () => {
    const json = sheetJson();
    if (!json) return;
    download(new Blob([JSON.stringify(json, null, 2)], { type: "application/json" }), "sprite-sheet.json");
    toast("متادیتای Unity (فرمت TexturePacker) دانلود شد", "ok");
  });
  qs("#btnSheetTres").addEventListener("click", () => {
    const tres = sheetTres();
    if (!tres) return;
    download(new Blob([tres], { type: "text/plain" }), "sprite-frames.tres");
    toast("متادیتای Godot (.tres) دانلود شد", "ok");
  });

  qs("#expPrefix").addEventListener("input", () => { });
  qs("#expQ").addEventListener("input", e => { qs("#expQV").textContent = e.target.value; });
  qs("#btnDlCurrent").addEventListener("click", dlCurrent);
  qs("#btnDlAll").addEventListener("click", dlAll);
  qs("#btnDlZip").addEventListener("click", dlZip);

  new ResizeObserver(() => { if (App.frames.length) { renderFlip(); } }).observe(qs("#flipStage"));
}
