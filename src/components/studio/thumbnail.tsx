"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, FlipHorizontal2, Frame as FrameIcon, ImagePlus, LayoutTemplate, Loader2, Trash2, Type } from "lucide-react";
import { toast } from "sonner";
import { useFrameStore } from "@/lib/store";
import { canvasToBlob, enhanceSmallCanvas, saveBlob } from "@/lib/cv/frame-utils";
import { autoRemoveBackground } from "@/lib/cv/auto-remove";
import { loadImageToCanvas } from "@/lib/cv/video-extract";
import { cn } from "@/lib/utils";

type Ratio = "16:9" | "1:1";
type FrameStyle = "none" | "white" | "black" | "neon";
type TextPos = "top" | "bottom";

const RATIOS: Array<{ id: Ratio; label: string; w: number; h: number }> = [
  { id: "16:9", label: "یوتیوب", w: 1280, h: 720 },
  { id: "1:1", label: "مربع", w: 1080, h: 1080 },
];

const BACKGROUNDS: Array<{ id: string; css: string; stops: [string, string] }> = [
  { id: "violet", css: "from-fuchsia-500 to-violet-700", stops: ["#d946ef", "#7c3aed"] },
  { id: "ocean", css: "from-cyan-400 to-blue-700", stops: ["#22d3ee", "#1d4ed8"] },
  { id: "sunset", css: "from-orange-400 to-rose-600", stops: ["#fb923c", "#e11d48"] },
  { id: "mint", css: "from-emerald-400 to-teal-700", stops: ["#34d399", "#0f766e"] },
  { id: "night", css: "from-slate-900 to-violet-900", stops: ["#0f172a", "#4c1d95"] },
  { id: "gold", css: "from-amber-300 to-orange-600", stops: ["#fcd34d", "#ea580c"] },
  { id: "candy", css: "from-pink-400 to-indigo-600", stops: ["#f472b6", "#4f46e5"] },
  { id: "lime", css: "from-lime-300 to-emerald-600", stops: ["#bef264", "#059669"] },
];

const TEXT_COLORS = ["#ffffff", "#fde047", "#22d3ee", "#0f172a", "#f43f5e", "#a3e635"];

const FRAMES: Array<{ id: FrameStyle; label: string }> = [
  { id: "none", label: "بدون" },
  { id: "white", label: "سفید" },
  { id: "black", label: "مشکی" },
  { id: "neon", label: "نئون" },
];

interface Subject {
  canvas: HTMLCanvasElement;
  name: string;
}

