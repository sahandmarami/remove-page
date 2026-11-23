"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, FileJson, Grid3X3, Image as ImageIcon, Pause, Play, SkipBack, SkipForward, Trash2 } from "lucide-react";
import { toast } from "sonner";
import JSZip from "jszip";
import { useFrameStore } from "@/lib/store";
import { buildSpriteSheet, canvasToBlob, extFor, fitInto, saveBlob, type SpriteSheetMeta } from "@/lib/cv/frame-utils";
import { cn } from "@/lib/utils";

export function Animator() {
  const frames = useFrameStore((s) => s.frames);
  const selectedFrameId = useFrameStore((s) => s.selectedFrameId);
  const setSelected = useFrameStore((s) => s.setSelected);
  const removeFrame = useFrameStore((s) => s.removeFrame);
  const clearAll = useFrameStore((s) => s.clearAll);

  const flipbookRef = useRef<HTMLCanvasElement>(null);
  const [playing, setPlaying] = useState(false);
  const [fps, setFps] = useState(10);
  const [sheetMeta, setSheetMeta] = useState<SpriteSheetMeta | null>(null);
  const [busy, setBusy] = useState(false);

  const currentIdx = frames.findIndex((f) => f.id === selectedFrameId);
  const displayIdx = currentIdx >= 0 ? currentIdx : 0;

  // auto grid: square-ish sheet
  const columns = useMemo(
    () => Math.min(8, Math.max(1, Math.ceil(Math.sqrt(frames.length || 1)))),
    [frames.length]
  );

  // ---------- flipbook ----------
  const drawFlipbook = useCallback(
    (idx: number) => {
      const canvas = flipbookRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const frame = frames[idx];
      if (!frame) return;
      const fit = fitInto(frame.w, frame.h, canvas.width, canvas.height);
      ctx.drawImage(frame.canvas, fit.x, fit.y, fit.w, fit.h);
    },
    [frames]
  );

  useEffect(() => {
    drawFlipbook(displayIdx);
  }, [displayIdx, drawFlipbook]);

  useEffect(() => {
    if (!playing || frames.length < 2) return;
    let idx = displayIdx;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      acc += now - last;
      last = now;
      const stepMs = 1000 / Math.max(1, fps);
      if (acc >= stepMs) {
        acc = acc % stepMs;
        idx = (idx + 1) % frames.length;
        drawFlipbook(idx);
        setSelected(frames[idx].id);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, fps, frames, drawFlipbook, setSelected]);

  useEffect(() => {
    if (frames.length < 2) setPlaying(false);
  }, [frames.length]);

  const step = (dir: 1 | -1) => {
    if (frames.length === 0) return;
    setPlaying(false);
    const next = (displayIdx + dir + frames.length) % frames.length;
    setSelected(frames[next].id);
  };

  // ---------- sprite sheet meta ----------
  useEffect(() => {
    if (frames.length === 0) {
      setSheetMeta(null);
      return;
    }
    const { meta } = buildSpriteSheet(
      frames.map((f) => ({ canvas: f.canvas, name: f.name })),
      { columns, spacing: 2, background: "transparent" }
    );
    setSheetMeta(meta);
  }, [frames, columns]);

  // ---------- exports ----------
  const downloadSheet = useCallback(async () => {
    if (frames.length === 0) return;
    setBusy(true);
    try {
      const { canvas } = buildSpriteSheet(
        frames.map((f) => ({ canvas: f.canvas, name: f.name })),
        { columns, spacing: 2, background: "transparent" }
      );
      const res = await saveBlob(await canvasToBlob(canvas, "image/png", 1).then((r) => r.blob), "spritesheet.png");
      if (res === "failed") toast.error("دانلود ناموفق بود — دوباره بزنید");
      else if (res !== "cancelled") toast.success("اسپرایت‌شیت ذخیره شد");
    } catch {
      toast.error("خروجی ناموفق بود");
    } finally {
      setBusy(false);
    }
  }, [columns, frames]);

  const downloadZip = useCallback(async () => {
    if (frames.length === 0) return;
    setBusy(true);
    try {
      const zip = new JSZip();
      const folder = zip.folder("spriteforge-frames") ?? zip;
      for (const frame of frames) {
        const { blob, actualType } = await canvasToBlob(frame.canvas, "image/webp", 0.92);
        folder.file(`${frame.name}.${extFor(actualType)}`, blob);
      }
      if (sheetMeta) folder.file("spritesheet.json", JSON.stringify(sheetMeta, null, 2));
      const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
      const res = await saveBlob(blob, `spriteforge-${frames.length}-frames.zip`);
      if (res === "failed") toast.error("دانلود ZIP ناموفق بود — دوباره بزنید");
      else if (res !== "cancelled") toast.success("ZIP ذخیره شد");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ساخت ZIP ناموفق بود");
    } finally {
      setBusy(false);
    }
  }, [frames, sheetMeta]);

  const copyJson = useCallback(async () => {
    if (!sheetMeta) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(sheetMeta, null, 2));
      toast.success("JSON کپی شد");
    } catch {
      toast.error("کپی ناموفق بود");
    }
  }, [sheetMeta]);

  if (frames.length === 0) {
    return (
      <div className="flex min-h-[420px] flex-col items-center justify-center gap-4 rounded-3xl border border-line panel-glass p-10 text-center">
        <div className="relative grid h-20 w-20 place-items-center rounded-2xl metallic-gradient shadow-xl">
          <ImageIcon className="h-9 w-9 text-white" />
        </div>
        <p className="text-lg font-black text-foreground">هنوز فریمی نیست</p>
        <p className="text-xs text-faint">از ابزارهای بالا فریم اضافه کنید</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 pb-2">
      {/* flipbook */}
      <div className="overflow-hidden rounded-2xl border border-line checker-dark">
        <canvas ref={flipbookRef} width={720} height={440} className="mx-auto block h-auto max-h-[440px] w-full" />
      </div>

      {/* playback */}
      <div className="flex items-center gap-2 rounded-2xl border border-line panel-glass p-2.5">
        <button
          type="button"
          onClick={() => step(-1)}
          aria-label="قبلی"
          className="grid h-9 w-9 place-items-center rounded-xl border border-line bg-chip text-foreground"
        >
          <SkipBack className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          aria-label={playing ? "توقف" : "پخش"}
          className="grid h-10 w-10 place-items-center rounded-xl metallic-gradient text-white shadow-md"
        >
          {playing ? <Pause className="h-4.5 w-4.5" /> : <Play className="h-4.5 w-4.5" />}
        </button>
        <button
          type="button"
          onClick={() => step(1)}
          aria-label="بعدی"
          className="grid h-9 w-9 place-items-center rounded-xl border border-line bg-chip text-foreground"
        >
          <SkipForward className="h-4 w-4" />
        </button>
        <div className="mr-2 flex min-w-0 flex-1 items-center gap-2">
          <span className="shrink-0 text-xs font-bold text-soft tabular-nums">{fps} FPS</span>
          <input
            type="range"
            min={1}
            max={30}
            step={1}
            value={fps}
            dir="ltr"
            onChange={(e) => setFps(Number(e.target.value))}
            className="h-1.5 min-w-0 flex-1 accent-violet-500"
            aria-label="سرعت"
          />
        </div>
      </div>

      {/* frames strip */}
      <div className="flex gap-2 overflow-x-auto rounded-2xl border border-line bg-surface p-2">
        {frames.map((f, i) => (
          <div
            key={f.id}
            className={cn(
              "relative shrink-0 cursor-pointer overflow-hidden rounded-lg border transition-all",
              i === displayIdx ? "border-violet-line-strong neon-ring" : "border-line hover:border-violet-line"
            )}
            onClick={() => {
              setPlaying(false);
              setSelected(f.id);
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={f.thumb} alt={f.name} className="checker-dark h-16 w-16 object-contain" />
            <span className="absolute right-0.5 top-0.5 rounded bg-black/60 px-1 font-mono text-[9px] text-white" dir="ltr">
              {i + 1}
            </span>
            <button
              type="button"
              aria-label="حذف"
              onClick={(e) => {
                e.stopPropagation();
                removeFrame(f.id);
              }}
              className="absolute left-0.5 top-0.5 rounded bg-black/60 p-0.5 text-white/90 hover:text-rose-ink"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>

      {/* exports */}
      <div className="sticky-safe">
        <div className="float-bar rounded-2xl border border-line panel-glass p-2.5">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void downloadZip()}
              disabled={busy}
              className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl metallic-gradient text-sm font-black text-white transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
            >
              <Download className="h-4.5 w-4.5" />
              دانلود ZIP
            </button>
            <button
              type="button"
              onClick={() => void downloadSheet()}
              disabled={busy}
              className="flex h-11 items-center justify-center gap-2 rounded-xl border border-cyan-line bg-cyan-tint px-4 text-sm font-black text-cyan-ink transition-all hover:border-cyan-line-strong active:scale-[0.98] disabled:opacity-50"
            >
              <Grid3X3 className="h-4.5 w-4.5" />
              <span className="hidden sm:inline">اسپرایت‌شیت</span>
              <span className="sm:hidden">شیت</span>
            </button>
            <button
              type="button"
              onClick={() => void copyJson()}
              disabled={!sheetMeta}
              aria-label="کپی JSON"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-line bg-chip text-soft transition-colors hover:border-violet-line hover:text-foreground disabled:opacity-40"
            >
              <FileJson className="h-4.5 w-4.5" />
            </button>
          </div>
          {frames.length > 2 && (
            <button
              type="button"
              onClick={clearAll}
              className="mt-2 w-full rounded-lg py-1.5 text-[11px] font-bold text-faint transition-colors hover:text-rose-ink"
            >
              پاک‌کردن همه
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
