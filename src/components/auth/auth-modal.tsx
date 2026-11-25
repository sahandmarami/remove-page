"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AtSign,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LogIn,
  MailCheck,
  Send,
  ShieldCheck,
  UserPlus,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase, SITE_URL } from "@/lib/supabase";
import { useAuth, type AuthModalMode } from "@/components/auth/auth-context";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** client-side password policy: ≥8 chars with at least one letter and one digit
 *  (the dashboard setting MIN_PASSWORD_LENGTH should be raised to 8 as well) */
function passwordProblem(pw: string): string | null {
  if (pw.length < 8) return "رمز عبور باید حداقل ۸ کاراکتر باشد";
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw))
    return "رمز عبور باید هم حرف داشته باشد هم عدد";
  return null;
}

/** map supabase errors to friendly persian messages */
function faAuthError(err: unknown): string {
  const msg = err instanceof Error ? err.message : "";
  const code = (err as { code?: string })?.code ?? "";
  if (code === "weak_password" || /password.*(weak|length|characters|digit)/i.test(msg))
    return "رمز عبور ضعیف است — حداقل ۸ کاراکتر شامل حرف و عدد";
  if (code === "email_not_confirmed" || /not confirmed/i.test(msg))
    return "ایمیلت هنوز تایید نشده — کد تایید را وارد کن";
  if (code === "invalid_credentials" || /invalid login credentials/i.test(msg))
    return "ایمیل یا رمز عبور اشتباه است";
  if (/user already registered/i.test(msg))
    return "این ایمیل قبلاً ثبت شده — وارد شو";
  if (code === "over_email_send_rate_limit" || /rate limit|too many/i.test(msg))
    return "سرویس ایمیل رایگان ساعتی محدوده — حدود یک ساعت دیگه دوباره امتحان کن (اسپم را هم چک کن)";
  if (/token has expired|expired/i.test(msg))
    return "کد منقضی شده — دوباره درخواست بده";
  if (/invalid otp|invalid token|code/i.test(msg))
    return "کد وارد شده درست نیست";
  if (/signups? not allowed/i.test(msg))
    return "فعلاً ثبت‌نام غیرفعال است";
  if (typeof navigator !== "undefined" && !navigator.onLine)
    return "اینترنت وصل نیست";
  return msg || "خطایی رخ داد — دوباره امتحان کن";
}

const RESEND_COOLDOWN = 60;

/** static-export basePath — empty in dev, "/remove-page" on GitHub Pages */
const BP = process.env.NEXT_PUBLIC_BASE_PATH || "";

/* ------------------------------------------------------------------ */
/* building blocks                                                     */
/* ------------------------------------------------------------------ */

function Field({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <span className="flex items-center gap-1.5 text-[11px] font-bold text-soft">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </span>
      {children}
    </div>
  );
}

function TextField({
  type = "text",
  value,
  onChange,
  placeholder,
  autoComplete,
  icon: Icon,
  trailing,
}: {
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
  icon: React.ComponentType<{ className?: string }>;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted">
        <Icon className="h-4 w-4" />
      </span>
      <Input
        dir="ltr"
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="h-12 rounded-xl border-line bg-chip ps-10 pe-10 text-left text-sm transition-all hover:border-line-strong focus:border-metallic focus-visible:ring-4 focus-visible:ring-metallic/25"
      />
      {trailing && (
        <span className="absolute end-2 top-1/2 -translate-y-1/2">{trailing}</span>
      )}
    </div>
  );
}

function SubmitButton({
  busy,
  icon: Icon,
  label,
}: {
  busy: boolean;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <Button
      type="submit"
      disabled={busy}
      className="btn-shine metallic-gradient h-12 w-full rounded-2xl text-sm font-extrabold text-white shadow-lg transition-all hover:brightness-110 hover:shadow-xl active:scale-[0.99] disabled:opacity-60"
    >
      {busy ? <Loader2 className="h-4.5 w-4.5 animate-spin" /> : <Icon className="h-4.5 w-4.5" />}
      {label}
    </Button>
  );
}

function ModeHeader({
  icon: Icon,
  title,
  desc,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
}) {
  return (
    <div className="space-y-1">
      <h3 className="flex items-center gap-2 text-sm font-extrabold">
        <Icon className="h-4 w-4 text-metallic" />
        {title}
      </h3>
      <p className="text-[11px] leading-5 text-soft">{desc}</p>
    </div>
  );
}

