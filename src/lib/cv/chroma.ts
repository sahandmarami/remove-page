/**
 * Live chroma-key engine.
 *
 * Keying is performed in chrominance space (Cb/Cr) so that luminance
 * variations (shadows on the screen, hair lighting) do not punch holes.
 * Alpha is a smooth ramp between `similarity` and `similarity + smoothness`.
 * Despill un-mixes the key color out of soft edges and suppresses the key
 * channel spill (green halo in hair, fringes on shoulders).
 */

import type { RGB } from "./color-utils";

export interface ChromaOptions {
  /** Key color (pure green: [0,177,64], pure blue: [0,71,177]). */
  color: RGB;
  /** Chroma distance below which a pixel is fully keyed out (0..1 of range). */
  similarity: number;
  /** Softness band added above similarity for partial alpha (0..1). */
  smoothness: number;
  /** Spill suppression / edge un-mixing strength (0..1). */
  despill: number;
}

export const DEFAULT_CHROMA: ChromaOptions = {
  color: [0, 177, 64],
  similarity: 0.28,
  smoothness: 0.18,
  despill: 0.6,
};

const CHROMA_RANGE = 180; // practical max distance in Cb/Cr

function toChroma(r: number, g: number, b: number): [number, number] {
  const cb = -0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 0.5 * r - 0.418688 * g - 0.081312 * b;
  return [cb, cr];
}

/**
 * Applies the chroma key in-place on an ImageData.
 */
export function applyChromaKey(img: ImageData, opts: ChromaOptions): void {
  const data = img.data;
  const [kr, kg, kb] = opts.color;
  const [kcb, kcr] = toChroma(kr, kg, kb);

  const tIn = Math.max(2, opts.similarity * CHROMA_RANGE);
  const tOut = tIn + Math.max(2, opts.smoothness * CHROMA_RANGE);

  // dominant spill channel of the key color
  const kMax = Math.max(kr, kg, kb);
  const spillChannel =
    kMax === kg && kg - Math.max(kr, kb) > 24
      ? 1
      : kMax === kr && kr - Math.max(kg, kb) > 24
        ? 0
        : kMax === kb && kb - Math.max(kr, kg) > 24
          ? 2
          : -1;

  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a === 0) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    const [cb, cr] = toChroma(r, g, b);
    const dist = Math.hypot(cb - kcb, cr - kcr);

    let alpha: number;
    if (dist <= tIn) {
      alpha = 0;
    } else if (dist >= tOut) {
      alpha = a / 255;
    } else {
      const t = (dist - tIn) / (tOut - tIn);
      alpha = (a / 255) * (t * t * (3 - 2 * t)); // smoothstep
    }

    const out8 = Math.round(alpha * 255);
    data[i + 3] = out8;

    if (out8 === 0) continue;

    // despill: un-mix key color out of semi-transparent edges
    if (opts.despill > 0.01 && out8 < 255) {
      const af = out8 / 255;
      const key: RGB = [kr, kg, kb];
      for (let c = 0; c < 3; c++) {
        const px = data[i + c];
        const unmixed = (px - key[c] * (1 - af)) / af;
        data[i + c] = px + (Math.max(0, Math.min(255, unmixed)) - px) * opts.despill;
      }
    }

    // channel spill suppression on near-key pixels
    const sc = spillChannel;
    if (opts.despill > 0.01 && sc >= 0) {
      const pr = data[i];
      const pg = data[i + 1];
      const pb = data[i + 2];
      const others =
        sc === 0 ? Math.max(pg, pb) : sc === 1 ? Math.max(pr, pb) : Math.max(pr, pg);
      const val = sc === 0 ? pr : sc === 1 ? pg : pb;
      if (val > others) {
        const target = others + (val - others) * (1 - opts.despill);
        if (sc === 0) data[i] = target;
        else if (sc === 1) data[i + 1] = target;
        else data[i + 2] = target;
      }
    }
  }
}
