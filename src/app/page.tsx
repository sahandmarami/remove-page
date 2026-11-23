"use client";

import { Film, Scissors, Clapperboard, Sparkles, Eraser } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BgRemove } from "@/components/studio/bg-remove";
import { SheetCutter } from "@/components/studio/sheet-cutter";
import { VideoStudio } from "@/components/studio/video-studio";
import { Animator } from "@/components/studio/animator";
import { ThemeToggle } from "@/components/theme-toggle";
import { useFrameStore } from "@/lib/store";
import { cn } from "@/lib/utils";

/** static-export basePath — empty in dev */
const BP = process.env.NEXT_PUBLIC_BASE_PATH || "";

const TABS = [
  {
    value: "remove",
    group: "group/tab-remove",
    icon: Eraser,
    title: "حذف پس‌زمینه",
    desc: "خودکار — فقط تصویر را بیندازید",
    active: "data-[state=active]:border-violet-line bg-surface data-[state=active]:bg-violet-tint/40",
    iconBox: "metallic-gradient text-white",
    dot: "bg-violet-400",
    dotOn: "group-data-[state=active]/tab-remove:opacity-100 group-data-[state=active]/tab-remove:scale-125",
    glow: "group-data-[state=active]/tab-remove:opacity-100",
  },
  {
    value: "sheet",
    group: "group/tab-sheet",
    icon: Scissors,
    title: "برش‌زن شیت تصویر",
    desc: "تشخیص خودکار آیتم‌ها و برش دقیق",
    active: "data-[state=active]:border-cyan-line bg-surface data-[state=active]:bg-cyan-tint/40",
    iconBox: "border border-cyan-line bg-cyan-tint text-cyan-ink",
    dot: "bg-cyan-400",
    dotOn: "group-data-[state=active]/tab-sheet:opacity-100 group-data-[state=active]/tab-sheet:scale-125",
    glow: "group-data-[state=active]/tab-sheet:opacity-100",
  },
  {
    value: "video",
    group: "group/tab-video",
    icon: Film,
    title: "ویدیو و گیف",
    desc: "استخراج فریم شفاف با تشخیص خودکار",
    active: "data-[state=active]:border-fuchsia-line bg-surface data-[state=active]:bg-fuchsia-tint/40",
    iconBox: "border border-fuchsia-line bg-fuchsia-tint text-fuchsia-ink",
    dot: "bg-fuchsia-400",
    dotOn: "group-data-[state=active]/tab-video:opacity-100 group-data-[state=active]/tab-video:scale-125",
    glow: "group-data-[state=active]/tab-video:opacity-100",
  },
  {
    value: "animator",
    group: "group/tab-anim",
    icon: Clapperboard,
    title: "انیماتور و خروجی",
    desc: "فلپ‌بوک، اسپرایت‌شیت و ZIP شفاف",
    active: "data-[state=active]:border-emerald-line bg-surface data-[state=active]:bg-emerald-tint/40",
    iconBox: "border border-emerald-line bg-emerald-tint text-emerald-ink",
    dot: "bg-emerald-400",
    dotOn: "group-data-[state=active]/tab-anim:opacity-100 group-data-[state=active]/tab-anim:scale-125",
    glow: "group-data-[state=active]/tab-anim:opacity-100",
  },
] as const;

