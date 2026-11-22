import { NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";

export const maxDuration = 120;

interface RawBox {
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
}

const SYSTEM_PROMPT = `You are a precise computer-vision annotation engine. The user sends an image that usually contains a sprite sheet, a product photo grid, or several distinct items on a background. Detect EVERY distinct item and answer with STRICT JSON ONLY, no markdown fences, no commentary:
{"boxes":[{"x":<number>,"y":<number>,"w":<number>,"h":<number>,"label":"<short english label>"}]}
Coordinates x,y,w,h are normalized floats in [0,1] relative to image width/height. Each box must tightly cover one item. If there is only one prominent object, return exactly one box.`;

function extractJson(text: string): unknown {
  const cleaned = text
    .replace(/```json/gi, "```")
    .replace(/```/g, "")
    .trim();
  const start = cleaned.search(/[[{]/);
  if (start === -1) return null;
  const openChar = cleaned[start];
  const closeChar = openChar === "[" ? "]" : "}";
  let depth = 0;
  let end = -1;
  let inString = false;
  let escaped = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === openChar) depth += 1;
    else if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

function normalizeBoxes(parsed: unknown, width: number, height: number): RawBox[] {
  const arr: unknown[] = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { boxes?: unknown[] }).boxes)
      ? (parsed as { boxes: unknown[] }).boxes
      : [];

  const out: RawBox[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const b = item as Record<string, unknown>;
    const x = Number(b.x);
    const y = Number(b.y);
    const w = Number(b.w);
    const h = Number(b.h);
    if (![x, y, w, h].every((v) => Number.isFinite(v))) continue;
    let nx = Math.max(0, Math.min(1, x));
    let ny = Math.max(0, Math.min(1, y));
    let nw = Math.max(0, Math.min(1, w));
    let nh = Math.max(0, Math.min(1, h));
    // If the model returned pixel coordinates, convert them
    if (w > 1 || h > 1 || x > 1 || y > 1) {
      nx = Math.max(0, Math.min(1, x / width));
      ny = Math.max(0, Math.min(1, y / height));
      nw = Math.max(0, Math.min(1, w / width));
      nh = Math.max(0, Math.min(1, h / height));
    }
    if (nw <= 0.002 || nh <= 0.002) continue;
    const label = typeof b.label === "string" ? b.label.slice(0, 40) : undefined;
    out.push({ x: nx, y: ny, w: nw, h: nh, label });
  }
  return out;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      image?: unknown;
      width?: unknown;
      height?: unknown;
    };
    const image = typeof body.image === "string" ? body.image : "";
    const width = Number(body.width) || 1;
    const height = Number(body.height) || 1;

    if (!image.startsWith("data:image/") || image.length > 8_000_000) {
      return NextResponse.json(
        { ok: false, error: "تصویر ارسالی معتبر نیست یا بیش از حد بزرگ است" },
        { status: 400 }
      );
    }

    const zai = await ZAI.create();
    const completion = await zai.chat.completions.createVision({
      model: "glm-4.5v",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: SYSTEM_PROMPT },
            { type: "image_url", image_url: { url: image } },
          ],
        },
      ],
      thinking: { type: "disabled" },
    });

    const content = completion.choices[0]?.message?.content;
    const raw =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content.map((c) => (c as { text?: string }).text ?? "").join("\n")
          : "";

    const boxes = normalizeBoxes(extractJson(raw), width, height);

    return NextResponse.json({
      ok: true,
      boxes,
      count: boxes.length,
      rawPreview: raw.slice(0, 300),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "خطای ناشناخته در سرور تشخیص";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
