"use client";

import { Clapperboard, Eraser, Film, LogIn, Scissors, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth/auth-context";

const FEATURES = [
  { icon: Eraser, title: "حذف پس‌زمینه", desc: "خودکار و دقیق، با کروماکی", chip: "border-violet-line bg-violet-tint text-violet-ink" },
  { icon: Scissors, title: "برش شیت", desc: "تشخیص هوشمند گرید اسپرایت", chip: "border-cyan-line bg-cyan-tint text-cyan-ink" },
  { icon: Film, title: "ویدیو و گیف", desc: "استخراج فریم‌های شفاف", chip: "border-fuchsia-line bg-fuchsia-tint text-fuchsia-ink" },
  { icon: Clapperboard, title: "انیماتور", desc: "ساخت انیمیشن Flipbook", chip: "border-emerald-line bg-emerald-tint text-emerald-ink" },
] as const;

/** landing screen shown to signed-out visitors — the studio tools stay locked */
export function AuthGate() {
  const { openAuth } = useAuth();

  return (
    <div className="flex flex-col items-center pt-6 pb-16 sm:pt-12">
      {/* headline */}
      <div className="flex flex-col items-center text-center">
        <span className="metallic-gradient hero-icon-float hero-icon-glow flex h-14 w-14 items-center justify-center rounded-2xl shadow-lg">
          <Sparkles className="h-7 w-7 text-white" />
        </span>
        <h2 className="metallic-text mt-4 text-2xl font-extrabold sm:text-3xl">
          قدرت کامل، مالِ حساب تو
        </h2>
        <p className="mt-2 max-w-md text-sm leading-6 text-soft">
          برای استفاده از ابزارها، اول وارد شو یا یک حساب رایگان بساز —
          کمتر از یک دقیقه طول می‌کشه و فقط به ایمیل نیاز داری.
        </p>
      </div>

      {/* feature cards */}
      <div className="mt-8 grid w-full max-w-2xl grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
        {FEATURES.map((f) => (
          <div
            key={f.title}
            className="panel-glass flex flex-col items-center gap-1.5 rounded-2xl p-4 text-center"
          >
            <span className={`rounded-xl border p-2 ${f.chip}`}>
              <f.icon className="h-5 w-5" />
            </span>
            <span className="text-xs font-extrabold sm:text-sm">{f.title}</span>
            <span className="text-[10px] leading-4 text-soft sm:text-[11px]">{f.desc}</span>
          </div>
        ))}
      </div>

      {/* CTA */}
      <Button
        type="button"
        onClick={() => openAuth("signup")}
        className="btn-shine metallic-gradient mt-8 h-13 w-full max-w-xs rounded-2xl text-sm font-extrabold text-white shadow-lg transition-transform hover:brightness-110 active:scale-[0.98]"
      >
        <LogIn className="h-4.5 w-4.5" />
        شروع رایگان — ورود / ثبت‌نام
      </Button>
      <p className="mt-3 flex items-center gap-1.5 text-[11px] font-bold text-soft">
        <ShieldCheck className="h-3.5 w-3.5 text-neon" />
        بدون کارت بانکی · پردازش داخل مرورگر · رایگان
      </p>
    </div>
  );
}
