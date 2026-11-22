/**
 * Full GIF decoding via gifuct-js with proper frame composition
 * (disposal methods 0..3), producing a list of composited canvases.
 */

import { parseGIF, decompressFrames } from "gifuct-js";

/** Shape of a decoded frame from gifuct-js decompressFrames(buildImagePatch=true). */
interface GifuctFrame {
  dims: { top: number; left: number; width: number; height: number };
  patch: Uint8ClampedArray;
  delay?: number;
  disposalType?: number;
}

export interface DecodedFrame {
  canvas: HTMLCanvasElement;
  /** Frame delay in milliseconds. */
  delayMs: number;
}

export interface DecodedGif {
  width: number;
  height: number;
  frames: DecodedFrame[];
}

export async function decodeGif(blob: Blob): Promise<DecodedGif> {
  const buffer = await blob.arrayBuffer();
  const gif = parseGIF(buffer as ArrayBuffer);
  const rawFrames = decompressFrames(gif, true) as unknown as GifuctFrame[];

  const width = gif.lsd.width;
  const height = gif.lsd.height;

  const composite = document.createElement("canvas");
  composite.width = width;
  composite.height = height;
  const cctx = composite.getContext("2d", { willReadFrequently: true })!;

  const patch = document.createElement("canvas");
  patch.width = width;
  patch.height = height;
  const pctx = patch.getContext("2d", { willReadFrequently: true })!;

  const frames: DecodedFrame[] = [];
  let pendingDisposal = 0;
  let pendingRect: { left: number; top: number; width: number; height: number } | null = null;
  let savedSnapshot: ImageData | null = null;

  for (const rf of rawFrames) {
    if (!rf || !rf.dims || !rf.patch) continue;
    const dims = rf.dims;
    const disposal = rf.disposalType ?? 0;
    const delayMs = Math.max(20, rf.delay ?? 100);

    // apply disposal of the previous frame before drawing this one
    if (pendingDisposal === 2 && pendingRect) {
      cctx.clearRect(pendingRect.left, pendingRect.top, pendingRect.width, pendingRect.height);
    } else if (pendingDisposal === 3 && savedSnapshot) {
      cctx.putImageData(savedSnapshot, 0, 0);
    }
    savedSnapshot = null;

    // save snapshot if THIS frame requests restore-to-previous afterwards
    if (disposal === 3) {
      savedSnapshot = cctx.getImageData(0, 0, width, height);
    }

    // draw the patch (RGBA) at its offset
    const patchData = new ImageData(new Uint8ClampedArray(rf.patch), dims.width, dims.height);
    pctx.clearRect(0, 0, width, height);
    pctx.putImageData(patchData, 0, 0);
    cctx.drawImage(patch, dims.left, dims.top);

    const snapshot = document.createElement("canvas");
    snapshot.width = width;
    snapshot.height = height;
    snapshot.getContext("2d")!.drawImage(composite, 0, 0);

    frames.push({ canvas: snapshot, delayMs });

    pendingDisposal = disposal;
    pendingRect = dims;
  }

  if (frames.length === 0) {
    throw new Error("گیف حاوی هیچ فریمی نیست");
  }

  return { width, height, frames };
}
