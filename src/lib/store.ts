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

/* ------------------------------------------------------------------ */
/* UI state — active tool tab (shared so the AI assistant can switch)  */
/* ------------------------------------------------------------------ */

export type TabId = "remove" | "sheet" | "video" | "anim" | "ai";

interface UiState {
  activeTab: TabId;
  setActiveTab: (t: TabId) => void;
}

export const useUiStore = create<UiState>((set) => ({
  activeTab: "remove",
  setActiveTab: (activeTab) => set({ activeTab }),
}));

/* ------------------------------------------------------------------ */
/* AI assistant — BYOK (bring your own key) chat with real tools       */
/* ------------------------------------------------------------------ */

export interface AiSettings {
  mode: "free" | "byok";
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface UiMessage {
  role: "user" | "assistant";
  content: string;
  tools?: string[];
}

const AI_LS_KEY = "rp-ai-settings";
const DEFAULT_AI_SETTINGS: AiSettings = {
  mode: "free",
  baseUrl: "",
  apiKey: "",
  model: "",
};

function loadAiSettings(): AiSettings {
  if (typeof window === "undefined") return DEFAULT_AI_SETTINGS;
  try {
    const raw = localStorage.getItem(AI_LS_KEY);
    if (!raw) return DEFAULT_AI_SETTINGS;
    const p = JSON.parse(raw) as Partial<AiSettings>;
    // saved keys without `mode` (old version) → BYOK
    if (
      typeof p.baseUrl === "string" &&
      typeof p.apiKey === "string" &&
      typeof p.model === "string" &&
      p.apiKey
    ) {
      return { mode: "byok", baseUrl: p.baseUrl, apiKey: p.apiKey, model: p.model };
    }
    if (p.mode === "free" && typeof p.model === "string" && p.model) {
      return { mode: "free", baseUrl: "", apiKey: "", model: p.model };
    }
  } catch {
    /* corrupted → defaults */
  }
  return DEFAULT_AI_SETTINGS;
}

interface AssistantState {
  aiSettings: AiSettings;
  saveAiSettings: (s: AiSettings) => void;
  messages: UiMessage[];
  pushMessage: (m: UiMessage) => void;
  clearMessages: () => void;
  aiBusy: boolean;
  setAiBusy: (b: boolean) => void;
}

export const useAssistantStore = create<AssistantState>((set) => ({
  aiSettings: loadAiSettings(),
  saveAiSettings: (s) => {
    try {
      localStorage.setItem(AI_LS_KEY, JSON.stringify(s));
    } catch {
      /* private mode — keep in memory only */
    }
    set({ aiSettings: s });
  },
  messages: [],
  pushMessage: (m) => set((s) => ({ messages: [...s.messages, m] })),
  clearMessages: () => set({ messages: [] }),
  aiBusy: false,
  setAiBusy: (aiBusy) => set({ aiBusy }),
}));
