"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Boxes, Download, ImageUp, Loader2, Scissors, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { BoxCanvas } from "@/components/studio/box-canvas";
import { detectBoxes, type Box } from "@/lib/cv/detect-boxes";
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

export function SheetCutter() {
  const addFrames = useFrameStore((s) => s.addFrames);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [source, setSource] = useState<SourceImage | null>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [cropping, setCropping] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const bgHintRef = useRef<RGB | null>(null);

  const loadCanvas = useCallback((canvas: HTMLCanvasElement, name: string) => {
    setSource({ canvas, name });
    setBoxes([]);
    setSelectedId(null);
    setDetecting(true);
    // auto-detect right after upload
    window.setTimeout(() => {
      try {
        const result = detectBoxes(canvas, { tolerance: 42 });
        bgHintRef.current = result.bgColor;
        setBoxes(result.boxes);
        if (result.boxes.length > 0) {
          toast.success(`${result.boxes.length} آیتم پیدا شد`);
        }
      } catch {
        toast.error("تشخیص ناموفق بود");
      } finally {
        setDetecting(false);
      }
    }, 50);
  }, []);

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
    setSelectedId(null);
    bgHintRef.current = null;
  };

  const processCrop = useCallback((box: Box): HTMLCanvasElement => {
    const original = enhanceSmallCanvas(cropToCanvas(source!.canvas, box));
    const img = original
      .getContext("2d", { willReadFrequently: true })!
      .getImageData(0, 0, original.width, original.height);
    const result = removeBackground(img, {
      ...DEFAULT_BG_OPTIONS,
      feather: 0.5,
      bgColorHint: bgHintRef.current,
    });
    const out = document.createElement("canvas");
    out.width = original.width;
    out.height = original.height;
    out.getContext("2d")!.putImageData(result.image, 0, 0);
    return out;
  }, [source]);

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
          className={`relative flex min-h-[380px] cursor-pointer flex-col items-center justify-center gap-4 overflow-hidden rounded-3xl border-2 border-dashed bg-surface transition-all sm:min-h-[440px] ${
            dragOver ? "border-cyan-line-strong bg-cyan-tint/30" : "border-line-strong hover:border-cyan-line"
          }`}
        >
          <div className="pointer-events-none absolute -top-24 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-cyan-tint blur-3xl" />
          <div className="relative grid h-20 w-20 place-items-center rounded-2xl border border-cyan-line bg-cyan-tint shadow-xl">
            <Scissors className="h-9 w-9 text-cyan-ink" />
          </div>
          <div className="relative text-center">
            <p className="text-lg font-black text-foreground">انتخاب تصویر</p>
            <p className="mt-1 text-xs text-faint">آیتم‌ها خودکار برش می‌خورند</p>
          </div>
          <p className="relative text-[11px] text-faint" dir="ltr">
            PNG · JPG · WebP
          </p>
        </div>
      </div>
    );
  }

  /* ---------- editor ---------- */
  return (
    <div className="flex flex-col gap-3">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void onFiles(e.target.files)}
      />

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1.5 rounded-xl border border-line bg-chip px-3 py-2 text-xs font-bold text-soft transition-colors hover:border-cyan-line hover:text-foreground"
        >
          <ImageUp className="h-4 w-4" />
          تعویض
        </button>
        <span className="flex items-center gap-1.5 rounded-xl border border-cyan-line bg-cyan-tint px-2.5 py-2 text-xs font-bold text-cyan-ink tabular-nums">
          <Boxes className="h-4 w-4" />
          {detecting ? "…" : boxes.length}
        </span>
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