export function ThumbnailMaker() {
  const frames = useFrameStore((s) => s.frames);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bgInputRef = useRef<HTMLInputElement>(null);
  const subjInputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<{ id: number; dx: number; dy: number } | null>(null);

  const [ratio, setRatio] = useState<Ratio>("16:9");
  const [bg, setBg] = useState<string>("violet");
  const [bgPhoto, setBgPhoto] = useState<HTMLCanvasElement | null>(null);
  const [subject, setSubject] = useState<Subject | null>(null);
  const [pos, setPos] = useState({ x: 0.5, y: 0.62 });
  const [scale, setScale] = useState(1);
  const [flip, setFlip] = useState(false);
  const [title, setTitle] = useState("");
  const [textColor, setTextColor] = useState("#ffffff");
  const [textPos, setTextPos] = useState<TextPos>("top");
  const [frameStyle, setFrameStyle] = useState<FrameStyle>("none");
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);

  const size = RATIOS.find((r) => r.id === ratio)!;

  // ensure the Persian font is ready before first canvas draw
  useEffect(() => {
    let alive = true;
    document.fonts
      .load('900 80px Vazirmatn')
      .catch(() => undefined)
      .then(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  // ---------- rendering ----------
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const W = size.w;
    const H = size.h;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, W, H);

    // background
    if (bgPhoto) {
      // photo background, cover-fit
      const s = Math.max(W / bgPhoto.width, H / bgPhoto.height);
      const dw = bgPhoto.width * s;
      const dh = bgPhoto.height * s;
      ctx.drawImage(bgPhoto, (W - dw) / 2, (H - dh) / 2, dw, dh);
      // slight dark overlay for text readability
      const ov = ctx.createLinearGradient(0, 0, 0, H);
      ov.addColorStop(0, "rgba(0,0,0,0.28)");
      ov.addColorStop(1, "rgba(0,0,0,0.12)");
      ctx.fillStyle = ov;
      ctx.fillRect(0, 0, W, H);
    } else {
      const preset = BACKGROUNDS.find((b) => b.id === bg) ?? BACKGROUNDS[0];
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, preset.stops[0]);
      g.addColorStop(1, preset.stops[1]);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    // subject (transparent cut-out)
    if (subject) {
      const base = Math.min(W, H) * 0.6;
      const s = (base / Math.max(subject.canvas.width, subject.canvas.height)) * scale;
      const dw = subject.canvas.width * s;
      const dh = subject.canvas.height * s;
      const cx = pos.x * W;
      const cy = pos.y * H;
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.35)";
      ctx.shadowBlur = Math.min(W, H) * 0.04;
      ctx.shadowOffsetY = Math.min(W, H) * 0.015;
      ctx.translate(cx, cy);
      if (flip) ctx.scale(-1, 1);
      ctx.drawImage(subject.canvas, -dw / 2, -dh / 2, dw, dh);
      ctx.restore();
    }

    // title text
    const text = title.trim();
    if (text) {
      let fs = Math.round(Math.min(W, H) * 0.16);
      const maxW = W * 0.86;
      ctx.font = `900 ${fs}px Vazirmatn, sans-serif`;
      // wrap into at most 2 lines
      let lines: string[] = [];
      const words = text.split(/\s+/);
      let cur = "";
      for (const w of words) {
        const t = cur ? `${cur} ${w}` : w;
        if (ctx.measureText(t).width <= maxW) cur = t;
        else {
          if (cur) lines.push(cur);
          cur = w;
        }
      }
      if (cur) lines.push(cur);
      if (lines.length > 2) {
        lines = [lines.slice(0, -1).join(" "), lines[lines.length - 1]];
      }
      // shrink until it fits
      while (fs > Math.min(W, H) * 0.07 && lines.some((l) => ctx.measureText(l).width > maxW)) {
        fs = Math.round(fs * 0.9);
        ctx.font = `900 ${fs}px Vazirmatn, sans-serif`;
      }
      const lh = fs * 1.28;
      const blockH = lines.length * lh;
      const centerY = textPos === "top" ? H * 0.2 + blockH / 2 : H - H * 0.14 - blockH / 2;

      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `900 ${fs}px Vazirmatn, sans-serif`;
      ctx.lineJoin = "round";
      ctx.lineWidth = fs * 0.16;
      ctx.strokeStyle = "rgba(15,15,25,0.9)";
      ctx.shadowColor = "rgba(0,0,0,0.45)";
      ctx.shadowBlur = fs * 0.18;
      lines.forEach((l, i) => {
        const y = centerY - ((lines.length - 1) * lh) / 2 + i * lh;
        ctx.strokeText(l, W / 2, y);
      });
      ctx.shadowBlur = 0;
      ctx.fillStyle = textColor;
      lines.forEach((l, i) => {
        const y = centerY - ((lines.length - 1) * lh) / 2 + i * lh;
        ctx.fillText(l, W / 2, y);
      });
    }

    // decorative frame
    if (frameStyle !== "none") {
      const inset = Math.round(Math.min(W, H) * 0.035);
      const bw = Math.round(Math.min(W, H) * 0.02);
      ctx.save();
      if (frameStyle === "neon") {
        ctx.strokeStyle = "#22d3ee";
        ctx.shadowColor = "#22d3ee";
        ctx.shadowBlur = bw * 2.5;
        ctx.lineWidth = bw * 0.75;
      } else {
        ctx.strokeStyle = frameStyle === "white" ? "#ffffff" : "#0f0f19";
        ctx.shadowColor = "rgba(0,0,0,0.4)";
        ctx.shadowBlur = bw;
        ctx.lineWidth = bw;
      }
      ctx.strokeRect(inset, inset, W - inset * 2, H - inset * 2);
      ctx.restore();
    }
  }, [bg, bgPhoto, flip, frameStyle, pos, scale, size, subject, textColor, textPos, title]);

  useEffect(() => {
    draw();
  }, [draw, ready]);

  // ---------- subject input ----------
  const keyFromUpload = useCallback(async (file: File) => {
    const { canvas } = await loadImageToCanvas(file);
    const up = enhanceSmallCanvas(canvas);
    const ctx = up.getContext("2d", { willReadFrequently: true })!;
    const img = ctx.getImageData(0, 0, up.width, up.height);
    const keyed = autoRemoveBackground(img, { feather: 0.5, removeHoles: true });
    ctx.putImageData(keyed.image, 0, 0);
    return { canvas: up, name: file.name.replace(/\.[^.]+$/, "") };
  }, []);

  const onSubjectFile = useCallback(
    async (files: FileList | null) => {
      const file = files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      try {
        const s = await keyFromUpload(file);
        setSubject(s);
        setPos({ x: 0.5, y: 0.62 });
        setScale(1);
        setFlip(false);
        toast.success("پس‌زمینه تصویر حذف شد");
      } catch {
        toast.error("بارگذاری ناموفق بود");
      }
    },
    [keyFromUpload]
  );

  const onBgFile = useCallback(async (files: FileList | null) => {
    const file = files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    try {
      const { canvas } = await loadImageToCanvas(file);
      setBgPhoto(canvas);
    } catch {
      toast.error("بارگذاری ناموفق بود");
    }
  }, []);

  // ---------- drag ----------
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!subject) return;
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width;
      const py = (e.clientY - rect.top) / rect.height;
      dragRef.current = { id: e.pointerId, dx: pos.x - px, dy: pos.y - py };
      canvas.setPointerCapture(e.pointerId);
    },
    [pos.x, pos.y, subject]
  );

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    setPos({
      x: Math.min(1.05, Math.max(-0.05, px + d.dx)),
      y: Math.min(1.05, Math.max(-0.05, py + d.dy)),
    });
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current?.id === e.pointerId) dragRef.current = null;
  }, []);

  // ---------- export ----------
  const download = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setSaving(true);
    try {
      const { blob } = await canvasToBlob(canvas, "image/png", 1);
      const res = await saveBlob(blob, `thumbnail-${size.w}x${size.h}.png`);
      if (res === "failed") toast.error("دانلود ناموفق بود — دوباره بزنید");
      else toast.success("تامنل ذخیره شد");
    } catch {
      toast.error("خروجی گرفتن ناموفق بود");
    } finally {
      setSaving(false);
    }
  }, [size.h, size.w]);

  return (
    <div className="flex flex-col gap-3">
      <input
        ref={bgInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void onBgFile(e.target.files)}
      />
      <input
        ref={subjInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void onSubjectFile(e.target.files)}
      />

      {/* canvas preview */}
      <div className="overflow-hidden rounded-2xl border border-line bg-surface p-1.5">
        <canvas
          ref={canvasRef}
          className="block h-auto w-full cursor-move rounded-xl touch-none"
          style={{ aspectRatio: ratio === "16:9" ? "16 / 9" : "1 / 1" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      </div>

      {/* size chips */}
      <div className="grid grid-cols-2 gap-1.5 rounded-2xl border border-line bg-surface p-1.5">
        {RATIOS.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => setRatio(r.id)}
            className={cn(
              "rounded-xl py-2 text-sm font-black transition-all active:scale-95",
              ratio === r.id
                ? "metallic-gradient text-white shadow-md"
                : "text-soft hover:bg-chip hover:text-foreground"
            )}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* background */}
      <div className="rounded-2xl border border-line bg-surface p-2.5">
        <div className="mb-2 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs font-black text-soft">
            <LayoutTemplate className="h-4 w-4" />
            پس‌زمینه
          </span>
          {bgPhoto && (
            <button
              type="button"
              onClick={() => setBgPhoto(null)}
              className="flex items-center gap-1 rounded-lg border border-line bg-chip px-2 py-1 text-[11px] font-bold text-soft hover:text-rose-ink"
            >
              <Trash2 className="h-3.5 w-3.5" />
              حذف عکس
            </button>
          )}
        </div>
        <div className="grid grid-cols-8 gap-1.5">
          {BACKGROUNDS.map((b) => (
            <button
              key={b.id}
              type="button"
              aria-label={b.id}
              onClick={() => {
                setBg(b.id);
                setBgPhoto(null);
              }}
              className={cn(
                "aspect-square rounded-lg border-2 transition-all active:scale-90 bg-gradient-to-br",
                b.css,
                !bgPhoto && bg === b.id ? "border-foreground ring-2 ring-violet-line" : "border-transparent opacity-80"
              )}
            />
          ))}
          <button
            type="button"
            onClick={() => bgInputRef.current?.click()}
            className={cn(
              "grid aspect-square place-items-center rounded-lg border-2 border-dashed transition-all active:scale-90",
              bgPhoto ? "border-solid border-violet-line-strong bg-violet-tint" : "border-line hover:border-violet-line"
            )}
            aria-label="عکس پس‌زمینه"
          >
            <ImagePlus className="h-4 w-4 text-soft" />
          </button>
        </div>
      </div>

      {/* subject */}
      <div className="rounded-2xl border border-line bg-surface p-2.5">
        <span className="mb-2 flex items-center gap-1.5 text-xs font-black text-soft">
          <ImagePlus className="h-4 w-4" />
          تصویر اصلی
        </span>
        {frames.length > 0 && (
          <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
            {frames.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => {
                  setSubject({ canvas: f.canvas, name: f.name });
                  setPos({ x: 0.5, y: 0.62 });
                  setScale(1);
                  setFlip(false);
                }}
                className={cn(
                  "shrink-0 overflow-hidden rounded-lg border transition-all",
                  subject?.name === f.name ? "border-violet-line-strong neon-ring" : "border-line hover:border-violet-line"
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.thumb} alt={f.name} className="checker-dark h-12 w-12 object-contain" />
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => subjInputRef.current?.click()}
            className="flex h-10 flex-1 items-center justify-center gap-2 rounded-xl border border-violet-line bg-violet-tint text-xs font-black text-violet-ink transition-all active:scale-[0.98]"
          >
            <ImagePlus className="h-4 w-4" />
            آپلود تصویر (پس‌زمینه خودکار حذف می‌شود)
          </button>
          {subject && (
            <>
              <button
                type="button"
                aria-label="قرینه"
                onClick={() => setFlip((f) => !f)}
                className={cn(
                  "grid h-10 w-10 shrink-0 place-items-center rounded-xl border transition-colors",
                  flip ? "border-violet-line-strong bg-violet-tint text-violet-ink" : "border-line bg-chip text-soft"
                )}
              >
                <FlipHorizontal2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label="حذف تصویر"
                onClick={() => setSubject(null)}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line bg-chip text-soft hover:text-rose-ink"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
        {subject && (
          <div className="mt-2.5">
            <div className="mb-1 flex items-center justify-between text-[11px] font-bold text-faint">
              <span>اندازه</span>
              <span className="tabular-nums">{Math.round(scale * 100)}٪</span>
            </div>
            <input
              type="range"
              min={0.3}
              max={2.2}
              step={0.05}
              value={scale}
              dir="ltr"
              onChange={(e) => setScale(Number(e.target.value))}
              className="h-1.5 w-full accent-violet-500"
              aria-label="اندازه تصویر"
            />
          </div>
        )}
      </div>

      {/* text */}
      <div className="rounded-2xl border border-line bg-surface p-2.5">
        <span className="mb-2 flex items-center gap-1.5 text-xs font-black text-soft">
          <Type className="h-4 w-4" />
          عنوان
        </span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="متن تامنل…"
          maxLength={60}
          className="h-10 w-full rounded-xl border border-line bg-chip px-3 text-sm font-bold text-foreground outline-none placeholder:text-faint focus:border-violet-line"
        />
        <div className="mt-2 flex items-center gap-1.5">
          {TEXT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              onClick={() => setTextColor(c)}
              className={cn(
                "h-6 w-6 rounded-full border-2 transition-all active:scale-90",
                textColor === c ? "border-violet-ink ring-2 ring-violet-line" : "border-line"
              )}
              style={{ backgroundColor: c }}
            />
          ))}
          <div className="mr-auto grid grid-cols-2 gap-1">
            {(["top", "bottom"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setTextPos(p)}
                className={cn(
                  "rounded-lg px-2.5 py-1 text-[11px] font-black transition-all",
                  textPos === p ? "metallic-gradient text-white" : "bg-chip text-soft"
                )}
              >
                {p === "top" ? "بالا" : "پایین"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* frame style */}
      <div className="rounded-2xl border border-line bg-surface p-2.5">
        <span className="mb-2 flex items-center gap-1.5 text-xs font-black text-soft">
          <FrameIcon className="h-4 w-4" />
          قاب
        </span>
        <div className="grid grid-cols-4 gap-1.5">
          {FRAMES.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFrameStyle(f.id)}
              className={cn(
                "rounded-xl py-2 text-xs font-black transition-all active:scale-95",
                frameStyle === f.id
                  ? "metallic-gradient text-white"
                  : "text-soft hover:bg-chip hover:text-foreground"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* download */}
      <div className="sticky-safe pb-2">
        <div className="float-bar flex items-center gap-2 rounded-2xl border border-line panel-glass p-2.5">
          <button
            type="button"
            onClick={() => void download()}
            disabled={saving || !ready}
            className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl metallic-gradient text-sm font-black text-white transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-40"
          >
            {saving ? <Loader2 className="h-4.5 w-4.5 animate-spin" /> : <Download className="h-4.5 w-4.5" />}
            دانلود PNG
          </button>
        </div>
      </div>
    </div>
  );
}
