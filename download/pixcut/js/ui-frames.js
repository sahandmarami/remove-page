/* ui-frames.js — module 2: video/GIF frame extraction + live chroma key + one-click tests */
import { qs, qsa, App, toast, openModal, closeModal, download, canvasToBlob, drawFit, clamp, fmtBytes } from "./util.js";
import { decodeGIF, renderGIF, encodeGIF } from "./gif.js";
import { chromaKey } from "./bgremove.js";

const F = {
  type: null,            // 'gif' | 'video'
  file: null,
  fileName: "",
  frames: [],            // [{canvas, delay}]
  current: 0,
  key: { r: 0, g: 180, b: 80 },
  picking: false,
  keyedCache: new Map(), // paramsKey -> [canvas]
};

const paramsKey = () => {
  const s = +qs("#rgSens").value, o = +qs("#rgSoft").value, d = +qs("#rgDespill2").value;
  const k = `${F.key.r},${F.key.g},${F.key.b}|${s}|${o}|${d}`;
  return k;
};

function keyedFrames() {
  const k = paramsKey();
  if (!F.keyedCache.has(k)) {
    const arr = F.frames.map(f => {
      const c = document.createElement("canvas");
      c.width = f.canvas.width; c.height = f.canvas.height;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(f.canvas, 0, 0);
      const img = ctx.getImageData(0, 0, c.width, c.height);
      chromaKey(img.data, c.width, c.height, {
        key: F.key,
        sensitivity: +qs("#rgSens").value,
        softness: +qs("#rgSoft").value,
        despill: +qs("#rgDespill2").value,
      });
      ctx.putImageData(img, 0, 0);
      return { canvas: c, delay: f.delay };
    });
    F.keyedCache.set(k, arr);
  }
  return F.keyedCache.get(k);
}

const rekeyDebounced = debounceRender();
function debounceRender() {
  let t = null;
  return () => {
    clearTimeout(t);
    t = setTimeout(() => {
      if (F.frames.length) { renderStrip(); renderPreview(); }
    }, 160);
  };
}

/* ================= loading ================= */

async function loadFile(file) {
  if (!file) return;
  F.file = file;
  await runExtract(file);
}

/** uniform sampling over decoded gif frames for 8/12/16 modes */
function selectGifFrames(frames, count) {
  if (count === "all" || frames.length <= count) return frames;
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push(frames[Math.round(i * (frames.length - 1) / (count - 1))]);
  }
  return out;
}

async function runExtract(file) {
  const isGif = file.type === "image/gif" || /\.gif$/i.test(file.name);
  const isVideo = file.type.startsWith("video/");
  if (!isGif && !isVideo) {
    toast("فقط ویدیو (MP4/WebM/MOV) یا GIF پذیرفته می‌شود", "err");
    return;
  }
  F.fileName = file.name;
  F.frames = [];
  F.current = 0;
  F.keyedCache.clear();
  qs("#btnExtract").disabled = true;
  showProgress(0);
  try {
    if (isGif) {
      F.type = "gif";
      qs("#srcBadge").textContent = "GIF";
      qs("#segAll").classList.remove("hidden");
      const parsed = decodeGIF(await file.arrayBuffer());
      const rendered = renderGIF(parsed);
      F.frames = selectGifFrames(rendered.frames, getCount());
      showProgress(1);
      toast(`${F.frames.length} فریم از GIF دیکد شد`, "ok");
    } else {
      F.type = "video";
      qs("#srcBadge").textContent = file.type.replace("video/", "").toUpperCase() || "VIDEO";
      qs("#segAll").classList.add("hidden");
      const count = getCount();
      F.frames = await extractVideoFrames(file, count, p => showProgress(p));
    }
    afterExtract();
  } catch (err) {
    console.error(err);
    toast(err?.message || "پردازش فایل ناموفق بود — کدک ممکن است پشتیبانی نشود", "err", 4200);
    hideProgress();
  } finally {
    qs("#btnExtract").disabled = false;
  }
}

