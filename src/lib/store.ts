"use client";

import { create } from "zustand";
import { makeThumb } from "@/lib/cv/frame-utils";

export type FrameSource = "sheet" | "video" | "remove";

export interface FrameItem {
  id: string;
  name: string;
  w: number;
  h: number;
  canvas: HTMLCanvasElement;
  thumb: string;
  source: FrameSource;
  createdAt: number;
}

export interface NewFrameInput {
  name: string;
  canvas: HTMLCanvasElement;
  source: FrameSource;
}

interface FrameState {
  frames: FrameItem[];
  selectedFrameId: string | null;
  addFrame: (input: NewFrameInput) => string;
  addFrames: (inputs: NewFrameInput[]) => number;
  removeFrame: (id: string) => void;
  clearAll: () => void;
  renameAll: (pattern: string) => void;
  setSelected: (id: string | null) => void;
}

let counter = 0;
const nextId = () => {
  counter += 1;
  return `fr-${Date.now().toString(36)}-${counter}`;
};

export const useFrameStore = create<FrameState>((set) => ({
  frames: [],
  selectedFrameId: null,

  addFrame: (input) => {
    const id = nextId();
    const frame: FrameItem = {
      id,
      name: input.name,
      w: input.canvas.width,
      h: input.canvas.height,
      canvas: input.canvas,
      thumb: makeThumb(input.canvas),
      source: input.source,
      createdAt: Date.now(),
    };
    set((s) => ({
      frames: [...s.frames, frame],
      selectedFrameId: s.selectedFrameId ?? id,
    }));
    return id;
  },

  addFrames: (inputs) => {
    const now = Date.now();
    const items: FrameItem[] = inputs.map((input, i) => ({
      id: nextId(),
      name: input.name,
      w: input.canvas.width,
      h: input.canvas.height,
      canvas: input.canvas,
      thumb: makeThumb(input.canvas),
      source: input.source,
      createdAt: now + i,
    }));
    set((s) => ({
      frames: [...s.frames, ...items],
      selectedFrameId: s.selectedFrameId ?? items[0]?.id ?? null,
    }));
    return items.length;
  },

  removeFrame: (id) =>
    set((s) => {
      const frames = s.frames.filter((f) => f.id !== id);
      return {
        frames,
        selectedFrameId:
          s.selectedFrameId === id ? (frames[0]?.id ?? null) : s.selectedFrameId,
      };
    }),

  clearAll: () => set({ frames: [], selectedFrameId: null }),

  renameAll: (pattern) =>
    set((s) => {
      const cleaned = pattern.trim() || "frame_{i}";
      const digits = Math.max(3, String(s.frames.length).length);
      return {
        frames: s.frames.map((f, i) => ({
          ...f,
          name: cleaned.includes("{i}")
            ? cleaned.replace(/\{i\}/g, String(i + 1).padStart(digits, "0"))
            : `${cleaned}_${String(i + 1).padStart(digits, "0")}`,
        })),
      };
    }),

  setSelected: (id) => set({ selectedFrameId: id }),
}));
