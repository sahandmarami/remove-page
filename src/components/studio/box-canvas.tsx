"use client";

import { memo, useCallback, useEffect, useRef } from "react";
import { Maximize2, ScanSearch, ZoomIn, ZoomOut } from "lucide-react";
import { makeBoxId, type Box } from "@/lib/cv/detect-boxes";
import { Button } from "@/components/ui/button";

type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

interface ViewState {
  scale: number;
  ox: number;
  oy: number;
}

interface DragState {
  mode: "none" | "move" | "resize" | "draw" | "pan";
  handle: Handle | null;
  startSX: number;
  startSY: number;
  origBox: Box | null;
  draft: Box | null;
  panOx: number;
  panOy: number;
}

interface BoxCanvasProps {
  image: HTMLCanvasElement | null;
  boxes: Box[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (boxes: Box[]) => void;
}

const HANDLE_SIZE = 9;
/** bigger grab radius & visual size on touch devices (Android/iOS) */
const COARSE_POINTER =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(pointer: coarse)").matches;
const HANDLE_DRAW_SIZE = COARSE_POINTER ? 13 : HANDLE_SIZE;
const HANDLE_HIT_SIZE = COARSE_POINTER ? 22 : HANDLE_SIZE;
const MIN_BOX_PX = 6;

const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

function handlePoint(sx: number, sy: number, sw: number, sh: number, h: Handle): [number, number] {
  switch (h) {
    case "nw": return [sx, sy];
    case "n": return [sx + sw / 2, sy];
    case "ne": return [sx + sw, sy];
    case "e": return [sx + sw, sy + sh / 2];
    case "se": return [sx + sw, sy + sh];
    case "s": return [sx + sw / 2, sy + sh];
    case "sw": return [sx, sy + sh];
    case "w": return [sx, sy + sh / 2];
  }
}

function cursorForHandle(h: Handle): string {
  switch (h) {
    case "n": case "s": return "ns-resize";
    case "e": case "w": return "ew-resize";
    case "ne": case "sw": return "nesw-resize";
    case "nw": case "se": return "nwse-resize";
  }
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

function BoxCanvasImpl({ image, boxes, selectedId, onSelect, onChange }: BoxCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLCanvasElement | null>(image);
  const boxesRef = useRef<Box[]>(boxes);
  const selectedRef = useRef<string | null>(selectedId);
  const viewRef = useRef<ViewState>({ scale: 1, ox: 0, oy: 0 });
  const dragRef = useRef<DragState>({
    mode: "none",
    handle: null,
    startSX: 0,
    startSY: 0,
    origBox: null,
    draft: null,
    panOx: 0,
    panOy: 0,
  });
  const dirtyRef = useRef(true);
  const rafRef = useRef<number>(0);
  const didFitRef = useRef(false);
  const zoomChipRef = useRef<HTMLSpanElement>(null);
  const hoverHandleRef = useRef<Handle | null>(null);

  // keep refs in sync with props (no re-render needed for canvas drawing)
  useEffect(() => {
    imageRef.current = image;
    if (image) didFitRef.current = false;
    dirtyRef.current = true;
  }, [image]);

  useEffect(() => {
    if (dragRef.current.mode === "none") {
      boxesRef.current = boxes;
      dirtyRef.current = true;
    }
  }, [boxes]);

  useEffect(() => {
    selectedRef.current = selectedId;
    dirtyRef.current = true;
  }, [selectedId]);

  const markZoom = useCallback(() => {
    if (zoomChipRef.current) {
      zoomChipRef.current.textContent = `${Math.round(viewRef.current.scale * 100)}%`;
    }
  }, []);

  const fit = useCallback(() => {
    const wrap = wrapRef.current;
    const img = imageRef.current;
    if (!wrap || !img) return;
    const rect = wrap.getBoundingClientRect();
    const scale = Math.min(
      (rect.width - 40) / img.width,
      (rect.height - 40) / img.height,
      6
    );
    const s = Math.max(0.04, scale);
    viewRef.current = {
      scale: s,
      ox: (rect.width - img.width * s) / 2,
      oy: (rect.height - img.height * s) / 2,
    };
    markZoom();
    dirtyRef.current = true;
  }, [markZoom]);

  // canvas sizing + continuous render loop (only redraws when dirty)
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(2, Math.round(rect.width * dpr));
      canvas.height = Math.max(2, Math.round(rect.height * dpr));
      dirtyRef.current = true;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const render = () => {
      rafRef.current = requestAnimationFrame(render);
      if (!dirtyRef.current) return;
      dirtyRef.current = false;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);

      const img = imageRef.current;
      const view = viewRef.current;
      if (img) {
        ctx.imageSmoothingEnabled = view.scale < 2.5;
        ctx.drawImage(img, view.ox, view.oy, img.width * view.scale, img.height * view.scale);
        ctx.strokeStyle = "rgba(148,163,184,0.4)";
        ctx.lineWidth = 1;
        ctx.strokeRect(view.ox - 0.5, view.oy - 0.5, img.width * view.scale + 1, img.height * view.scale + 1);
      }

      const list = boxesRef.current;
      const sel = selectedRef.current;

      const drawBox = (b: Box, index: number, isSel: boolean, dashed = false) => {
        const sx = view.ox + b.x * view.scale;
        const sy = view.oy + b.y * view.scale;
        const sw = b.w * view.scale;
        const sh = b.h * view.scale;
        if (sw < 1 || sh < 1) return;

        ctx.fillStyle = isSel ? "rgba(34,211,238,0.10)" : "rgba(168,85,247,0.08)";
        ctx.fillRect(sx, sy, sw, sh);

        ctx.lineWidth = isSel ? 2 : 1.4;
        if (dashed) ctx.setLineDash([6, 4]);
        ctx.strokeStyle = isSel ? "#22d3ee" : "rgba(192,132,252,0.95)";
        if (isSel) {
          ctx.shadowColor = "rgba(34,211,238,0.75)";
          ctx.shadowBlur = 12;
        }
        ctx.strokeRect(sx, sy, sw, sh);
        ctx.shadowBlur = 0;
        ctx.setLineDash([]);

        const label = b.label?.trim() || String(index);
        ctx.font = "600 11px Vazirmatn, sans-serif";
        const tw = ctx.measureText(label).width + 10;
        ctx.fillStyle = isSel ? "rgba(8,145,178,0.95)" : "rgba(126,34,206,0.92)";
        roundedRectPath(ctx, sx, sy - 17, tw, 15, 4);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.textBaseline = "middle";
        ctx.fillText(label, sx + 5, sy - 9.5);

        if (isSel && !dashed) {
          for (const hd of HANDLES) {
            const [hx, hy] = handlePoint(sx, sy, sw, sh, hd);
            ctx.fillStyle = "#ffffff";
            ctx.strokeStyle = "#8b5cf6";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.rect(hx - HANDLE_DRAW_SIZE / 2, hy - HANDLE_DRAW_SIZE / 2, HANDLE_DRAW_SIZE, HANDLE_DRAW_SIZE);
            ctx.fill();
            ctx.stroke();
          }
        }
      };

      list.forEach((b, i) => drawBox(b, i + 1, b.id === sel));
      const d = dragRef.current;
      if (d.mode === "draw" && d.draft) {
        drawBox(d.draft, list.length + 1, true, true);
      }
      ctx.restore();
    };
    rafRef.current = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, []);