async function extractVideoFrames(file, count, onProgress) {
  const url = URL.createObjectURL(file);
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  v.preload = "auto";
  v.src = url;
  await new Promise((res, rej) => {
    v.onloadedmetadata = () => res();
    v.onerror = () => rej(new Error("کدک ویدیو در این مرورگر پشتیبانی نمی‌شود (برای MOV از H.264 استفاده کنید)"));
  });
  let dur = v.duration;
  if (!isFinite(dur)) {
    v.currentTime = 1e7;
    await new Promise(res => { v.ondurationchange = () => { if (isFinite(v.duration)) res(); }; setTimeout(res, 2500); });
    dur = isFinite(v.duration) ? v.duration : 0;
  }
  try { await v.play(); } catch { /* autoplay policies */ }
  v.pause();

  const MAX_SIDE = 800;
  const k = Math.min(1, MAX_SIDE / Math.max(v.videoWidth, v.videoHeight));
  const W = Math.max(2, Math.round(v.videoWidth * k));
  const H = Math.max(2, Math.round(v.videoHeight * k));
  const frames = [];

  for (let i = 0; i < count; i++) {
    const t = dur * (i + 0.5) / count;
    await seekTo(v, t);
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    c.getContext("2d").drawImage(v, 0, 0, W, H);
    frames.push({ canvas: c, delay: 90 });
    onProgress((i + 1) / count);
    await new Promise(r => requestAnimationFrame(r));
  }
  URL.revokeObjectURL(url);
  return frames;
}

function seekTo(v, t) {
  return new Promise(res => {
    let done = false;
    const finish = () => { if (!done) { done = true; v.removeEventListener("seeked", finish); res(); } };
    v.addEventListener("seeked", finish);
    v.currentTime = t;
    setTimeout(finish, 2200);
  });
}

function getCount() {
  const active = qs("#countSeg .seg-btn.active");
  const v = active?.dataset.count || "8";
  return v === "all" ? "all" : +v;
}

function afterExtract() {
  hideProgress();
  qs("#framesEmpty").classList.add("hidden");
  qs("#framesWork").classList.remove("hidden");
  qs("#frameCount").textContent = String(F.frames.length);
  renderStrip();
  renderPreview();
}

function showProgress(p) {
  qs("#extractWrap").classList.remove("hidden");
  qs("#extractBar").style.width = Math.round(p * 100) + "%";
  qs("#extractPct").textContent = Math.round(p * 100) + "%";
}
function hideProgress() {
  setTimeout(() => qs("#extractWrap").classList.add("hidden"), 350);
}

/* ================= strip + preview ================= */

function renderStrip() {
  const strip = qs("#framesStrip");
  strip.innerHTML = "";
  const list = F.frames;
  list.forEach((f, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "thumb" + (i === F.current ? " active" : "");
    const c = document.createElement("canvas");
    c.width = 104; c.height = 104;
    drawFit(c.getContext("2d"), f.canvas, 104, 104, null);
    const idx = document.createElement("span");
    idx.className = "idx";
    idx.textContent = String(i + 1);
    b.appendChild(c); b.appendChild(idx);
    b.addEventListener("click", () => { F.current = i; renderStrip(); renderPreview(); });
    strip.appendChild(b);
  });
}

function renderPreview() {
  const cv = qs("#keyPreview");
  const src = (F.frames.length && keyedFrames()[Math.min(F.current, F.frames.length - 1)]?.canvas) || null;
  if (!src) return;
  const maxW = Math.min(560, src.width);
  const k = maxW / src.width;
  cv.width = Math.round(src.width * k);
  cv.height = Math.round(src.height * k);
  cv.style.width = cv.width + "px";
  cv.style.height = cv.height + "px";
  cv.getContext("2d").drawImage(src, 0, 0, cv.width, cv.height);
}

/* ================= chroma key controls ================= */

function setKey(color) {
  F.key = color;
  qsa(".swatch").forEach(s => s.classList.remove("active"));
  rekeyDebounced();
}

/* ================= tests ================= */

function showTest(title, nodes, downloadName, blob) {
  qs("#testTitle").textContent = title;
  const body = qs("#testBody");
  body.innerHTML = "";
  for (const n of nodes) body.appendChild(n);
  const dl = qs("#btnTestDownload");
  if (blob) {
    dl.classList.remove("hidden");
    dl.onclick = () => download(blob, downloadName);
  } else {
    dl.classList.add("hidden");
  }
  openModal("#testModal");
}

async function testSpriteSheet() {
  if (!F.frames.length) return;
  const keyed = keyedFrames();
  const n = Math.min(keyed.length, 16);
  const cols = Math.min(4, n);
  const cell = Math.max(...keyed.slice(0, n).map(f => Math.max(f.canvas.width, f.canvas.height)));
  const rows = Math.ceil(n / cols);
  const sheet = document.createElement("canvas");
  sheet.width = cols * cell; sheet.height = rows * cell;
  const ctx = sheet.getContext("2d");
  keyed.slice(0, n).forEach((f, i) => {
    const x = (i % cols) * cell, y = ((i / cols) | 0) * cell;
    ctx.drawImage(f.canvas, x + (cell - f.canvas.width) / 2, y + (cell - f.canvas.height) / 2);
  });
  const view = document.createElement("canvas");
  const kk = Math.min(1, 560 / sheet.width);
  view.width = Math.round(sheet.width * kk);
  view.height = Math.round(sheet.height * kk);
  view.style.width = view.width + "px";
  view.getContext("2d").drawImage(sheet, 0, 0, view.width, view.height);
  const { blob } = await canvasToBlob(sheet, "image/png");
  showTest("تست اسپرایت‌شیت (Canvas)", [view], "sprite-sheet.png", blob);
}

