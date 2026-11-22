/* mask.js — manual mask editor modal: eraser / restore / magic wand / pipette + undo-redo */
import { qs, qsa, openModal, closeModal, toast, clamp } from "./util.js";
import { floodSelect } from "./bgremove.js";

let state = null; // {canvas, ctx, orig, view:{scale,ox,oy}, tool, size, tol, undo:[], redo:[], pickColor}

export function openMaskEditor(sourceCanvas, onApply) {
  const modal = qs("#maskModal");
  const stage = qs("#maskCanvas").parentElement;

  // working canvas at native resolution
  const work = document.createElement("canvas");
  work.width = sourceCanvas.width;
  work.height = sourceCanvas.height;
  const ctx = work.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(sourceCanvas, 0, 0);

  const orig = document.createElement("canvas");
  orig.width = work.width; orig.height = work.height;
  orig.getContext("2d").drawImage(work, 0, 0);

  state = {
    canvas: work, ctx, orig,
    tool: "eraser", size: 20, tol: 35,
    undo: [], redo: [], pickColor: null,
    onApply, painting: false, lastX: 0, lastY: 0,
  };

  qsa("#maskToolSeg .seg-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.mtool === "eraser");
  });
  qs("#rgMaskSize").value = 20; qs("#rgMaskSizeV").textContent = "20";
  qs("#rgMaskTol").value = 35; qs("#rgMaskTolV").textContent = "35";
  qs("#maskTolWrap").style.visibility = "visible";
  updateColorChip(null);
  updateUndoButtons();

  // canvas element sizing to stage
  const cv = qs("#maskCanvas");
  const resize = () => {
    const rect = stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(rect.width * dpr);
    cv.height = Math.round(rect.height * dpr);
    fitView();
    render();
  };
  state.resize = resize;
  resize();
  if (!state.ro) state.ro = new ResizeObserver(() => state.resize?.());
  state.ro.disconnect();
  state.ro.observe(stage);

  openModal("#maskModal");
}

function fitView() {
  const cv = qs("#maskCanvas");
  const dpr = window.devicePixelRatio || 1;
  const W = cv.width / dpr, H = cv.height / dpr;
  const { canvas } = state;
  const scale = Math.min(W / canvas.width, H / canvas.height, 1.5);
  state.view = {
    scale,
    ox: (W - canvas.width * scale) / 2,
    oy: (H - canvas.height * scale) / 2,
    W, H, dpr,
  };
}

function render() {
  const cv = qs("#maskCanvas");
  const ctx = cv.getContext("2d");
  const v = state.view;
  ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
  ctx.clearRect(0, 0, v.W, v.H);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(state.canvas, v.ox, v.oy, state.canvas.width * v.scale, state.canvas.height * v.scale);
}

function pushUndo() {
  state.undo.push(state.ctx.getImageData(0, 0, state.canvas.width, state.canvas.height));
  if (state.undo.length > 16) state.undo.shift();
  state.redo = [];
  updateUndoButtons();
}

function updateUndoButtons() {
  qs("#btnMaskUndo").disabled = !state || state.undo.length === 0;
  qs("#btnMaskRedo").disabled = !state || state.redo.length === 0;
}

function updateColorChip(c) {
  const chip = qs("#maskColor");
  if (c) {
    chip.style.background = `rgb(${c.r},${c.g},${c.b})`;
    chip.style.borderColor = "var(--purple)";
  } else {
    chip.style.background = "transparent";
    chip.style.borderColor = "var(--border-strong)";
  }
}

function toImageCoords(e) {
  const cv = qs("#maskCanvas");
  const rect = cv.getBoundingClientRect();
  const v = state.view;
  const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
  return { x: (sx - v.ox) / v.scale, y: (sy - v.oy) / v.scale };
}

function stampBrush(x, y) {
  const { ctx, tool, size } = state;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, size / 2, 0, Math.PI * 2);
  if (tool === "eraser") {
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "#000";
    ctx.fill();
  } else if (tool === "restore") {
    // restore original pixels inside brush circle
    ctx.clip();
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(state.orig, 0, 0);
  }
  ctx.restore();
}

