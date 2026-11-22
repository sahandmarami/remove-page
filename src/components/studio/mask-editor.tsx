"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Brush,
  CircleDot,
  Eraser,
  Pipette,
  Redo2,
  RotateCcw,
  Undo2,
  Wand2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { rgbToHex, type RGB } from "@/lib/cv/color-utils";
import { cn } from "@/lib/utils";

type Tool = "eraser" | "restore" | "wand" | "picker";
type WandAction = "erase" | "restore";

interface MaskEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  original: HTMLCanvasElement | null;
  initial: HTMLCanvasElement | null;
  defaultName: string;
  onSave: (canvas: HTMLCanvasElement, name: string) => void;
}

const MAX_HISTORY = 30;

export function MaskEditor({
  open,
  onOpenChange,
  original,
  initial,
  defaultName,
  onSave,
}: MaskEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null);
  const workRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const undoStack = useRef<ImageData[]>([]);
  const redoStack = useRef<ImageData[]>([]);
  const [tool, setTool] = useState<Tool>("eraser");
  const [wandAction, setWandAction] = useState<WandAction>("erase");
  const [brushSize, setBrushSize] = useState(28);
  const [wandTolerance, setWandTolerance] = useState(52);
  const [picked, setPicked] = useState<RGB | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [name, setName] = useState(defaultName);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

  const attachCanvas = useCallback((el: HTMLCanvasElement | null) => {
    canvasRef.current = el;
    setCanvasEl(el);
  }, []);

  // (re)build working canvas when opened — re-runs once the portal canvas mounts
  useEffect(() => {
    if (!open || !initial || !original || !canvasEl) return;
    const c = document.createElement("canvas");
    c.width = initial.width;
    c.height = initial.height;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(initial, 0, 0);
    workRef.current = c;
    // paint into the visible canvas (mutate via the ref, not the state value)
    const view = canvasRef.current;
    if (!view) return;
    view.width = initial.width;
    view.height = initial.height;
    const vctx = view.getContext("2d")!;
    vctx.clearRect(0, 0, view.width, view.height);
    vctx.drawImage(c, 0, 0);
  }, [open, initial, original, canvasEl]);

  const syncHistory = useCallback(() => {
    setCanUndo(undoStack.current.length > 0);
    setCanRedo(redoStack.current.length > 0);
  }, []);

  const snapshot = useCallback(() => {
    const work = workRef.current;
    if (!work) return;
    const ctx = work.getContext("2d", { willReadFrequently: true })!;
    undoStack.current.push(ctx.getImageData(0, 0, work.width, work.height));
    if (undoStack.current.length > MAX_HISTORY) undoStack.current.shift();
    redoStack.current = [];
    syncHistory();
  }, [syncHistory]);

  const repaint = useCallback(() => {
    const work = workRef.current;
    const view = canvasRef.current;
    if (!work || !view) return;
    const vctx = view.getContext("2d")!;
    vctx.clearRect(0, 0, view.width, view.height);
    vctx.drawImage(work, 0, 0);
  }, []);

  const undo = useCallback(() => {
    const work = workRef.current;
    if (!work || undoStack.current.length === 0) return;
    const ctx = work.getContext("2d", { willReadFrequently: true })!;
    redoStack.current.push(ctx.getImageData(0, 0, work.width, work.height));
    const prev = undoStack.current.pop()!;
    ctx.putImageData(prev, 0, 0);
    repaint();
    syncHistory();
  }, [repaint, syncHistory]);

  const redo = useCallback(() => {
    const work = workRef.current;
    if (!work || redoStack.current.length === 0) return;
    const ctx = work.getContext("2d", { willReadFrequently: true })!;
    undoStack.current.push(ctx.getImageData(0, 0, work.width, work.height));
    const next = redoStack.current.pop()!;
    ctx.putImageData(next, 0, 0);
    repaint();
    syncHistory();
  }, [repaint, syncHistory]);

  const reset = useCallback(() => {
    if (!workRef.current || !initial) return;
    snapshot();
    const ctx = workRef.current.getContext("2d", { willReadFrequently: true })!;
    ctx.clearRect(0, 0, workRef.current.width, workRef.current.height);
    ctx.drawImage(initial, 0, 0);
    repaint();
  }, [initial, repaint, snapshot]);

  // keyboard shortcuts
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) {
        e.preventDefault();
        redo();
      } else if (e.key === "e") setTool("eraser");
      else if (e.key === "r") setTool("restore");
      else if (e.key === "w") setTool("wand");
      else if (e.key === "i") setTool("picker");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, undo, redo]);

  const canvasPos = useCallback((clientX: number, clientY: number) => {
    const view = canvasRef.current!;
    const rect = view.getBoundingClientRect();
    return {
      x: Math.round(((clientX - rect.left) / rect.width) * view.width),
      y: Math.round(((clientY - rect.top) / rect.height) * view.height),
    };
  }, []);

  const applyBrushAt = useCallback(
    (x: number, y: number) => {
      const work = workRef.current;
      const orig = original;
      if (!work || !orig) return;
      const ctx = work.getContext("2d", { willReadFrequently: true })!;
      const r = brushSize / 2;
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.clip();
      if (tool === "eraser") {
        ctx.clearRect(0, 0, work.width, work.height);
      } else if (tool === "restore") {
        ctx.drawImage(orig, 0, 0);
      }
      ctx.restore();
    },
    [brushSize, tool, original]
  );

  const applyWandAt = useCallback(
    (x: number, y: number) => {
      const work = workRef.current;
      const orig = original;
      if (!work || !orig) return;
      const octx = orig.getContext("2d", { willReadFrequently: true })!;
      const origData = octx.getImageData(0, 0, orig.width, orig.height);
      const od = origData.data;
      const wctx = work.getContext("2d", { willReadFrequently: true })!;
      const workData = wctx.getImageData(0, 0, work.width, work.height);
      const wd = workData.data;

      const w = work.width;
      const h = work.height;
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const seedIdx = (y * w + x) * 4;
      const seed: RGB = [od[seedIdx], od[seedIdx + 1], od[seedIdx + 2]];
      const tol = wandTolerance;

      const dist = (i: number) => {
        const dr = od[i] - seed[0];
        const dg = od[i + 1] - seed[1];
        const db = od[i + 2] - seed[2];
        return Math.sqrt(dr * dr + dg * dg + db * db);
      };

      const visited = new Uint8Array(w * h);
      const queue = new Int32Array(w * h);
      let head = 0;
      let tail = 0;
      const p0 = y * w + x;
      visited[p0] = 1;
      queue[tail++] = p0;
      const region: number[] = [];
      while (head < tail) {
        const p = queue[head++];
        region.push(p);
        const px = p % w;
        const py = (p - px) / w;
        const neighbors = [
          px > 0 ? p - 1 : -1,
          px < w - 1 ? p + 1 : -1,
          py > 0 ? p - w : -1,
          py < h - 1 ? p + w : -1,
        ];
        for (const n of neighbors) {
          if (n < 0 || visited[n]) continue;
          const ni = n * 4;
          if (dist(ni) > tol) continue;
          visited[n] = 1;
          queue[tail++] = n;
        }
      }

      if (wandAction === "erase") {
        for (const p of region) wd[p * 4 + 3] = 0;
      } else {
        for (const p of region) {
          const i = p * 4;
          wd[i] = od[i];
          wd[i + 1] = od[i + 1];
          wd[i + 2] = od[i + 2];
          wd[i + 3] = od[i + 3];
        }
      }
      wctx.putImageData(workData, 0, 0);
      repaint();
    },
    [original, repaint, wandAction, wandTolerance]
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const view = canvasRef.current;
      if (!view) return;
      const { x, y } = canvasPos(e.clientX, e.clientY);
      try {
        view.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic or stale pointer id — safe to continue without capture */
      }

      if (tool === "picker") {
        const work = workRef.current;
        if (!work) return;
        const ctx = work.getContext("2d", { willReadFrequently: true })!;
        const d = ctx.getImageData(Math.min(x, work.width - 1), Math.min(y, work.height - 1), 1, 1).data;
        setPicked([d[0], d[1], d[2]]);
        return;
      }

      snapshot();
      if (tool === "wand") {
        applyWandAt(x, y);
        return;
      }
      drawingRef.current = true;
      lastPointRef.current = { x, y };
      applyBrushAt(x, y);
      repaint();
    },
    [applyBrushAt, applyWandAt, canvasPos, repaint, snapshot, tool]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drawingRef.current) return;
      const { x, y } = canvasPos(e.clientX, e.clientY);
      const last = lastPointRef.current;
      if (last) {
        // interpolate for fast strokes
        const dist = Math.hypot(x - last.x, y - last.y);
        const steps = Math.max(1, Math.ceil(dist / (brushSize / 4)));
        for (let s = 1; s <= steps; s++) {
          const ix = last.x + ((x - last.x) * s) / steps;
          const iy = last.y + ((y - last.y) * s) / steps;
          applyBrushAt(Math.round(ix), Math.round(iy));
        }
      } else {
        applyBrushAt(x, y);
      }
      lastPointRef.current = { x, y };
      repaint();
    },
    [applyBrushAt, brushSize, canvasPos, repaint]
  );

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    drawingRef.current = false;
    lastPointRef.current = null;
    canvasRef.current?.releasePointerCapture?.(e.pointerId);
  }, []);

  const tools: Array<{ id: Tool; icon: React.ReactNode; label: string; hint: string }> = [
    { id: "eraser", icon: <Eraser className="h-4 w-4" />, label: "پاک‌کن", hint: "E" },
    { id: "restore", icon: <Brush className="h-4 w-4" />, label: "بازیابی", hint: "R" },
    { id: "wand", icon: <Wand2 className="h-4 w-4" />, label: "چوب جادویی", hint: "W" },
    { id: "picker", icon: <Pipette className="h-4 w-4" />, label: "قطره‌چکان", hint: "I" },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl panel-glass border-line max-h-[92vh] overflow-y-auto scroll-slim">
        <DialogHeader className="text-right">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Wand2 className="h-4 w-4 text-cyan-ink" />
            ویرایشگر ماسک دستی
          </DialogTitle>
          <DialogDescription>
            با پاک‌کن لبه‌ها را اصلاح کنید، با بازیابی پیکسل‌های اصلی را برگردانید و با چوب جادویی ناحیه‌های هم‌رنگ را یکجا پاک یا بازیابی کنید.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-[1fr_220px]">
          <div className="rounded-xl border border-line checker-dark overflow-hidden flex items-center justify-center min-h-[300px] p-2">
            <canvas
              ref={attachCanvas}
              className="max-w-full max-h-[420px] object-contain touch-none"
              style={{ cursor: tool === "picker" ? "crosshair" : tool === "wand" ? "cell" : "crosshair" }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            />
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-1.5">
              {tools.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTool(t.id)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-medium transition-colors",
                    tool === t.id
                      ? "border-cyan-line-strong bg-cyan-tint text-cyan-ink neon-ring"
                      : "border-line bg-chip text-soft hover:border-violet-line-strong hover:text-violet-ink"
                  )}
                  title={`${t.label} (${t.hint})`}
                >
                  {t.icon}
                  {t.label}
                </button>
              ))}
            </div>

            {tool === "wand" && (
              <div className="space-y-1.5">
                <Label className="text-xs text-soft">عمل چوب جادویی</Label>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setWandAction("erase")}
                    className={cn(
                      "rounded-lg border px-2 py-1.5 text-xs",
                      wandAction === "erase"
                        ? "border-rose-line-strong bg-rose-tint text-rose-ink"
                        : "border-line bg-chip text-soft"
                    )}
                  >
                    پاک‌سازی ناحیه
                  </button>
                  <button
                    type="button"
                    onClick={() => setWandAction("restore")}
                    className={cn(
                      "rounded-lg border px-2 py-1.5 text-xs",
                      wandAction === "restore"
                        ? "border-emerald-400/60 bg-emerald-400/10 text-emerald-ink"
                        : "border-line bg-chip text-soft"
                    )}
                  >
                    بازیابی ناحیه
                  </button>
                </div>
                <div className="pt-1">
                  <div className="flex justify-between text-xs text-soft">
                    <span>آستانه چوب جادویی</span>
                    <span className="text-cyan-ink">{wandTolerance}</span>
                  </div>
                  <Slider
                    value={[wandTolerance]}
                    min={4}
                    max={140}
                    step={2}
                    onValueChange={(v) => setWandTolerance(v[0])}
                    className="mt-1"
                  />
                </div>
              </div>
            )}

            {(tool === "eraser" || tool === "restore") && (
              <div>
                <div className="flex justify-between text-xs text-soft">
                  <span>اندازه قلم‌مو</span>
                  <span className="text-cyan-ink">{brushSize}px</span>
                </div>
                <Slider
                  value={[brushSize]}
                  min={4}
                  max={90}
                  step={2}
                  onValueChange={(v) => setBrushSize(v[0])}
                  className="mt-1"
                />
              </div>
            )}

            {picked && (
              <div className="flex items-center gap-2 rounded-lg border border-line bg-chip px-2.5 py-2">
                <CircleDot className="h-4 w-4 text-soft" />
                <span
                  className="h-5 w-5 rounded border border-line-strong"
                  style={{ backgroundColor: rgbToHex(picked) }}
                />
                <span className="font-mono text-xs text-soft" dir="ltr">
                  {rgbToHex(picked)}
                </span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-1.5">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={!canUndo}
                onClick={undo}
                className="border border-line bg-chip"
              >
                <Undo2 className="h-4 w-4" />
                برگشت
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={!canRedo}
                onClick={redo}
                className="border border-line bg-chip"
              >
                <Redo2 className="h-4 w-4" />
                ازنو
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={reset}
                className="border border-line bg-chip"
              >
                <RotateCcw className="h-4 w-4" />
                بازنشانی
              </Button>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="mask-frame-name" className="text-xs text-soft">
                نام فریم
              </Label>
              <input
                id="mask-frame-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                dir="ltr"
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-cyan-line-strong"
              />
            </div>

            <Button
              type="button"
              className="w-full metallic-gradient text-white font-bold glow-purple hover:brightness-110"
              onClick={() => {
                const work = workRef.current;
                if (!work) return;
                const out = document.createElement("canvas");
                out.width = work.width;
                out.height = work.height;
                out.getContext("2d")!.drawImage(work, 0, 0);
                onSave(out, name.trim() || defaultName);
              }}
            >
              ذخیره به فریم‌ها
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
