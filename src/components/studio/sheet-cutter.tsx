"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  Boxes,
  Cpu,
  Download,
  ImageUp,
  Layers,
  Loader2,
  Package,
  Pipette,
  ScanLine,
  ScanSearch,
  Scissors,
  Sparkles,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { BoxCanvas } from "@/components/studio/box-canvas";
import { MaskEditor } from "@/components/studio/mask-editor";
import { detectBoxes, makeBoxId, type Box } from "@/lib/cv/detect-boxes";
import { removeBackground, DEFAULT_BG_OPTIONS } from "@/lib/cv/bg-removal";
import { rgbToHex, type RGB } from "@/lib/cv/color-utils";
import {
  canvasToBlob,
  cropToCanvas,
  downloadBlob,
  downloadFramesZip,
  extFor,
  frameName,
  makeThumb,
} from "@/lib/cv/frame-utils";
import { loadImageToCanvas } from "@/lib/cv/video-extract";
import { generateSampleSheet } from "@/lib/cv/test-generators";
import { useFrameStore } from "@/lib/store";
import { cn } from "@/lib/utils";

interface SourceImage {
  canvas: HTMLCanvasElement;
  name: string;
  w: number;
  h: number;
}

const FEATURES = [
  {
    icon: ScanSearch,
    title: "تشخیص دوگانه",
    desc: "Vision AI سروری یا بینایی ماشین کاملاً آفلاین",
    cls: "border-violet-400/30 bg-violet-500/10 text-violet-300",
  },
  {
    icon: WandSparkles,
    title: "حذف پس‌زمینه",
    desc: "فیلودفیل با سد گرادیان Sobel و حذف حفره‌ها",
    cls: "border-cyan-400/30 bg-cyan-400/10 text-cyan-300",
  },
  {
    icon: Package,
    title: "برش و دانلود ZIP",
    desc: "همه برش‌ها یک‌جا، WebP شفاف با آلفای کامل",
    cls: "border-fuchsia-400/30 bg-fuchsia-500/10 text-fuchsia-300",
  },
] as const;

function SliderRow({
  label,
  display,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  display: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex justify-between text-xs text-slate-400">
        <span>{label}</span>
        <span className="text-cyan-300">{display}</span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(v[0])}
        className="mt-1.5"
      />
    </div>
  );
}

