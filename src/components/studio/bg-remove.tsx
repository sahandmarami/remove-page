"use client";

import { useCallback, useRef, useState } from "react";
import { Download, Eraser, ImageUp, Loader2, Package, X } from "lucide-react";
import { toast } from "sonner";
import { autoRemoveBackground } from "@/lib/cv/auto-remove";
import { canvasToBlob, enhanceSmallCanvas, saveBlob } from "@/lib/cv/frame-utils";
import { loadImageToCanvas } from "@/lib/cv/video-extract";
import { useFrameStore } from "@/lib/store";

/** processing above this size is downscaled to keep the phone smooth */
const MAX_PROCESS_SIDE = 2200;

interface RemoveResult {
  canvas: HTMLCanvasElement;
  resultUrl: string;
  removedPercent: number;
}

export function BgRemove() {
  const addFrame = useFrameStore((s) => s.addFrame);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [hasSource, setHasSource] = useState(false);
  const [result, setResult] = useState<RemoveResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const jobRef = useRef(0);

  const process = useCallback(async (canvas: HTMLCanvasElement, fname: string) => {
    const job = ++jobRef.current;
    setBusy(true);
    try {
      await new Promise((r) => window.setTimeout(r, 30));
      if (job !== jobRef.current) return;

      // downscale huge photos for a smooth phone experience
      let work = canvas;
      const maxSide = Math.max(canvas.width, canvas.height);
      if (maxSide > MAX_PROCESS_SIDE) {
        const s = MAX_PROCESS_SIDE / maxSide;
        const small = document.createElement("canvas");
        small.width = Math.round(canvas.width * s);
        small.height = Math.round(canvas.height * s);
        const c = small.getContext("2d")!;
        c.imageSmoothingQuality = "high";
        c.drawImage(canvas, 0, 0, small.width, small.height);
        work = small;
      }
      // small sources get upscaled 2× so the export is never lower quality
      work = enhanceSmallCanvas(work);

      const ctx = work.getContext("2d", { willReadFrequently: true })!;
      const img = ctx.getImageData(0, 0, work.width, work.height);
      const res = autoRemoveBackground(img, { feather: 0.5, removeHoles: true });

      const out = document.createElement("canvas");
      out.width = work.width;
      out.height = work.height;
      out.getContext("2d")!.putImageData(res.image, 0, 0);

      if (job !== jobRef.current) return;
      setResult({
        canvas: out,
        resultUrl: out.toDataURL("image/png"),
        removedPercent: Math.round(res.removedRatio * 100),
      });
      setName(fname);
    } catch (err) {
      if (job === jobRef.current) {
        toast.error(err instanceof Error ? err.message : "پردازش ناموفق بود");
      }
    } finally {
      if (job === jobRef.current) setBusy(false);
    }
  }, []);

  const onFiles = useCallback(
    async (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        toast.error("فقط تصویر یا گیف");
        return;
      }
      try {
        const { canvas } = await loadImageToCanvas(file);
        setHasSource(true);
        setResult(null);
        void process(canvas, file.name);
      } catch {
        toast.error("بارگذاری ناموفق بود");
      }
    },
    [process]
  );

  const close = () => {
    jobRef.current += 1;
    setHasSource(false);
    setResult(null);
    setBusy(false);
    setName("");
  };

  const download = useCallback(async () => {
    if (!result) return;
    const base = (name || "image").replace(/\.[^.]+$/, "") || "image";
    try {
      const { blob } = await canvasToBlob(result.canvas, "image/png", 1);
      const res = await saveBlob(blob, `${base}-transparent.png`);
      if (res === "failed") toast.error("دانلود ناموفق بود — دوباره بزنید");
      else if (res !== "cancelled") toast.success("ذخیره شد");
    } catch {
      toast.error("خروجی گرفتن ناموفق بود");
    }
  }, [name, result]);

  const sendToAnimator = useCallback(() => {
    if (!result) return;
    const base = (name || "image").replace(/\.[^.]+$/, "") || "image";
    addFrame({ name: `${base}_001`, canvas: result.canvas, source: "remove" });
    toast.success("به انیماتور اضافه شد");
  }, [addFrame, name, result]);

  return (
    <div className="flex flex-col gap-3">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void onFiles(e.target.files)}
      />

      {!hasSource ? (
        /* ---------- upload ---------- */
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
            dragOver ? "border-violet-line-strong bg-violet-tint/30" : "border-line-strong hover:border-violet-line"
          }`}
        >
          <div className="pointer-events-none absolute -top-24 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-violet-tint blur-3xl" />
          <div className="relative grid h-20 w-20 place-items-center rounded-2xl metallic-gradient shadow-xl">
            <Eraser className="h-9 w-9 text-white" />
          </div>
          <div className="relative text-center">
            <p className="text-lg font-black text-foreground">انتخاب تصویر</p>
            <p className="mt-1 text-xs text-faint">یا بکشید و رها کنید</p>
          </div>
          <p className="relative text-[11px] text-faint" dir="ltr">
            PNG · JPG · WebP · GIF
          </p>
        </div>
      ) : (
        /* ---------- live preview ---------- */
        <>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 rounded-xl border border-line bg-chip px-3 py-2 text-xs font-bold text-soft transition-colors hover:border-violet-line hover:text-foreground"
            >
              <ImageUp className="h-4 w-4" />
              تعویض
            </button>
            {result && (
              <span className="rounded-xl border border-emerald-line bg-emerald-tint px-2.5 py-2 text-xs font-bold text-emerald-ink tabular-nums">
                {result.removedPercent}٪ حذف شد
              </span>
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

          <div className="relative overflow-hidden rounded-2xl border border-line checker-dark">
            {result ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={result.resultUrl}
                alt="نتیجه"
                className="mx-auto block h-auto max-h-[560px] w-auto max-w-full"
                draggable={false}
              />
            ) : (
              <div className="grid min-h-[300px] place-items-center">
                <Loader2 className="h-7 w-7 animate-spin text-violet-ink" />
              </div>
            )}
            {busy && result && (
              <div className="absolute inset-0 grid place-items-center bg-overlay/50 backdrop-blur-sm">
                <Loader2 className="h-7 w-7 animate-spin text-cyan-ink" />
              </div>
            )}
          </div>

          {/* actions */}
          <div className="sticky-safe pb-2">
            <div className="float-bar flex items-center gap-2 rounded-2xl border border-line panel-glass p-2.5">
              <button
                type="button"
                onClick={() => void download()}
                disabled={!result || busy}
                className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl metallic-gradient text-sm font-black text-white transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-40"
              >
                <Download className="h-4.5 w-4.5" />
                دانلود PNG
              </button>
              <button
                type="button"
                onClick={sendToAnimator}
                disabled={!result || busy}
                className="flex h-11 items-center justify-center gap-2 rounded-xl border border-violet-line bg-violet-tint px-4 text-sm font-black text-violet-ink transition-all hover:border-violet-line-strong active:scale-[0.98] disabled:opacity-40"
              >
                <Package className="h-4.5 w-4.5" />
                <span className="hidden sm:inline">افزودن به انیماتور</span>
                <span className="sm:hidden">انیماتور</span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
