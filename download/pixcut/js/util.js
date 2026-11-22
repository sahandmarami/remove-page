/* util.js — helpers, theme, toast, downloads */
export const App = { frames: [], version: "1.0.0" };

export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));
export const tick = () => new Promise(r => setTimeout(r, 0));

export function debounce(fn, ms) {
  let t = null;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function fmtBytes(n) {
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
  return (n / 1048576).toFixed(2) + " MB";
}

export function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("");
}

export function hexToRgb(hex) {
  const m = hex.replace("#", "");
  const v = parseInt(m.length === 3 ? m.split("").map(c => c + c).join("") : m, 16);
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}

/* ---------- toast ---------- */
export function toast(msg, type = "info", ms = 2600) {
  const wrap = qs("#toasts");
  const el = document.createElement("div");
  el.className = "toast " + type;
  const ic = type === "ok" ? "check" : type === "err" ? "x" : "sparkles";
  el.innerHTML = `<svg class="ic"><use href="#i-${ic}"/></svg><span></span>`;
  el.querySelector("span").textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 320); }, ms);
}

/* ---------- theme ---------- */
const THEME_KEY = "pixcut-theme";
export function initTheme() {
  let t = null;
  try { t = localStorage.getItem(THEME_KEY); } catch { /* ignore */ }
  if (!t) t = window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
  applyTheme(t);
  qs("#btnTheme").addEventListener("click", toggleTheme);
}
export function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  const meta = qs('meta[name="theme-color"]');
  if (meta) meta.content = t === "dark" ? "#070a13" : "#f4f6fb";
  const use = qs("#btnTheme use");
  if (use) use.setAttribute("href", t === "dark" ? "#i-sun" : "#i-moon");
}
export function toggleTheme() {
  const t = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(t);
  try { localStorage.setItem(THEME_KEY, t); } catch { /* ignore */ }
}

/* ---------- modals ---------- */
export function openModal(sel) { qs(sel).classList.add("open"); qs(sel).setAttribute("aria-hidden", "false"); }
export function closeModal(sel) { qs(sel).classList.remove("open"); qs(sel).setAttribute("aria-hidden", "true"); }
export function wireModal(sel, onClose) {
  const bd = qs(sel);
  bd.addEventListener("click", e => { if (e.target === bd) { closeModal(sel); onClose?.(); } });
  bd.addEventListener("keydown", e => { if (e.key === "Escape") { closeModal(sel); onClose?.(); } });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && bd.classList.contains("open")) { closeModal(sel); onClose?.(); }
  });
}

/* ---------- downloads ---------- */
export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function canvasToBlob(canvas, type = "image/webp", q = 0.95) {
  return new Promise(resolve => {
    canvas.toBlob(b => {
      if (b && type === "image/webp" && b.type !== "image/webp") {
        // webp not supported → fallback png
        canvas.toBlob(pb => resolve({ blob: pb, type: "image/png" }), "image/png");
      } else {
        resolve({ blob: b, type: b ? b.type : "image/png" });
      }
    }, type, q);
  });
}

export async function downloadCanvas(canvas, name, type = "image/webp", q = 0.95) {
  const { blob, type: actual } = await canvasToBlob(canvas, type, q);
  const ext = actual === "image/webp" ? "webp" : "png";
  download(blob, name.replace(/\.(webp|png)$/i, "") + "." + ext);
  return { blob, ext, size: blob.size };
}

/* ---------- fit-draw helper ---------- */
export function drawFit(ctx, src, W, H, bg) {
  ctx.clearRect(0, 0, W, H);
  if (bg === "checker") {
    const s = 16;
    for (let y = 0; y < H; y += s) for (let x = 0; x < W; x += s) {
      ctx.fillStyle = ((x / s + y / s) & 1) ? "rgba(148,163,184,.28)" : "rgba(148,163,184,.12)";
      ctx.fillRect(x, y, s, s);
    }
  } else if (bg) {
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  }
  const sw = src.width, sh = src.height;
  const k = Math.min(W / sw, H / sh);
  const dw = Math.round(sw * k), dh = Math.round(sh * k);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, Math.round((W - dw) / 2), Math.round((H - dh) / 2), dw, dh);
  return { dw, dh, dx: Math.round((W - dw) / 2), dy: Math.round((H - dh) / 2) };
}
