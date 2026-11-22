"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Clapperboard,
  Copy,
  Download,
  FileJson,
  Grid3X3,
  Package,
  Pause,
  PencilLine,
  Play,
  SkipBack,
  SkipForward,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import JSZip from "jszip";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useFrameStore } from "@/lib/store";
import {
  buildSpriteSheet,
  canvasToBlob,
  copyTextToClipboard,
  downloadBlob,
  extFor,
  fitInto,
  type SpriteSheetMeta,
} from "@/lib/cv/frame-utils";
import { cn } from "@/lib/utils";

type BgMode = "checkerDark" | "checkerLight" | "white" | "black";
type SheetBg = "transparent" | "white" | "black" | "slate";

const BG_OPTIONS: Array<{ id: BgMode; label: string; className: string }> = [
  { id: "checkerDark", label: "شطرنجی تیره", className: "checker-dark" },
  { id: "checkerLight", label: "شطرنجی روشن", className: "checker-light" },
  { id: "white", label: "سفید", className: "bg-white-solid" },
  { id: "black", label: "سیاه", className: "bg-black-solid" },
];

export function Animator() {
  const frames = useFrameStore((s) => s.frames);
  const selectedFrameId = useFrameStore((s) => s.selectedFrameId);
  const setSelected = useFrameStore((s) => s.setSelected);
  const removeFrame = useFrameStore((s) => s.removeFrame);
  const clearAll = useFrameStore((s) => s.clearAll);
  const renameAll = useFrameStore((s) => s.renameAll);

  const flipbookRef = useRef<HTMLCanvasElement>(null);
  const sheetRef = useRef<HTMLCanvasElement>(null);

  const [playing, setPlaying] = useState(false);
  const [fps, setFps] = useState(10);
  const [bgMode, setBgMode] = useState<BgMode>("checkerDark");

  const [columns, setColumns] = useState(4);
  const [spacing, setSpacing] = useState(4);
  const [sheetBg, setSheetBg] = useState<SheetBg>("transparent");
  const [sheetMeta, setSheetMeta] = useState<SpriteSheetMeta | null>(null);
  const [copied, setCopied] = useState(false);

  const [quality, setQuality] = useState(0.92);
  const [pattern, setPattern] = useState("sprite_{i}");
  const [zipping, setZipping] = useState(false);

  const currentIdx = frames.findIndex((f) => f.id === selectedFrameId);
  const displayIdx = currentIdx >= 0 ? currentIdx : 0;

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
  }, [playing, fps, frames, drawFlipbook, setSelected]);

  // pause when the last frame is removed / frames emptied
  useEffect(() => {
    if (frames.length < 2) setPlaying(false);
  }, [frames.length]);

  const step = (dir: 1 | -1) => {
    if (frames.length === 0) return;
    setPlaying(false);
    const next = (displayIdx + dir + frames.length) % frames.length;
    setSelected(frames[next].id);
  };

  // ---------- sprite sheet ----------
  useEffect(() => {
    if (frames.length === 0) {
      setSheetMeta(null);
      return;
    }
    const { canvas, meta } = buildSpriteSheet(
      frames.map((f) => ({ canvas: f.canvas, name: f.name })),
      { columns, spacing, background: sheetBg }
    );
    const target = sheetRef.current;
    if (target) {
      const scale = Math.min(1, 720 / canvas.width, 460 / canvas.height);
      target.width = Math.max(1, Math.round(canvas.width * scale));
      target.height = Math.max(1, Math.round(canvas.height * scale));
      const ctx = target.getContext("2d")!;
      ctx.clearRect(0, 0, target.width, target.height);
      ctx.drawImage(canvas, 0, 0, target.width, target.height);
    }
    setSheetMeta(meta);
  }, [frames, columns, spacing, sheetBg]);

  const downloadSheet = useCallback(
    async (type: "image/png" | "image/webp") => {
      if (frames.length === 0) return;
      const { canvas } = buildSpriteSheet(
        frames.map((f) => ({ canvas: f.canvas, name: f.name })),
        { columns, spacing, background: sheetBg }
      );
      const { blob, actualType } = await canvasToBlob(canvas, type, quality);
      downloadBlob(blob, `spritesheet-${columns}col.${extFor(actualType)}`);
      toast.success("اسپرایت‌شیت دانلود شد", { description: `${canvas.width}×${canvas.height}` });
    },
    [columns, frames, quality, sheetBg, spacing]
  );

  const copyMeta = useCallback(async () => {
    if (!sheetMeta) return;
    const ok = await copyTextToClipboard(JSON.stringify(sheetMeta, null, 2));
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
      toast.success("متادیتای JSON کپی شد", { description: "سازگار با Unity و Godot" });
    } else {
      toast.error("کپی به کلیپ‌بورد ناموفق بود");
    }
  }, [sheetMeta]);

  // ---------- export ----------
  const downloadOne = useCallback(
    async (id: string) => {
      const frame = frames.find((f) => f.id === id);
      if (!frame) return;
      const { blob, actualType } = await canvasToBlob(frame.canvas, "image/webp", quality);
      downloadBlob(blob, `${frame.name}.${extFor(actualType)}`);
    },
    [frames, quality]
  );

  const downloadZip = useCallback(async () => {
    if (frames.length === 0) return;
    setZipping(true);
    try {
      const zip = new JSZip();
      const folder = zip.folder("spriteforge-frames") ?? zip;
      let webpOk = 0;
      for (const frame of frames) {
        const { blob, actualType } = await canvasToBlob(frame.canvas, "image/webp", quality);
        if (actualType.includes("webp")) webpOk += 1;
        folder.file(`${frame.name}.${extFor(actualType)}`, blob);
      }
      if (sheetMeta) {
        folder.file("spritesheet.json", JSON.stringify(sheetMeta, null, 2));
      }
      const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
      downloadBlob(blob, `spriteforge-frames-${frames.length}.zip`);
      toast.success("فایل ZIP دانلود شد", {
        description: `${frames.length} فریم${webpOk === frames.length ? " — همگی WebP شفاف" : ""}`,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ساخت ZIP ناموفق بود");
    } finally {
      setZipping(false);
    }
  }, [frames, quality, sheetMeta]);

  const previewName = useMemo(() => {
    const digits = Math.max(3, String(frames.length || 1).length);
    const sample = pattern.includes("{i}")
      ? pattern.replace(/\{i\}/g, "1".padStart(digits, "0"))
      : `${pattern}_001`;
    return sample;
  }, [frames.length, pattern]);

  if (frames.length === 0) {
    return (
      <div className="flex min-h-[420px] flex-col items-center justify-center gap-4 rounded-xl panel-glass p-10 text-center">
        <div className="rounded-2xl metallic-gradient p-[1.5px]">
          <div className="rounded-2xl bg-slate-950/85 px-10 py-8">
            <Clapperboard className="mx-auto h-10 w-10 text-violet-400" />
            <p className="mt-4 text-sm font-bold metallic-text">هنوز فریمی وجود ندارد</p>
            <p className="mt-2 max-w-md text-xs leading-5 text-slate-400">
              از تب «برش‌زن شیت تصویر» کادرها را برش بزنید یا از تب «استودیو ویدیو و گیف» فریم‌های
              کروماکی‌شده استخراج کنید تا در اینجا فلپ‌بوک، اسپرایت‌شیت و خروجی WebP فعال شود.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_330px]">
      {/* ---------- flipbook + frames ---------- */}
      <div className="flex flex-col gap-3">
        <div className={cn("overflow-hidden rounded-xl border border-white/10", BG_OPTIONS.find((b) => b.id === bgMode)?.className)}>
          <canvas
            ref={flipbookRef}
            width={720}
            height={440}
            className="mx-auto block h-auto max-h-[440px] w-full"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-xl panel-glass p-3">
          <Button
            type="button"
            size="icon"
            variant="secondary"
            onClick={() => step(-1)}
            className="border border-white/10 bg-white/5"
            aria-label="فریم قبلی"
          >
            <SkipBack className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            disabled={frames.length < 2}
            className="metallic-gradient text-white font-bold glow-purple hover:brightness-110"
          >
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {playing ? "توقف" : "پخش پیوسته"}
          </Button>
          <Button
            type="button"
            size="icon"
            variant="secondary"
            onClick={() => step(1)}
            className="border border-white/10 bg-white/5"
            aria-label="فریم بعدی"
          >
            <SkipForward className="h-4 w-4" />
          </Button>
          <div className="flex min-w-[180px] flex-1 items-center gap-2">
            <span className="shrink-0 text-xs text-slate-400">سرعت</span>
            <Slider
              value={[fps]}
              min={1}
              max={30}
              step={1}
              onValueChange={(v) => setFps(v[0])}
              className="flex-1"
            />
            <span className="w-14 shrink-0 text-center font-mono text-xs text-cyan-300" dir="ltr">
              {fps} FPS
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {BG_OPTIONS.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => setBgMode(b.id)}
                title={b.label}
                aria-label={b.label}
                className={cn(
                  "h-7 w-7 rounded-md border transition-all",
                  b.className,
                  bgMode === b.id
                    ? "border-cyan-400 neon-ring scale-110"
                    : "border-white/15 hover:border-violet-400/50"
                )}
              />
            ))}
          </div>
          <span className="font-mono text-xs text-slate-400" dir="ltr">
            {displayIdx + 1} / {frames.length}
          </span>
        </div>

        {/* frames strip */}
        <div className="rounded-xl panel-glass p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-200">
              <PencilLine className="h-4 w-4 text-violet-400" />
              فریم‌ها ({frames.length})
            </h3>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                clearAll();
                toast.info("همه فریم‌ها پاک شدند");
              }}
              className="text-slate-400 hover:text-rose-300"
            >
              <Trash2 className="h-4 w-4" />
              پاک‌کردن همه
            </Button>
          </div>
          <div className="grid max-h-64 grid-cols-[repeat(auto-fill,minmax(108px,1fr))] gap-2 overflow-y-auto scroll-slim p-1">
            {frames.map((f, i) => (
              <div
                key={f.id}
                role="button"
                tabIndex={0}
                onClick={() => setSelected(f.id)}
                onKeyDown={(e) => e.key === "Enter" && setSelected(f.id)}
                className={cn(
                  "group relative cursor-pointer rounded-lg border p-1.5 transition-all",
                  selectedFrameId === f.id
                    ? "border-cyan-400/70 bg-cyan-400/10 neon-ring"
                    : "border-white/10 bg-white/5 hover:border-violet-400/40"
                )}
              >
                <img
                  src={f.thumb}
                  alt={`فریم ${f.name}`}
                  className="mx-auto h-16 w-full rounded object-contain checker-dark"
                />
                <p className="mt-1 truncate text-center font-mono text-[10px] text-slate-300" dir="ltr" title={f.name}>
                  {f.name}
                </p>
                <p className="text-center font-mono text-[9px] text-slate-500" dir="ltr">
                  {f.w}×{f.h}
                </p>
                <div className="absolute inset-x-1 top-1 flex justify-between opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    aria-label="دانلود فریم"
                    onClick={(e) => {
                      e.stopPropagation();
                      void downloadOne(f.id);
                    }}
                    className="rounded bg-slate-950/85 p-1 text-cyan-300 hover:text-cyan-200"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="حذف فریم"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFrame(f.id);
                    }}
                    className="rounded bg-slate-950/85 p-1 text-rose-400 hover:text-rose-300"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <span className="absolute -top-1.5 right-1 rounded bg-violet-600 px-1 font-mono text-[9px] text-white" dir="ltr">
                  {i + 1}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ---------- right panels ---------- */}
      <div className="flex flex-col gap-3">
        {/* sprite sheet */}
        <section className="rounded-xl panel-glass p-4 space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-200">
            <Grid3X3 className="h-4 w-4 text-violet-400" />
            سازنده اسپرایت‌شیت مشبک
          </h3>
          <div className="rounded-lg border border-white/10 checker-dark p-2">
            <canvas ref={sheetRef} className="mx-auto block h-auto max-h-[200px] w-auto max-w-full" />
          </div>
          <div>
            <div className="flex justify-between text-xs text-slate-400">
              <span>تعداد ستون‌ها</span>
              <span className="text-cyan-300">{columns}</span>
            </div>
            <Slider value={[columns]} min={1} max={16} step={1} onValueChange={(v) => setColumns(v[0])} className="mt-1.5" />
          </div>
          <div>
            <div className="flex justify-between text-xs text-slate-400">
              <span>فاصله بین سلول‌ها</span>
              <span className="text-cyan-300">{spacing}px</span>
            </div>
            <Slider value={[spacing]} min={0} max={24} step={1} onValueChange={(v) => setSpacing(v[0])} className="mt-1.5" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ["transparent", "شفاف"],
                ["white", "سفید"],
                ["black", "سیاه"],
                ["slate", "اسلیت"],
              ] as Array<[SheetBg, string]>
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setSheetBg(id)}
                className={cn(
                  "rounded-lg border px-2.5 py-1.5 text-xs transition-colors",
                  sheetBg === id
                    ? "border-cyan-400/60 bg-cyan-400/10 text-cyan-300"
                    : "border-white/10 bg-white/5 text-slate-300 hover:border-violet-400/40"
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {sheetMeta && (
            <p className="font-mono text-[10px] text-slate-500" dir="ltr">
              {sheetMeta.sheet.columns}×{sheetMeta.sheet.rows} — {sheetMeta.sheet.width}×{sheetMeta.sheet.height}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => void downloadSheet("image/png")}
              className="border border-white/10 bg-white/5"
            >
              <Download className="h-4 w-4" />
              PNG
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void downloadSheet("image/webp")}
              className="border border-cyan-400/30 bg-cyan-400/10 text-cyan-200 hover:border-cyan-400/60"
            >
              <Download className="h-4 w-4" />
              WebP
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void copyMeta()}
              className="col-span-2 border border-violet-400/30 bg-violet-500/10 text-violet-200 hover:border-violet-400/60"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              کپی متادیتا JSON (Unity / Godot)
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                if (!sheetMeta) return;
                const blob = new Blob([JSON.stringify(sheetMeta, null, 2)], { type: "application/json" });
                downloadBlob(blob, "spritesheet.json");
                toast.success("فایل متادیتا دانلود شد");
              }}
              className="col-span-2 border border-white/10 bg-white/5"
            >
              <FileJson className="h-4 w-4" />
              دانلود فایل متادیتا JSON
            </Button>
          </div>
        </section>

        {/* export */}
        <section className="rounded-xl panel-glass p-4 space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-200">
            <Package className="h-4 w-4 text-cyan-400" />
            خروجی و دانلود
          </h3>
          <div>
            <div className="flex justify-between text-xs text-slate-400">
              <span>کیفیت WebP</span>
              <span className="text-cyan-300">{Math.round(quality * 100)}٪</span>
            </div>
            <Slider value={[quality]} min={0.5} max={1} step={0.02} onValueChange={(v) => setQuality(v[0])} className="mt-1.5" />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="rename-pattern" className="flex items-center gap-1.5 text-xs text-slate-400">
              <FileJson className="h-3.5 w-3.5" />
              الگوی تغییر نام دسته‌ای
            </label>
            <input
              id="rename-pattern"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              dir="ltr"
              className="w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 font-mono text-sm text-slate-200 outline-none focus:border-cyan-400/50"
            />
            <div className="flex items-center justify-between">
              <p className="font-mono text-[10px] text-slate-500" dir="ltr">
                {previewName}.webp
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  renameAll(pattern);
                  toast.success("نام همه فریم‌ها بازنویسی شد");
                }}
                className="text-xs text-cyan-300 hover:text-cyan-200"
              >
                <Check className="h-3.5 w-3.5" />
                اعمال نام‌ها
              </Button>
            </div>
          </div>
          <Button
            type="button"
            disabled={zipping}
            onClick={() => void downloadZip()}
            className="w-full metallic-gradient text-white font-bold glow-purple hover:brightness-110"
          >
            {zipping ? <Download className="h-4 w-4 animate-bounce" /> : <Package className="h-4 w-4" />}
            دانلود ZIP همه فریم‌ها ({frames.length})
          </Button>
          <p className="text-[11px] leading-4 text-slate-500">
            همه فایل‌ها با آلفای شفاف به WebP تبدیل و در مرورگر شما زیپ می‌شوند — هیچ فایلی به سرور ارسال نمی‌شود.
          </p>
        </section>
      </div>
    </div>
  );
}