export default function Home() {
  const frameCount = useFrameStore((s) => s.frames.length);

  return (
    <div className="flex min-h-screen flex-col">
      {/* ---------- decorative background ---------- */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="orb orb-violet absolute -top-32 right-[8%] h-72 w-72 rounded-full blur-3xl sm:h-96 sm:w-96" />
        <div className="orb orb-cyan absolute top-1/3 -left-24 h-56 w-56 rounded-full blur-3xl sm:h-80 sm:w-80" />
        <div className="orb orb-fuchsia absolute -bottom-40 right-1/3 h-64 w-64 rounded-full blur-3xl" />
      </div>

      {/* ---------- header ---------- */}
      <header className="sticky top-0 z-40 border-b border-line bg-background/80 backdrop-blur-xl">
        <div className="top-hairline absolute inset-x-0 bottom-0 h-px opacity-70" />
        <div className="mx-auto flex max-w-7xl items-center gap-2.5 px-3 py-2.5 sm:gap-3 sm:px-4 sm:py-3">
          {/* real app logo */}
          <div className="logo-ring shrink-0 rounded-2xl p-[2px]">
            <img
              src={`${BP}/icon-192.png`}
              alt="لوگوی اسپرایت‌فورج"
              className="h-10 w-10 rounded-[14px] object-cover sm:h-11 sm:w-11"
              width={44}
              height={44}
            />
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-black leading-6 metallic-text sm:text-lg">اسپرایت‌فورج</h1>
            <p className="hidden truncate text-xs text-faint sm:block">
              حذف پس‌زمینه، برش شیت و استخراج فریم — همه‌چیز داخل مرورگر
            </p>
          </div>

          <div className="mr-auto flex items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-lg border border-line bg-chip px-2.5 py-1.5 text-xs font-medium text-soft sm:flex">
              <Sparkles className="h-3.5 w-3.5 text-cyan-ink" />
              {frameCount} فریم
            </span>
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* ---------- main ---------- */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-3 pb-6 pt-3 sm:px-4 sm:pt-5">
        {/* ---------- compact remove-focused hero band ---------- */}
        <section className="hero-band relative mb-4 overflow-hidden rounded-3xl border border-line sm:mb-6">
          <div className="hero-grid pointer-events-none absolute inset-0" />
          <div className="relative flex items-center gap-3 px-4 py-4 sm:gap-5 sm:px-7 sm:py-5">
            <div className="hero-icon-float shrink-0">
              <img
                src={`${BP}/icon-192.png`}
                alt=""
                aria-hidden
                className="h-14 w-14 rounded-2xl sm:h-20 sm:w-20"
                width={80}
                height={80}
              />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-black leading-7 metallic-text sm:text-2xl sm:leading-9">
                پس‌زمینه را خودکار حذف کن — تمیز و دقیق
              </h2>
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-soft sm:text-sm sm:leading-6">
                تصویر یا گیف را بگذارید؛ رنگ پس‌زمینه خودکار تشخیص داده می‌شود، لبه‌ها
                مات و بدون هاله جدا می‌شوند و خروجی شفاف همان‌جا دانلود می‌شود.
              </p>
            </div>
          </div>
        </section>

        <Tabs defaultValue="remove" className="w-full">
          {/* graphical tab cards */}
          <TabsList className="mb-4 grid h-auto w-full grid-cols-2 items-stretch gap-2.5 rounded-none border-0 bg-transparent p-0 sm:mb-5 sm:grid-cols-4 sm:gap-3">
            {TABS.map((t) => (
              <TabsTrigger
                key={t.value}
                value={t.value}
                className={cn(
                  "tab-card group h-auto flex-col items-start gap-2 overflow-hidden rounded-2xl border border-line bg-surface p-3 backdrop-blur hover:border-line-strong sm:gap-2.5 sm:p-4",
                  t.group,
                  t.active
                )}
              >
                <span
                  className={cn(
                    "pointer-events-none absolute inset-x-0 -top-8 h-16 opacity-0 blur-2xl transition-opacity duration-500",
                    t.dot,
                    t.glow
                  )}
                />
                <span className="relative flex w-full items-center gap-2.5 sm:gap-3">
                  <span
                    className={cn(
                      "grid h-10 w-10 shrink-0 place-items-center rounded-xl shadow-lg transition-transform group-hover:scale-110 group-active:scale-95",
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

          <TabsContent value="remove" className="mt-0">
            <BgRemove />
          </TabsContent>
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
    </div>
  );
}
