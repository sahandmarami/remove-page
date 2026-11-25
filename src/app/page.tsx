"use client";

import { useState } from "react";
import { Clapperboard, Eraser, Film, Loader2, Scissors } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { AccountButton } from "@/components/auth/account-button";
import { AuthGate } from "@/components/auth/auth-gate";
import { useAuth } from "@/components/auth/auth-context";
import { BgRemove } from "@/components/studio/bg-remove";
import { SheetCutter } from "@/components/studio/sheet-cutter";
import { VideoStudio } from "@/components/studio/video-studio";
import { Animator } from "@/components/studio/animator";
import { useFrameStore } from "@/lib/store";
import { cn } from "@/lib/utils";

/** static-export basePath — empty in dev */
const BP = process.env.NEXT_PUBLIC_BASE_PATH || "";

const TABS = [
  { id: "remove", icon: Eraser, label: "حذف پس‌زمینه" },
  { id: "sheet", icon: Scissors, label: "برش شیت" },
  { id: "video", icon: Film, label: "ویدیو و گیف" },
  { id: "anim", icon: Clapperboard, label: "انیماتور" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function Home() {
  const [tab, setTab] = useState<TabId>("remove");
  const { user, initializing } = useAuth();
  const frameCount = useFrameStore((s) => s.frames.length);

  return (
    <div className="flex min-h-dvh flex-col">
      {/* decorative background */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="orb orb-violet absolute -top-32 right-[8%] h-72 w-72 rounded-full blur-3xl sm:h-96 sm:w-96" />
        <div className="orb orb-cyan absolute top-1/3 -left-24 h-56 w-56 rounded-full blur-3xl sm:h-80 sm:w-80" />
      </div>

      {/* header */}
      <header className="sticky top-0 z-40 border-b border-line bg-background/80 backdrop-blur-xl">
        <div className="top-hairline absolute inset-x-0 bottom-0 h-px opacity-70" />
        <div className="mx-auto flex max-w-5xl items-center gap-2.5 px-3 py-2.5 sm:px-4">
          <div className="logo-ring shrink-0 rounded-xl p-[2px]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`${BP}/icon-192.png`}
              alt="Remove Page"
              className="h-9 w-9 rounded-[10px] object-cover sm:h-10 sm:w-10"
              width={40}
              height={40}
            />
          </div>
          <h1
            className="brand-font metallic-text select-none text-lg font-extrabold tracking-wide sm:text-xl"
            dir="ltr"
          >
            Remove&nbsp;Page
          </h1>

          <div className="mr-auto flex items-center gap-2">
            {user && frameCount > 0 && (
              <span className="flex items-center gap-1 rounded-lg border border-line bg-chip px-2 py-1 text-xs font-bold text-soft tabular-nums">
                {frameCount}
              </span>
            )}
            <AccountButton />
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* main */}
      <main className="mx-auto w-full max-w-5xl flex-1 px-3 pb-6 pt-3 sm:px-4 sm:pt-4">
        {initializing ? (
          <div className="flex flex-1 items-center justify-center py-28">
            <Loader2 className="metallic-text h-7 w-7 animate-spin" />
          </div>
        ) : !user ? (
          /* studio locked until signed in */
          <AuthGate />
        ) : (
          <>
            {/* segmented tool switcher */}
            <nav className="mb-3 grid grid-cols-4 gap-1 rounded-2xl border border-line bg-surface p-1.5 sm:gap-2 sm:p-2">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  aria-pressed={tab === t.id}
                  className={cn(
                    "flex min-w-0 flex-col items-center gap-1 rounded-xl px-0.5 py-2 text-[10px] font-bold transition-all sm:flex-row sm:justify-center sm:gap-2 sm:text-sm",
                    tab === t.id
                      ? "metallic-gradient text-white shadow-md"
                      : "text-soft hover:bg-chip hover:text-foreground active:scale-95"
                  )}
                >
                  <t.icon className="h-4.5 w-4.5 shrink-0 sm:h-4 sm:w-4" />
                  <span className="truncate leading-4">{t.label}</span>
                </button>
              ))}
            </nav>

            {tab === "remove" && <BgRemove />}
            {tab === "sheet" && <SheetCutter />}
            {tab === "video" && <VideoStudio />}
            {tab === "anim" && <Animator />}
          </>
        )}
      </main>
    </div>
  );
}
