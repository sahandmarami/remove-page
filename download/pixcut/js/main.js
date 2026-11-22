/* main.js — app shell: theme, tabs, module wiring, demos */
import { qs, qsa, App, initTheme, openModal, closeModal, toast, wireModal } from "./util.js";
import { initCut } from "./ui-cut.js";
import { initFrames } from "./ui-frames.js";
import { initAnim } from "./ui-anim.js";

/* ---------- tabs ---------- */
function selectTab(name) {
  qsa(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
  qsa(".page").forEach(p => p.classList.toggle("active", p.id === "page-" + name));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

qsa(".tab-btn").forEach(btn => btn.addEventListener("click", () => selectTab(btn.dataset.tab)));
document.addEventListener("app:goto", e => selectTab(e.detail));
qsa("[data-goto]").forEach(b => b.addEventListener("click", () => selectTab(b.dataset.goto)));

/* ---------- boot ---------- */
function boot() {
  initTheme();

  initCut();
  initFrames();
  initAnim();

  // modals: click on backdrop closes (mask editor closes & discards)
  wireModal("#testModal", () => { });
  qs("#btnTestClose").addEventListener("click", () => closeModal("#testModal"));
  wireModal("#maskModal", () => { });

  // prevent losing frames silently — nothing to persist, this is a privacy-friendly local app

  // announce readiness
  window.dispatchEvent(new Event("app:ready"));
}

try {
  boot();
} catch (err) {
  console.error(err);
  try { toast("خطا در راه‌اندازی برنامه: " + err.message, "err", 6000); } catch { /* noop */ }
}
