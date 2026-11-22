/**
 * Non-blocking uniform temporal sampling of video files.
 * Uses media element seeking + requestVideoFrameCallback when available,
 * yields to the event loop between frames and reports progress.
 */

import type { DecodedFrame } from "./gif";

export interface ExtractProgress {
  current: number;
  total: number;
}

export interface LoadedImage {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

export function loadImageToCanvas(file: Blob): Promise<LoadedImage> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d")!.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      resolve({ canvas, width: canvas.width, height: canvas.height });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("بارگذاری تصویر ناموفق بود"));
    };
    img.src = url;
  });
}

export function waitFor(el: HTMLMediaElement, event: string, timeoutMs = 6000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error(`منتظر رویداد ${event} ماند: timeout`));
    }, timeoutMs);
    const onOk = () => {
      cleanup();
      resolve();
    };
    const onErr = () => {
      cleanup();
      reject(new Error("خطا در پخش رسانه — کدک پشتیبانی نمی‌شود"));
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      el.removeEventListener(event, onOk);
      el.removeEventListener("error", onErr);
    };
    el.addEventListener(event, onOk, { once: true });
    el.addEventListener("error", onErr, { once: true });
  });
}

const nextTick = () =>
  new Promise<void>((r) => {
    requestAnimationFrame(() => setTimeout(r, 0));
  });

/** Waits until the video actually presents the frame for the current time. */
export function waitForPresentedFrame(video: HTMLVideoElement, timeoutMs = 1200): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    const timer = window.setTimeout(finish, timeoutMs);
    const v = video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number;
    };
    if (v.requestVideoFrameCallback) {
      v.requestVideoFrameCallback(() => {
        window.clearTimeout(timer);
        finish();
      });
    } else if (video.readyState >= 2) {
      window.clearTimeout(timer);
      finish();
    } else {
      video.addEventListener(
        "loadeddata",
        () => {
          window.clearTimeout(timer);
          finish();
        },
        { once: true }
      );
    }
  });
}

export interface VideoMeta {
  width: number;
  height: number;
  duration: number;
}

/** Loads a video element and resolves reliable metadata (fixes Infinity duration of MediaRecorder webm). */
export async function loadVideoMeta(url: string): Promise<{ video: HTMLVideoElement; meta: VideoMeta }> {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  // attached to the DOM (hidden) so codecs decode reliably in all browsers
  video.style.position = "fixed";
  video.style.opacity = "0";
  video.style.pointerEvents = "none";
  video.style.zIndex = "-1";
  video.style.width = "1px";
  video.style.height = "1px";
  document.body.appendChild(video);
  video.src = url;
  await waitFor(video, "loadeddata");

  let duration = video.duration;
  if (!Number.isFinite(duration) || duration === 0) {
    // Chrome stores Infinity for MediaRecorder blobs; seek past the end to force duration resolution
    video.currentTime = 1e7;
    try {
      await waitFor(video, "seeked", 4000);
    } catch {
      /* ignore */
    }
    duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : video.currentTime;
    if (!Number.isFinite(duration) || duration <= 0) duration = 3;
  }

  return {
    video,
    meta: {
      width: video.videoWidth || 480,
      height: video.videoHeight || 480,
      duration,
    },
  };
}

/**
 * Extracts exactly `count` frames at uniform temporal centers.
 * Non-blocking: yields between frames, reports progress, supports cancel.
 */
export async function extractFramesFromVideo(
  video: HTMLVideoElement,
  duration: number,
  count: number,
  onProgress?: (p: ExtractProgress) => void,
  isCancelled?: () => boolean
): Promise<DecodedFrame[]> {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) throw new Error("ابعاد ویدیو در دسترس نیست");

  const frames: DecodedFrame[] = [];

  for (let i = 0; i < count; i++) {
    if (isCancelled?.()) break;
    const t = Math.min(duration - 0.001, (duration * (i + 0.5)) / count);
    video.currentTime = Math.max(0, t);
    try {
      await waitFor(video, "seeked", 4000);
    } catch {
      continue;
    }
    // wait for the actual presented frame when supported
    const v = video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number;
    };
    if (v.requestVideoFrameCallback) {
      await new Promise<void>((resolve) => {
        let done = false;
        const timer = window.setTimeout(() => {
          if (!done) {
            done = true;
            resolve();
          }
        }, 250);
        v.requestVideoFrameCallback!(() => {
          if (!done) {
            done = true;
            window.clearTimeout(timer);
            resolve();
          }
        });
      });
    }

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")!.drawImage(video, 0, 0, w, h);
    frames.push({ canvas, delayMs: Math.round((duration / count) * 1000) });

    onProgress?.({ current: i + 1, total: count });
    await nextTick();
  }

  return frames;
}
