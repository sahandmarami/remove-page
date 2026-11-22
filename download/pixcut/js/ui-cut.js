/* ui-cut.js — module 1: interactive box canvas, detection, bg removal, cut + downloads */
import { qs, qsa, App, toast, download, downloadCanvas, canvasToBlob, clamp, fmtBytes, debounce, drawFit } from "./util.js";
import { detectObjects } from "./detect.js";
import { removeBackground } from "./bgremove.js";
import { makeZip } from "./zip.js";
import { openMaskEditor, closeMaskEditor, isMaskOpen } from "./mask.js";

const S = {
  img: null, result: null, isProcessed: false,
  boxes: [], selected: -1,
  tool: "select",
  view: { scale: 1, ox: 0, oy: 0 },
  pieces: [],
  drag: null,
  coarse: window.matchMedia?.("(pointer: coarse)").matches || false,
};

const stage = () => qs("#cutStage");
const cvBase = () => qs("#cvBase");
const cvOverlay = () => qs("#cvOverlay");

const HANDLE_R = () => (S.coarse ? 16 : 10);
const MIN_BOX = 12;

/* ================= view / rendering ================= */

function fitView() {
  const rect = stage().getBoundingClientRect();
  if (!S.img || rect.width < 4) return;
  const scale = Math.min(rect.width / S.img.width, rect.height / S.img.height);
  S.view = {
    scale,
    ox: (rect.width - S.img.width * scale) / 2,
    oy: (rect.height - S.img.height * scale) / 2,
  };
  updateZoomLabel();
  draw();
}

function resizeCanvases() {
  const rect = stage().getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  for (const cv of [cvBase(), cvOverlay()]) {
    cv.width = Math.max(2, Math.round(rect.width * dpr));
    cv.height = Math.max(2, Math.round(rect.height * dpr));
  }
  draw();
}

function updateZoomLabel() {
  qs("#zoomLabel").textContent = Math.round(S.view.scale * 100) + "%";
}

