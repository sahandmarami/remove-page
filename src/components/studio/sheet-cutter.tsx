"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ImageUp,
  Loader2,
  RefreshCw,
  Scissors,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { BoxCanvas } from "@/components/studio/box-canvas";
import { type Box } from "@/lib/cv/detect-boxes";
import { analyzeSheet, type SmartSheetResult } from "@/lib/cv/smart-sheet";
import { removeBackground, DEFAULT_BG_OPTIONS } from "@/lib/cv/bg-removal";
import {
  canvasToBlob,
  cropToCanvas,
  enhanceSmallCanvas,
  frameName,
  makeThumb,
  saveBlob,
} from "@/lib/cv/frame-utils";
import { loadImageToCanvas } from "@/lib/cv/video-extract";
import type { RGB } from "@/lib/cv/color-utils";
import { useFrameStore } from "@/lib/store";
import { cn } from "@/lib/utils";

interface SourceImage {
  canvas: HTMLCanvasElement;
  name: string;
}

interface GridInfo {
  mode: SmartSheetResult["mode"];
  columns: number;
  rows: number;
  cellW: number;
  cellH: number;
  confidence: number;
}

export function SheetCutter() {
  const addFrames = useFrameStore((s) => s.addFrames);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [source, setSource] = useState<SourceImage | null>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [grid, setGrid] = useState<GridInfo | null>(null);
  const [colOverride, setColOverride] = useState(0); // 0 = automatic
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [cropping, setCropping] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const bgHintRef = useRef<RGB | null>(null);

  /** Smart (AI) detection: layout inference + uniform grid cutting. */
  const runDetect = useCallback((canvas: HTMLCanvasElement, forcedCols: number) => {
    setDetecting(true);
    // yield a frame so the spinner paints before the CPU work
    window.setTimeout(() => {
      try {
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const result = analyzeSheet(
          { data: img.data, width: canvas.width, height: canvas.height },
          forcedCols >= 1 ? { columns: forcedCols } : {}
        );
        bgHintRef.current = result.bgColor;
        setBoxes(result.boxes);
        setGrid({
          mode: result.mode,
          columns: result.columns,
          rows: result.rows,
          cellW: result.cellW,
          cellH: result.cellH,
          confidence: result.confidence,
        });
        if (result.boxes.length > 0) {
          const where =
            result.mode === "grid"
              ? `گرید ${result.columns}×${result.rows} — فریم‌ها هم‌اندازه`
              : "برش هوشمند";
          toast.success(`${result.boxes.length} فریم پیدا شد — ${where}`);
        } else {
          toast.error("اسپرایتی در تصویر پیدا نشد");
        }
      } catch {
        toast.error("تشخیص ناموفق بود");
      } finally {
        setDetecting(false);
      }
    }, 30);
  }, []);

  const loadCanvas = useCallback(
    (canvas: HTMLCanvasElement, name: string) => {
      setSource({ canvas, name });
      setBoxes([]);
      setGrid(null);
      setSelectedId(null);
      setColOverride(0);
      runDetect(canvas, 0);
    },
    [runDetect]
  );

  const onFiles = useCallback(
    async (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        toast.error("فقط تصویر");
        return;
      }
      try {
        const { canvas } = await loadImageToCanvas(file);
        loadCanvas(canvas, file.name);
      } catch {
        toast.error("بارگذاری ناموفق بود");
      }
    },
    [loadCanvas]
  );

  const close = () => {
    setSource(null);
    setBoxes([]);
    setGrid(null);
    setSelectedId(null);
    setColOverride(0);
    bgHintRef.current = null;
  };

  const processCrop = useCallback(
    (box: Box): HTMLCanvasElement => {
      const original = enhanceSmallCanvas(cropToCanvas(source!.canvas, box));
      const ctx = original.getContext("2d", { willReadFrequently: true })!;
      const img = ctx.getImageData(0, 0, original.width, original.height);
      let result = removeBackground(img, {
        ...DEFAULT_BG_OPTIONS,
        feather: 0.5,
        bgColorHint: bgHintRef.current,
        removeHoles: true,
      });
      // sanity guard: a detected cell always contains artwork. If the keying
      // nuked nearly everything, retry with the conservative pipeline.
      let opaque = 0;
      for (let i = 3; i < result.image.data.length; i += 4) {
        if (result.image.data[i] > 128) opaque++;
      }
      if (opaque < original.width * original.height * 0.02) {
        result = removeBackground(img, {
          ...DEFAULT_BG_OPTIONS,
          feather: 0.5,
          bgColorHint: bgHintRef.current,
          removeHoles: true,
          removeGuideLines: false,
          tolerance: Math.max(24, Math.round(DEFAULT_BG_OPTIONS.tolerance * 0.85)),
        });
      }
      const out = document.createElement("canvas");
      out.width = original.width;
      out.height = original.height;
      out.getContext("2d")!.putImageData(result.image, 0, 0);
      return out;
    },
    [source]
  );

  const cropAll = useCallback(async () => {
    if (!source || boxes.length === 0) return;
    setCropping(true);
    try {
      const inputs: Array<{ name: string; canvas: HTMLCanvasElement; source: "sheet" }> = [];
      for (let i = 0; i < boxes.length; i++) {
        inputs.push({
          name: frameName("sprite_{i}", i, boxes.length),
          canvas: processCrop(boxes[i]),
          source: "sheet",
        });
        await new Promise((r) => setTimeout(r, 0));
      }
      addFrames(inputs);
      toast.success(`${inputs.length} برش به انیماتور اضافه شد`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "برش ناموفق بود");
    } finally {
      setCropping(false);
    }
  }, [addFrames, boxes, processCrop, source]);

  const downloadOne = useCallback(
    async (box: Box, index: number) => {
      if (!source) return;
      try {
        const processed = processCrop(box);
        const name = frameName("sprite_{i}", index, boxes.length);
        const { blob } = await canvasToBlob(processed, "image/png", 1);
        const res = await saveBlob(blob, `${name}.png`);
        if (res === "failed") toast.error("دانلود ناموفق بود");
      } catch {
        toast.error("دانلود ناموفق بود");
      }
    },
    [boxes.length, processCrop, source]
  );

  const thumbs = useMemo(() => {
    if (!source) return [];
    return boxes.map((b, i) => ({
      id: b.id,
      index: i,
      thumb: makeThumb(cropToCanvas(source.canvas, b), 132),
    }));
  }, [boxes, source]);

  const cycleColumns = (dir: 1 | -1) => {
    if (!source) return;
    // 0 = automatic, then 2..24
    let next = colOverride + dir;
    if (next < 0) next = 24;
    if (next > 24) next = 0;
    setColOverride(next);
    runDetect(source.canvas, next);
  };

  if (!source) {
    /* ---------- upload ---------- */
    return (
      <div className="flex flex-col gap-3">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => void onFiles(e.target.files)}
        />
        <div
          role="button"
          tabIndex={0}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => e.key === "Enter" && fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void onFiles(e.dataTransfer.files);
          }}
          data-hot={dragOver}
          className="dropzone-frame group cursor-pointer"
        >
          <div
            className={`relative flex min-h-[340px] flex-col items-center justify-center gap-5 overflow-hidden rounded-[1.45rem] bg-surface transition-colors sm:min-h-[440px] ${
              dragOver ? "bg-cyan-tint/40" : ""
            }`}
          >
            <div className="pointer-events-none absolute -top-28 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-cyan-tint blur-3xl" />
            <div className="pointer-events-none absolute inset-x-10 bottom-4 h-24 rounded-full bg-cyan-tint/40 blur-2xl" />

            <div className="hero-icon-float hero-icon-glow relative grid h-24 w-24 place-items-center rounded-[1.4rem] bg-gradient-to-br from-cyan-500 to-teal-600 shadow-xl">
              <Scissors className="h-11 w-11 text-white drop-shadow" />
            </div>

            <div className="relative text-center">
              <p className="text-xl font-black tracking-tight text-foreground">
                اسپرایت‌شیتت رو رها کن
              </p>
              <p className="mt-1.5 flex items-center justify-center gap-1.5 text-xs font-bold text-faint">
                <Sparkles className="h-3.5 w-3.5 text-cyan-ink" />
                گرید فریم‌ها خودکار تشخیص داده می‌شه
              </p>
            </div>

            <span className="btn-shine relative flex items-center gap-2 rounded-2xl bg-gradient-to-br from-cyan-500 to-teal-600 px-6 py-3 text-sm font-extrabold text-white shadow-lg transition-transform group-hover:scale-105 group-active:scale-95">
              <ImageUp className="h-4.5 w-4.5" />
              انتخاب فایل
            </span>

            <div className="relative flex flex-wrap items-center justify-center gap-1.5" dir="ltr">
              {["PNG", "JPG", "WebP"].map((f) => (
                <span
                  key={f}
                  className="rounded-lg border border-line bg-chip px-2.5 py-1 text-[10px] font-extrabold tracking-wide text-soft"
                >
                  {f}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ---------- editor ---------- */
  const gridLabel = detecting
    ? "…"
    : grid && grid.mode === "grid" && grid.columns > 0
      ? `${grid.columns}×${grid.rows}`
      : `${boxes.length}`;

  return (
    <div className="flex flex-col gap-3">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void onFiles(e.target.files)}
      />

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1.5 rounded-xl border border-line bg-chip px-3 py-2 text-xs font-bold text-soft transition-colors hover:border-cyan-line hover:text-foreground"
        >
          <ImageUp className="h-4 w-4" />
          تعویض
        </button>
        <span
          className="flex items-center gap-1.5 rounded-xl border border-cyan-line bg-cyan-tint px-2.5 py-2 text-xs font-bold text-cyan-ink tabular-nums"
          title={
            grid && grid.mode === "grid"
              ? `سلول ${grid.cellW}×${grid.cellH} — همه فریم‌ها هم‌اندازه‌اند`
              : undefined
          }
        >
          <Sparkles className="h-4 w-4" />
          {gridLabel}
        </span>
        {/* manual grid override */}
        <div className="flex items-center gap-1 rounded-xl border border-line bg-chip p-1">
          <button
            type="button"
            aria-label="ستون کمتر"
            onClick={() => cycleColumns(-1)}
            className="grid h-7 w-7 place-items-center rounded-lg text-soft transition-colors hover:bg-cyan-tint hover:text-cyan-ink"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <span className="min-w-[52px] text-center text-[11px] font-bold text-soft tabular-nums">
            {colOverride >= 1 ? `${colOverride} ستون` : "گرید: خودکار"}
          </span>
          <button
            type="button"
            aria-label="ستون بیشتر"
            onClick={() => cycleColumns(1)}
            className="grid h-7 w-7 place-items-center rounded-lg text-soft transition-colors hover:bg-cyan-tint hover:text-cyan-ink"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        </div>
        <button
          type="button"
          onClick={() => runDetect(source.canvas, colOverride)}
          disabled={detecting}
          className="flex items-center gap-1.5 rounded-xl border border-line bg-chip px-3 py-2 text-xs font-bold text-soft transition-colors hover:border-cyan-line hover:text-foreground disabled:opacity-50"
        >
          {detecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          تشخیص دوباره
        </button>
        {boxes.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setBoxes([]);
              setSelectedId(null);
            }}
            className="rounded-xl border border-line bg-chip px-3 py-2 text-xs font-bold text-soft transition-colors hover:border-rose-line hover:text-rose-ink"
          >
            پاک‌کردن
          </button>
        )}
        <button
          type="button"
          onClick={close}
          aria-label="بستن"
          className="mr-auto grid h-9 w-9 place-items-center rounded-xl border border-line bg-chip text-soft transition-colors hover:border-rose-line hover:text-rose-ink"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="h-[52dvh] min-h-[320px] overflow-hidden rounded-2xl border border-line float-bar sm:h-[520px]">
        <BoxCanvas
          image={source.canvas}
          boxes={boxes}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onChange={setBoxes}
        />
      </div>

      {thumbs.length > 0 && (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {thumbs.map((t) => (
            <div
              key={t.id}
              role="button"
              tabIndex={0}
              onClick={() => setSelectedId(t.id)}
              onKeyDown={(e) => e.key === "Enter" && setSelectedId(t.id)}
              className={cn(
                "group relative cursor-pointer overflow-hidden rounded-xl border transition-all",
                selectedId === t.id
                  ? "border-cyan-line-strong neon-ring"
                  : "border-line hover:border-cyan-line"
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={t.thumb}
                alt={`کادر ${t.index + 1}`}
                className="checker-dark aspect-square w-full object-contain"
              />
              <span className="absolute right-1 top-1 rounded bg-black/60 px-1 font-mono text-[10px] text-white" dir="ltr">
                {t.index + 1}
              </span>
              <div className="absolute inset-x-0 bottom-0 flex justify-center gap-1 bg-black/45 py-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                <button
                  type="button"
                  aria-label="دانلود"
                  onClick={(e) => {
                    e.stopPropagation();
                    void downloadOne(boxes[t.index], t.index);
                  }}
                  className="rounded p-1 text-white/90 hover:text-cyan-ink"
                >
                  <Download className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="حذف"
                  onClick={(e) => {
                    e.stopPropagation();
                    setBoxes((prev) => prev.filter((x) => x.id !== t.id));
                    if (selectedId === t.id) setSelectedId(null);
                  }}
                  className="rounded p-1 text-white/90 hover:text-rose-ink"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* actions */}
      <div className="sticky-safe pb-2">
        <div className="float-bar flex items-center gap-2 rounded-2xl border border-line panel-glass p-2.5">
          <button
            type="button"
            onClick={() => void cropAll()}
            disabled={cropping || boxes.length === 0}
            className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl metallic-gradient text-sm font-black text-white transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-40"
          >
            {cropping ? (
              <Loader2 className="h-4.5 w-4.5 animate-spin" />
            ) : (
              <Scissors className="h-4.5 w-4.5" />
            )}
            برش و افزودن به انیماتور
            {boxes.length > 0 && (
              <span className="rounded-md bg-black/25 px-1.5 py-0.5 text-xs tabular-nums">
                {boxes.length}
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
