"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Film, Loader2, Pause, Play, X } from "lucide-react";
import { toast } from "sonner";
import { autoRemoveBackground } from "@/lib/cv/auto-remove";
import { decodeGif, type DecodedFrame } from "@/lib/cv/gif";
import {
  extractFramesFromVideo,
  loadVideoMeta,
  waitFor,
  waitForPresentedFrame,
} from "@/lib/cv/video-extract";
import { cloneCanvas, downloadFramesZip, fitInto, frameName } from "@/lib/cv/frame-utils";
import { useFrameStore } from "@/lib/store";
import { cn } from "@/lib/utils";

type Mode = "idle" | "video" | "gif";
type Count = 8 | 12 | 16 | 0; // 0 = all

const COUNTS: Array<{ v: Count; label: string }> = [
  { v: 8, label: "۸" },
  { v: 12, label: "۱۲" },
  { v: 16, label: "۱۶" },
  { v: 0, label: "همه" },
];

export function VideoStudio() {
  const addFrames = useFrameStore((s) => s.addFrames);

  const [mode, setMode] = useState<Mode>("idle");
  const [count, setCount] = useState<Count>(8);
  const [gifAll, setGifAll] = useState(false);
  const [busySource, setBusySource] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);

  const [videoPlaying, setVideoPlaying] = useState(false);
  const [gifIdx, setGifIdx] = useState(0);
  const [gifPlaying, setGifPlaying] = useState(false);
  const [gifLen, setGifLen] = useState(0);

  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const videoUrlRef = useRef<string | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const rawCanvasRef = useRef<HTMLCanvasElement>(null);
  const workRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const gifTimerRef = useRef<number>(0);
  const gifIdxRef = useRef(0);
  const cancelRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modeRef = useRef<Mode>("idle");
  const gifFramesRef = useRef<DecodedFrame[]>([]);
  const playingRef = useRef(false);

  modeRef.current = mode;
  gifIdxRef.current = gifIdx;
  playingRef.current = videoPlaying || gifPlaying;

  // ---------- live preview: every frame is keyed automatically ----------
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

    let work = workRef.current;
    if (!work) {
      work = document.createElement("canvas");
      workRef.current = work;
    }
    // downscaled copy for a smooth realtime preview; export runs full-res
    const maxSide = playingRef.current ? 360 : 560;
    const s = Math.min(1, maxSide / Math.max(raw.width, raw.height));
    const workW = Math.max(1, Math.round(raw.width * s));
    const workH = Math.max(1, Math.round(raw.height * s));
    if (work.width !== workW || work.height !== workH) {
      work.width = workW;
      work.height = workH;
    }
    const wctx = work.getContext("2d", { willReadFrequently: true })!;
    wctx.clearRect(0, 0, work.width, work.height);
    wctx.imageSmoothingQuality = "high";
    wctx.drawImage(raw, 0, 0, workW, workH);
    const img = wctx.getImageData(0, 0, work.width, work.height);
    const keyed = autoRemoveBackground(img, { feather: 1.0, removeHoles: true });
    wctx.putImageData(keyed.image, 0, 0);

    const ctx = canvas.getContext("2d")!;
    const fit = fitInto(work.width, work.height, canvas.width, canvas.height);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(work, fit.x, fit.y, fit.w, fit.h);
  }, []);

  // redraw while paused
  useEffect(() => {
    if ((mode === "video" && !videoPlaying) || (mode === "gif" && !gifPlaying)) {
      drawPreview();
    }
  }, [gifIdx, drawPreview, gifPlaying, mode, videoPlaying]);

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
    if (mode !== "gif" || !gifPlaying || gifFramesRef.current.length === 0) return;
    let cancelled = false;
    const step = () => {
      if (cancelled) return;
      const idx = (gifIdxRef.current + 1) % gifFramesRef.current.length;
      setGifIdx(idx);
      const delay = Math.max(33, gifFramesRef.current[idx]?.delayMs ?? 100);
      gifTimerRef.current = window.setTimeout(step, delay);
    };
    gifTimerRef.current = window.setTimeout(
      step,
      Math.max(33, gifFramesRef.current[gifIdxRef.current]?.delayMs ?? 100)
    );
    return () => {
      cancelled = true;
      window.clearTimeout(gifTimerRef.current);
    };
  }, [gifPlaying, mode]);

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

  // ---------- source ----------
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
    gifFramesRef.current = [];
    setGifLen(0);
    setMode("idle");
    setVideoPlaying(false);
    setGifPlaying(false);
    setGifIdx(0);
    setProgress(0);
  }, []);

  const loadVideo = useCallback(
    async (url: string) => {
      setBusySource(true);
      try {
        const { video } = await loadVideoMeta(url);
        videoElRef.current = video;
        videoUrlRef.current = url;
        setMode("video");
        setGifPlaying(false);
        setVideoPlaying(false);
        video.currentTime = 0;
        try {
          await waitFor(video, "seeked", 3000);
        } catch {
          /* already at 0 */
        }
        await waitForPresentedFrame(video);
        drawPreview();
      } catch {
        toast.error("این فرمت پشتیبانی نمی‌شود");
      } finally {
        setBusySource(false);
      }
    },
    [drawPreview]
  );

  const loadGif = useCallback(async (blob: Blob) => {
    setBusySource(true);
    try {
      const decoded = await decodeGif(blob);
      gifFramesRef.current = decoded.frames;
      setGifLen(decoded.frames.length);
      setMode("gif");
      setGifIdx(0);
      setVideoPlaying(false);
      window.setTimeout(() => drawPreview(), 80);
    } catch {
      toast.error("دیکد گیف ناموفق بود");
    } finally {
      setBusySource(false);
    }
  }, [drawPreview]);

  const onFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;
      resetSource();
      if (file.type === "image/gif" || file.name.toLowerCase().endsWith(".gif")) {
        void loadGif(file);
      } else if (file.type.startsWith("video/") || /\.(mp4|webm|mov|mkv)$/i.test(file.name)) {
        void loadVideo(URL.createObjectURL(file));
      } else {
        toast.error("فقط ویدیو یا گیف");
      }
    },
    [loadGif, loadVideo, resetSource]
  );

  const close = () => resetSource();

  // ---------- extraction ----------
  const extract = useCallback(async () => {
    if (mode === "idle") return;
    cancelRef.current = false;
    videoElRef.current?.pause();
    setVideoPlaying(false);
    setGifPlaying(false);
    setExtracting(true);

    const applyTo = (canvas: HTMLCanvasElement): HTMLCanvasElement => {
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const keyed = autoRemoveBackground(img, { feather: 1.0, removeHoles: true });
      ctx.putImageData(keyed.image, 0, 0);
      return canvas;
    };

    try {
      const inputs: Array<{ name: string; canvas: HTMLCanvasElement; source: "video" }> = [];

      if (mode === "video") {
        const v = videoElRef.current;
        if (!v) return;
        const n = count === 0 ? 16 : count;
        const frames = await extractFramesFromVideo(
          v,
          v.duration || 1,
          n,
          (p) => setProgress(Math.round((p.current / Math.max(1, p.total)) * 100)),
          () => cancelRef.current
        );
        frames.forEach((f, i) => {
          inputs.push({
            name: frameName("vid_{i}", i, frames.length),
            canvas: applyTo(f.canvas),
            source: "video",
          });
        });
      } else {
        const len = gifFramesRef.current.length;
        let list: number[];
        if (gifAll || count === 0) {
          list = Array.from({ length: len }, (_, i) => i);
        } else {
          const n = Math.min(count, len);
          list = [];
          for (let i = 0; i < n; i++) {
            list.push(Math.min(len - 1, Math.floor(((i + 0.5) * len) / n)));
          }
          list = Array.from(new Set(list));
        }
        for (let i = 0; i < list.length; i++) {
          if (cancelRef.current) break;
          const f = gifFramesRef.current[list[i]];
          if (!f) continue;
          inputs.push({
            name: frameName("vid_{i}", i, list.length),
            canvas: applyTo(cloneCanvas(f.canvas)),
            source: "video",
          });
          setProgress(Math.round(((i + 1) / list.length) * 100));
          await new Promise((r) => setTimeout(r, 0));
        }
      }

      if (inputs.length === 0) {
        toast.warning("فریمی استخراج نشد");
        return;
      }
      addFrames(inputs);
      const res = await downloadFramesZip(inputs, "spriteforge-frames", 0.95);
      if (res === "failed") toast.error("دانلود ZIP ناموفق بود — دوباره بزنید");
      else if (res !== "cancelled") toast.success(`${inputs.length} فریم ذخیره شد`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "استخراج ناموفق بود");
    } finally {
      setExtracting(false);
      setProgress(0);
      cancelRef.current = false;
    }
  }, [addFrames, count, gifAll, mode]);

  const sourceReady = mode !== "idle";
  const totalGif = gifLen;

  return (
    <div className="flex flex-col gap-3">
      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,video/webm,video/quicktime,image/gif,.mp4,.webm,.mov,.mkv,.gif"
        className="hidden"
        onChange={(e) => onFiles(e.target.files)}
      />

      {!sourceReady ? (
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
            onFiles(e.dataTransfer.files);
          }}
          className={`relative flex min-h-[380px] cursor-pointer flex-col items-center justify-center gap-4 overflow-hidden rounded-3xl border-2 border-dashed bg-surface transition-all sm:min-h-[440px] ${
            dragOver ? "border-fuchsia-line-strong bg-fuchsia-tint/30" : "border-line-strong hover:border-fuchsia-line"
          }`}
        >
          <div className="pointer-events-none absolute -top-24 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-fuchsia-tint blur-3xl" />
          <div className="relative grid h-20 w-20 place-items-center rounded-2xl border border-fuchsia-line bg-fuchsia-tint shadow-xl">
            <Film className="h-9 w-9 text-fuchsia-ink" />
          </div>
          <div className="relative text-center">
            <p className="text-lg font-black text-foreground">انتخاب ویدیو یا گیف</p>
            <p className="mt-1 text-xs text-faint">فریم‌ها خودکار شفاف می‌شوند</p>
          </div>
          <p className="relative text-[11px] text-faint" dir="ltr">
            MP4 · WebM · MOV · GIF
          </p>
        </div>
      ) : (
        <>
          {/* live preview */}
          <div className="relative overflow-hidden rounded-2xl border border-line checker-dark">
            <canvas
              ref={previewCanvasRef}
              width={720}
              height={480}
              className="mx-auto block h-auto max-h-[480px] w-full"
            />
            {busySource && (
              <div className="absolute inset-0 grid place-items-center bg-overlay/60 backdrop-blur-sm">
                <Loader2 className="h-7 w-7 animate-spin text-fuchsia-ink" />
              </div>
            )}
          </div>

          {/* playback + source row */}
          <div className="flex items-center gap-2 rounded-2xl border border-line panel-glass p-2.5">
            {mode === "video" && (
              <>
                <button
                  type="button"
                  onClick={() => setVideoPlaying((p) => !p)}
                  aria-label={videoPlaying ? "توقف" : "پخش"}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-line bg-chip text-foreground"
                >
                  {videoPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </button>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0.05, videoElRef.current?.duration || 1)}
                  step={0.02}
                  dir="ltr"
                  className="h-1.5 min-w-0 flex-1 accent-violet-500"
                  onChange={(e) => {
                    const v = videoElRef.current;
                    if (v) v.currentTime = Number(e.target.value);
                  }}
                  aria-label="زمان"
                />
              </>
            )}
            {mode === "gif" && (
              <>
                <button
                  type="button"
                  onClick={() => setGifPlaying((p) => !p)}
                  aria-label={gifPlaying ? "توقف" : "پخش"}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-line bg-chip text-foreground"
                >
                  {gifPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </button>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, totalGif - 1)}
                  step={1}
                  value={gifIdx}
                  dir="ltr"
                  className="h-1.5 min-w-0 flex-1 accent-violet-500"
                  onChange={(e) => {
                    setGifPlaying(false);
                    setGifIdx(Number(e.target.value));
                  }}
                  aria-label="فریم"
                />
                <span className="shrink-0 text-xs text-faint tabular-nums" dir="ltr">
                  {gifIdx + 1}/{totalGif}
                </span>
              </>
            )}
            <button
              type="button"
              onClick={close}
              aria-label="بستن"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-line bg-chip text-soft transition-colors hover:border-rose-line hover:text-rose-ink"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* frame count chips */}
          <div
            className={cn(
              "grid gap-1.5 rounded-2xl border border-line bg-surface p-1.5",
              mode === "gif" ? "grid-cols-4" : "grid-cols-3"
            )}
          >
            {COUNTS.filter((c) => mode === "gif" || c.v !== 0).map((c) => {
              const active = c.v === 0 ? gifAll : !gifAll && count === c.v;
              return (
                <button
                  key={c.label}
                  type="button"
                  onClick={() => {
                    if (c.v === 0) {
                      setGifAll(true);
                    } else {
                      setCount(c.v);
                      setGifAll(false);
                    }
                  }}
                  className={cn(
                    "rounded-xl py-2 text-sm font-black transition-all active:scale-95",
                    active
                      ? "metallic-gradient text-white shadow-md"
                      : "text-soft hover:bg-chip hover:text-foreground"
                  )}
                >
                  {c.label}
                  {c.v === 0 && totalGif > 0 && (
                    <span className="mr-1 text-[10px] opacity-80 tabular-nums">({totalGif})</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* actions */}
          <div className="sticky-safe pb-2">
            <div className="float-bar rounded-2xl border border-line panel-glass p-2.5">
              {extracting ? (
                <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-chip">
                  <div
                    className="h-full metallic-gradient transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => void extract()}
                disabled={extracting}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-xl metallic-gradient text-sm font-black text-white transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-60"
              >
                {extracting ? (
                  <Loader2 className="h-4.5 w-4.5 animate-spin" />
                ) : (
                  <Film className="h-4.5 w-4.5" />
                )}
                استخراج و دانلود ZIP
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