function draw() {
  const dpr = window.devicePixelRatio || 1;
  const v = S.view;
  // base
  const bctx = cvBase().getContext("2d");
  bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  bctx.clearRect(0, 0, cvBase().width, cvBase().height);
  const src = S.result || S.img;
  if (src) {
    bctx.imageSmoothingQuality = "high";
    bctx.drawImage(src, v.ox, v.oy, src.width * v.scale, src.height * v.scale);
  }
  // overlay
  const octx = cvOverlay().getContext("2d");
  octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  octx.clearRect(0, 0, cvOverlay().width, cvOverlay().height);
  const cssW = cvOverlay().width / dpr, cssH = cvOverlay().height / dpr;
  const purple = getComputedStyle(document.documentElement).getPropertyValue("--purple").trim() || "#7c3aed";
  const teal = getComputedStyle(document.documentElement).getPropertyValue("--teal").trim() || "#0d9488";

  S.boxes.forEach((b, i) => {
    const x = v.ox + b.x * v.scale, y = v.oy + b.y * v.scale;
    const w = b.w * v.scale, h = b.h * v.scale;
    const sel = i === S.selected;
    octx.lineWidth = sel ? 2.5 : 1.6;
    octx.strokeStyle = sel ? purple : teal;
    if (sel) { octx.shadowColor = purple; octx.shadowBlur = 10; }
    octx.strokeRect(x, y, w, h);
    octx.shadowBlur = 0;
    // index chip
    const label = String(i + 1);
    octx.font = "700 11px Vazirmatn, sans-serif";
    const tw = octx.measureText(label).width + 10;
    octx.fillStyle = sel ? purple : "rgba(20,30,55,.8)";
    roundRect(octx, x, y - 18, tw, 15, 5);
    octx.fill();
    octx.fillStyle = "#fff";
    octx.textBaseline = "middle";
    octx.fillText(label, x + 5, y - 10);
    // handles
    if (sel) {
      const hr = HANDLE_R() / 2;
      for (const [hx, hy] of handlePoints(x, y, w, h)) {
        octx.fillStyle = "#fff";
        octx.strokeStyle = purple;
        octx.lineWidth = 1.5;
        octx.beginPath();
        octx.rect(hx - hr, hy - hr, hr * 2, hr * 2);
        octx.fill(); octx.stroke();
      }
    }
  });

  // marquee draft
  if (S.drag?.mode === "draw" && S.drag.draft) {
    const d = S.drag.draft;
    const x = v.ox + d.x * v.scale, y = v.oy + d.y * v.scale;
    octx.setLineDash([6, 4]);
    octx.strokeStyle = purple;
    octx.lineWidth = 1.5;
    octx.strokeRect(x, y, d.w * v.scale, d.h * v.scale);
    octx.setLineDash([]);
  }
  void cssW; void cssH;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const HANDLE_OFFSETS = [
  ["nw", 0, 0], ["n", 0.5, 0], ["ne", 1, 0],
  ["e", 1, 0.5], ["se", 1, 1], ["s", 0.5, 1],
  ["sw", 0, 1], ["w", 0, 0.5],
];
function handlePoints(sx, sy, sw, sh) {
  return HANDLE_OFFSETS.map(([, fx, fy]) => [sx + sw * fx, sy + sh * fy]);
}

/* ================= hit testing ================= */

function toImage(e) {
  const rect = cvOverlay().getBoundingClientRect();
  const v = S.view;
  const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
  return { sx, sy, ix: (sx - v.ox) / v.scale, iy: (sy - v.oy) / v.scale };
}

function hitTest(sx, sy) {
  const v = S.view;
  // handles of selected box first
  if (S.selected >= 0) {
    const b = S.boxes[S.selected];
    const bx = v.ox + b.x * v.scale, by = v.oy + b.y * v.scale;
    const bw = b.w * v.scale, bh = b.h * v.scale;
    const names = HANDLE_OFFSETS.map(([n]) => n);
    const pts = handlePoints(bx, by, bw, bh);
    const R = HANDLE_R();
    for (let i = 0; i < pts.length; i++) {
      if (Math.abs(sx - pts[i][0]) <= R && Math.abs(sy - pts[i][1]) <= R) {
        return { kind: "handle", handle: names[i] };
      }
    }
  }
  for (let i = S.boxes.length - 1; i >= 0; i--) {
    const b = S.boxes[i];
    const bx = v.ox + b.x * v.scale, by = v.oy + b.y * v.scale;
    if (sx >= bx && sx <= bx + b.w * v.scale && sy >= by && sy <= by + b.h * v.scale) {
      return { kind: "box", index: i };
    }
  }
  return { kind: "empty" };
}

/* ================= pointer interaction ================= */

function onPointerDown(e) {
  if (!S.img) return;
  cvOverlay().setPointerCapture(e.pointerId);
  const { sx, sy, ix, iy } = toImage(e);

  if (S.tool === "pan" || e.button === 1) {
    S.drag = { mode: "pan", startSX: sx, startSY: sy, startOx: S.view.ox, startOy: S.view.oy };
    cvOverlay().classList.add("panning");
    return;
  }

  const hit = hitTest(sx, sy);
  if (hit.kind === "handle") {
    S.selected = S.selected; // keep
    S.drag = { mode: "resize", handle: hit.handle, origBox: { ...S.boxes[S.selected] } };
  } else if (hit.kind === "box") {
    S.selected = hit.index;
    S.drag = { mode: "move", origBox: { ...S.boxes[hit.index] }, startIX: ix, startIY: iy };
  } else {
    S.drag = { mode: "draw", startIX: ix, startIY: iy, draft: null };
    S.selected = -1;
  }
  draw();
  renderBoxList();
}

function onPointerMove(e) {
  if (!S.img) return;
  const { sx, sy, ix, iy } = toImage(e);
  const d = S.drag;
  if (!d) {
    // hover cursor
    const hit = hitTest(sx, sy);
    cvOverlay().style.cursor =
      hit.kind === "handle" ? "nwse-resize" :
      hit.kind === "box" ? "move" :
      S.tool === "pan" ? "grab" : "crosshair";
    return;
  }
  const iw = S.img.width, ih = S.img.height;

  if (d.mode === "pan") {
    S.view.ox = d.startOx + (sx - d.startSX);
    S.view.oy = d.startOy + (sy - d.startSY);
    draw();
    return;
  }
  if (d.mode === "draw") {
    const x1 = clamp(d.startIX, 0, iw), y1 = clamp(d.startIY, 0, ih);
    const x2 = clamp(ix, 0, iw), y2 = clamp(iy, 0, ih);
    d.draft = {
      x: Math.min(x1, x2), y: Math.min(y1, y2),
      w: Math.abs(x2 - x1), h: Math.abs(y2 - y1),
    };
    draw();
    return;
  }
  if (d.mode === "move") {
    const b = d.origBox;
    const nx = clamp(b.x + (ix - d.startIX), 0, iw - b.w);
    const ny = clamp(b.y + (iy - d.startIY), 0, ih - b.h);
    S.boxes[S.selected] = { ...b, x: nx, y: ny };
    draw();
    return;
  }
  if (d.mode === "resize") {
    const b = d.origBox;
    let L = b.x, T = b.y, R = b.x + b.w, B = b.y + b.h;
    const hnd = d.handle;
    if (hnd.includes("w")) L = clamp(ix, 0, R - MIN_BOX);
    if (hnd.includes("e")) R = clamp(ix, L + MIN_BOX, iw);
    if (hnd.includes("n")) T = clamp(iy, 0, B - MIN_BOX);
    if (hnd.includes("s")) B = clamp(iy, T + MIN_BOX, ih);
    S.boxes[S.selected] = { x: L, y: T, w: R - L, h: B - T };
    draw();
  }
}

function onPointerUp() {
  const d = S.drag;
  if (d?.mode === "pan") cvOverlay().classList.remove("panning");
  if (d?.mode === "draw") {
    const dr = d.draft;
    if (dr && dr.w >= MIN_BOX && dr.h >= MIN_BOX) {
      S.boxes.push({ x: Math.round(dr.x), y: Math.round(dr.y), w: Math.round(dr.w), h: Math.round(dr.h) });
      S.selected = S.boxes.length - 1;
      updateSteps(2);
    }
  }
  if (d && (d.mode === "move" || d.mode === "resize")) renderBoxList();
  S.drag = null;
  draw();
  updateCutButtons();
}

/* ================= zoom ================= */

function zoomAt(factor, cx, cy) {
  const v = S.view;
  const ns = clamp(v.scale * factor, fitScale() * 0.3, 12);
  v.ox = cx - ((cx - v.ox) * ns) / v.scale;
  v.oy = cy - ((cy - v.oy) * ns) / v.scale;
  v.scale = ns;
  updateZoomLabel();
  draw();
}

function fitScale() {
  const rect = stage().getBoundingClientRect();
  if (!S.img || rect.width < 4) return 1;
  return Math.min(rect.width / S.img.width, rect.height / S.img.height);
}

/* ================= box list ================= */

function renderBoxList() {
  const wrap = qs("#cutResults");
  wrap.innerHTML = "";
  qs("#cutCount").textContent = String(S.boxes.length);
  S.boxes.forEach((b, i) => {
    const item = document.createElement("div");
    item.className = "result-item";
    item.innerHTML = `
      <div class="result-thumb checker"></div>
      <div class="result-meta"><b>کادر ${i + 1}</b><span dir="ltr">${Math.round(b.w)}×${Math.round(b.h)}</span></div>
      <button class="icon-btn dl" type="button" title="دانلود این برش"><svg class="ic"><use href="#i-download"/></svg></button>
      <button class="icon-btn del" type="button" title="حذف کادر"><svg class="ic"><use href="#i-trash"/></svg></button>`;
    const thumb = item.querySelector(".result-thumb");
    const tc = document.createElement("canvas");
    const src = S.result || S.img;
    tc.width = 44; tc.height = 44;
    const tctx = tc.getContext("2d");
    const k = Math.min(44 / b.w, 44 / b.h);
    tctx.imageSmoothingQuality = "high";
    tctx.drawImage(src, b.x, b.y, b.w, b.h, (44 - b.w * k) / 2, (44 - b.h * k) / 2, b.w * k, b.h * k);
    thumb.appendChild(tc);
    item.querySelector(".dl").addEventListener("click", () => cutAndDownloadOne(i));
    item.querySelector(".del").addEventListener("click", () => {
      S.boxes.splice(i, 1);
      if (S.selected >= S.boxes.length) S.selected = S.boxes.length - 1;
      renderBoxList(); draw(); updateCutButtons();
    });
    item.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      S.selected = i; draw();
    });
    wrap.appendChild(item);
  });
}