async function testVideo() {
  if (!F.frames.length) {
    // no source? generate a synthetic green-screen animation from scratch
    F.frames = makeSyntheticGreenFrames(10);
    F.type = "video";
    afterExtract();
  }
  const keyed = keyedFrames();
  const w = keyed[0].canvas.width, h = keyed[0].canvas.height;
  const recCanvas = document.createElement("canvas");
  recCanvas.width = w; recCanvas.height = h;
  const rctx = recCanvas.getContext("2d");
  const stream = recCanvas.captureStream(30);
  const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"]
    .find(m => window.MediaRecorder?.isTypeSupported?.(m)) || "";
  if (!window.MediaRecorder || (!mime && !MediaRecorder.isTypeSupported)) {
    toast("MediaRecorder در این مرورگر پشتیبانی نمی‌شود", "err");
    return;
  }
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise(res => { rec.onstop = res; });
  rec.start(100);
  const loops = 3, fps = 10;
  const total = keyed.length * loops;
  for (let i = 0; i < total; i++) {
    rctx.drawImage(keyed[i % keyed.length].canvas, 0, 0);
    await new Promise(r => setTimeout(r, 1000 / fps));
  }
  rec.stop();
  await done;
  const blob = new Blob(chunks, { type: mime || "video/webm" });
  const video = document.createElement("video");
  video.src = URL.createObjectURL(blob);
  video.controls = true;
  video.loop = true;
  video.style.maxWidth = "100%";
  video.style.maxHeight = "50dvh";
  showTest("تست ویدیوی شفاف (MediaRecorder)", [video], "green-test." + (mime.includes("mp4") ? "mp4" : "webm"), blob);
}

