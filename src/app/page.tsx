"use client";

import { Film, Scissors, Clapperboard, Sparkles, ScanSearch, Layers3 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SheetCutter } from "@/components/studio/sheet-cutter";
import { VideoStudio } from "@/components/studio/video-studio";
import { Animator } from "@/components/studio/animator";
import { ThemeToggle } from "@/components/theme-toggle";
import { useFrameStore } from "@/lib/store";
import { cn } from "@/lib/utils";

const TABS = [
  {
    value: "sheet",
    group: "group/tab-sheet",
    icon: Scissors,
    title: "برش‌زن شیت تصویر",
    desc: "تشخیص خودکار آیتم‌ها و حذف پس‌زمینه",
    active: "data-[state=active]:border-violet-line bg-surface data-[state=active]:bg-violet-tint/40",
    iconBox: "metallic-gradient text-white",
    dot: "bg-violet-400",
    dotOn: "group-data-[state=active]/tab-sheet:opacity-100 group-data-[state=active]/tab-sheet:scale-125",
  },
  {
    value: "video",
    group: "group/tab-video",
    icon: Film,
    title: "استودیو ویدیو و گیف",
    desc: "استخراج فریم با کروماکی زنده",
    active: "data-[state=active]:border-cyan-line bg-surface data-[state=active]:bg-cyan-tint/40",
    iconBox: "border border-cyan-line bg-cyan-tint text-cyan-ink",
    dot: "bg-cyan-400",
    dotOn: "group-data-[state=active]/tab-video:opacity-100 group-data-[state=active]/tab-video:scale-125",
  },
  {
    value: "animator",
    group: "group/tab-anim",
    icon: Clapperboard,
    title: "انیماتور و خروجی",
    desc: "فلپ‌بوک، اسپرایت‌شیت و ZIP شفاف",
    active: "data-[state=active]:border-fuchsia-line bg-surface data-[state=active]:bg-fuchsia-tint/40",
    iconBox: "border border-fuchsia-line bg-fuchsia-tint text-fuchsia-ink",
    dot: "bg-fuchsia-400",
    dotOn: "group-data-[state=active]/tab-anim:opacity-100 group-data-[state=active]/tab-anim:scale-125",
  },
] as const;

export default function Home() {
  const frameCount = useFrameStore((s) => s.frames.length);

  return (
    <div className="flex min-h-screen flex-col">
      {/* ---------- header ---------- */}
      <header className="sticky top-0 z-40 border-b border-line bg-background/80 backdrop-blur-xl">
        <div className="top-hairline absolute inset-x-0 bottom-0 h-px opacity-70" />
        <div className="mx-auto flex max-w-7xl items-center gap-2.5 px-3 py-2.5 sm:gap-3 sm:px-4 sm:py-3">
          <div className="rounded-xl metallic-gradient p-[1.5px] glow-purple">
            <div className="rounded-xl bg-background p-2">
              <Scissors className="h-5 w-5 text-cyan-ink" />
            </div>
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-black leading-6 metallic-text sm:text-lg">اسپرایت‌فورج</h1>
            <p className="hidden truncate text-xs text-faint sm:block">
              برش شیت، حذف پس‌زمینه و استخراج فریم — همه‌چیز داخل مرورگر
            </p>
          </div>

          <div className="mr-auto flex items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-lg border border-line bg-chip px-2.5 py-1.5 text-xs font-medium text-soft sm:flex">
              <Layers3 className="h-3.5 w-3.5 text-cyan-ink" />
              {frameCount} فریم
            </span>
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* ---------- main ---------- */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-3 py-4 sm:px-4 sm:py-5">
        <Tabs defaultValue="sheet" className="w-full">
          {/* graphical tab cards */}
          <TabsList className="mb-4 grid h-auto w-full grid-cols-1 items-stretch gap-2.5 rounded-none border-0 bg-transparent p-0 sm:mb-5 sm:grid-cols-3 sm:gap-3">
            {TABS.map((t) => (
              <TabsTrigger
                key={t.value}
                value={t.value}
                className={cn(
                  "tab-card h-auto flex-col items-start gap-2 rounded-2xl border border-line bg-surface p-3 backdrop-blur hover:border-line-strong sm:gap-2.5 sm:p-4",
                  t.group,
                  t.active
                )}
              >
                <span className="flex w-full items-center gap-2.5 sm:gap-3">
                  <span
                    className={cn(
                      "grid h-10 w-10 shrink-0 place-items-center rounded-xl shadow-lg transition-transform group-hover:scale-105",
                      t.iconBox
                    )}
                  >
                    <t.icon className="h-5 w-5" />
                  </span>
                  <span className="flex min-w-0 flex-col items-start gap-0.5">
                    <span className="text-sm font-black text-foreground">{t.title}</span>
                    <span className="truncate text-xs text-faint">{t.desc}</span>
                  </span>
                  <span
                    className={cn(
                      "mr-auto h-2 w-2 shrink-0 rounded-full opacity-25 transition-all",
                      t.dot,
                      t.dotOn
                    )}
                  />
                </span>
              </TabsTrigger>
            ))}
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

      {/* ---------- footer ---------- */}
      <footer className="mt-auto border-t border-line bg-background/60 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2.5 text-xs text-faint">
          <p className="flex items-center gap-1.5">
            <ScanSearch className="h-3.5 w-3.5" />
            تشخیص دوگانه · کروماکی زنده · خروجی WebP شفاف
          </p>
          <p className="flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-violet-ink" />
            هیچ فایلی به سرور ارسال نمی‌شود
          </p>
        </div>
      </footer>
    </div>
  );
}