function updateCutButtons() {
  qs("#btnCutAll").disabled = S.boxes.length === 0;
}

/* ================= steps ================= */

function updateSteps(n) {
  const steps = qsa("#cutSteps .step");
  steps.forEach((s, i) => s.classList.toggle("active", i < n));
}

/* ================= file loading ================= */

async function loadFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    toast("فقط فایل تصویری پذیرفته می‌شود", "err");
    return;
  }
  try {
    const bmp = await createImageBitmap(file);
    const MAX = 4096;
    const k = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close?.();
    setSource(c, file.name);
  } catch {
    toast("بارگذاری تصویر ناموفق بود", "err");
  }
}

function setSource(canvas, name) {
  S.img = canvas;
  S.result = canvas;
  S.isProcessed = false;
  S.boxes = [];
  S.selected = -1;
  S.pieces = [];
  qs("#cutEmpty").classList.add("hidden");
  qs("#cutWork").classList.remove("hidden");
  qs("#btnRestoreBg").classList.add("hidden");
  qs("#btnMaskEdit").disabled = true;
  renderBoxList();
  updateSteps(1);
  requestAnimationFrame(() => {
    resizeCanvases();
    fitView();
    autoDetect(true);
  });
  toast(`تصویر بارگذاری شد — ${canvas.width}×${canvas.height}`, "ok");
  void name;
}

