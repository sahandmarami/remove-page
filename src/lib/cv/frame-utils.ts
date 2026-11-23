/**
 * Frame utilities: cropping, WebP export, sprite-sheet composition,
 * engine metadata (Unity / Godot), batch renaming and downloads.
 */

import type { Box } from "./detect-boxes";

export interface SpriteSheetMeta {
  app: string;
  sheet: {
    width: number;
    height: number;
    columns: number;
    rows: number;
    cellWidth: number;
    cellHeight: number;
    spacing: number;
    frameCount: number;
  };
  frames: Array<{
    index: number;
    name: string;
    x: number;
    y: number;
    w: number;
    h: number;
  }>;
  unity: {
    spriteSheet: { name: string; width: number; height: number };
    grid: [number, number];
    sprites: Array<{ name: string; rect: [number, number, number, number] }>;
  };
  godot: {
    hframes: number;
    vframes: number;
    frame: number;
    frameSize: [number, number];
  };
}

export function createCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
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

export type SaveResult = "saved" | "shared" | "cancelled" | "failed";

/**
 * Mobile-first, fault-tolerant saving.
 *
 * On phones the classic `<a download>` click can be silently swallowed
 * (especially after an `await` breaks the user-gesture chain). The Web Share
 * sheet is the reliable path there, so on touch devices it is tried first.
 * Desktop keeps the anchor download, with a data-URL as the last resort.
 */
export async function saveBlob(blob: Blob, filename: string): Promise<SaveResult> {
  // 1) Web Share on touch devices — visible system sheet, most reliable on mobile
  const coarse =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (coarse && typeof navigator.share === "function" && nav.canShare) {
    try {
      const file = new File([blob], filename, {
        type: blob.type || "application/octet-stream",
      });
      if (nav.canShare({ files: [file] })) {
        await navigator.share({ files: [file] });
        return "shared";
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return "cancelled"; // user closed the share sheet
      }
      // any other failure → fall through to the anchor download
    }
  }

  // 2) object-URL anchor download
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
    // 3) last resort: data URL
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
): { canvas: HTMLCanvasElement; meta: SpriteSheetMeta } {
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

  const frameEntries: SpriteSheetMeta["frames"] = [];
  frames.forEach((f, i) => {
    const col = i % columns;
    const row = Math.floor(i / columns);
    const ox = spacing + col * (cellW + spacing);
    const oy = spacing + row * (cellH + spacing);
    // center inside the cell
    const dx = ox + Math.floor((cellW - f.canvas.width) / 2);
    const dy = oy + Math.floor((cellH - f.canvas.height) / 2);
    ctx.drawImage(f.canvas, dx, dy);
    frameEntries.push({
      index: i,
      name: f.name,
      x: dx,
      y: dy,
      w: f.canvas.width,
      h: f.canvas.height,
    });
  });

  const meta: SpriteSheetMeta = {
    app: "SpriteForge",
    sheet: {
      width,
      height,
      columns,
      rows,
      cellWidth: cellW,
      cellHeight: cellH,
      spacing,
      frameCount: count,
    },
    frames: frameEntries,
    unity: {
      spriteSheet: { name: "spritesheet", width, height },
      grid: [cellW, cellH],
      sprites: frameEntries.map((f) => ({
        name: f.name,
        rect: [f.x, f.y, f.w, f.h],
      })),
    },
    godot: {
      hframes: columns,
      vframes: rows,
      frame: 0,
      frameSize: [cellW, cellH],
    },
  };

  return { canvas, meta };
}

/** Pack frames into a ZIP blob (in-browser, nothing is sent to any server). */
export async function zipFramesToBlob(
  frames: Array<{ name: string; canvas: HTMLCanvasElement }>,
  quality = 0.92
): Promise<Blob> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  const folder = zip.folder("spriteforge-frames") ?? zip;
  for (const frame of frames) {
    const { blob, actualType } = await canvasToBlob(frame.canvas, "image/webp", quality);
    folder.file(`${frame.name}.${extFor(actualType)}`, blob);
  }
  return zip.generateAsync({ type: "blob", compression: "STORE" });
}

/** Pack frames into a ZIP and trigger a browser save (share sheet on mobile). */
export async function downloadFramesZip(
  frames: Array<{ name: string; canvas: HTMLCanvasElement }>,
  zipName = "spriteforge-frames",
  quality = 0.92
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
