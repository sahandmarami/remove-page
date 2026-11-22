"use client";

import { useCallback, useRef, useState } from "react";
import {
  Boxes,
  Cpu,
  Crop,
  ImageUp,
  Layers,
  Loader2,
  ScanLine,
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
import { cropToCanvas, frameName } from "@/lib/cv/frame-utils";
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
      toast.success(`${n} فریم به انیماتور اضافه شد`, {
        description: bgEnabled ? "با حذف پس‌زمینه و لبه نرم" : "برش مستقیم بدون حذف پس‌زمینه",
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "خطا در برش فریم‌ها");
    } finally {
      setCropping(false);
    }
  }, [addFrames, bgEnabled, boxes, prefix, processCrop, source]);

  const selectedBox = boxes.find((b) => b.id === selectedId) ?? null;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_330px]">
      {/* ---------- canvas column ---------- */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => void onFiles(e.target.files)}
          />
          <Button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="metallic-gradient text-white font-bold glow-purple hover:brightness-110"
          >
            <ImageUp className="h-4 w-4" />
            آپلود شیت تصویر
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={loadSample}
            className="border border-white/10 bg-white/5 hover:border-cyan-400/40"
          >
            <Sparkles className="h-4 w-4 text-cyan-400" />
            شیت نمونه تستی
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={aiBusy || !source}
            onClick={() => void aiDetect()}
            className="border border-violet-400/30 bg-violet-500/10 text-violet-200 hover:border-violet-400/60"
          >
            {aiBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cpu className="h-4 w-4" />}
            تشخیص هوشمند (Vision AI)
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={localBusy || !source}
            onClick={localDetect}
            className="border border-cyan-400/30 bg-cyan-400/10 text-cyan-200 hover:border-cyan-400/60"
          >
            {localBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanLine className="h-4 w-4" />}
            تشخیص محلی (بینایی ماشین)
          </Button>
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

        <div
          className="h-[520px]"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void onFiles(e.dataTransfer.files);
          }}
        >
          <BoxCanvas
            image={source?.canvas ?? null}
            boxes={boxes}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onChange={setBoxes}
          />
        </div>
      </div>

      {/* ---------- controls column ---------- */}
      <div className="flex flex-col gap-3">
        {/* detection settings */}
        <section className="rounded-xl panel-glass p-4 space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-200">
            <ScanLine className="h-4 w-4 text-violet-400" />
            تنظیمات تشخیص محلی
          </h3>
          <div>
            <div className="flex justify-between text-xs text-slate-400">
              <span>آستانه تفکیک رنگ</span>
              <span className="text-cyan-300">{detectTolerance}</span>
            </div>
            <Slider
              value={[detectTolerance]}
              min={10}
              max={110}
              step={2}
              onValueChange={(v) => setDetectTolerance(v[0])}
              className="mt-1.5"
            />
          </div>
          <p className="text-[11px] leading-4 text-slate-500">
            تشخیص محلی با نمونه‌برداری رنگ غالب لبه‌ها و برچسب‌گذاری مؤلفه‌های متصل، کاملاً آفلاین روی دستگاه شما اجرا می‌شود.
          </p>
        </section>

        {/* boxes list */}
        <section className="rounded-xl panel-glass p-4 space-y-2.5">
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-200">
            <Boxes className="h-4 w-4 text-violet-400" />
            کادرهای شناسایی‌شده
            <span className="mr-auto rounded-md bg-violet-500/20 px-2 py-0.5 text-xs text-violet-300">
              {boxes.length}
            </span>
          </h3>
          <div className="max-h-40 space-y-1 overflow-y-auto scroll-slim pl-1">
            {boxes.length === 0 && (
              <p className="py-2 text-center text-xs text-slate-500">هنوز کادری وجود ندارد</p>
            )}
            {boxes.map((b, i) => (
              <div
                key={b.id}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedId(b.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setSelectedId(b.id);
                }}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition-colors",
                  selectedId === b.id
                    ? "border-cyan-400/50 bg-cyan-400/10 text-cyan-200"
                    : "border-white/10 bg-white/5 text-slate-300 hover:border-violet-400/40"
                )}
              >
                <span className="font-mono text-[10px] text-slate-500">#{i + 1}</span>
                <span dir="ltr" className="font-mono text-[11px]">
                  {Math.round(b.w)}×{Math.round(b.h)}
                </span>
                {b.label && <span className="truncate text-[11px] text-violet-300">{b.label}</span>}
                <button
                  type="button"
                  aria-label="حذف کادر"
                  className="ml-auto text-slate-500 hover:text-rose-400"
                  onClick={(e) => {
                    e.stopPropagation();
                    setBoxes((prev) => prev.filter((x) => x.id !== b.id));
                    if (selectedId === b.id) setSelectedId(null);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* background removal */}
        <section className="rounded-xl panel-glass p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-200">
              <WandSparkles className="h-4 w-4 text-cyan-400" />
              موتور حذف پس‌زمینه
            </h3>
            <Switch checked={bgEnabled} onCheckedChange={setBgEnabled} aria-label="حذف پس‌زمینه" />
          </div>

          {bgSwatch && (
            <div className="flex items-center gap-2 text-xs text-slate-400">
              رنگ تشخیص‌شده پس‌زمینه:
              <span
                className="h-4 w-4 rounded border border-white/25"
                style={{ backgroundColor: rgbToHex(bgSwatch) }}
              />
              <span className="font-mono text-[11px]" dir="ltr">
                {rgbToHex(bgSwatch)}
              </span>
            </div>
          )}

          <div className={cn("space-y-3", !bgEnabled && "opacity-45 pointer-events-none")}>
            <div>
              <div className="flex justify-between text-xs text-slate-400">
                <span>آستانه حساسیت (Tolerance)</span>
                <span className="text-cyan-300">{bgTolerance}</span>
              </div>
              <Slider value={[bgTolerance]} min={8} max={120} step={2} onValueChange={(v) => setBgTolerance(v[0])} className="mt-1.5" />
            </div>
            <div>
              <div className="flex justify-between text-xs text-slate-400">
                <span>سد گرادیان لبه (Sobel Barrier)</span>
                <span className="text-cyan-300">{edgeBarrier}</span>
              </div>
              <Slider value={[edgeBarrier]} min={0} max={120} step={2} onValueChange={(v) => setEdgeBarrier(v[0])} className="mt-1.5" />
            </div>
            <div>
              <div className="flex justify-between text-xs text-slate-400">
                <span>مات‌کردن لبه (Feather)</span>
                <span className="text-cyan-300">{feather.toFixed(1)}px</span>
              </div>
              <Slider value={[feather]} min={0} max={8} step={0.2} onValueChange={(v) => setFeather(v[0])} className="mt-1.5" />
            </div>
            <div>
              <div className="flex justify-between text-xs text-slate-400">
                <span>خنثی‌سازی هاله (Defringe / Despill)</span>
                <span className="text-cyan-300">{Math.round(defringe * 100)}%</span>
              </div>
              <Slider value={[defringe]} min={0} max={1} step={0.05} onValueChange={(v) => setDefringe(v[0])} className="mt-1.5" />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-xs text-slate-400">حذف حفره‌های محصور</Label>
              <Switch checked={removeHoles} onCheckedChange={setRemoveHoles} aria-label="حذف حفره‌ها" />
            </div>
            {removeHoles && (
              <div>
                <div className="flex justify-between text-xs text-slate-400">
                  <span>سقف مساحت حفره</span>
                  <span className="text-cyan-300">{holeCap}٪</span>
                </div>
                <Slider value={[holeCap]} min={1} max={30} step={1} onValueChange={(v) => setHoleCap(v[0])} className="mt-1.5" />
              </div>
            )}
          </div>
          <p className="text-[11px] leading-4 text-slate-500">
            فیلد فیلود از لبه‌ها بذرگذاری می‌شود و هرگز از سد گرادیان Sobel عبور نمی‌کند؛ حفره‌های محصور فقط تا سقف مساحت تعیین‌شده حذف می‌شوند تا لباس‌ها سوراخ نشوند.
          </p>
        </section>

        {/* crop */}
        <section className="rounded-xl panel-glass p-4 space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-200">
            <Crop className="h-4 w-4 text-violet-400" />
            برش و ارسال به انیماتور
          </h3>
          <div className="space-y-1.5">
            <Label htmlFor="crop-prefix" className="text-xs text-slate-400">
              پیشوند نام فریم‌ها
            </Label>
            <input
              id="crop-prefix"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              dir="ltr"
              placeholder="sprite"
              className="w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-400/50"
            />
            <p className="font-mono text-[10px] text-slate-500" dir="ltr">
              {frameName(`${prefix.trim() || "sprite"}_{i}`, 0, Math.max(1, boxes.length))}.webp
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={!selectedBox || cropping}
              onClick={openMaskEditor}
              className="border border-cyan-400/30 bg-cyan-400/10 text-cyan-200 hover:border-cyan-400/60"
            >
              <WandSparkles className="h-4 w-4" />
              ویرایش ماسک
            </Button>
            <Button
              type="button"
              disabled={cropping || boxes.length === 0 || !source}
              onClick={() => void cropAll()}
              className="metallic-gradient text-white font-bold glow-purple hover:brightness-110"
            >
              {cropping ? <Loader2 className="h-4 w-4 animate-spin" /> : <Layers className="h-4 w-4" />}
              برش همه ({boxes.length})
            </Button>
          </div>
        </section>
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