export function SheetCutter() {
  const addFrames = useFrameStore((s) => s.addFrames);
  const addFrame = useFrameStore((s) => s.addFrame);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [source, setSource] = useState<SourceImage | null>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detectTolerance, setDetectTolerance] = useState(42);
  const [aiBusy, setAiBusy] = useState(false);
  const [localBusy, setLocalBusy] = useState(false);

  const [bgEnabled, setBgEnabled] = useState(true);
  const [bgTolerance, setBgTolerance] = useState(DEFAULT_BG_OPTIONS.tolerance);
  const [edgeBarrier, setEdgeBarrier] = useState(DEFAULT_BG_OPTIONS.edgeBarrier);
  const [feather, setFeather] = useState(DEFAULT_BG_OPTIONS.feather);
  const [defringe, setDefringe] = useState(DEFAULT_BG_OPTIONS.defringe);
  const [removeHoles, setRemoveHoles] = useState(DEFAULT_BG_OPTIONS.removeHoles);
  const [holeCap, setHoleCap] = useState(DEFAULT_BG_OPTIONS.holeMaxPercent);
  const [bgSwatch, setBgSwatch] = useState<RGB | null>(null);

  const [prefix, setPrefix] = useState("sprite");
  const [autoDownload, setAutoDownload] = useState(true);
  const [cropping, setCropping] = useState(false);
  const [maskKey, setMaskKey] = useState(0);
  const [maskState, setMaskState] = useState<{
    original: HTMLCanvasElement;
    processed: HTMLCanvasElement;
    name: string;
  } | null>(null);

  const loadCanvas = useCallback((canvas: HTMLCanvasElement, name: string) => {
    setSource({ canvas, name, w: canvas.width, h: canvas.height });
    setBoxes([]);
    setSelectedId(null);
    setBgSwatch(null);
    toast.success("تصویر بارگذاری شد", { description: `${name} — ${canvas.width}×${canvas.height}` });
  }, []);

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
    loadCanvas(canvas, "sample-sheet.png");
  }, [loadCanvas]);

  const localDetect = useCallback(() => {
    if (!source) {
      toast.error("ابتدا یک تصویر بارگذاری کنید");
      return;
    }
    setLocalBusy(true);
    // let the spinner paint before the synchronous CV pass
    window.setTimeout(() => {
      try {
        const result = detectBoxes(source.canvas, { tolerance: detectTolerance });
        setBoxes(result.boxes);
        setSelectedId(null);
        setBgSwatch(result.bgColor);
        if (result.boxes.length === 0) {
          toast.warning("آیتمی پیدا نشد", {
            description: "آستانه حساسیت را کاهش دهید یا از تشخیص هوش مصنوعی استفاده کنید",
          });
        } else {
          toast.success(`${result.boxes.length} آیتم شناسایی شد`, {
            description: `رنگ پس‌زمینه: ${rgbToHex(result.bgColor)}`,
          });
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "خطا در تشخیص محلی");
      } finally {
        setLocalBusy(false);
      }
    }, 40);
  }, [detectTolerance, source]);

  const aiDetect = useCallback(async () => {
    if (!source) {
      toast.error("ابتدا یک تصویر بارگذاری کنید");
      return;
    }
    setAiBusy(true);
    try {
      // downscale for a light payload
      const maxSide = 1024;
      const scale = Math.min(1, maxSide / Math.max(source.w, source.h));
      const small = document.createElement("canvas");
      small.width = Math.round(source.w * scale);
      small.height = Math.round(source.h * scale);
      small.getContext("2d")!.drawImage(source.canvas, 0, 0, small.width, small.height);
      const dataUrl = small.toDataURL("image/jpeg", 0.85);

      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 100_000);
      const res = await fetch("/api/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: dataUrl, width: source.w, height: source.h }),
        signal: controller.signal,
      });
      window.clearTimeout(timer);
      const json = (await res.json()) as {
        ok: boolean;
        boxes?: Array<{ x: number; y: number; w: number; h: number; label?: string }>;
        error?: string;
      };
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `پاسخ سرور: ${res.status}`);
      }
      const mapped: Box[] = (json.boxes ?? []).map((b) => ({
        id: makeBoxId(),
        x: Math.round(b.x * source.w),
        y: Math.round(b.y * source.h),
        w: Math.round(b.w * source.w),
        h: Math.round(b.h * source.h),
        label: b.label,
      }));
      setBoxes(mapped);
      setSelectedId(null);
      if (mapped.length === 0) {
        toast.warning("هوش مصنوعی کادری برنگرداند", {
          description: "تشخیص محلی بینایی ماشین را امتحان کنید",
        });
      } else {
        toast.success(`${mapped.length} کادر از Vision AI دریافت شد`);
      }
    } catch (err) {
      const msg =
        err instanceof DOMException && err.name === "AbortError"
          ? "زمان پاسخ سرور به پایان رسید"
          : err instanceof Error
            ? err.message
            : "خطای ناشناخته";
      toast.error("تشخیص هوش مصنوعی ناموفق بود", { description: msg });
    } finally {
      setAiBusy(false);
    }
  }, [source]);

  const processCrop = useCallback(
    (box: Box): { original: HTMLCanvasElement; processed: HTMLCanvasElement } => {
      const original = cropToCanvas(source!.canvas, box);
      if (!bgEnabled) {
        return { original, processed: original };
      }
      const img = original.getContext("2d", { willReadFrequently: true })!.getImageData(
        0,
        0,
        original.width,
        original.height
      );
      const result = removeBackground(img, {
        tolerance: bgTolerance,
        edgeBarrier,
        feather,
        defringe,
        removeHoles,
        holeMaxPercent: holeCap,
      });
      const processed = document.createElement("canvas");
      processed.width = original.width;
      processed.height = original.height;
      processed.getContext("2d")!.putImageData(result.image, 0, 0);
      return { original, processed };
    },
    [bgEnabled, bgTolerance, defringe, edgeBarrier, feather, holeCap, removeHoles, source]
  );

  const openMaskEditor = useCallback(() => {
    if (!source) return;
    const box = boxes.find((b) => b.id === selectedId);
    if (!box) {
      toast.error("یک کادر را انتخاب کنید");
      return;
    }
    const { original, processed } = processCrop(box);
    const idx = boxes.findIndex((b) => b.id === selectedId);
    setMaskKey((k) => k + 1);
    setMaskState({
      original,
      processed,
      name: frameName(`${prefix.trim() || "sprite"}_{i}`, idx, boxes.length),
    });
  }, [boxes, prefix, processCrop, selectedId, source]);

  /** cut every box → add to animator → optionally download a transparent-WebP ZIP */
  const cropAll = useCallback(async () => {
    if (!source) return;
    if (boxes.length === 0) {
      toast.error("کادری برای برش وجود ندارد");
      return;
    }
    setCropping(true);
    try {
      const inputs: Array<{ name: string; canvas: HTMLCanvasElement; source: "sheet" }> = [];
      for (let i = 0; i < boxes.length; i++) {
        const { processed } = processCrop(boxes[i]);
        inputs.push({
          name: frameName(`${prefix.trim() || "sprite"}_{i}`, i, boxes.length),
          canvas: processed,
          source: "sheet",
        });
        // keep UI responsive
        await new Promise((r) => setTimeout(r, 0));
      }
      const n = addFrames(inputs);
      if (autoDownload) {
        toast.loading("در حال ساخت ZIP شفاف...", { id: "crop-zip" });
        await downloadFramesZip(inputs, `${prefix.trim() || "sprite"}-cut`, 0.95);
        toast.success(`${n} فایل برش‌شده دانلود شد`, {
          id: "crop-zip",
          description: bgEnabled
            ? "ZIP با فریم‌های WebP شفاف — در انیماتور هم آماده است"
            : "در تب انیماتور هم آماده است",
        });
      } else {
        toast.success(`${n} فریم به انیماتور اضافه شد`, {
          description: bgEnabled ? "با حذف پس‌زمینه و لبه نرم" : "برش مستقیم بدون حذف پس‌زمینه",
        });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "خطا در برش فریم‌ها");
    } finally {
      setCropping(false);
    }
  }, [addFrames, autoDownload, bgEnabled, boxes, prefix, processCrop, source]);

  /** download a single cut frame as transparent WebP */
  const downloadOneBox = useCallback(
    async (box: Box, index: number) => {
      if (!source) return;
      try {
        const { processed } = processCrop(box);
        const name = frameName(`${prefix.trim() || "sprite"}_{i}`, index, boxes.length);
        const { blob, actualType } = await canvasToBlob(processed, "image/webp", 0.95);
        downloadBlob(blob, `${name}.${extFor(actualType)}`);
        toast.success(`«${name}.webp» دانلود شد`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "دانلود فریم ناموفق بود");
      }
    },
    [boxes.length, prefix, processCrop, source]
  );

  // graphical thumbnails for detected boxes (recomputed only when boxes settle)
  const boxThumbs = useMemo(() => {
    if (!source) return [];
    return boxes.map((b, i) => {
      const crop = cropToCanvas(source.canvas, b);
      return {
        id: b.id,
        index: i,
        thumb: makeThumb(crop, 132),
        title: `${b.label ? `${b.label} — ` : ""}${Math.round(b.w)}×${Math.round(b.h)}`,
      };
    });
  }, [boxes, source]);

  const selectedBox = boxes.find((b) => b.id === selectedId) ?? null;

  // ---------- empty state: graphical dropzone hero ----------
  if (!source) {
    return (
      <div className="flex flex-col gap-4">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => void onFiles(e.target.files)}
        />
        <div
          className="hero-dots relative cursor-pointer overflow-hidden rounded-3xl border-2 border-dashed border-violet-400/25 bg-slate-950/40 p-8 text-center transition-colors hover:border-violet-400/50 sm:p-12"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void onFiles(e.dataTransfer.files);
          }}
        >
          <div className="pointer-events-none absolute -top-28 right-1/2 h-72 w-72 translate-x-1/2 rounded-full bg-violet-500/20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-28 left-1/4 h-56 w-56 rounded-full bg-cyan-400/10 blur-3xl" />
          <div className="relative">
            <div className="hero-icon-glow mx-auto grid h-20 w-20 place-items-center rounded-2xl metallic-gradient">
              <ImageUp className="h-9 w-9 text-white" />
            </div>
            <h2 className="mt-5 text-xl font-black metallic-text sm:text-2xl">
              شیت تصویر را اینجا رها کنید
            </h2>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-400">
              آیتم‌ها خودکار شناسایی می‌شوند، پس‌زمینه حذف می‌شود و با یک کلیک، همه فایل‌های
              برش‌خورده به‌صورت ZIP شفاف دانلود می‌شوند.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <Button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  fileInputRef.current?.click();
                }}
                className="metallic-gradient text-white font-bold glow-purple hover:brightness-110"
              >
                <ImageUp className="h-4 w-4" />
                انتخاب تصویر
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={(e) => {
                  e.stopPropagation();
                  loadSample();
                }}
                className="border border-white/10 bg-white/5 hover:border-cyan-400/40"
              >
                <Sparkles className="h-4 w-4 text-cyan-400" />
                شیت نمونه تستی
              </Button>
            </div>
            <p className="mt-3 text-[11px] text-slate-500" dir="ltr">
              PNG · JPG · WebP — Drag &amp; Drop
            </p>

            <div className="mx-auto mt-9 grid max-w-3xl gap-3 sm:grid-cols-3">
              {FEATURES.map((f) => (
                <div
                  key={f.title}
                  className="rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-right transition-colors hover:border-white/25"
                >
                  <span className={cn("mb-2.5 grid h-9 w-9 place-items-center rounded-xl border", f.cls)}>
                    <f.icon className="h-4.5 w-4.5" />
                  </span>
                  <p className="text-sm font-bold text-slate-200">{f.title}</p>
                  <p className="mt-1 text-[11px] leading-4 text-slate-500">{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---------- loaded state ----------
  return (
    <div className="flex flex-col gap-4">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void onFiles(e.target.files)}
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        {/* ---------- canvas column ---------- */}
        <div className="flex flex-col gap-3">
          {/* compact toolbar */}
          <div className="flex flex-wrap items-center gap-2 rounded-2xl panel-glass p-2.5">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => fileInputRef.current?.click()}
              className="border border-white/10 bg-white/5"
            >
              <ImageUp className="h-4 w-4" />
              تعویض تصویر
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={aiBusy}
              onClick={() => void aiDetect()}
              className="border border-violet-400/30 bg-violet-500/10 text-violet-200 hover:border-violet-400/60"
            >
              {aiBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cpu className="h-4 w-4" />}
              تشخیص AI
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={localBusy}
              onClick={localDetect}
              className="border border-cyan-400/30 bg-cyan-400/10 text-cyan-200 hover:border-cyan-400/60"
            >
              {localBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ScanLine className="h-4 w-4" />
              )}
              تشخیص محلی
            </Button>
            {bgSwatch && (
              <span
                className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-[11px] text-slate-400"
                title="رنگ پس‌زمینه تشخیص‌شده"
              >
                <span
                  className="h-3.5 w-3.5 rounded border border-white/25"
                  style={{ backgroundColor: rgbToHex(bgSwatch) }}
                />
                <span className="font-mono text-[10px]" dir="ltr">
                  {rgbToHex(bgSwatch)}
                </span>
              </span>
            )}
            <div className="mr-auto flex items-center gap-2">
              <span className="font-mono text-[11px] text-slate-500" dir="ltr">
                {source.w}×{source.h}
              </span>
              {boxes.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setBoxes([]);
                    setSelectedId(null);
                  }}
                  className="text-slate-400 hover:text-rose-300"
                >
                  <X className="h-4 w-4" />
                  پاک‌کردن کادرها
                </Button>
              )}
            </div>
          </div>

          <div
            className="h-[560px] overflow-hidden rounded-2xl border border-white/10 float-bar"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void onFiles(e.dataTransfer.files);
            }}
          >
            <BoxCanvas
              image={source.canvas}
              boxes={boxes}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onChange={setBoxes}
            />
          </div>
          <p className="px-1 text-[11px] text-slate-500">
            روی تصویر یک کادر بکشید تا آیتم جدیدی اضافه شود · درگ برای جابجایی · ۸ دستگیره برای
            تغییر اندازه
          </p>
        </div>

        {/* ---------- sidebar ---------- */}
        <aside className="flex flex-col gap-3">
          {/* detected boxes — graphical thumbnails */}
          <section className="rounded-2xl panel-glass p-4 space-y-3">
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-200">
              <Boxes className="h-4 w-4 text-violet-400" />
              کادرهای شناسایی‌شده
              <span className="mr-auto rounded-md bg-violet-500/20 px-2 py-0.5 text-xs text-violet-300">
                {boxes.length}
              </span>
            </h3>
            {boxes.length === 0 ? (
              <p className="rounded-xl border border-dashed border-white/15 bg-slate-950/40 px-3 py-4 text-center text-[11px] leading-5 text-slate-500">
                هنوز کادری نیست — با دکمه‌های تشخیص در بالا، یا کشیدن مستقیم روی تصویر کادر بسازید
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {boxThumbs.map((t) => (
                  <div
                    key={t.id}
                    role="button"
                    tabIndex={0}
                    title={t.title}
                    onClick={() => setSelectedId(t.id)}
                    onKeyDown={(e) => e.key === "Enter" && setSelectedId(t.id)}
                    className={cn(
                      "group relative cursor-pointer overflow-hidden rounded-xl border transition-all",
                      selectedId === t.id
                        ? "border-cyan-400/70 neon-ring"
                        : "border-white/10 hover:border-violet-400/50"
                    )}
                  >
                    <img
                      src={t.thumb}
                      alt={`کادر ${t.index + 1}`}
                      className="checker-dark h-16 w-full object-contain"
                    />
                    <span className="absolute right-1 top-1 rounded bg-violet-600/90 px-1 font-mono text-[9px] text-white" dir="ltr">
                      {t.index + 1}
                    </span>
                    <div className="absolute inset-0 flex items-center justify-center gap-1 bg-slate-950/70 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        type="button"
                        aria-label="دانلود این برش"
                        title="دانلود WebP شفاف"
                        onClick={(e) => {
                          e.stopPropagation();
                          void downloadOneBox(boxes[t.index], t.index);
                        }}
                        className="rounded-lg bg-slate-900/90 p-1.5 text-cyan-300 hover:text-cyan-200"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label="حذف کادر"
                        onClick={(e) => {
                          e.stopPropagation();
                          setBoxes((prev) => prev.filter((x) => x.id !== t.id));
                          if (selectedId === t.id) setSelectedId(null);
                        }}
                        className="rounded-lg bg-slate-900/90 p-1.5 text-rose-400 hover:text-rose-300"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* local detection settings */}
          <section className="rounded-2xl panel-glass p-4 space-y-3">
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-200">
              <ScanLine className="h-4 w-4 text-violet-400" />
              حساسیت تشخیص محلی
            </h3>
            <SliderRow
              label="آستانه تفکیک رنگ"
              display={String(detectTolerance)}
              value={detectTolerance}
              min={10}
              max={110}
              step={2}
              onChange={setDetectTolerance}
            />
            <p className="text-[11px] text-slate-500">
              کاملاً آفلاین روی دستگاه شما اجرا می‌شود.
            </p>
          </section>

          {/* background removal engine */}
          <section className="rounded-2xl panel-glass p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-bold text-slate-200">
                <WandSparkles className="h-4 w-4 text-cyan-400" />
                موتور حذف پس‌زمینه
              </h3>
              <Switch checked={bgEnabled} onCheckedChange={setBgEnabled} aria-label="حذف پس‌زمینه" />
            </div>

            <div className={cn("space-y-3", !bgEnabled && "opacity-45 pointer-events-none")}>
              <SliderRow
                label="آستانه حساسیت (Tolerance)"
                display={String(bgTolerance)}
                value={bgTolerance}
                min={8}
                max={120}
                step={2}
                onChange={setBgTolerance}
              />
              <SliderRow
                label="سد گرادیان لبه (Sobel)"
                display={String(edgeBarrier)}
                value={edgeBarrier}
                min={0}
                max={120}
                step={2}
                onChange={setEdgeBarrier}
              />
              <SliderRow
                label="مات‌کردن لبه (Feather)"
                display={`${feather.toFixed(1)}px`}
                value={feather}
                min={0}
                max={8}
                step={0.2}
                onChange={setFeather}
              />
              <SliderRow
                label="خنثی‌سازی هاله (Defringe)"
                display={`${Math.round(defringe * 100)}٪`}
                value={defringe}
                min={0}
                max={1}
                step={0.05}
                onChange={setDefringe}
              />
              <div className="flex items-center justify-between">
                <Label className="text-xs text-slate-400">حذف حفره‌های محصور</Label>
                <Switch checked={removeHoles} onCheckedChange={setRemoveHoles} aria-label="حذف حفره‌ها" />
              </div>
              {removeHoles && (
                <SliderRow
                  label="سقف مساحت حفره"
                  display={`${holeCap}٪`}
                  value={holeCap}
                  min={1}
                  max={30}
                  step={1}
                  onChange={setHoleCap}
                />
              )}
            </div>
            <p className="text-[11px] text-slate-500">
              فیلودفیل از سد Sobel عبور نمی‌کند؛ حفره‌ها تا سقف مساحت حذف می‌شوند تا لباس‌ها سوراخ نشوند.
            </p>
          </section>
        </aside>
      </div>

      {/* ---------- sticky bottom action bar: cut + download ---------- */}
      <div className="sticky bottom-3 z-30">
        <div className="float-bar flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-white/10 panel-glass px-4 py-3">
          <div className="flex items-center gap-2">
            <Label htmlFor="crop-prefix" className="shrink-0 text-xs text-slate-400">
              پیشوند
            </Label>
            <input
              id="crop-prefix"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              dir="ltr"
              placeholder="sprite"
              className="w-28 rounded-lg border border-white/10 bg-slate-950/60 px-2.5 py-1.5 font-mono text-sm text-slate-200 outline-none focus:border-cyan-400/50"
            />
            <span className="hidden font-mono text-[10px] text-slate-500 sm:inline" dir="ltr">
              {frameName(`${prefix.trim() || "sprite"}_{i}`, 0, Math.max(1, boxes.length))}.webp
            </span>
          </div>

          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 hover:border-cyan-400/40">
            <Switch checked={autoDownload} onCheckedChange={setAutoDownload} aria-label="دانلود خودکار ZIP" />
            <Package className="h-3.5 w-3.5 text-cyan-300" />
            دانلود خودکار ZIP
          </label>

          <div className="mr-auto flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!selectedBox || cropping}
              onClick={openMaskEditor}
              className="border border-cyan-400/30 bg-cyan-400/10 text-cyan-200 hover:border-cyan-400/60"
            >
              <Pipette className="h-4 w-4" />
              ویرایش ماسک
            </Button>
            <Button
              type="button"
              disabled={cropping || boxes.length === 0}
              onClick={() => void cropAll()}
              className="metallic-gradient text-white font-bold glow-purple hover:brightness-110"
            >
              {cropping ? <Loader2 className="h-4 w-4 animate-spin" /> : <Scissors className="h-4 w-4" />}
              {autoDownload ? (
                <>
                  برش همه و دانلود ZIP
                  <span className="rounded-md bg-black/25 px-1.5 py-0.5 text-xs">{boxes.length}</span>
                </>
              ) : (
                <>
                  برش همه
                  <span className="rounded-md bg-black/25 px-1.5 py-0.5 text-xs">{boxes.length}</span>
                </>
              )}
              <Layers className="hidden h-4 w-4 sm:inline" />
            </Button>
          </div>
        </div>
      </div>

      <MaskEditor
        key={maskKey}
        open={maskState !== null}
        onOpenChange={(o) => {
          if (!o) setMaskState(null);
        }}
        original={maskState?.original ?? null}
        initial={maskState?.processed ?? null}
        defaultName={maskState?.name ?? "frame"}
        onSave={(canvas, name) => {
          addFrame({ name, canvas, source: "sheet" });
          setMaskState(null);
          toast.success(`فریم «${name}» ذخیره شد`, { description: "در تب انیماتور و خروجی آماده است" });
        }}
      />
    </div>
  );
}
