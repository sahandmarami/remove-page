"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Contrast,
  Download,
  Eraser,
  ImageUp,
  Loader2,
  Package,
  SlidersHorizontal,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { autoRemoveBackground } from "@/lib/cv/auto-remove";
import { rgbToHex, type RGB } from "@/lib/cv/color-utils";
import {
  canvasToBlob,
  downloadBlob,
} from "@/lib/cv/frame-utils";
import { loadImageToCanvas } from "@/lib/cv/video-extract";
import { generateSampleSheet } from "@/lib/cv/test-generators";
import { useFrameStore } from "@/lib/store";
import { cn } from "@/lib/utils";

/** processing above this size is downscaled to keep the phone smooth */
const MAX_PROCESS_SIDE = 2200;

interface RemoveState {
  canvas: HTMLCanvasElement;
  originalUrl: string;
  resultUrl: string;
  bgColor: RGB;
  tolerance: number;
  removedPercent: number;
  outW: number;
  outH: number;
}

export function BgRemove() {
  const addFrame = useFrameStore((s) => s.addFrame);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [srcCanvas, setSrcCanvas] = useState<HTMLCanvasElement | null>(null);
  const [result, setResult] = useState<RemoveState | null>(null);
  const [busy, setBusy] = useState(false);

  // minimal auto settings
  const [sensitivity, setSensitivity] = useState(100); // 50..170 (%)
  const [feather, setFeather] = useState(1.0);
  const [removeHoles, setRemoveHoles] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // compare slider
  const [wipe, setWipe] = useState(45);
  const dragRef = useRef(false);
  const compareRef = useRef<HTMLDivElement>(null);

  const runJobRef = useRef(0);

  const process = useCallback(
    async (canvas: HTMLCanvasElement, fname: string) => {
      const job = ++runJobRef.current;
      setBusy(true);
      try {
        // let the spinner paint before the sync CV pass
        await new Promise((r) => window.setTimeout(r, 30));
        if (job !== runJobRef.current) return;

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

        const ctx = work.getContext("2d", { willReadFrequently: true })!;
        const img = ctx.getImageData(0, 0, work.width, work.height);
        const res = autoRemoveBackground(img, {
          sensitivity: sensitivity / 100,
          feather,
          removeHoles,
        });

        const out = document.createElement("canvas");
        out.width = work.width;
        out.height = work.height;
        out.getContext("2d")!.putImageData(res.image, 0, 0);

        if (job !== runJobRef.current) return;
        setResult({
          canvas: out,
          originalUrl: canvas.toDataURL("image/png"),
          resultUrl: out.toDataURL("image/png"),
          bgColor: res.bgColor,
          tolerance: res.autoTolerance,
          removedPercent: Math.round(res.removedRatio * 100),
          outW: out.width,
          outH: out.height,
        });
        setName(fname);
      } catch (err) {
        toast.error("حذف پس‌زمینه ناموفق بود", {
          description: err instanceof Error ? err.message : undefined,
        });
      } finally {
        if (job === runJobRef.current) setBusy(false);
      }
    },
    [feather, removeHoles, sensitivity]
  );

  const loadCanvas = useCallback(
    (canvas: HTMLCanvasElement, fname: string) => {
      setSrcCanvas(canvas);
      setResult(null);
      setWipe(45);
      void process(canvas, fname);
    },
    [process]
  );

  const onFiles = useCallback(
    async (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        toast.error("فقط فایل تصویری پذیرفته می‌شود");
        return;
      }
      try {
        const { canvas } = await loadImageToCanvas(file);
        loadCanvas(canvas, file.name);
      } catch {
        toast.error("بارگذاری تصویر ناموفق بود");
      }
    },
    [loadCanvas]
  );

  const loadSample = useCallback(() => {
    const canvas = generateSampleSheet();
    loadCanvas(canvas, "sample.png");
  }, [loadCanvas]);

  // re-run when advanced settings change (debounced)
  useEffect(() => {
    if (!srcCanvas) return;
    const t = window.setTimeout(() => void process(srcCanvas, name || "image"), 350);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sensitivity, feather, removeHoles]);

  // ---------- compare slider drag ----------
  const updateWipe = useCallback((clientX: number) => {
    const el = compareRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pct = ((clientX - rect.left) / rect.width) * 100;
    setWipe(Math.max(0, Math.min(100, pct)));
  }, []);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (dragRef.current) updateWipe(e.clientX);
    };
    const up = () => {
      dragRef.current = false;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [updateWipe]);

  // ---------- output ----------
  const download = useCallback(async () => {
    if (!result) return;
    const blob = await canvasToBlob(result.canvas, "image/png", 1);
    const base = (name || "image").replace(/\.[^.]+$/, "") || "image";
    downloadBlob(blob, `${base}-transparent.png`);
    toast.success("PNG شفاف دانلود شد", {
      description: `${result.outW}×${result.outH} — با لبه‌ی مات‌شده و بدون هاله`,
    });
  }, [name, result]);

  const sendToAnimator = useCallback(() => {
    if (!result) return;
    const base = (name || "image").replace(/\.[^.]+$/, "") || "image";
    const id = addFrame({ name: `${base}_001`, canvas: result.canvas, source: "remove" });
    toast.success("به انیماتور اضافه شد", {
      description: "در تب «انیماتور و خروجی» آماده فلپ‌بوک و اسپرایت‌شیت است",
    });
    return id;
  }, [addFrame, name, result]);

  const sourceReady = !!srcCanvas;

  return (
    <div className="flex flex-col gap-4">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => onFiles(e.target.files)}
      />

      {!sourceReady ? (
        /* ---------------- empty state: graphical dropzone ---------------- */
        <div
          className="hero-dots relative overflow-hidden rounded-3xl border-2 border-dashed border-violet-line bg-surface p-8 text-center sm:p-12"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            onFiles(e.dataTransfer.files);
          }}
        >
          <div className="pointer-events-none absolute -top-24 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-violet-tint blur-3xl" />
          <div className="pointer-events-none absolute -bottom-28 right-1/4 h-56 w-56 rounded-full bg-cyan-tint blur-3xl" />
          <div className="relative">
            <div className="hero-icon-glow mx-auto grid h-20 w-20 place-items-center rounded-2xl metallic-gradient">
              <Eraser className="h-9 w-9 text-white" />
            </div>
            <h2 className="mt-5 text-xl font-black metallic-text sm:text-2xl">
              تصویر را بیندازید، پس‌زمینه خودش حذف می‌شود
            </h2>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-soft">
              رنگ پس‌زمینه به‌صورت خودکار تشخیص داده می‌شود و با ماتینگ لبه‌ی
              زیرپیکسلی تمیز جدا می‌شود — بدون هیچ تنظیماتی.
            </p>

            <div className="mx-auto mt-7 flex max-w-md flex-col gap-3 sm:flex-row">
              <div
                role="button"
                tabIndex={0}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => e.key === "Enter" && fileInputRef.current?.click()}
                className="group flex-1 cursor-pointer rounded-2xl metallic-gradient p-[1.5px] transition-transform hover:scale-[1.02]"
              >
                <div className="flex h-full items-center gap-3 rounded-[calc(1rem-1px)] bg-surface p-4">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-violet-line-strong bg-violet-tint text-violet-ink">
                    <Upload className="h-5 w-5" />
                  </span>
                  <span className="text-right">
                    <span className="block text-sm font-black text-foreground">آپلود تصویر</span>
                    <span className="mt-0.5 block text-xs text-soft">
                      کشیدن و رها کردن هم کار می‌کند
                    </span>
                  </span>
                </div>
              </div>

              <div
                role="button"
                tabIndex={0}
                onClick={loadSample}
                onKeyDown={(e) => e.key === "Enter" && loadSample()}
                className="flex-1 cursor-pointer rounded-2xl border border-cyan-line bg-cyan-tint p-4 transition-all hover:scale-[1.02] hover:border-cyan-line-strong"
              >
                <div className="flex h-full items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-cyan-line-strong bg-cyan-tint text-cyan-ink">
                    <Sparkles className="h-5 w-5" />
                  </span>
                  <span className="text-right">
                    <span className="block text-sm font-black text-cyan-ink">تصویر نمونه</span>
                    <span className="mt-0.5 block text-xs text-soft">یک کلیک — بدون آپلود</span>
                  </span>
                </div>
              </div>
            </div>

            <p className="mt-6 text-xs text-faint" dir="ltr">
              PNG · JPG · WebP — Drag &amp; Drop
            </p>
          </div>
        </div>
      ) : (
        /* ---------------- ready state ---------------- */
        <>
          <div className="flex flex-wrap items-center gap-2 rounded-2xl panel-glass p-2.5">
            <Button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="metallic-gradient text-white font-bold glow-purple hover:brightness-110"
            >
              <ImageUp className="h-4 w-4" />
              تصویر دیگر
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={loadSample}
              className="border border-line bg-chip text-soft hover:border-cyan-line-strong"
            >
              <Sparkles className="h-4 w-4 text-cyan-ink" />
              نمونه
            </Button>
            {result && (
              <span className="flex items-center gap-1.5 rounded-lg border border-line bg-chip px-2.5 py-1.5 text-xs text-soft">
                <span
                  className="h-3 w-3 rounded-full border border-line-strong"
                  style={{ backgroundColor: rgbToHex(result.bgColor) }}
                />
                پس‌زمینه: <span dir="ltr">{rgbToHex(result.bgColor)}</span>
                <span className="text-emerald-ink">· حذف {result.removedPercent}٪</span>
              </span>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setSrcCanvas(null);
                setResult(null);
                setName("");
              }}
              className="mr-auto text-soft hover:text-rose-ink"
            >
              <X className="h-4 w-4" />
              بستن
            </Button>
          </div>

          {/* ---------------- compare viewer ---------------- */}
          <div
            ref={compareRef}
            onPointerDown={(e) => {
              dragRef.current = true;
              updateWipe(e.clientX);
            }}
            className="relative select-none overflow-hidden rounded-2xl border border-line checker-dark"
          >
            {result ? (
              <>
                {/* cleaned layer (base) */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={result.resultUrl}
                  alt="تصویر بدون پس‌زمینه"
                  className="mx-auto block h-auto max-h-[520px] w-auto max-w-full"
                  draggable={false}
                />
                {/* original layer clipped from the left */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={result.originalUrl}
                  alt="تصویر اصلی"
                  className="absolute inset-0 mx-auto block h-auto max-h-[520px] w-auto max-w-full"
                  style={{ clipPath: `inset(0 0 0 ${wipe}%)` }}
                  draggable={false}
                />

                {/* divider handle */}
                <div
                  className="pointer-events-none absolute inset-y-0 w-0.5 bg-white/90 shadow-[0_0_12px_rgba(255,255,255,0.55)]"
                  style={{ left: `${wipe}%` }}
                >
                  <span className="absolute top-1/2 left-1/2 grid h-9 w-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-line-strong bg-surface shadow-lg">
                    <Contrast className="h-4 w-4 text-foreground" />
                  </span>
                </div>

                <span className="absolute right-3 top-3 rounded-md bg-overlay px-2 py-1 text-xs font-bold text-foreground border border-line backdrop-blur">
                  اصلی
                </span>
                <span className="absolute left-3 top-3 rounded-md bg-overlay px-2 py-1 text-xs font-bold text-cyan-ink border border-line backdrop-blur">
                  شفاف
                </span>

                {busy && (
                  <div className="absolute inset-0 grid place-items-center bg-overlay/60 backdrop-blur-sm">
                    <Loader2 className="h-8 w-8 animate-spin text-cyan-ink" />
                  </div>
                )}
              </>
            ) : (
              <div className="grid h-72 place-items-center">
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="h-8 w-8 animate-spin text-violet-ink" />
                  <p className="text-sm font-bold text-foreground">
                    در حال تشخیص و حذف پس‌زمینه…
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* ---------------- output actions ---------------- */}
          {result && !busy && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                onClick={() => void download()}
                className="metallic-gradient text-white font-bold glow-purple hover:brightness-110"
              >
                <Download className="h-4 w-4" />
                دانلود PNG شفاف
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={sendToAnimator}
                className="border border-violet-line bg-violet-tint text-violet-ink hover:border-violet-line-strong"
              >
                <Package className="h-4 w-4" />
                افزودن به انیماتور
              </Button>
              <span className="text-xs text-faint" dir="ltr">
                {result.outW}×{result.outH}
              </span>
            </div>
          )}

          {/* ---------------- collapsed advanced settings ---------------- */}
          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <div className="rounded-xl panel-glass">
              <CollapsibleTrigger className="flex w-full items-center gap-2 px-4 py-3 text-sm font-bold text-soft hover:text-foreground">
                <SlidersHorizontal className="h-4 w-4 text-violet-ink" />
                تنظیمات پیشرفته
                <span className="text-xs font-normal text-faint">
                  (اگر حذف خودکار راضی‌کننده نبود)
                </span>
                <svg
                  className={cn("mr-auto h-4 w-4 transition-transform", advancedOpen && "rotate-180")}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4 border-t border-line px-4 py-4">
                <div>
                  <div className="flex justify-between text-xs text-soft">
                    <span>حساسیت حذف</span>
                    <span className="text-cyan-ink">{sensitivity}٪</span>
                  </div>
                  <Slider
                    value={[sensitivity]}
                    min={50}
                    max={170}
                    step={5}
                    onValueChange={(v) => setSensitivity(v[0])}
                    className="mt-1.5"
                  />
                  <p className="mt-1 text-xs text-faint">
                    بالاتر = پس‌زمینه‌ی بیشتر حذف می‌شود؛ پایین‌تر = محافظه‌کارانه‌تر.
                  </p>
                </div>
                <div>
                  <div className="flex justify-between text-xs text-soft">
                    <span>نرمی لبه (Feather)</span>
                    <span className="text-cyan-ink">{feather.toFixed(1)}px</span>
                  </div>
                  <Slider
                    value={[feather]}
                    min={0}
                    max={4}
                    step={0.2}
                    onValueChange={(v) => setFeather(v[0])}
                    className="mt-1.5"
                  />
                </div>
                <div className="flex items-center justify-between rounded-lg border border-line bg-chip px-3 py-2">
                  <Label className="text-xs text-soft">حذف حفره‌های محصور (فضای بین دست و پا)</Label>
                  <Switch checked={removeHoles} onCheckedChange={setRemoveHoles} aria-label="حذف حفره‌ها" />
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
        </>
      )}
    </div>
  );
}