/* ================= detection ================= */

function autoDetect(silent = false) {
  if (!S.img) return;
  const data = S.img.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, S.img.width, S.img.height);
  const boxes = detectObjects(data.data, S.img.width, S.img.height, { tolerance: 70 });
  S.boxes = boxes;
  S.selected = boxes.length ? 0 : -1;
  renderBoxList();
  draw();
  updateCutButtons();
  if (boxes.length) {
    updateSteps(2);
    if (!silent) toast(`${boxes.length} شیء شناسایی شد`, "ok");
  } else if (!silent) {
    toast("شیئی پیدا نشد — می‌توانید کادرها را دستی بکشید", "info");
  }
}

/* ================= bg removal ================= */

async function applyBgRemoval() {
  if (!S.img) return;
  const btn = qs("#btnRemoveBg");
  btn.disabled = true;
  btn.innerHTML = '<svg class="ic"><use href="#i-refresh"/></svg> در حال پردازش...';
  await new Promise(r => setTimeout(r, 30));
  try {
    const ctx = S.img.getContext("2d", { willReadFrequently: true });
    const imgData = ctx.getImageData(0, 0, S.img.width, S.img.height);
    const res = removeBackground(imgData.data, S.img.width, S.img.height, {
      tolerance: +qs("#rgTol").value,
      feather: +qs("#rgFeather").value,
      defringe: +qs("#rgDefringe").value,
      despill: +qs("#rgDespill").value,
      holes: true,
    });
    if (res.failed) {
      toast("پس‌زمینه‌ی یکدست شناسایی نشد — حساسیت را تنظیم کنید یا از ویرایشگر ماسک استفاده کنید", "err", 3600);
    } else {
      const c = document.createElement("canvas");
      c.width = S.img.width; c.height = S.img.height;
      c.getContext("2d").putImageData(imgData, 0, 0);
      S.result = c;
      S.isProcessed = true;
      qs("#btnRestoreBg").classList.remove("hidden");
      qs("#btnMaskEdit").disabled = false;
      qs("#btnRemoveBg").textContent ? null : null;
      qs("#btnRemoveBg").innerHTML = '<svg class="ic"><use href="#i-refresh"/></svg> اجرای مجدد';
      updateSteps(2);
      toast("پس‌زمینه حذف شد — برش‌ها حالا شفاف هستند", "ok");
    }
    renderBoxList();
    draw();
  } finally {
    btn.disabled = false;
  }
}