function strokeTo(x0, y0, x1, y1) {
  const d = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(d / (state.size * 0.3)));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    stampBrush(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
  }
}

function applyWand(x, y) {
  const { canvas, tol } = state;
  const ix = clamp(Math.round(x), 0, canvas.width - 1);
  const iy = clamp(Math.round(y), 0, canvas.height - 1);
  const imgData = state.ctx.getImageData(0, 0, canvas.width, canvas.height);
  const mask = floodSelect(imgData.data, canvas.width, canvas.height, ix, iy, tol);
  // transparent the selected region
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) imgData.data[i * 4 + 3] = 0;
  }
  state.ctx.putImageData(imgData, 0, 0);
}

function pickColor(x, y) {
  const { canvas } = state;
  const ix = clamp(Math.round(x), 0, canvas.width - 1);
  const iy = clamp(Math.round(y), 0, canvas.height - 1);
  const d = state.ctx.getImageData(ix, iy, 1, 1).data;
  state.pickColor = { r: d[0], g: d[1], b: d[2] };
  updateColorChip(state.pickColor);
  toast("رنگ مرجع چوب جادویی ثبت شد", "ok", 1600);
}

/* ---------- pointer events ---------- */
qs("#maskCanvas").addEventListener("pointerdown", e => {
  if (!state) return;
  const { x, y } = toImageCoords(e);
  e.currentTarget.setPointerCapture(e.pointerId);
  if (state.tool === "wand") {
    pushUndo();
    applyWand(x, y);
    render();
    return;
  }
  if (state.tool === "pipette") {
    pickColor(x, y);
    return;
  }
  pushUndo();
  state.painting = true;
  state.lastX = x; state.lastY = y;
  stampBrush(x, y);
  render();
});
qs("#maskCanvas").addEventListener("pointermove", e => {
  if (!state?.painting) return;
  const { x, y } = toImageCoords(e);
  strokeTo(state.lastX, state.lastY, x, y);
  state.lastX = x; state.lastY = y;
  render();
});
window.addEventListener("pointerup", () => { if (state) state.painting = false; });

/* ---------- tool UI ---------- */
function guard(fn) { return (...a) => { if (state) fn(...a); }; }

qsa("#maskToolSeg .seg-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    qsa("#maskToolSeg .seg-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    if (!state) return;
    state.tool = btn.dataset.mtool;
    const cv = qs("#maskCanvas");
    cv.classList.toggle("pick", state.tool === "pipette");
  });
});
qs("#rgMaskSize").addEventListener("input", guard(e => {
  state.size = +e.target.value;
  qs("#rgMaskSizeV").textContent = e.target.value;
}));
qs("#rgMaskTol").addEventListener("input", guard(e => {
  state.tol = +e.target.value;
  qs("#rgMaskTolV").textContent = e.target.value;
}));
qs("#btnMaskUndo").addEventListener("click", guard(() => {
  if (!state.undo.length) return;
  state.redo.push(state.ctx.getImageData(0, 0, state.canvas.width, state.canvas.height));
  state.ctx.putImageData(state.undo.pop(), 0, 0);
  updateUndoButtons();
  render();
}));
qs("#btnMaskRedo").addEventListener("click", guard(() => {
  if (!state.redo.length) return;
  state.undo.push(state.ctx.getImageData(0, 0, state.canvas.width, state.canvas.height));
  state.ctx.putImageData(state.redo.pop(), 0, 0);
  updateUndoButtons();
  render();
}));

/* ---------- apply / cancel ---------- */
export function applyMask() {
  if (!state) return;
  const out = document.createElement("canvas");
  out.width = state.canvas.width;
  out.height = state.canvas.height;
  out.getContext("2d").drawImage(state.canvas, 0, 0);
  const onApply = state.onApply;
  closeMaskEditor();
  onApply?.(out);
}

qs("#btnMaskApply").addEventListener("click", applyMask);
qs("#btnMaskCancel").addEventListener("click", closeMaskEditor);
qs("#btnMaskClose").addEventListener("click", closeMaskEditor);

export function closeMaskEditor() {
  closeModal("#maskModal");
  state = null;
}

export function isMaskOpen() {
  return qs("#maskModal").classList.contains("open");
}
