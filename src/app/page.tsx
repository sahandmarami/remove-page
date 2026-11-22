"use client";

import { Scissors, Clapperboard, Layers, Film, Cpu } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SheetCutter } from "@/components/studio/sheet-cutter";
import { VideoStudio } from "@/components/studio/video-studio";
import { Animator } from "@/components/studio/animator";
import { useFrameStore } from "@/lib/store";

export default function Home() {
  const frameCount = useFrameStore((s) => s.frames.length);

  return (
    <div className="flex min-h-screen flex-col">
      {/* ---------- header ---------- */}
      <header className="relative sticky top-0 z-40 border-b border-white/10 bg-slate-950/70 backdrop-blur-xl">
        <div className="top-hairline absolute inset-x-0 bottom-0 h-px opacity-70" />
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="rounded-xl metallic-gradient p-[1.5px] glow-purple">
              <div className="rounded-xl bg-slate-950/80 p-2">
                <Scissors className="h-5 w-5 text-cyan-400" />
              </div>
            </div>
            <div>
              <h1 className="text-lg font-black leading-6 metallic-text">
                اسپرایت‌فورج
              </h1>
              <p className="text-[11px] text-slate-400">
                برش‌زن هوشمند شیت، حذف پس‌زمینه و استخراج فریم از ویدیو و گیف
              </p>
            </div>
          </div>

          <div className="mr-auto flex flex-wrap items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-lg border border-violet-400/25 bg-violet-500/10 px-2.5 py-1.5 text-[11px] font-medium text-violet-300 sm:flex">
              <Cpu className="h-3.5 w-3.5" />
              تشخیص دوگانه: AI سروری + بینایی ماشین محلی
            </span>
            <span className="flex items-center gap-1.5 rounded-lg border border-cyan-400/25 bg-cyan-400/10 px-2.5 py-1.5 text-[11px] font-medium text-cyan-300">
              <Film className="h-3.5 w-3.5" />
              کروماکی زنده و WebP شفاف
            </span>
            <span className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] font-medium text-slate-300">
              <Layers className="h-3.5 w-3.5" />
              {frameCount} فریم ذخیره‌شده
            </span>
          </div>
        </div>
      </header>

      {/* ---------- main ---------- */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-5">
        <Tabs defaultValue="sheet" className="w-full">
          <TabsList className="mb-4 grid w-full max-w-2xl grid-cols-3 gap-1.5 rounded-xl border border-white/10 bg-slate-950/60 p-1.5 backdrop-blur">
            <TabsTrigger
              value="sheet"
              className="gap-2 rounded-lg data-[state=active]:metallic-gradient data-[state=active]:text-white data-[state=active]:shadow-none"
            >
              <Scissors className="h-4 w-4" />
              برش‌زن شیت تصویر
            </TabsTrigger>
            <TabsTrigger
              value="video"
              className="gap-2 rounded-lg data-[state=active]:metallic-gradient data-[state=active]:text-white data-[state=active]:shadow-none"
            >
              <Film className="h-4 w-4" />
              استودیو ویدیو و گیف
            </TabsTrigger>
            <TabsTrigger
              value="animator"
              className="gap-2 rounded-lg data-[state=active]:metallic-gradient data-[state=active]:text-white data-[state=active]:shadow-none"
            >
              <Clapperboard className="h-4 w-4" />
              انیماتور و خروجی
              {frameCount > 0 && (
                <span className="rounded-full bg-cyan-400/20 px-1.5 text-[10px] font-bold text-cyan-300">
                  {frameCount}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="sheet" className="mt-0">
            <SheetCutter />
          </TabsContent>
          <TabsContent value="video" className="mt-0">
            <VideoStudio />
          </TabsContent>
          <TabsContent value="animator" className="mt-0">
            <Animator />
          </TabsContent>
        </Tabs>
      </main>

      {/* ---------- footer (sticky on short pages) ---------- */}
      <footer className="mt-auto border-t border-white/10 bg-slate-950/60 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-3 text-[11px] text-slate-500">
          <p>
            اسپرایت‌فورج — تمام پردازش‌های سنگین (برچسب‌گذاری مؤلفه‌های متصل، فیلد فیلود، کروماکی و زیپ‌سازی) داخل مرورگر شما اجرا می‌شود.
          </p>
          <p dir="ltr" className="font-mono">
            Next.js 16 · React 19 · TypeScript · Tailwind CSS 4
          </p>
        </div>
      </footer>
    </div>
  );
}
