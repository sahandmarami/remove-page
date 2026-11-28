"use client";

import { downloadFramesZip } from "@/lib/cv/frame-utils";
import {
  useAssistantStore,
  useFrameStore,
  useUiStore,
  type AiSettings,
} from "@/lib/store";

/* ------------------------------------------------------------------ */
/* OpenAI-compatible chat client (works with OpenAI, OpenRouter, Groq, */
/* z.ai … anything exposing /chat/completions) + local tool execution  */
/* ------------------------------------------------------------------ */

export const SYSTEM_PROMPT = `تو «دستیار Remove Page» هستی؛ راهنمای یک استودیوی گرافیکی که کاملاً داخل مرورگر کاربر کار می‌کند. تب‌ها:
- remove: حذف پس‌زمینه تصویر (خودکار و کروماکی)
- sheet: برش اسپرایت‌شیت به فریم‌ها با تشخیص هوشمند گرید
- video: استخراج فریم‌های شفاف از ویدیو یا گیف
- anim: انیماتور فلپ‌بوک برای ساخت گیف از فریم‌ها
فریم‌های ساخته‌شده در ابزارها به انیماتور می‌روند و از آنجا ZIP یا گیف خروجی می‌گیرند.
قواعد پاسخ: فارسی، صمیمی و خیلی کوتاه (۱ تا ۳ جمله). وقتی کاربر بخواهد کاری در سایت انجام شود، از ابزارها استفاده کن و نتیجه را با جزئیات گزارش بده. ابزار مخرب clear_animator را فقط بعد از تایید صریح کاربر صدا بزن. برای کارهایی که ابزاری ندارند (مثل حذف متن از تصویر یا ویرایش خود تصویر با هوش مصنوعی) وعده نده و راه درست را با ابزارهای موجود توضیح بده. پردازش تصویر کلاً داخل مرورگر کاربر انجام می‌شود و چیزی جایی آپلود نمی‌شود.`;

export const TOOL_DEFS = [
  {
    type: "function",
    function: {
      name: "get_state",
      description: "وضعیت فعلی برنامه: تب فعال، تعداد فریم‌های انیماتور و منبع هر فریم",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "switch_tab",
      description: "رفتن به یکی از تب‌های استودیو",
      parameters: {
        type: "object",
        properties: {
          tab: {
            type: "string",
            enum: ["remove", "sheet", "video", "anim"],
            description: "remove=حذف پس‌زمینه، sheet=برش شیت، video=ویدیو و گیف، anim=انیماتور",
          },
        },
        required: ["tab"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "rename_frames",
      description: "تغییر نام همه‌ی فریم‌ها با یک الگو؛ {i} با شماره فریم جایگزین می‌شود",
      parameters: {
        type: "object",
        properties: { pattern: { type: "string", description: "مثلاً frame_{i} یا walk_{i}" } },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "clear_animator",
      description: "پاک کردن همه‌ی فریم‌های انیماتور (مخرب — فقط بعد از تایید صریح کاربر)",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "download_frames_zip",
      description: "دانلود همه‌ی فریم‌های انیماتور به صورت یک فایل ZIP",
      parameters: { type: "object", properties: {} },
    },
  },
] as const;

const TAB_NAMES: Record<string, string> = {
  remove: "حذف پس‌زمینه",
  sheet: "برش شیت",
  video: "ویدیو و گیف",
  anim: "انیماتور",
};

/** run one tool call locally against app stores; returns a text result for the model */
async function executeTool(name: string, args: string): Promise<string> {
  const ui = useUiStore.getState();
  const fr = useFrameStore.getState();

  switch (name) {
    case "get_state": {
      const sources = [...new Set(fr.frames.map((f) => f.source))];
      return JSON.stringify({
        activeTab: ui.activeTab,
        activeTabName: TAB_NAMES[ui.activeTab] ?? ui.activeTab,
        frameCount: fr.frames.length,
        frameSources: sources,
        selectedFrame: fr.frames.find((f) => f.id === fr.selectedFrameId)?.name ?? null,
      });
    }
    case "switch_tab": {
      const tab = (JSON.parse(args) as { tab?: string }).tab ?? "";
      if (!(tab in TAB_NAMES)) return "خطا: تب نامعتبر";
      ui.setActiveTab(tab as "remove" | "sheet" | "video" | "anim");
      return `کاربر به تب «${TAB_NAMES[tab]}» منتقل شد.`;
    }
    case "rename_frames": {
      const { pattern } = JSON.parse(args) as { pattern?: string };
      if (!fr.frames.length) return "خطا: هیچ فریمی در انیماتور نیست";
      fr.renameAll(pattern ?? "frame_{i}");
      return `${fr.frames.length} فریم با الگوی «${pattern}» نام‌گذاری شدند.`;
    }
    case "clear_animator": {
      if (!fr.frames.length) return "انیماتور از قبل خالی بود";
      fr.clearAll();
      return `انیماتور پاک شد (${fr.frames.length} فریم حذف شد).`;
    }
    case "download_frames_zip": {
      if (!fr.frames.length) return "خطا: هیچ فریمی برای دانلود نیست";
      const res = await downloadFramesZip(
        fr.frames.map((f) => ({ name: f.name, canvas: f.canvas })),
        "remove-page-frames"
      );
      return res === "failed" ? "خطا: ساخت ZIP ناموفق بود" : "فایل ZIP دانلود شد.";
    }
    default:
      return `خطا: ابزار ناشناس ${name}`;
  }
}

interface ApiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
  tool_call_id?: string;
}

export class AiHttpError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

async function callChat(
  s: AiSettings,
  messages: ApiMessage[],
  withTools: boolean
): Promise<ApiMessage> {
  const url = `${s.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${s.apiKey}`,
    },
    body: JSON.stringify({
      model: s.model,
      messages,
      temperature: 0.4,
      ...(withTools ? { tools: TOOL_DEFS, tool_choice: "auto" } : {}),
    }),
  });
  if (!res.ok) {
    throw new AiHttpError(res.status, await res.text().catch(() => ""));
  }
  const data = (await res.json()) as {
    choices?: { message?: ApiMessage }[];
  };
  const msg = data.choices?.[0]?.message;
  if (!msg) throw new Error("پاسخ خالی از سرویس");
  return msg;
}

