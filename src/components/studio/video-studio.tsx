"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CircleStop,
  Droplets,
  Eye,
  FileVideo,
  Film,
  ImageDown,
  Loader2,
  Package,
  Pause,
  Pipette,
  Play,
  Sparkles,
  TestTube2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { applyChromaKey, DEFAULT_CHROMA } from "@/lib/cv/chroma";
import { decodeGif, type DecodedFrame } from "@/lib/cv/gif";
import {
  extractFramesFromVideo,
  loadVideoMeta,
  waitFor,
  waitForPresentedFrame,
  type VideoMeta,
} from "@/lib/cv/video-extract";
import { cloneCanvas, downloadFramesZip, fitInto, frameName } from "@/lib/cv/frame-utils";
import { encodeTestGif, recordTestVideo } from "@/lib/cv/test-generators";
import { hexToRgb, rgbToHex } from "@/lib/cv/color-utils";
import { useFrameStore } from "@/lib/store";
import { cn } from "@/lib/utils";

type Mode = "idle" | "video" | "gif";
type Count = 8 | 12 | 16;

const COUNTS: Count[] = [8, 12, 16];

export function VideoStudio() {
  const addFrames = useFrameStore((s) => s.addFrames);

  const [mode, setMode] = useState<Mode>("idle");
  const [srcName, setSrcName] = useState("");
  const [videoMeta, setVideoMeta] = useState<VideoMeta | null>(null);
  const [gifFrames, setGifFrames] = useState<DecodedFrame[]>([]);
  const [count, setCount] = useState<Count>(8);
  const [gifAll, setGifAll] = useState(false);
  const [busySource, setBusySource] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [prefix, setPrefix] = useState("vid");
  const [autoZip, setAutoZip] = useState(true);

  const [chromaEnabled, setChromaEnabled] = useState(true);
  const [chromaHex, setChromaHex] = useState("#00B140");
  const [similarity, setSimilarity] = useState(DEFAULT_CHROMA.similarity);
  const [smoothness, setSmoothness] = useState(DEFAULT_CHROMA.smoothness);
  const [despill, setDespill] = useState(DEFAULT_CHROMA.despill);
  const [eyedropper, setEyedropper] = useState(false);

  const [videoPlaying, setVideoPlaying] = useState(false);
  const [gifIdx, setGifIdx] = useState(0);
  const [gifPlaying, setGifPlaying] = useState(false);

  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const videoUrlRef = useRef<string | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const rawCanvasRef = useRef<HTMLCanvasElement>(null);
  const chromaWorkRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const gifTimerRef = useRef<number>(0);
  const gifIdxRef = useRef(0);
  const cancelRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chromaRef = useRef({ enabled: chromaEnabled, hex: chromaHex, similarity, smoothness, despill });
  const modeRef = useRef<Mode>("idle");
  const gifFramesRef = useRef<DecodedFrame[]>([]);

  chromaRef.current = { enabled: chromaEnabled, hex: chromaHex, similarity, smoothness, despill };
  gifIdxRef.current = gifIdx;
  modeRef.current = mode;
  gifFramesRef.current = gifFrames;

  // ---------- preview rendering ----------
  const drawPreview = useCallback(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    const m = modeRef.current;
    let raw = rawCanvasRef.current;
    if (!raw) {
      raw = document.createElement("canvas");
      rawCanvasRef.current = raw;
    }

    if (m === "video") {
      const v = videoElRef.current;
      if (!v || !v.videoWidth) return;
      if (raw.width !== v.videoWidth || raw.height !== v.videoHeight) {
        raw.width = v.videoWidth;
        raw.height = v.videoHeight;
      }
      raw.getContext("2d", { willReadFrequently: true })!.drawImage(v, 0, 0);
    } else if (m === "gif") {
      const f = gifFramesRef.current[gifIdxRef.current];
      if (!f) return;
      if (raw.width !== f.canvas.width || raw.height !== f.canvas.height) {
        raw.width = f.canvas.width;
        raw.height = f.canvas.height;
      }
      const rctx = raw.getContext("2d", { willReadFrequently: true })!;
      rctx.clearRect(0, 0, raw.width, raw.height);
      rctx.drawImage(f.canvas, 0, 0);
    } else {
      return;
    }

    const chroma = chromaRef.current;
    const ctx = canvas.getContext("2d")!;
    const fit = fitInto(raw.width, raw.height, canvas.width, canvas.height);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!chroma.enabled) {
      ctx.drawImage(raw, fit.x, fit.y, fit.w, fit.h);
      return;
    }

    let work = chromaWorkRef.current;
    if (!work) {
      work = document.createElement("canvas");
      chromaWorkRef.current = work;
    }
    if (work.width !== raw.width || work.height !== raw.height) {
      work.width = raw.width;
      work.height = raw.height;
    }
    const wctx = work.getContext("2d", { willReadFrequently: true })!;
    // copy the raw frame into the work canvas first, then key it out in place
    wctx.clearRect(0, 0, work.width, work.height);
    wctx.drawImage(raw, 0, 0);
    const img = wctx.getImageData(0, 0, work.width, work.height);
    applyChromaKey(img, {
      color: hexToRgb(chroma.hex),
      similarity: chroma.similarity,
      smoothness: chroma.smoothness,
      despill: chroma.despill,
    });
    wctx.putImageData(img, 0, 0);
    ctx.drawImage(work, fit.x, fit.y, fit.w, fit.h);
  }, []);

  // redraw when settings change while paused
  useEffect(() => {
    if ((mode === "video" && !videoPlaying) || (mode === "gif" && !gifPlaying)) {
      drawPreview();
    }
  }, [chromaEnabled, chromaHex, similarity, smoothness, despill, gifIdx, drawPreview, gifPlaying, mode, videoPlaying]);

  // video playback loop
  useEffect(() => {
    if (mode !== "video") return;
    const v = videoElRef.current;
    if (!v) return;
    const onSeeked = () => drawPreview();
    v.addEventListener("seeked", onSeeked);
    if (videoPlaying) {
      void v.play().catch(() => setVideoPlaying(false));
      const loop = () => {
        drawPreview();
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
      return () => {
        cancelAnimationFrame(rafRef.current);
        v.removeEventListener("seeked", onSeeked);
        v.pause();
      };
    }
    v.pause();
    return () => v.removeEventListener("seeked", onSeeked);
  }, [videoPlaying, mode, drawPreview]);

  // gif playback
  useEffect(() => {
    if (mode !== "gif" || !gifPlaying || gifFrames.length === 0) return;
    let cancelled = false;
    const step = () => {
      if (cancelled) return;
      const idx = (gifIdxRef.current + 1) % gifFrames.length;
      setGifIdx(idx);
      const delay = Math.max(33, gifFrames[idx]?.delayMs ?? 100);
      gifTimerRef.current = window.setTimeout(step, delay);
    };
    gifTimerRef.current = window.setTimeout(step, Math.max(33, gifFrames[gifIdxRef.current]?.delayMs ?? 100));
    return () => {
      cancelled = true;
      window.clearTimeout(gifTimerRef.current);
    };
  }, [gifPlaying, gifFrames, mode]);

  // cleanup
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.clearTimeout(gifTimerRef.current);
      videoElRef.current?.pause();
      videoElRef.current?.remove();
      if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current);
    };
  }, []);

  // ---------- source loading ----------
  const resetSource = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    window.clearTimeout(gifTimerRef.current);
    videoElRef.current?.pause();
    videoElRef.current?.remove();
    if (videoUrlRef.current) {
      URL.revokeObjectURL(videoUrlRef.current);
      videoUrlRef.current = null;
    }
    videoElRef.current = null;
    setVideoMeta(null);
    setGifFrames([]);
    setMode("idle");
    setSrcName("");
    setVideoPlaying(false);
    setGifPlaying(false);
    setGifIdx(0);
    setProgress(null);
  }, []);

  const loadVideo = useCallback(
    async (url: string, name: string) => {
      setBusySource(true);
      try {
        const { video, meta } = await loadVideoMeta(url);
        videoElRef.current = video;
        videoUrlRef.current = url;
        setVideoMeta(meta);
        setMode("video");
        setSrcName(name);
        setGifPlaying(false);
        setVideoPlaying(false);
        toast.success("ویدیو آماده است", {
          description: `${name} — ${meta.width}×${meta.height} — ${meta.duration.toFixed(2)} ثانیه`,
        });
        // seek to the start and wait for the first frame to actually present
        video.currentTime = 0;
        try {
          await waitFor(video, "seeked", 3000);
        } catch {
          /* already at 0 */
        }
        await waitForPresentedFrame(video);
        drawPreview();
      } catch (err) {
        toast.error("بارگذاری ویدیو ناموفق بود", {
          description: err instanceof Error ? err.message : "کدک یا فرمت پشتیبانی نمی‌شود",
        });
      } finally {
        setBusySource(false);
      }
    },
    [drawPreview]
  );

  const loadGif = useCallback(
    async (blob: Blob, name: string) => {
      setBusySource(true);
      try {
        const decoded = await decodeGif(blob);
        setGifFrames(decoded.frames);
        setMode("gif");
        setSrcName(name);
        setGifIdx(0);
        setVideoPlaying(false);
        toast.success("گیف دیکد شد", {
          description: `${decoded.frames.length} فریم — ${decoded.width}×${decoded.height}`,
        });
        window.setTimeout(() => drawPreview(), 80);
      } catch (err) {
        toast.error("دیکد گیف ناموفق بود", {
          description: err instanceof Error ? err.message : undefined,
        });
      } finally {
        setBusySource(false);
      }
    },
    [drawPreview]
  );

  const onFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;
      resetSource();
      if (file.type === "image/gif" || file.name.toLowerCase().endsWith(".gif")) {
        void loadGif(file, file.name);
      } else if (file.type.startsWith("video/") || /\.(mp4|webm|mov|mkv)$/i.test(file.name)) {
        void loadVideo(URL.createObjectURL(file), file.name);
      } else {
        toast.error("فقط ویدیو (MP4/WebM/MOV) یا گیف پذیرفته می‌شود");
      }
    },
    [loadGif, loadVideo, resetSource]
  );

  // ---------- one-click test generators ----------
  const testVideo = useCallback(async () => {
    resetSource();
    setBusySource(true);
    toast.loading("در حال ضبط ویدیوی تستی پرده سبز...", { id: "testvid" });
    try {
      const { url } = await recordTestVideo();
      toast.dismiss("testvid");
      await loadVideo(url, "test-green.webm");
    } catch (err) {
      toast.dismiss("testvid");
      toast.error(err instanceof Error ? err.message : "ساخت ویدیوی تستی ناموفق بود");
      setBusySource(false);
    }
  }, [loadVideo, resetSource]);

  const testGif = useCallback(async () => {
    resetSource();
    setBusySource(true);
    toast.loading("در حال ساخت گیف متحرک تستی...", { id: "testgif" });
    try {
      const { blob } = await encodeTestGif();
      toast.dismiss("testgif");
      await loadGif(blob, "test-animation.gif");
    } catch (err) {
      toast.dismiss("testgif");
      toast.error(err instanceof Error ? err.message : "ساخت گیف تستی ناموفق بود");
      setBusySource(false);
    }
  }, [loadGif, resetSource]);

  // ---------- eyedropper ----------
  const onPreviewClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!eyedropper) return;
      const raw = rawCanvasRef.current;
      if (!raw || (raw.width === 0 && raw.height === 0)) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = Math.round(((e.clientX - rect.left) / rect.width) * raw.width);
      const y = Math.round(((e.clientY - rect.top) / rect.height) * raw.height);
      if (x < 0 || y < 0 || x >= raw.width || y >= raw.height) return;
      const ctx = raw.getContext("2d", { willReadFrequently: true })!;
      const d = ctx.getImageData(x, y, 1, 1).data;
      if (d[3] < 10) {
        toast.warning("این پیکسل شفاف است — رنگ دیگری انتخاب کنید");
        return;
      }
      setChromaHex(rgbToHex([d[0], d[1], d[2]]));
      setEyedropper(false);
      toast.success(`رنگ کلید: ${rgbToHex([d[0], d[1], d[2]])}`);
    },
    [eyedropper]
  );

  // ---------- extraction ----------
  const targetIndices = useCallback((): number[] | "video" => {
    if (mode === "video") return "video";
    const len = gifFrames.length;
    if (gifAll) return Array.from({ length: len }, (_, i) => i);
    const n = Math.min(count, len);
    const idx: number[] = [];
    for (let i = 0; i < n; i++) {
      idx.push(Math.min(len - 1, Math.floor(((i + 0.5) * len) / n)));
    }
    return Array.from(new Set(idx));
  }, [count, gifAll, gifFrames.length, mode]);

  const extract = useCallback(async () => {
    if (mode === "idle") {
      toast.error("ابتدا ویدیو یا گیف بارگذاری کنید");
      return;
    }
    cancelRef.current = false;
    videoElRef.current?.pause();
    setVideoPlaying(false);
    setGifPlaying(false);

    const chroma = chromaRef.current;
    const applyTo = (canvas: HTMLCanvasElement): HTMLCanvasElement => {
      if (!chroma.enabled) return canvas;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      applyChromaKey(img, {
        color: hexToRgb(chroma.hex),
        similarity: chroma.similarity,
        smoothness: chroma.smoothness,
        despill: chroma.despill,
      });
      ctx.putImageData(img, 0, 0);
      return canvas;
    };

    try {
      const inputs: Array<{ name: string; canvas: HTMLCanvasElement; source: "video" }> = [];

      if (mode === "video") {
        const v = videoElRef.current;
        if (!v || !videoMeta) return;
        const frames = await extractFramesFromVideo(
          v,
          videoMeta.duration,
          count,
          (p) => setProgress(p),
          () => cancelRef.current
        );
        frames.forEach((f, i) => {
          inputs.push({
            name: frameName(`${prefix.trim() || "vid"}_{i}`, i, frames.length),
            canvas: applyTo(f.canvas),
            source: "video",
          });
        });
      } else {
        const idx = targetIndices();
        const list = Array.isArray(idx) ? idx : [];
        for (let i = 0; i < list.length; i++) {
          if (cancelRef.current) break;
          const f = gifFrames[list[i]];
          if (!f) continue;
          const canvas = applyTo(cloneCanvas(f.canvas));
          inputs.push({
            name: frameName(`${prefix.trim() || "vid"}_{i}`, i, list.length),
            canvas,
            source: "video",
          });
          setProgress({ current: i + 1, total: list.length });
          await new Promise((r) => setTimeout(r, 0));
        }
      }

      if (inputs.length === 0) {
        toast.warning("فریمی استخراج نشد");
        return;
      }
      const n = addFrames(inputs);
      if (autoZip) {
        toast.loading("در حال ساخت ZIP شفاف...", { id: "vid-zip" });
        await downloadFramesZip(inputs, `${prefix.trim() || "vid"}-frames`, 0.95);
        toast.success(`${n} فایل استخراج‌شده دانلود شد`, {
          id: "vid-zip",
          description: chroma.enabled
            ? "ZIP با فریم‌های WebP شفاف کروماکی‌شده — در انیماتور هم آماده است"
            : "در تب انیماتور هم آماده است",
        });
      } else {
        toast.success(`${n} فریم به انیماتور اضافه شد`, {
          description: chroma.enabled ? "با کروماکی اعمال‌شده" : "بدون کروماکی",
        });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "خطا در استخراج فریم‌ها");
    } finally {
      setProgress(null);
      cancelRef.current = false;
    }
  }, [addFrames, autoZip, count, gifFrames, mode, prefix, targetIndices, videoMeta]);

  const totalFrames =
    mode === "gif"
      ? gifAll
        ? gifFrames.length
        : Math.min(count, gifFrames.length)
      : mode === "video"
        ? count
        : 0;
  const sourceReady = mode !== "idle";

  return (
    <div className="flex flex-col gap-4">
      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,video/webm,video/quicktime,image/gif,.mp4,.webm,.mov,.gif"
        className="hidden"
        onChange={(e) => onFiles(e.target.files)}
      />
      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
      {/* ---------- preview column ---------- */}
      <div className="flex flex-col gap-3">
        {sourceReady && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl panel-glass p-2.5">
          <Button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="metallic-gradient text-white font-bold glow-purple hover:brightness-110"
          >
            <Upload className="h-4 w-4" />
            آپلود ویدیو / گیف
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={busySource}
            onClick={() => void testVideo()}
            className="border border-emerald-400/30 bg-emerald-400/10 text-emerald-200 hover:border-emerald-400/60"
          >
            {busySource ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <TestTube2 className="h-4 w-4" />
            )}
            ویدیوی تستی پرده سبز
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={busySource}
            onClick={() => void testGif()}
            className="border border-cyan-400/30 bg-cyan-400/10 text-cyan-200 hover:border-cyan-400/60"
          >
            <Sparkles className="h-4 w-4" />
            گیف متحرک تستی
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={resetSource}
            className="mr-auto text-slate-400 hover:text-rose-300"
          >
            بستن منبع
          </Button>
        </div>
        )}

        {sourceReady ? (
        <div className="relative overflow-hidden rounded-2xl border border-white/10 checker-dark">
          <canvas
            ref={previewCanvasRef}
            width={720}
            height={480}
            onClick={onPreviewClick}
            className={cn(
              "mx-auto block h-auto max-h-[480px] w-full cursor-default",
              eyedropper && "cursor-crosshair"
            )}
          />

          {mode === "gif" && gifFrames.length > 0 && (
            <div className="absolute right-3 top-3 rounded-md bg-slate-900/80 px-2 py-1 text-[11px] text-cyan-300 border border-white/10 backdrop-blur">
              فریم {gifIdx + 1} / {gifFrames.length}
            </div>
          )}
          {mode === "video" && videoMeta && (
            <div className="absolute right-3 top-3 rounded-md bg-slate-900/80 px-2 py-1 text-[11px] text-cyan-300 border border-white/10 backdrop-blur">
              {videoMeta.width}×{videoMeta.height} — {videoMeta.duration.toFixed(1)}s
            </div>
          )}
        </div>
        ) : (
        <div
          className="hero-dots relative overflow-hidden rounded-3xl border-2 border-dashed border-cyan-400/25 bg-slate-950/40 p-8 text-center sm:p-10"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            onFiles(e.dataTransfer.files);
          }}
        >
          <div className="pointer-events-none absolute -top-24 right-1/2 h-64 w-64 translate-x-1/2 rounded-full bg-cyan-400/15 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 left-1/4 h-56 w-56 rounded-full bg-violet-500/15 blur-3xl" />
          <div className="relative">
            <div className="hero-icon-glow mx-auto grid h-20 w-20 place-items-center rounded-2xl border border-cyan-400/40 bg-cyan-400/15">
              <FileVideo className="h-9 w-9 text-cyan-300" />
            </div>
            <h2 className="mt-5 text-xl font-black metallic-text sm:text-2xl">
              ویدیو یا گیف را به فریم‌های شفاف تبدیل کنید
            </h2>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-400">
              فایل را اینجا رها کنید یا بدون آپلود، با یک کلیک منبع تستی بسازید — کروماکی زنده
              روی پیش‌نمایش اعمال می‌شود و خروجی ZIP شفاف دانلود می‌شود.
            </p>

            <div className="mt-7 grid gap-3 text-right sm:grid-cols-3">
              <div
                role="button"
                tabIndex={0}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => e.key === "Enter" && fileInputRef.current?.click()}
                className="group cursor-pointer rounded-2xl metallic-gradient p-[1.5px] transition-transform hover:scale-[1.02]"
              >
                <div className="flex h-full flex-col gap-1.5 rounded-[calc(1rem-1px)] bg-slate-950/85 p-4">
                  <span className="mb-1 grid h-10 w-10 place-items-center rounded-xl border border-violet-400/40 bg-violet-500/15 text-violet-300">
                    <Upload className="h-5 w-5" />
                  </span>
                  <span className="text-sm font-black text-white">آپلود ویدیو / گیف</span>
                  <span className="text-[11px] leading-4 text-slate-400">
                    کشیدن و رها کردن هم کار می‌کند
                  </span>
                  <span className="mt-auto pt-1 font-mono text-[10px] text-slate-500" dir="ltr">
                    MP4 · WebM · MOV · GIF
                  </span>
                </div>
              </div>

              <div
                role="button"
                tabIndex={0}
                onClick={() => void testVideo()}
                onKeyDown={(e) => e.key === "Enter" && void testVideo()}
                className="cursor-pointer rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-4 transition-all hover:scale-[1.02] hover:border-emerald-400/60"
              >
                <span className="mb-1 grid h-10 w-10 place-items-center rounded-xl border border-emerald-400/40 bg-emerald-400/15 text-emerald-300">
                  <TestTube2 className="h-5 w-5" />
                </span>
                <span className="block text-sm font-black text-emerald-100">ویدیوی تستی پرده سبز</span>
                <span className="mt-1 block text-[11px] leading-4 text-slate-400">
                  یک کلیک — بدون آپلود فایل
                </span>
              </div>

              <div
                role="button"
                tabIndex={0}
                onClick={() => void testGif()}
                onKeyDown={(e) => e.key === "Enter" && void testGif()}
                className="cursor-pointer rounded-2xl border border-cyan-400/30 bg-cyan-400/10 p-4 transition-all hover:scale-[1.02] hover:border-cyan-400/60"
              >
                <span className="mb-1 grid h-10 w-10 place-items-center rounded-xl border border-cyan-400/40 bg-cyan-400/15 text-cyan-300">
                  <Sparkles className="h-5 w-5" />
                </span>
                <span className="block text-sm font-black text-cyan-100">گیف متحرک تستی</span>
                <span className="mt-1 block text-[11px] leading-4 text-slate-400">
                  یک کلیک — بدون آپلود فایل
                </span>
              </div>
            </div>
          </div>
        </div>
        )}

        {/* playback controls */}
        {mode === "video" && videoMeta && (
          <div className="flex items-center gap-2 rounded-xl panel-glass p-3">
            <Button
              type="button"
              size="icon"
              variant="secondary"
              className="border border-white/10 bg-white/5"
              onClick={() => setVideoPlaying((p) => !p)}
              aria-label={videoPlaying ? "توقف" : "پخش"}
            >
              {videoPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
            <input
              type="range"
              min={0}
              max={Math.max(0.05, videoMeta.duration)}
              step={0.02}
              dir="ltr"
              className="h-1.5 flex-1 accent-violet-500"
              onChange={(e) => {
                const v = videoElRef.current;
                if (v) v.currentTime = Number(e.target.value);
              }}
              aria-label="جابجایی زمانی"
            />
            <span className="text-xs text-slate-400" dir="ltr">
              {srcName}
            </span>
          </div>
        )}
        {mode === "gif" && gifFrames.length > 0 && (
          <div className="flex items-center gap-2 rounded-xl panel-glass p-3">
            <Button
              type="button"
              size="icon"
              variant="secondary"
              className="border border-white/10 bg-white/5"
              onClick={() => setGifPlaying((p) => !p)}
              aria-label={gifPlaying ? "توقف" : "پخش"}
            >
              {gifPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
            <Slider
              value={[gifIdx]}
              min={0}
              max={gifFrames.length - 1}
              step={1}
              onValueChange={(v) => {
                setGifPlaying(false);
                setGifIdx(v[0]);
              }}
              className="flex-1"
            />
            <span className="text-xs text-slate-400" dir="ltr">
              {srcName}
            </span>
          </div>
        )}
      </div>

      {/* ---------- controls column ---------- */}
      <div className="flex flex-col gap-3">
        {/* frame count */}
        <section className="rounded-xl panel-glass p-4 space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-200">
            <Film className="h-4 w-4 text-violet-400" />
            تعداد فریم‌های استخراج
          </h3>
          <div className="grid grid-cols-3 gap-1.5">
            {COUNTS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  setCount(c);
                  setGifAll(false);
                }}
                className={cn(
                  "rounded-lg border px-2 py-2 text-sm font-bold transition-colors",
                  count === c && !gifAll
                    ? "border-cyan-400/60 bg-cyan-400/10 text-cyan-300 neon-ring"
                    : "border-white/10 bg-white/5 text-slate-300 hover:border-violet-400/40"
                )}
              >
                {c} فریم
              </button>
            ))}
          </div>
          {mode === "gif" && (
            <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2">
              <Label className="text-xs text-slate-300">همه فریم‌های اصلی گیف ({gifFrames.length})</Label>
              <Switch
                checked={gifAll}
                onCheckedChange={(v) => {
                  setGifAll(v);
                  if (v) toast.info(`هر ${gifFrames.length} فریم اصلی استخراج می‌شود`);
                }}
                aria-label="همه فریم‌ها"
              />
            </div>
          )}
          {mode === "video" && (
            <p className="text-[11px] leading-4 text-slate-500">
              نمونه‌برداری زمانی متوازن روی طول ویدیو اعمال می‌شود و به‌صورت غیرمسدودکننده با نوار پیشرفت اجرا خواهد شد.
            </p>
          )}
        </section>

        {/* chroma key */}
        <section className="rounded-xl panel-glass p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-200">
              <Droplets className="h-4 w-4 text-emerald-400" />
              کروماکی زنده
            </h3>
            <Switch checked={chromaEnabled} onCheckedChange={setChromaEnabled} aria-label="کروماکی" />
          </div>

          <div className={cn("space-y-3", !chromaEnabled && "opacity-45 pointer-events-none")}>
            <div className="flex items-center gap-2">
              <label
                className="relative h-9 w-14 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-white/20"
                style={{ backgroundColor: chromaHex }}
                aria-label="انتخاب رنگ کلید"
              >
                <input
                  type="color"
                  value={chromaHex}
                  onChange={(e) => setChromaHex(e.target.value)}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                />
              </label>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setEyedropper((v) => !v)}
                className={cn(
                  "flex-1 border",
                  eyedropper
                    ? "border-cyan-400/60 bg-cyan-400/15 text-cyan-300 neon-ring"
                    : "border-white/10 bg-white/5 text-slate-300"
                )}
              >
                {eyedropper ? <Eye className="h-4 w-4" /> : <Pipette className="h-4 w-4" />}
                {eyedropper ? "روی پیش‌نمایش کلیک کنید" : "قطره‌چکان"}
              </Button>
            </div>
            <div className="flex gap-1.5">
              {[
                { label: "پرده سبز", hex: "#00B140" },
                { label: "پرده آبی", hex: "#0047BB" },
                { label: "بنفش", hex: "#B026FF" },
              ].map((p) => (
                <button
                  key={p.hex}
                  type="button"
                  onClick={() => setChromaHex(p.hex)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-[11px] text-slate-300 hover:border-violet-400/40"
                >
                  <span className="h-3 w-3 rounded-full border border-white/30" style={{ backgroundColor: p.hex }} />
                  {p.label}
                </button>
              ))}
            </div>
            <div>
              <div className="flex justify-between text-xs text-slate-400">
                <span>حساسیت کلید</span>
                <span className="text-cyan-300">{Math.round(similarity * 100)}٪</span>
              </div>
              <Slider value={[similarity]} min={0.02} max={0.9} step={0.01} onValueChange={(v) => setSimilarity(v[0])} className="mt-1.5" />
            </div>
            <div>
              <div className="flex justify-between text-xs text-slate-400">
                <span>نرمی لبه</span>
                <span className="text-cyan-300">{Math.round(smoothness * 100)}٪</span>
              </div>
              <Slider value={[smoothness]} min={0.01} max={0.6} step={0.01} onValueChange={(v) => setSmoothness(v[0])} className="mt-1.5" />
            </div>
            <div>
              <div className="flex justify-between text-xs text-slate-400">
                <span>خنثی‌سازی بازتاب پرده (Despill)</span>
                <span className="text-cyan-300">{Math.round(despill * 100)}٪</span>
              </div>
              <Slider value={[despill]} min={0} max={1} step={0.05} onValueChange={(v) => setDespill(v[0])} className="mt-1.5" />
            </div>
          </div>
        </section>
      </div>
      </div>

      {/* ---------- sticky bottom action bar: extract + download ---------- */}
      <div className="sticky bottom-3 z-30">
        <div className="float-bar flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-white/10 panel-glass px-4 py-3">
          <div className="flex items-center gap-2">
            <Label htmlFor="vid-prefix" className="shrink-0 text-xs text-slate-400">
              پیشوند
            </Label>
            <input
              id="vid-prefix"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              dir="ltr"
              placeholder="vid"
              className="w-24 rounded-lg border border-white/10 bg-slate-950/60 px-2.5 py-1.5 font-mono text-sm text-slate-200 outline-none focus:border-cyan-400/50"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 hover:border-cyan-400/40">
            <Switch checked={autoZip} onCheckedChange={setAutoZip} aria-label="دانلود خودکار ZIP" />
            <Package className="h-3.5 w-3.5 text-cyan-300" />
            دانلود خودکار ZIP
          </label>
          {progress && (
            <div className="flex min-w-[170px] flex-1 items-center gap-2">
              <Progress value={(progress.current / progress.total) * 100} className="h-2 flex-1" />
              <span className="font-mono text-[11px] text-cyan-300" dir="ltr">
                {progress.current}/{progress.total}
              </span>
            </div>
          )}
          <div className="mr-auto flex items-center gap-2">
            {progress && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  cancelRef.current = true;
                }}
                className="border border-rose-400/30 bg-rose-400/10 text-rose-200 hover:border-rose-400/60"
              >
                <CircleStop className="h-4 w-4" />
                لغو
              </Button>
            )}
            <Button
              type="button"
              disabled={!sourceReady || !!progress}
              onClick={() => void extract()}
              className="metallic-gradient text-white font-bold glow-purple hover:brightness-110"
            >
              {progress ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ImageDown className="h-4 w-4" />
              )}
              استخراج و دانلود ZIP
              <span className="rounded-md bg-black/25 px-1.5 py-0.5 text-xs">{totalFrames}</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