  // fit whenever a new image arrives (after canvas size settles)
  useEffect(() => {
    if (!image) return;
    const t = window.setTimeout(() => {
      if (!didFitRef.current) {
        didFitRef.current = true;
        fit();
      }
    }, 30);
    return () => window.clearTimeout(t);
  }, [image, fit]);

  const toImageCoords = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const view = viewRef.current;
    return {
      sx,
      sy,
      ix: (sx - view.ox) / view.scale,
      iy: (sy - view.oy) / view.scale,
    };
  }, []);

  const hitTest = useCallback((sx: number, sy: number): { kind: "handle"; handle: Handle } | { kind: "box"; box: Box } | { kind: "empty" } => {
    const view = viewRef.current;
    const list = boxesRef.current;
    const sel = selectedRef.current;

    // handles of the selected box first (top priority)
    const selBox = list.find((b) => b.id === sel);
    if (selBox) {
      const sx0 = view.ox + selBox.x * view.scale;
      const sy0 = view.oy + selBox.y * view.scale;
      const sw0 = selBox.w * view.scale;
      const sh0 = selBox.h * view.scale;
      for (const hd of HANDLES) {
        const [hx, hy] = handlePoint(sx0, sy0, sw0, sh0, hd);
        if (Math.abs(sx - hx) <= HANDLE_HIT_SIZE && Math.abs(sy - hy) <= HANDLE_HIT_SIZE) {
          return { kind: "handle", handle: hd };
        }
      }
    }
    // boxes, topmost first
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i];
      const bx = view.ox + b.x * view.scale;
      const by = view.oy + b.y * view.scale;
      const bw = b.w * view.scale;
      const bh = b.h * view.scale;
      if (sx >= bx && sx <= bx + bw && sy >= by && sy <= by + bh) {
        return { kind: "box", box: b };
      }
    }
    return { kind: "empty" };
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!imageRef.current) return;
      const canvas = canvasRef.current!;
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic or stale pointer id — safe to continue without capture */
      }
      const { sx, sy } = toImageCoords(e.clientX, e.clientY);
      const drag = dragRef.current;

      if (e.button === 1 || e.altKey) {
        drag.mode = "pan";
        drag.panOx = viewRef.current.ox;
        drag.panOy = viewRef.current.oy;
        drag.startSX = sx;
        drag.startSY = sy;
        canvas.style.cursor = "grabbing";
        e.preventDefault();
        return;
      }

      const hit = hitTest(sx, sy);
      if (hit.kind === "handle") {
        drag.mode = "resize";
        drag.handle = hit.handle;
        drag.origBox = boxesRef.current.find((b) => b.id === selectedRef.current) ?? null;
        drag.startSX = sx;
        drag.startSY = sy;
      } else if (hit.kind === "box") {
        onSelect(hit.box.id);
        drag.mode = "move";
        drag.origBox = { ...hit.box };
        drag.startSX = sx;
        drag.startSY = sy;
      } else {
        drag.mode = "draw";
        drag.draft = null;
        drag.startSX = sx;
        drag.startSY = sy;
      }
      e.preventDefault();
    },
    [hitTest, onSelect, toImageCoords]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas || !imageRef.current) return;
      const { sx, sy, ix, iy } = toImageCoords(e.clientX, e.clientY);
      const drag = dragRef.current;
      const view = viewRef.current;
      const img = imageRef.current;

      if (drag.mode === "none") {
        // hover feedback only — direct style, no React state
        const hit = hitTest(sx, sy);
        if (hit.kind === "handle") {
          canvas.style.cursor = cursorForHandle(hit.handle);
          hoverHandleRef.current = hit.handle;
        } else if (hit.kind === "box") {
          canvas.style.cursor = "move";
        } else {
          canvas.style.cursor = "crosshair";
        }
        return;
      }

      const dx = sx - drag.startSX;
      const dy = sy - drag.startSY;

      if (drag.mode === "pan") {
        viewRef.current = { ...view, ox: drag.panOx + dx, oy: drag.panOy + dy };
        dirtyRef.current = true;
        return;
      }

      if (drag.mode === "draw") {
        const x1 = Math.max(0, Math.min(img.width, (drag.startSX - view.ox) / view.scale));
        const y1 = Math.max(0, Math.min(img.height, (drag.startSY - view.oy) / view.scale));
        const x2 = Math.max(0, Math.min(img.width, ix));
        const y2 = Math.max(0, Math.min(img.height, iy));
        drag.draft = {
          id: "draft",
          x: Math.min(x1, x2),
          y: Math.min(y1, y2),
          w: Math.abs(x2 - x1),
          h: Math.abs(y2 - y1),
        };
        dirtyRef.current = true;
        return;
      }

      if (drag.mode === "move" && drag.origBox) {
        const b = drag.origBox;
        const nx = Math.max(0, Math.min(img.width - b.w, b.x + dx / view.scale));
        const ny = Math.max(0, Math.min(img.height - b.h, b.y + dy / view.scale));
        boxesRef.current = boxesRef.current.map((old) =>
          old.id === b.id ? { ...old, x: nx, y: ny } : old
        );
        dirtyRef.current = true;
        return;
      }

      if (drag.mode === "resize" && drag.origBox && drag.handle) {
        const b = drag.origBox;
        const left0 = b.x;
        const top0 = b.y;
        const right0 = b.x + b.w;
        const bottom0 = b.y + b.h;
        const dix = dx / view.scale;
        const diy = dy / view.scale;
        let left = left0;
        let right = right0;
        let top = top0;
        let bottom = bottom0;
        const h = drag.handle;
        if (h.includes("w")) left = Math.max(0, Math.min(right0 - MIN_BOX_PX / view.scale, left0 + dix));
        if (h.includes("e")) right = Math.max(left0 + MIN_BOX_PX / view.scale, Math.min(img.width, right0 + dix));
        if (h.includes("n")) top = Math.max(0, Math.min(bottom0 - MIN_BOX_PX / view.scale, top0 + diy));
        if (h.includes("s")) bottom = Math.max(top0 + MIN_BOX_PX / view.scale, Math.min(img.height, bottom0 + diy));
        boxesRef.current = boxesRef.current.map((old) =>
          old.id === b.id
            ? {
                ...old,
                x: left,
                y: top,
                w: right - left,
                h: bottom - top,
              }
            : old
        );
        dirtyRef.current = true;
      }
    },
    [hitTest, toImageCoords]
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      const drag = dragRef.current;
      if (!canvas) return;
      canvas.releasePointerCapture?.(e.pointerId);

      if (drag.mode === "draw") {
        const d = drag.draft;
        drag.draft = null;
        if (d && d.w * viewRef.current.scale >= MIN_BOX_PX && d.h * viewRef.current.scale >= MIN_BOX_PX) {
          const newBox: Box = {
            id: makeBoxId(),
            x: Math.round(d.x),
            y: Math.round(d.y),
            w: Math.round(d.w),
            h: Math.round(d.h),
          };
          boxesRef.current = [...boxesRef.current, newBox];
          onChange(boxesRef.current);
          onSelect(newBox.id);
        } else {
          onSelect(null);
        }
      } else if (drag.mode === "move" || drag.mode === "resize") {
        onChange([...boxesRef.current]);
      }
      drag.mode = "none";
      drag.handle = null;
      drag.origBox = null;
      canvas.style.cursor = "crosshair";
      dirtyRef.current = true;
    },
    [onChange, onSelect]
  );

  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      if (!imageRef.current) return;
      e.preventDefault();
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const view = viewRef.current;
      const factor = Math.exp(-e.deltaY * 0.0022);
      const newScale = Math.max(0.04, Math.min(12, view.scale * factor));
      viewRef.current = {
        scale: newScale,
        ox: mx - ((mx - view.ox) * newScale) / view.scale,
        oy: my - ((my - view.oy) * newScale) / view.scale,
      };
      markZoom();
      dirtyRef.current = true;
    },
    [markZoom]
  );

  const zoomStep = useCallback(
    (dir: 1 | -1) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mx = rect.width / 2;
      const my = rect.height / 2;
      const view = viewRef.current;
      const newScale = Math.max(0.04, Math.min(12, view.scale * (dir === 1 ? 1.25 : 0.8)));
      viewRef.current = {
        scale: newScale,
        ox: mx - ((mx - view.ox) * newScale) / view.scale,
        oy: my - ((my - view.oy) * newScale) / view.scale,
      };
      markZoom();
      dirtyRef.current = true;
    },
    [markZoom]
  );

  // keyboard: delete / nudge
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const sel = selectedRef.current;
      if (!sel) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        boxesRef.current = boxesRef.current.filter((b) => b.id !== sel);
        onChange([...boxesRef.current]);
        onSelect(null);
        e.preventDefault();
      } else if (e.key.startsWith("Arrow")) {
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        boxesRef.current = boxesRef.current.map((b) =>
          b.id === sel ? { ...b, x: Math.max(0, b.x + dx), y: Math.max(0, b.y + dy) } : b
        );
        onChange([...boxesRef.current]);
        e.preventDefault();
      } else if (e.key === "Escape") {
        onSelect(null);
      }
    },
    [onChange, onSelect]
  );

  return (
    <div
      ref={wrapRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="relative h-full min-h-[340px] w-full overflow-hidden rounded-xl border border-line checker-dark outline-none focus-visible:ring-2 focus-visible:ring-cyan-line-strong"
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full touch-none select-none"
        style={{ cursor: "crosshair" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
      />

      {/* floating zoom controls */}
      <div className="absolute left-3 top-3 z-10 flex flex-col gap-1.5">
        <Button
          type="button"
          size="icon"
          variant="secondary"
          className="h-11 w-11 bg-overlay backdrop-blur border border-line hover:border-cyan-line-strong sm:h-8 sm:w-8"
          onClick={() => zoomStep(1)}
          aria-label="بزرگ‌نمایی"
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="secondary"
          className="h-11 w-11 bg-overlay backdrop-blur border border-line hover:border-cyan-line-strong sm:h-8 sm:w-8"
          onClick={() => zoomStep(-1)}
          aria-label="کوچک‌نمایی"
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="secondary"
          className="h-11 w-11 bg-overlay backdrop-blur border border-line hover:border-cyan-line-strong sm:h-8 sm:w-8"
          onClick={fit}
          aria-label="اندازه‌گیری در کادر"
        >
          <Maximize2 className="h-4 w-4" />
        </Button>
        <span
          ref={zoomChipRef}
          className="mx-auto rounded-md bg-overlay px-1.5 py-0.5 text-xs font-medium text-cyan-ink border border-line backdrop-blur"
        >
          100%
        </span>
      </div>

      {/* info chips */}
      <div className="absolute right-3 top-3 z-10 flex items-center gap-1.5">
        <span className="flex items-center gap-1 rounded-md bg-overlay px-2 py-1 text-xs font-medium text-violet-ink border border-line backdrop-blur">
          <ScanSearch className="h-3.5 w-3.5" />
          {boxes.length} کادر
        </span>
      </div>

      <div className="pointer-events-none absolute inset-x-3 bottom-2.5 z-10 hidden justify-center sm:flex">
        <span className="rounded-lg bg-surface px-3 py-1.5 text-xs leading-4 text-soft border border-line backdrop-blur text-center">
          کشیدن روی فضای خالی: کادر جدید — درگ کادر: جابجایی — دستگیره‌ها: تغییر اندازه — Alt یا کلیک میانی: پن — چرخ ماوس: زوم — Delete: حذف کادر
        </span>
      </div>

      {!image && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 text-center">
          <div className="rounded-2xl metallic-gradient p-[1.5px]">
            <div className="rounded-2xl bg-surface px-8 py-6">
              <p className="text-sm font-bold metallic-text">تصویری بارگذاری نشده است</p>
              <p className="mt-1.5 text-xs text-soft">
                یک شیت تصویر آپلود کنید یا از دکمه «شیت نمونه» استفاده کنید
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export const BoxCanvas = memo(BoxCanvasImpl);