/** full assistant turn: chat + tool loop (max 6 rounds); persists nothing */
export async function chatWithAssistant(
  history: { role: "user" | "assistant"; content: string }[]
): Promise<{ reply: string; toolsUsed: string[] }> {
  const s = useAssistantStore.getState().aiSettings;
  const api: ApiMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.map((m) => ({ role: m.role, content: m.content }) as ApiMessage),
  ];

  const toolsUsed: string[] = [];
  let allowTools = true;

  for (let round = 0; round < 6; round++) {
    let msg: ApiMessage;
    try {
      msg = await callChat(s, api, allowTools);
    } catch (err) {
      // some models/providers reject tools — degrade gracefully once
      if (allowTools && err instanceof AiHttpError && err.status === 400 && /tool/i.test(err.body)) {
        allowTools = false;
        continue;
      }
      throw err;
    }

    if (!msg.tool_calls?.length) {
      return { reply: msg.content?.trim() || "(بدون پاسخ)", toolsUsed };
    }

    api.push(msg);
    for (const tc of msg.tool_calls) {
      let result: string;
      try {
        result = await executeTool(tc.function.name, tc.function.arguments || "{}");
        toolsUsed.push(tc.function.name);
      } catch (e) {
        result = e instanceof Error ? `خطا: ${e.message}` : "خطای ناشناخته";
      }
      api.push({ role: "tool", tool_call_id: tc.id, content: result });
    }
  }
  return { reply: "کار انجام شد اما پاسخ نهایی نرسید — دوباره امتحان کن.", toolsUsed };
}

/** quick connection test for the settings form */
export async function testConnection(s: AiSettings): Promise<string> {
  const msg = await callChat(
    s,
    [{ role: "user", content: "فقط کلمه ok را جواب بده" }],
    false
  );
  return msg.content?.trim() || "ok";
}

/** map errors to short friendly persian messages */
export function friendlyAiError(err: unknown): string {
  if (err instanceof AiHttpError) {
    if (err.status === 401 || err.status === 403) return "کلید API اشتباه است یا منقضی شده";
    if (err.status === 404) return "آدرس سرویس یا نام مدل درست نیست — هر دو را چک کن";
    if (err.status === 429) return "محدودیت نرخ سرویس — کمی بعد دوباره امتحان کن";
    if (err.status === 402) return "اعتبار حساب سرویس تمام شده";
    return `سرویس خطا داد (کد ${err.status})`;
  }
  if (err instanceof TypeError) return "اتصال برقرار نشد — آدرس سرویس، اینترنت یا مسدودی CORS را چک کن";
  if (err instanceof Error && err.message) return err.message;
  return "خطای ناشناخته";
}