function makeSyntheticGreenFrames(n) {
  const frames = [];
  for (let i = 0; i < n; i++) {
    const c = document.createElement("canvas");
    c.width = 320; c.height = 240;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#00b140";
    ctx.fillRect(0, 0, c.width, c.height);
    const x = 40 + i * ((c.width - 100) / (n - 1));
    const y = 120 + Math.sin(i / n * Math.PI * 2) * 50;
    ctx.fillStyle = "#8b5cf6";
    ctx.beginPath();
    ctx.arc(x, y, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(x - 10, y - 10, 10, 0, Math.PI * 2);
    ctx.fill();
    frames.push({ canvas: c, delay: 100 });
  }
  return frames;
}

async function testGif() {
  if (!F.frames.length) {
    F.frames = makeSyntheticGreenFrames(10);
    F.type = "video";
    afterExtract();
  }
  toast("در حال ساخت GIF...", "info");
  await new Promise(r => setTimeout(r, 40));
  const keyed = keyedFrames().slice(0, 24);
  const w = keyed[0].canvas.width, h = keyed[0].canvas.height;
  const gifFrames = keyed.map(f => {
    const ctx = f.canvas.getContext("2d");
    return { data: ctx.getImageData(0, 0, w, h).data, width: w, height: h, delay: f.delay };
  });
  const buf = encodeGIF(gifFrames, { transparent: true });
  const blob = new Blob([buf], { type: "image/gif" });
  const img = document.createElement("img");
  img.src = URL.createObjectURL(blob);
  img.style.maxWidth = "100%";
  img.style.maxHeight = "50dvh";
  showTest("تست GIF شفاف", [img], "transparent-test.gif", blob);
  toast(`GIF ساخته شد (${fmtBytes(blob.size)})`, "ok");
}

/* ================= demo gif ================= */

async function makeDemoGifFile() {
  // 8 frames: purple ball bouncing on green screen
  const n = 8, w = 240, h = 240;
  const frames = [];
  for (let i = 0; i < n; i++) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#00b140";
    ctx.fillRect(0, 0, w, h);
    const x = w / 2 + Math.cos(i / n * Math.PI * 2) * 60;
    const y = h / 2 + Math.sin(i / n * Math.PI * 4) * 55;
    ctx.fillStyle = "#a855f7";
    ctx.beginPath();
    ctx.arc(x, y, 36, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fde047";
    ctx.beginPath();
    ctx.arc(x + 12, y - 12, 12, 0, Math.PI * 2);
    ctx.fill();
    const { blob } = await canvasToBlob(c, "image/png");
    const bmp = await createImageBitmap(blob);
    const fc = document.createElement("canvas");
    fc.width = w; fc.height = h;
    fc.getContext("2d").drawImage(bmp, 0, 0);
    frames.push({ data: fc.getContext("2d").getImageData(0, 0, w, h).data, width: w, height: h, delay: 90 });
  }
  const buf = encodeGIF(frames, { transparent: false });
  return new File([buf], "demo-chroma.gif", { type: "image/gif" });
}

/* ================= wiring ================= */

export function initFrames() {
  const dz = qs("#dropFrames");
  const file = qs("#fileFrames");

  dz.addEventListener("click", (e) => { if (e.target.closest("button#demoGif")) return; file.click(); });
  dz.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") file.click(); });
  ["dragover", "dragenter"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add("dragover"); }));
  ["dragleave", "drop"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove("dragover"); }));
  dz.addEventListener("drop", e => loadFile(e.dataTransfer.files?.[0]));
  file.addEventListener("change", e => loadFile(e.target.files?.[0]));
  qs("#btnChangeSrc").addEventListener("click", () => file.click());

  qs("#demoGif").addEventListener("click", async () => {
    toast("در حال ساخت GIF نمونه...", "info");
    const f = await makeDemoGifFile();
    loadFile(f);
  });

  qsa("#countSeg .seg-btn").forEach(b => b.addEventListener("click", () => {
    qsa("#countSeg .seg-btn").forEach(x => x.classList.remove("active"));
    b.classList.add("active");
  }));

  qs("#btnExtract").addEventListener("click", async () => {
    if (!F.file) { toast("اول یک فایل بارگذاری کنید", "info"); return; }
    await runExtract(F.file);
  });

  // key presets
  qsa(".swatch").forEach(sw => {
    sw.addEventListener("click", () => {
      setKey(hexToRgb(sw.dataset.key));
      sw.classList.add("active");
    });
  });
  qs("#btnPick").addEventListener("click", () => {
    F.picking = !F.picking;
    qs("#btnPick").classList.toggle("active", F.picking);
    qs("#keyPreview").style.cursor = F.picking ? "crosshair" : "default";
    if (F.picking) toast("روی پیش‌نمایش کلیک کنید تا رنگ کلید گرفته شود", "info", 2400);
  });
  qs("#keyPreview").addEventListener("click", e => {
    if (!F.picking || !F.frames.length) return;
    const cv = qs("#keyPreview");
    const rect = cv.getBoundingClientRect();
    const x = clamp(Math.round((e.clientX - rect.left) / rect.width * cv.width), 0, cv.width - 1);
    const y = clamp(Math.round((e.clientY - rect.top) / rect.height * cv.height), 0, cv.height - 1);
    // sample from ORIGINAL frame (scaled mapping)
    const srcF = F.frames[Math.min(F.current, F.frames.length - 1)].canvas;
    const kx = Math.round(x / cv.width * srcF.width);
    const ky = Math.round(y / cv.height * srcF.height);
    const d = srcF.getContext("2d").getImageData(kx, ky, 1, 1).data;
    F.key = { r: d[0], g: d[1], b: d[2] };
    F.picking = false;
    qs("#btnPick").classList.remove("active");
    qsa(".swatch").forEach(s => s.classList.remove("active"));
    rekeyDebounced();
    toast("رنگ کلید از تصویر گرفته شد", "ok", 1600);
  });
  for (const [id, key] of [["#rgSens", "rgSensV"], ["#rgSoft", "rgSoftV"], ["#rgDespill2", "rgDespill2V"]]) {
    qs(id).addEventListener("input", e => {
      qs("#" + key).textContent = e.target.value;
      rekeyDebounced();
    });
  }

  qs("#btnSendStudio").addEventListener("click", () => {
    if (!F.frames.length) { toast("اول فریم استخراج کنید", "info"); return; }
    App.frames = keyedFrames().map(f => ({ canvas: f.canvas, delay: f.delay, name: "frame" }));
    document.dispatchEvent(new CustomEvent("app:frames-updated"));
    toast(`${App.frames.length} فریم شفاف به استودیو انیمیشن ارسال شد`, "ok");
    document.dispatchEvent(new CustomEvent("app:goto", { detail: "anim" }));
  });

  qs("#btnTestSheet").addEventListener("click", testSpriteSheet);
  qs("#btnTestVideo").addEventListener("click", testVideo);
  qs("#btnTestGif").addEventListener("click", testGif);
}

function hexToRgb(hex) {
  const v = parseInt(hex.replace("#", ""), 16);
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}

export function framesState() { return F; }