/** password input with visibility toggle */
function PasswordField({
  value,
  onChange,
  placeholder,
  autoComplete,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <TextField
      type={show ? "text" : "password"}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      autoComplete={autoComplete}
      icon={KeyRound}
      trailing={
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setShow((s) => !s)}
          aria-label={show ? "پنهان کردن رمز" : "نمایش رمز"}
          className="rounded-lg p-1.5 text-soft transition-colors hover:bg-chip hover:text-foreground"
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      }
    />
  );
}

/* ------------------------------------------------------------------ */
/* the modal                                                           */
/* ------------------------------------------------------------------ */

export function AuthModal() {
  const { authOpen, authMode, closeAuth, openAuth, pendingEmail, setPendingEmail } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newConfirm, setNewConfirm] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const autoSubmit = useRef(false);

  // reset transient state whenever the modal opens
  useEffect(() => {
    if (authOpen) {
      setError(null);
      setCode("");
      autoSubmit.current = false;
      if (pendingEmail) setEmail(pendingEmail);
    }
  }, [authOpen, pendingEmail]); // eslint-disable-line react-hooks/exhaustive-deps

  // resend cooldown timer
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setInterval(() => setResendIn((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(t);
  }, [resendIn]);

  function switchMode(mode: AuthModalMode, keepError = false) {
    setError(keepError ? error : null);
    setPassword("");
    setConfirm("");
    setCode("");
    if (mode !== "reset") {
      setNewPassword("");
      setNewConfirm("");
    }
    openAuth(mode);
  }

  /* ----------------------------- actions ----------------------------- */

  async function doLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!EMAIL_RE.test(email)) return setError("ایمیل معتبر نیست");
    if (password.length < 6) return setError("رمز عبور را وارد کن");
    setBusy("login");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(null);
    if (error) {
      const code = (error as { code?: string }).code ?? "";
      if (code === "email_not_confirmed" || /not confirmed/i.test(error.message)) {
        setPendingEmail(email);
        setResendIn(RESEND_COOLDOWN);
        switchMode("verify", true);
        setError("ایمیلت تایید نشده — کد تایید را وارد کن");
        return;
      }
      setError(faAuthError(error));
      return;
    }
    toast.success("خوش برگشتی! وارد شدی");
    closeAuth();
  }

  async function doSignup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!EMAIL_RE.test(email)) return setError("ایمیل معتبر نیست");
    const pwProblem = passwordProblem(password);
    if (pwProblem) return setError(pwProblem);
    if (password !== confirm) return setError("رمز عبور و تکرارش یکسان نیستند");
    setBusy("signup");
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: SITE_URL },
    });
    setBusy(null);
    if (error) {
      if (/user already registered/i.test(error.message)) {
        setError("این ایمیل قبلاً ثبت شده — وارد شو");
        return;
      }
      setError(faAuthError(error));
      return;
    }
    if (data.session) {
      // email confirmation is disabled server-side → signed in directly
      toast.success("حسابت ساخته شد! خوش آمدی");
      closeAuth();
      return;
    }
    // confirmation email on its way → OTP screen
    setPendingEmail(email);
    setResendIn(RESEND_COOLDOWN);
    switchMode("verify");
    toast.success("کد تایید به ایمیلت ارسال شد");
  }

  async function doVerify(token?: string) {
    const otp = (token ?? code).replace(/\s/g, "");
    if (!pendingEmail) {
      switchMode("signup");
      return;
    }
    if (otp.length !== 6) return setError("کد ۶ رقمی را کامل وارد کن");
    setError(null);
    setBusy("verify");
    const { error } = await supabase.auth.verifyOtp({
      email: pendingEmail,
      token: otp,
      type: "signup",
    });
    setBusy(null);
    if (error) return setError(faAuthError(error));
    toast.success("ایمیل تایید شد! خوش آمدی");
    setPendingEmail(null);
    closeAuth();
  }

  // auto-submit once all six digits are typed
  useEffect(() => {
    if (authMode !== "verify" || !authOpen) return;
    if (code.length === 6 && !busy && !autoSubmit.current) {
      autoSubmit.current = true;
      void doVerify();
    }
    if (code.length < 6) autoSubmit.current = false;
  }, [code, authMode, authOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  async function doResend() {
    if (!pendingEmail || resendIn > 0) return;
    setBusy("resend");
    setError(null);
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: pendingEmail,
      options: { emailRedirectTo: SITE_URL },
    });
    setBusy(null);
    if (error) return setError(faAuthError(error));
    setResendIn(RESEND_COOLDOWN);
    toast.success("کد جدید ارسال شد");
  }

  async function doForgot(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!EMAIL_RE.test(email)) return setError("ایمیل معتبر نیست");
    setBusy("forgot");
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: SITE_URL,
    });
    setBusy(null);
    if (error) return setError(faAuthError(error));
    setPendingEmail(email);
    setResendIn(RESEND_COOLDOWN);
    switchMode("reset");
    toast.success("کد بازیابی به ایمیلت ارسال شد");
  }

  async function doReset(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!pendingEmail) {
      switchMode("forgot");
      return;
    }
    const otp = code.replace(/\s/g, "");
    if (otp.length !== 6) return setError("کد ۶ رقمی را کامل وارد کن");
    const pwProblem = passwordProblem(newPassword);
    if (pwProblem) return setError(pwProblem);
    if (newPassword !== newConfirm) return setError("رمز جدید و تکرارش یکسان نیستند");
    setBusy("reset");
    const { error: otpError } = await supabase.auth.verifyOtp({
      email: pendingEmail,
      token: otp,
      type: "recovery",
    });
    if (otpError) {
      setBusy(null);
      return setError(faAuthError(otpError));
    }
    const { error: updError } = await supabase.auth.updateUser({ password: newPassword });
    setBusy(null);
    if (updError) return setError(faAuthError(updError));
    toast.success("رمز عبور عوض شد! دوباره وارد شو");
    setPendingEmail(null);
    switchMode("login");
    closeAuth();
  }

  /* ------------------------------ views ------------------------------ */

  const isAccount = authMode === "login" || authMode === "signup";

  let innerTitle = "";
  let innerDesc = "";
  if (authMode === "verify") {
    innerTitle = "تایید ایمیل";
    innerDesc = "کد ۶ رقمی که برایت فرستادیم را وارد کن";
  } else if (authMode === "forgot") {
    innerTitle = "بازیابی رمز عبور";
    innerDesc = "ایمیلت را بزن تا کد بازیابی برایت بفرستیم";
  } else if (authMode === "reset") {
    innerTitle = "تعیین رمز جدید";
    innerDesc = "کد بازیابی و رمز جدیدت را وارد کن";
  }

  return (
    <Dialog open={authOpen} onOpenChange={(o) => (o ? null : closeAuth())}>
      <DialogContent className="panel-solid max-w-[25rem] gap-0 overflow-hidden border-line p-0 rounded-3xl shadow-2xl" showCloseButton={false}>
        <DialogTitle className="sr-only">حساب کاربری Remove Page</DialogTitle>

        {/* brand hero band */}
        <div className="metallic-gradient relative flex items-center gap-3 overflow-hidden px-5 py-4">
          <span className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-white/15 blur-xl" />
          <span className="pointer-events-none absolute -bottom-12 left-10 h-24 w-24 rounded-full bg-white/10 blur-lg" />
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/15 shadow-inner ring-1 ring-white/30">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`${BP}/icon-192.png`} alt="" className="h-9 w-9 rounded-xl object-cover" width={36} height={36} />
          </span>
          <div className="min-w-0">
            <p className="select-none text-base font-extrabold tracking-wide text-white" dir="ltr">
              Remove&nbsp;Page
            </p>
            <p className="text-[11px] font-bold leading-4 text-white/85">
              حساب رایگان — ابزارها همیشه در دسترس تو
            </p>
          </div>
          <button
            type="button"
            onClick={closeAuth}
            aria-label="بستن"
            className="absolute end-3 top-3 rounded-full bg-black/20 p-1.5 text-white/90 transition-colors hover:bg-black/40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {/* segmented tabs for login/signup */}
          {isAccount && (
            <div className="grid grid-cols-2 gap-1 rounded-2xl border border-line bg-chip p-1">
              <button
                type="button"
                onClick={() => switchMode("login")}
                className={cn(
                  "flex h-9 items-center justify-center gap-1.5 rounded-xl text-xs font-extrabold transition-all",
                  authMode === "login"
                    ? "metallic-gradient text-white shadow-md"
                    : "text-soft hover:text-foreground active:scale-95"
                )}
              >
                <LogIn className="h-3.5 w-3.5" />
                ورود
              </button>
              <button
                type="button"
                onClick={() => switchMode("signup")}
                className={cn(
                  "flex h-9 items-center justify-center gap-1.5 rounded-xl text-xs font-extrabold transition-all",
                  authMode === "signup"
                    ? "metallic-gradient text-white shadow-md"
                    : "text-soft hover:text-foreground active:scale-95"
                )}
              >
                <UserPlus className="h-3.5 w-3.5" />
                ثبت‌نام
              </button>
            </div>
          )}

          {/* context header for verify / forgot / reset */}
          {!isAccount && <ModeHeader
            icon={authMode === "verify" ? MailCheck : ShieldCheck}
            title={innerTitle}
            desc={innerDesc}
          />}

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] font-bold leading-5 text-destructive">
              <span className="mt-0.5 block h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" />
              {error}
            </div>
          )}

          {/* ------------------------------ login ------------------------------ */}
          {authMode === "login" && (
            <form onSubmit={doLogin} className="space-y-3.5">
              <Field icon={AtSign} label="ایمیل">
                <TextField
                  type="email"
                  value={email}
                  onChange={setEmail}
                  placeholder="you@example.com"
                  autoComplete="email"
                  icon={AtSign}
                />
              </Field>
              <Field icon={KeyRound} label="رمز عبور">
                <PasswordField
                  value={password}
                  onChange={setPassword}
                  placeholder="••••••••"
                  autoComplete="current-password"
                />
              </Field>
              <SubmitButton busy={busy === "login"} icon={LogIn} label="ورود به حساب" />
              <div className="flex items-center justify-between pt-0.5 text-[11px] text-soft">
                <button
                  type="button"
                  className="font-bold hover:text-metallic hover:underline"
                  onClick={() => switchMode("forgot")}
                >
                  رمزت یادت رفته؟
                </button>
                <button
                  type="button"
                  className="font-bold text-metallic hover:underline"
                  onClick={() => switchMode("signup")}
                >
                  حساب نداری؟ ثبت‌نام کن
                </button>
              </div>
            </form>
          )}

          {/* ------------------------------ signup ------------------------------ */}
          {authMode === "signup" && (
            <form onSubmit={doSignup} className="space-y-3.5">
              <Field icon={AtSign} label="ایمیل">
                <TextField
                  type="email"
                  value={email}
                  onChange={setEmail}
                  placeholder="you@example.com"
                  autoComplete="email"
                  icon={AtSign}
                />
              </Field>
              <Field icon={KeyRound} label="رمز عبور">
                <PasswordField
                  value={password}
                  onChange={setPassword}
                  placeholder="حداقل ۸ کاراکتر شامل حرف و عدد"
                  autoComplete="new-password"
                />
              </Field>
              <Field icon={KeyRound} label="تکرار رمز عبور">
                <PasswordField
                  value={confirm}
                  onChange={setConfirm}
                  placeholder="••••••••"
                  autoComplete="new-password"
                />
              </Field>
              <SubmitButton busy={busy === "signup"} icon={UserPlus} label="ساخت حساب رایگان" />
              <p className="text-center text-[11px] text-soft">
                قبلاً ثبت‌نام کردی؟{" "}
                <button
                  type="button"
                  className="font-bold text-metallic hover:underline"
                  onClick={() => switchMode("login")}
                >
                  وارد شو
                </button>
              </p>
            </form>
          )}

          {/* ------------------------------ verify ------------------------------ */}
          {authMode === "verify" && (
            <div className="space-y-4">
              <div className="flex items-center justify-center gap-2 rounded-xl border border-line bg-chip px-3 py-2 text-[11px] font-bold">
                <CheckCircle2 className="h-3.5 w-3.5 text-neon" />
                <span dir="ltr" className="max-w-[11rem] truncate text-left">{pendingEmail ?? "—"}</span>
                <button
                  type="button"
                  className="mr-auto shrink-0 text-metallic hover:underline"
                  onClick={() => switchMode("signup")}
                >
                  ویرایش
                </button>
              </div>
              <div dir="ltr" className="flex justify-center py-1">
                <InputOTP maxLength={6} value={code} onChange={setCode}>
                  <InputOTPGroup className="gap-2">
                    {[0, 1, 2, 3, 4, 5].map((i) => (
                      <InputOTPSlot
                        key={i}
                        index={i}
                        className="h-[3.4rem] w-11 rounded-xl border border-line bg-chip text-base font-extrabold shadow-sm transition-all first:rounded-xl last:rounded-xl data-[active=true]:scale-105 data-[active=true]:border-metallic data-[active=true]:bg-violet-tint/40 data-[active=true]:ring-4 data-[active=true]:ring-metallic/25"
                      />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
              </div>
              <SubmitButton
                busy={busy === "verify"}
                icon={MailCheck}
                label="تایید و ورود"
              />
              <div className="flex items-center justify-between text-[11px]">
                <button
                  type="button"
                  disabled={resendIn > 0 || busy === "resend"}
                  onClick={doResend}
                  className={cn(
                    "flex items-center gap-1 font-bold",
                    resendIn > 0 ? "cursor-not-allowed text-muted" : "text-metallic hover:underline"
                  )}
                >
                  {busy === "resend" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                  {resendIn > 0 ? `ارسال دوباره تا ${resendIn} ثانیه` : "ارسال دوباره کد"}
                </button>
                <span className="text-muted">اسپم را هم چک کن</span>
              </div>
            </div>
          )}

          {/* ------------------------------ forgot ------------------------------ */}
          {authMode === "forgot" && (
            <form onSubmit={doForgot} className="space-y-3.5">
              <Field icon={AtSign} label="ایمیل">
                <TextField
                  type="email"
                  value={email}
                  onChange={setEmail}
                  placeholder="you@example.com"
                  autoComplete="email"
                  icon={AtSign}
                />
              </Field>
              <SubmitButton busy={busy === "forgot"} icon={Send} label="ارسال کد بازیابی" />
              <p className="text-center text-[11px] text-soft">
                <button
                  type="button"
                  className="font-bold text-metallic hover:underline"
                  onClick={() => switchMode("login")}
                >
                  بازگشت به ورود
                </button>
              </p>
            </form>
          )}

          {/* ------------------------------ reset ------------------------------ */}
          {authMode === "reset" && (
            <form onSubmit={doReset} className="space-y-3.5">
              <Field icon={ShieldCheck} label="کد بازیابی ۶ رقمی">
                <Input
                  dir="ltr"
                  inputMode="numeric"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, ""))}
                  placeholder="──────"
                  className="h-12 rounded-xl border-line bg-chip text-center text-base font-extrabold tracking-[0.4em]"
                  required
                />
              </Field>
              <Field icon={KeyRound} label="رمز جدید">
                <PasswordField
                  value={newPassword}
                  onChange={setNewPassword}
                  placeholder="حداقل ۸ کاراکتر شامل حرف و عدد"
                  autoComplete="new-password"
                />
              </Field>
              <Field icon={KeyRound} label="تکرار رمز جدید">
                <PasswordField
                  value={newConfirm}
                  onChange={setNewConfirm}
                  placeholder="••••••••"
                  autoComplete="new-password"
                />
              </Field>
              <SubmitButton busy={busy === "reset"} icon={KeyRound} label="ثبت رمز جدید" />
              <div className="flex items-center justify-between text-[11px]">
                <button
                  type="button"
                  disabled={resendIn > 0 || busy === "resend"}
                  onClick={async () => {
                    if (!pendingEmail || resendIn > 0) return;
                    setBusy("resend");
                    const { error } = await supabase.auth.resetPasswordForEmail(pendingEmail, {
                      redirectTo: SITE_URL,
                    });
                    setBusy(null);
                    if (error) return setError(faAuthError(error));
                    setResendIn(RESEND_COOLDOWN);
                    toast.success("کد جدید ارسال شد");
                  }}
                  className={cn(
                    "flex items-center gap-1 font-bold",
                    resendIn > 0 ? "cursor-not-allowed text-muted" : "text-metallic hover:underline"
                  )}
                >
                  <Send className="h-3.5 w-3.5" />
                  {resendIn > 0 ? `ارسال دوباره تا ${resendIn} ثانیه` : "ارسال دوباره کد"}
                </button>
                <button
                  type="button"
                  className="font-bold text-soft hover:text-metallic hover:underline"
                  onClick={() => switchMode("forgot")}
                >
                  ویرایش ایمیل
                </button>
              </div>
            </form>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
