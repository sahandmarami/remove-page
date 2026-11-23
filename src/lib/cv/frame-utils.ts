/**
 * Frame utilities: cropping, lossless export, sprite-sheet composition,
 * batch renaming and downloads.
 */

import type { Box } from "./detect-boxes";

export function createCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/**
 * High-quality upscale for very small sources so exports never look
 * blurrier than the original. Below `minSide` the image is doubled with
 * two-step smooth interpolation (much cleaner than a single big jump).
 */
export function enhanceSmallCanvas(
  src: HTMLCanvasElement,
  minSide = 620
): HTMLCanvasElement {
  const maxSide = Math.max(src.width, src.height);
  if (maxSide <= 0 || maxSide >= minSide) return src;
  let cur = src;
  // upscale in ×2 steps until the long side reaches minSide
  while (Math.max(cur.width, cur.height) < minSide && Math.max(cur.width, cur.height) < 2400) {
    const next = createCanvas(cur.width * 2, cur.height * 2);
    const ctx = next.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(cur, 0, 0, next.width, next.height);
    cur = next;
  }
  return cur;
}

export function cropToCanvas(
  source: HTMLCanvasElement,
  box: Box,
  transparentBg = false
): HTMLCanvasElement {
  const x = Math.max(0, Math.round(box.x));
  const y = Math.max(0, Math.round(box.y));
  const w = Math.max(1, Math.min(source.width - x, Math.round(box.w)));
  const h = Math.max(1, Math.min(source.height - y, Math.round(box.h)));
  const out = createCanvas(w, h);
  const ctx = out.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(source, x, y, w, h, 0, 0, w, h);
  if (!transparentBg) {
    void ctx; // keep opaque crop
  }
  return out;
}

export function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const out = createCanvas(src.width, src.height);
  out.getContext("2d")!.drawImage(src, 0, 0);
  return out;
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  type = "image/webp",
  quality = 0.92
): Promise<{ blob: Blob; actualType: string }> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("تبدیل بوم به فایل ناموفق بود"));
          return;
        }
        const actualType = blob.type || type;
        resolve({ blob, actualType });
      },
      type,
      quality
    );
  });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export type SaveResult = "saved" | "cancelled" | "failed";

/**
 * Direct file download — no share sheet, no dialogs.
 * Writes the blob straight to the browser's download pipeline via an
 * object-URL anchor. Works on Android Chrome, iOS Safari and desktop.
 */
export async function saveBlob(blob: Blob, filename: string): Promise<SaveResult> {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 8000);
    return "saved";
  } catch {
    // last resort: data URL
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      return "saved";
    } catch {
      return "failed";
    }
  }
}

/** canvas → blob → saveBlob, with a concise toast on failure. */
export async function saveCanvas(
  canvas: HTMLCanvasElement,
  filename: string,
  type = "image/png",
  quality = 1
): Promise<SaveResult> {
  const { blob } = await canvasToBlob(canvas, type, quality);
  return saveBlob(blob, filename);
}

export function makeThumb(canvas: HTMLCanvasElement, size = 120): string {
  const scale = Math.min(1, size / Math.max(canvas.width, canvas.height));
  const t = createCanvas(canvas.width * scale, canvas.height * scale);
  t.getContext("2d")!.drawImage(canvas, 0, 0, t.width, t.height);
  try {
    return t.toDataURL("image/webp", 0.7);
  } catch {
    return t.toDataURL("image/png");
  }
}

/** prefix_001 style naming with automatic padding. */
export function frameName(pattern: string, index: number, totalCount: number): string {
  const digits = Math.max(3, String(totalCount).length);
  const n = String(index + 1).padStart(digits, "0");
  if (pattern.includes("{i}")) {
    return pattern.replace(/\{i\}/g, n);
  }
  return `${pattern}_${n}`;
}

export function extFor(type: string): string {
  if (type.includes("webp")) return "webp";
  if (type.includes("png")) return "png";
  if (type.includes("jpeg") || type.includes("jpg")) return "jpg";
  return "img";
}

export interface SheetBuildOptions {
  columns: number;
  spacing: number;
  background: "transparent" | "white" | "black" | "slate";
}

export function buildSpriteSheet(
  frames: Array<{ canvas: HTMLCanvasElement; name: string }>,
  options: SheetBuildOptions
): { canvas: HTMLCanvasElement } {
  const columns = Math.max(1, Math.min(32, Math.round(options.columns)));
  const spacing = Math.max(0, Math.round(options.spacing));
  const count = frames.length;
  const rows = Math.max(1, Math.ceil(count / columns));
  const cellW = Math.max(...frames.map((f) => f.canvas.width));
  const cellH = Math.max(...frames.map((f) => f.canvas.height));

  const width = columns * cellW + (columns + 1) * spacing;
  const height = rows * cellH + (rows + 1) * spacing;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d")!;

  if (options.background === "white") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
  } else if (options.background === "black") {
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, width, height);
  } else if (options.background === "slate") {
    ctx.fillStyle = "#141624";
    ctx.fillRect(0, 0, width, height);
  }

  frames.forEach((f, i) => {
    const col = i % columns;
    const row = Math.floor(i / columns);
    const ox = spacing + col * (cellW + spacing);
    const oy = spacing + row * (cellH + spacing);
    // center inside the cell
    const dx = ox + Math.floor((cellW - f.canvas.width) / 2);
    const dy = oy + Math.floor((cellH - f.canvas.height) / 2);
    ctx.drawImage(f.canvas, dx, dy);
  });

  return { canvas };
}

/** Pack frames into a ZIP blob — lossless PNG frames, in-browser. */
export async function zipFramesToBlob(
  frames: Array<{ name: string; canvas: HTMLCanvasElement }>,
  quality = 1
): Promise<Blob> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  const folder = zip.folder("remove-page-frames") ?? zip;
  for (const frame of frames) {
    const { blob, actualType } = await canvasToBlob(frame.canvas, "image/png", quality);
    folder.file(`${frame.name}.${extFor(actualType)}`, blob);
  }
  return zip.generateAsync({ type: "blob", compression: "STORE" });
}

/** Pack frames into a ZIP and trigger a browser save. */
export async function downloadFramesZip(
  frames: Array<{ name: string; canvas: HTMLCanvasElement }>,
  zipName = "remove-page-frames",
  quality = 1
): Promise<SaveResult> {
  const blob = await zipFramesToBlob(frames, quality);
  return saveBlob(blob, `${zipName}.zip`);
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function fitInto(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number
): { w: number; h: number; x: number; y: number } {
  const scale = Math.min(dstW / srcW, dstH / srcH);
  const w = srcW * scale;
  const h = srcH * scale;
  return { w, h, x: (dstW - w) / 2, y: (dstH - h) / 2 };
}
