"use client";

import { useEffect, useRef, useState } from "react";
import {
  Bot,
  CheckCircle2,
  KeyRound,
  Loader2,
  Send,
  Settings2,
  ShieldCheck,
  Trash2,
  Wrench,
  XCircle,
} from "lucide-react";
import {
  friendlyAiError,
  testConnection,
  chatWithAssistant,
} from "@/lib/ai";
import {
  useAssistantStore,
  useUiStore,
  type AiSettings,
  type TabId,
} from "@/lib/store";

/** provider presets — any OpenAI-compatible /chat/completions endpoint works */
const PRESETS: { name: string; baseUrl: string; model: string }[] = [
  { name: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "openrouter/auto" },
  { name: "Groq", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" },
  { name: "z.ai (GLM)", baseUrl: "https://api.z.ai/api/paas/v4", model: "glm-4-flash" },
];

const SUGGESTIONS = [
  "چیکار می‌تونی اینجا بکنی؟",
  "چند تا فریم دارم؟ اسم‌شون رو مرتب کن",
  "برو به انیماتور و همه رو ZIP کن",
];

const TAB_TARGETS: TabId[] = ["remove", "sheet", "video", "anim"];

/* ------------------------------------------------------------------ */

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-extrabold text-soft">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  "h-11 w-full rounded-xl border border-line bg-surface px-3 text-xs font-bold text-foreground outline-none transition-colors placeholder:text-faint focus:border-violet-line";

/* ------------------------------------------------------------------ */

export function Assistant() {
  const { aiSettings, saveAiSettings, messages, pushMessage, clearMessages, aiBusy, setAiBusy } =
    useAssistantStore();
  const setActiveTab = useUiStore((s) => s.setActiveTab);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<AiSettings>(aiSettings);
  const [testState, setTestState] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [testMsg, setTestMsg] = useState("");
  const [input, setInput] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);
  const busy = aiBusy || testState === "testing";

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, aiBusy]);

  function openSettings() {
    setDraft(aiSettings);
    setTestState("idle");
    setEditing(true);
  }

  async function saveAndTest() {
    if (!draft.apiKey.trim() || !draft.baseUrl.trim() || !draft.model.trim()) return;
    setTestState("testing");
    setTestMsg("");
    try {
      const reply = await testConnection(draft);
      saveAiSettings(draft);
      setTestState("ok");
      setTestMsg(`اتصال برقراره ✓ — جواب سرویس: ${reply.slice(0, 40)}`);
      setTimeout(() => setEditing(false), 900);
    } catch (err) {
      setTestState("fail");
      setTestMsg(friendlyAiError(err));
    }
  }

  async function send(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    setInput("");
    pushMessage({ role: "user", content: t });
    setAiBusy(true);
    try {
      const history = [...messages, { role: "user" as const, content: t }];
      const { reply, toolsUsed } = await chatWithAssistant(history);
      pushMessage({
        role: "assistant",
        content: reply,
        tools: toolsUsed.length ? toolsUsed : undefined,
      });
    } catch (err) {
      pushMessage({ role: "assistant", content: `⚠️ ${friendlyAiError(err)}` });
    } finally {
      setAiBusy(false);
    }
  }

  /* ---------------- settings view ---------------- */
  if (editing || !aiSettings.apiKey) {
    return (
      <div className="flex flex-col gap-3 pb-2">
        <div className="panel-solid rounded-3xl border-line p-5 shadow-xl">
          <div className="flex items-center gap-3">
            <span className="metallic-gradient hero-icon-float hero-icon-glow grid h-12 w-12 shrink-0 place-items-center rounded-2xl shadow-lg">
              <KeyRound className="h-6 w-6 text-white" />
            </span>
            <div>
              <p className="text-base font-black">اتصال دستیار هوشمند</p>
              <p className="mt-0.5 text-[11px] leading-5 text-soft">
                کلید API خودت را بده تا دستیار داخل سایت کارها را انجام بدهد — تعویض تب،
                مرتب‌سازی فریم‌ها، خروجی گرفتن و راهنمایی.
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                onClick={() => setDraft((d) => ({ ...d, baseUrl: p.baseUrl, model: p.model }))}
                className="rounded-lg border border-line bg-chip px-2.5 py-1.5 text-[10px] font-extrabold text-soft transition-colors hover:border-violet-line hover:text-violet-ink"
              >
                {p.name}
              </button>
            ))}
          </div>

          <div className="mt-3 flex flex-col gap-3">
            <Field label="آدرس سرویس (OpenAI-compatible)">
              <input
                dir="ltr"
                value={draft.baseUrl}
                onChange={(e) => setDraft((d) => ({ ...d, baseUrl: e.target.value }))}
                placeholder="https://api.openai.com/v1"
                className={`${inputCls} text-left`}
                spellCheck={false}
              />
            </Field>
            <Field label="نام مدل">
              <input
                dir="ltr"
                value={draft.model}
                onChange={(e) => setDraft((d) => ({ ...d, model: e.target.value }))}
                placeholder="gpt-4o-mini"
                className={`${inputCls} text-left`}
                spellCheck={false}
              />
            </Field>
            <Field label="کلید API">
              <input
                dir="ltr"
                type="password"
                value={draft.apiKey}
                onChange={(e) => setDraft((d) => ({ ...d, apiKey: e.target.value }))}
                placeholder="sk-…"
                className={`${inputCls} text-left`}
                spellCheck={false}
                autoComplete="off"
              />
            </Field>
          </div>

          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              disabled={busy || !draft.apiKey.trim()}
              onClick={saveAndTest}
              className="btn-shine metallic-gradient flex h-11 flex-1 items-center justify-center gap-2 rounded-xl text-sm font-extrabold text-white shadow-lg transition-all active:scale-95 disabled:opacity-50"
            >
              {testState === "testing" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4.5 w-4.5" />
              )}
              ذخیره و تست اتصال
            </button>
            {aiSettings.apiKey && (
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="h-11 rounded-xl border border-line bg-chip px-4 text-xs font-extrabold text-soft transition-colors hover:text-foreground"
              >
                انصراف
              </button>
            )}
          </div>

          {testMsg && (
            <p
              className={`mt-3 flex items-center gap-1.5 rounded-xl border px-3 py-2.5 text-[11px] font-bold ${
                testState === "ok"
                  ? "border-emerald-line bg-emerald-tint text-emerald-ink"
                  : "border-destructive/40 bg-destructive/10 text-destructive"
              }`}
            >
              {testState === "ok" ? (
                <CheckCircle2 className="h-4 w-4 shrink-0" />
              ) : (
                <XCircle className="h-4 w-4 shrink-0" />
              )}
              {testMsg}
            </p>
          )}

          <p className="mt-3 flex items-start gap-1.5 text-[10px] leading-5 text-faint">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neon" />
            کلید فقط داخل مرورگر خودت ذخیره می‌شود و مستقیم به سرویسی که انتخاب کردی
            فرستاده می‌شود — این سایت سرور ندارد که درگیرش شود.
          </p>
        </div>
      </div>
    );
  }

  /* ---------------- chat view ---------------- */
  return (
    <div className="flex flex-col gap-3 pb-2">
      {/* assistant header card */}
      <div className="panel-glass flex items-center gap-2.5 rounded-2xl border-line p-3">
        <span className="metallic-gradient grid h-9 w-9 shrink-0 place-items-center rounded-xl shadow-md">
          <Bot className="h-5 w-5 text-white" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-extrabold">دستیار هوشمند</p>
          <p dir="ltr" className="truncate text-left text-[10px] font-bold text-faint">
            {aiSettings.model}
          </p>
        </div>
        <button
          type="button"
          onClick={openSettings}
          aria-label="تنظیمات دستیار"
          className="grid h-9 w-9 place-items-center rounded-xl border border-line bg-chip text-soft transition-colors hover:text-foreground"
        >
          <Settings2 className="h-4 w-4" />
        </button>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={clearMessages}
            aria-label="پاک کردن گفتگو"
            className="grid h-9 w-9 place-items-center rounded-xl border border-line bg-chip text-soft transition-colors hover:border-destructive/40 hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* messages */}
      <div
        ref={scrollRef}
        className="flex min-h-[42dvh] flex-col gap-2.5 overflow-y-auto rounded-2xl py-1"
      >
        {messages.length === 0 && (
          <div className="flex flex-col items-center gap-3 pt-8">
            <span className="metallic-gradient hero-icon-float hero-icon-glow grid h-16 w-16 place-items-center rounded-3xl shadow-xl">
              <Bot className="h-8 w-8 text-white" />
            </span>
            <p className="text-sm font-black">بگو چی‌کار کنم، انجامش می‌دم</p>
            <div className="flex flex-col items-stretch gap-1.5 sm:items-center">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="rounded-xl border border-line bg-chip px-3.5 py-2 text-[11px] font-bold text-soft transition-colors hover:border-violet-line hover:text-violet-ink"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) =>
          m.role === "user" ? (
            <div
              key={i}
              className="metallic-gradient max-w-[85%] self-end rounded-2xl rounded-bl-md px-3.5 py-2.5 text-sm font-bold leading-6 text-white shadow-md"
            >
              {m.content}
            </div>
          ) : (
            <div key={i} className="flex max-w-[90%] flex-col gap-1.5 self-start">
              {m.tools && (
                <div className="flex flex-wrap gap-1">
                  {m.tools.map((t, j) => (
                    <span
                      key={j}
                      className="flex items-center gap-1 rounded-lg border border-violet-line bg-violet-tint px-2 py-0.5 text-[9px] font-extrabold text-violet-ink"
                      dir="ltr"
                    >
                      <Wrench className="h-2.5 w-2.5" />
                      {t}
                    </span>
                  ))}
                </div>
              )}
              <div className="whitespace-pre-wrap break-words rounded-2xl rounded-br-md border border-line bg-chip px-3.5 py-2.5 text-sm font-bold leading-6 text-foreground">
                {m.content}
              </div>
            </div>
          )
        )}

        {aiBusy && (
          <div className="flex items-center gap-2 self-start rounded-2xl border border-line bg-chip px-3.5 py-2.5">
            <Loader2 className="h-4 w-4 animate-spin text-violet-ink" />
            <span className="text-xs font-bold text-soft">داره کار می‌کنه…</span>
          </div>
        )}
      </div>

      {/* quick tab shortcuts */}
      <div className="flex flex-wrap items-center gap-1.5">
        {TAB_TARGETS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setActiveTab(t)}
            className="rounded-lg border border-line bg-chip px-2.5 py-1 text-[10px] font-extrabold text-soft transition-colors hover:text-foreground"
          >
            {t === "remove" && "حذف پس‌زمینه"}
            {t === "sheet" && "برش شیت"}
            {t === "video" && "ویدیو"}
            {t === "anim" && "انیماتور"}
          </button>
        ))}
      </div>

      {/* input row */}
      <div className="panel-glass flex items-center gap-2 rounded-2xl border-line p-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
          dir="auto"
          placeholder="چی بخوای بگو…"
          className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 text-sm font-bold text-foreground outline-none transition-colors placeholder:text-faint focus:border-violet-line"
          disabled={busy}
        />
        <button
          type="button"
          onClick={() => void send(input)}
          disabled={busy || !input.trim()}
          aria-label="ارسال"
          className="btn-shine metallic-gradient grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white shadow-md transition-all active:scale-90 disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-4.5 w-4.5 animate-spin" />
          ) : (
            <Send className="h-4.5 w-4.5 -scale-x-100" />
          )}
        </button>
      </div>
    </div>
  );
}