function restoreOriginal() {
  S.result = S.img;
  S.isProcessed = false;
  qs("#btnRestoreBg").classList.add("hidden");
  qs("#btnMaskEdit").disabled = true;
  qs("#btnRemoveBg").innerHTML = '<svg class="ic"><use href="#i-wand"/></svg> حذف پس‌زمینه';
  renderBoxList();
  draw();
  toast("تصویر اصلی بازگردانده شد", "info");
}

const reApplyDebounced = debounce(() => { if (S.isProcessed) applyBgRemoval(); }, 450);

/* ================= cutting ================= */

function cropBox(box) {
  const src = S.result || S.img;
  const c = document.createElement("canvas");
  c.width = Math.round(box.w); c.height = Math.round(box.h);
  c.getContext("2d").drawImage(src, box.x, box.y, box.w, box.h, 0, 0, c.width, c.height);
  return c;
}

function pieceName(i) {
  const prefix = (qs("#cutPrefix").value.trim() || "cut").replace(/[^\w\-]/g, "") || "cut";
  return `${prefix}_${String(i + 1).padStart(3, "0")}`;
}

async function cutAndDownloadOne(i) {
  const piece = cropBox(S.boxes[i]);
  const { ext, size } = await downloadCanvas(piece, pieceName(i) + ".webp", "image/webp", 0.95);
  toast(`کادر ${i + 1} دانلود شد (${fmtBytes(size)}, ${ext})`, "ok");
  updateSteps(3);
}

async function cutAll() {
  if (!S.boxes.length) return;
  const btn = qs("#btnCutAll");
  btn.disabled = true;
  try {
    S.pieces = S.boxes.map(cropBox);
    // give each piece a live preview refresh
    renderBoxList();
    updateSteps(3);
    qs("#btnZipCut").disabled = false;
    // auto-download each piece (browsers allow a few per gesture)
    for (let i = 0; i < S.pieces.length && i < 6; i++) {
      const { blob, ext } = await canvasToBlob(S.pieces[i], "image/webp", 0.95);
      download(blob, pieceName(i) + "." + (ext === "image/webp" ? "webp" : "png"));
      await new Promise(r => setTimeout(r, 180));
    }
    if (S.pieces.length > 6) {
      toast(`${S.pieces.length} برش آماده شد — ۶ فایل اول دانلود شد؛ بقیه را از لیست یا ZIP بگیرید`, "info", 4200);
    } else {
      toast(`${S.pieces.length} فایل برش‌خورده دانلود شد`, "ok");
    }
  } finally {
    btn.disabled = false;
  }
}

async function zipAll() {
  if (!S.pieces.length) return;
  toast("در حال ساخت ZIP...", "info");
  const files = [];
  for (let i = 0; i < S.pieces.length; i++) {
    const { blob } = await canvasToBlob(S.pieces[i], "image/webp", 0.95);
    files.push({ name: pieceName(i) + ".webp", data: blob });
  }
  const zipBlob = await makeZip(files);
  download(zipBlob, (qs("#cutPrefix").value.trim() || "cut") + "-cuts.zip");
  toast(`${files.length} فایل در ZIP دانلود شد`, "ok");
  updateSteps(3);
}

/* ================= demo image ================= */

function makeDemoImage() {
  const w = 880, h = 620;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  // smooth neutral gradient background (flood-fill friendly, objects far in color space)
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#e3e7ee");
  g.addColorStop(1, "#c9d1de");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // object 1: crimson card
  ctx.fillStyle = "#dc2626";
  roundRect(ctx, 90, 120, 250, 190, 26);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, 116, 146, 198, 44, 12);
  ctx.fill();
  // object 2: teal circle
  ctx.fillStyle = "#14b8a6";
  ctx.beginPath();
  ctx.arc(600, 400, 105, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#0f766e";
  ctx.beginPath();
  ctx.arc(600, 400, 62, 0, Math.PI * 2);
  ctx.fill();
  // object 3: amber star
  ctx.fillStyle = "#f59e0b";
  ctx.beginPath();
  const cx = 390, cy = 430, R = 78, r2 = 34;
  for (let i = 0; i < 10; i++) {
    const ang = -Math.PI / 2 + i * Math.PI / 5;
    const rr = i % 2 === 0 ? R : r2;
    const px2 = cx + Math.cos(ang) * rr, py2 = cy + Math.sin(ang) * rr;
    if (i === 0) ctx.moveTo(px2, py2); else ctx.lineTo(px2, py2);
  }
  ctx.closePath();
  ctx.fill();
  return c;
}

/* ================= wiring ================= */

export function initCut() {
  const dz = qs("#cutEmpty");
  const file = qs("#fileCut");

  dz.addEventListener("click", (e) => { if (e.target.closest("button#demoCut")) return; file.click(); });
  dz.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") file.click(); });
  ["dragover", "dragenter"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add("dragover"); }));
  ["dragleave", "drop"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove("dragover"); }));
  dz.addEventListener("drop", e => loadFile(e.dataTransfer.files?.[0]));
  file.addEventListener("change", e => loadFile(e.target.files?.[0]));
  qs("#demoCut").addEventListener("click", () => {
    setSource(makeDemoImage(), "demo");
  });

  qs("#btnDetect").addEventListener("click", () => autoDetect());
  qs("#btnClearBoxes").addEventListener("click", () => {
    S.boxes = []; S.selected = -1;
    renderBoxList(); draw(); updateCutButtons();
  });
  qs("#btnZoomIn").addEventListener("click", () => {
    const rect = stage().getBoundingClientRect();
    zoomAt(1.25, rect.width / 2, rect.height / 2);
  });
  qs("#btnZoomOut").addEventListener("click", () => {
    const rect = stage().getBoundingClientRect();
    zoomAt(0.8, rect.width / 2, rect.height / 2);
  });
  qs("#btnZoomFit").addEventListener("click", fitView);
  qs("#toolSelect").addEventListener("click", () => setTool("select"));
  qs("#toolPan").addEventListener("click", () => setTool("pan"));

  cvOverlay().addEventListener("pointerdown", onPointerDown);
  cvOverlay().addEventListener("pointermove", onPointerMove);
  cvOverlay().addEventListener("pointerup", onPointerUp);
  cvOverlay().addEventListener("pointercancel", onPointerUp);
  cvOverlay().addEventListener("wheel", e => {
    if (!S.img) return;
    e.preventDefault();
    const rect = cvOverlay().getBoundingClientRect();
    zoomAt(e.deltaY < 0 ? 1.12 : 0.9, e.clientX - rect.left, e.clientY - rect.top);
  }, { passive: false });
  window.addEventListener("keydown", e => {
    if (isMaskOpen()) return;
    if (e.key === "Delete" && S.selected >= 0 && !e.target.closest("input")) {
      S.boxes.splice(S.selected, 1);
      S.selected = -1;
      renderBoxList(); draw(); updateCutButtons();
    }
  });

  qs("#btnRemoveBg").addEventListener("click", applyBgRemoval);
  qs("#btnRestoreBg").addEventListener("click", restoreOriginal);
  qs("#btnMaskEdit").addEventListener("click", () => {
    if (!S.isProcessed) return;
    openMaskEditor(S.result, (canvas) => {
      S.result = canvas;
      renderBoxList();
      draw();
      toast("ماسک اعمال شد", "ok");
    });
  });
  for (const [id, key] of [["#rgTol", "rgTolV"], ["#rgFeather", "rgFeatherV"], ["#rgDefringe", "rgDefringeV"], ["#rgDespill", "rgDespillV"]]) {
    qs(id).addEventListener("input", e => {
      qs("#" + key).textContent = e.target.value;
      reApplyDebounced();
    });
  }

  qs("#btnCutAll").addEventListener("click", cutAll);
  qs("#btnZipCut").addEventListener("click", zipAll);
  qs("#cutPrefix").addEventListener("input", () => { /* naming only */ });

  new ResizeObserver(resizeCanvases).observe(stage());
}

function setTool(t) {
  S.tool = t;
  qs("#toolSelect").classList.toggle("active", t === "select");
  qs("#toolPan").classList.toggle("active", t === "pan");
  cvOverlay().classList.toggle("pan", t === "pan");
}

export function cutState() { return S; }
