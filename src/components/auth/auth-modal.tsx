"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AtSign,
  KeyRound,
  Loader2,
  LogIn,
  MailCheck,
  Send,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
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

/** map supabase errors to friendly persian messages */
function faAuthError(err: unknown): string {
  const msg = err instanceof Error ? err.message : "";
  const code = (err as { code?: string })?.code ?? "";
  if (code === "email_not_confirmed" || /not confirmed/i.test(msg))
    return "ایمیلت هنوز تایید نشده — کد تایید را وارد کن";
  if (code === "invalid_credentials" || /invalid login credentials/i.test(msg))
    return "ایمیل یا رمز عبور اشتباه است";
  if (/user already registered/i.test(msg))
    return "این ایمیل قبلاً ثبت شده — وارد شو";
  if (code === "over_email_send_rate_limit" || /rate limit|too many/i.test(msg))
    return "ارسال ایمیل محدود شده — چند دقیقه بعد دوباره امتحان کن";
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

/* ------------------------------------------------------------------ */
/* small building blocks                                               */
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
    <label className="block space-y-1.5">
      <span className="flex items-center gap-1.5 text-xs font-bold text-soft">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </span>
      {children}
    </label>
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
      className="metallic-gradient h-11 w-full rounded-xl text-sm font-extrabold text-white shadow-md transition-transform hover:opacity-95 active:scale-[0.98] disabled:opacity-60"
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
      {label}
    </Button>
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
    if (password.length < 6) return setError("رمز عبور باید حداقل ۶ کاراکتر باشد");
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
    if (password.length < 6) return setError("رمز عبور باید حداقل ۶ کاراکتر باشد");
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
    if (newPassword.length < 6) return setError("رمز جدید باید حداقل ۶ کاراکتر باشد");
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

  let title = "";
  let desc = "";

  if (authMode === "login") {
    title = "ورود به حساب";
    desc = "برای استفاده از حساب کاربری وارد شو";
  } else if (authMode === "signup") {
    title = "ساخت حساب جدید";
    desc = "با ایمیل ثبت‌نام کن؛ یک کد تایید برایت می‌فرستیم";
  } else if (authMode === "verify") {
    title = "تایید ایمیل";
    desc = pendingEmail
      ? `کد ۶ رقمی ارسال‌شده به ${pendingEmail} را وارد کن`
      : "کد تایید را وارد کن";
  } else if (authMode === "forgot") {
    title = "بازیابی رمز عبور";
    desc = "ایمیلت را وارد کن تا کد بازیابی بفرستیم";
  } else {
    title = "تعیین رمز جدید";
    desc = pendingEmail
      ? `کد ارسال‌شده به ${pendingEmail} و رمز جدیدت را وارد کن`
      : "کد بازیابی و رمز جدیدت را وارد کن";
  }

  return (
    <Dialog open={authOpen} onOpenChange={(o) => (o ? null : closeAuth())}>
      <DialogContent className="max-w-sm panel-glass border-line rounded-3xl">
        <DialogHeader className="text-right">
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="metallic-gradient flex h-8 w-8 items-center justify-center rounded-xl text-white shadow-sm">
              {authMode === "login" || authMode === "forgot" ? (
                <LogIn className="h-4 w-4" />
              ) : authMode === "verify" || authMode === "reset" ? (
                <ShieldCheck className="h-4 w-4" />
              ) : (
                <UserPlus className="h-4 w-4" />
              )}
            </span>
            {title}
          </DialogTitle>
          <DialogDescription className="text-xs leading-5 text-soft">
            {desc}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-bold leading-5 text-destructive">
            {error}
          </div>
        )}

        {/* ------------------------------ login ------------------------------ */}
        {authMode === "login" && (
          <form onSubmit={doLogin} className="space-y-3">
            <Field icon={AtSign} label="ایمیل">
              <Input
                dir="ltr"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="h-11 rounded-xl border-line bg-chip text-left text-sm"
                required
              />
            </Field>
            <Field icon={KeyRound} label="رمز عبور">
              <Input
                dir="ltr"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="h-11 rounded-xl border-line bg-chip text-left text-sm"
                required
              />
            </Field>
            <SubmitButton busy={busy === "login"} icon={LogIn} label="ورود" />
            <div className="flex items-center justify-between pt-0.5 text-xs text-soft">
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
                حساب نداری؟ ثبت‌نام
              </button>
            </div>
          </form>
        )}

        {/* ------------------------------ signup ------------------------------ */}
        {authMode === "signup" && (
          <form onSubmit={doSignup} className="space-y-3">
            <Field icon={AtSign} label="ایمیل">
              <Input
                dir="ltr"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="h-11 rounded-xl border-line bg-chip text-left text-sm"
                required
              />
            </Field>
            <Field icon={KeyRound} label="رمز عبور">
              <Input
                dir="ltr"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="حداقل ۶ کاراکتر"
                className="h-11 rounded-xl border-line bg-chip text-left text-sm"
                required
              />
            </Field>
            <Field icon={KeyRound} label="تکرار رمز عبور">
              <Input
                dir="ltr"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••"
                className="h-11 rounded-xl border-line bg-chip text-left text-sm"
                required
              />
            </Field>
            <SubmitButton busy={busy === "signup"} icon={UserPlus} label="ثبت‌نام" />
            <p className="text-center text-xs text-soft">
              قبلاً ثبت‌نام کردی؟{" "}
              <button
                type="button"
                className="font-bold text-metallic hover:underline"
                onClick={() => switchMode("login")}
              >
                ورود
              </button>
            </p>
          </form>
        )}

        {/* ------------------------------ verify ------------------------------ */}
        {authMode === "verify" && (
          <div className="space-y-3">
            <div dir="ltr" className="flex justify-center py-1">
              <InputOTP maxLength={6} value={code} onChange={setCode}>
                <InputOTPGroup className="gap-2">
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <InputOTPSlot
                      key={i}
                      index={i}
                      className="h-12 w-10 rounded-xl border border-line bg-chip text-base font-extrabold first:rounded-xl last:rounded-xl"
                    />
                  ))}
                </InputOTPGroup>
              </InputOTP>
            </div>
            <SubmitButton
              busy={busy === "verify"}
              icon={MailCheck}
              label="تایید و ادامه"
            />
            <div className="flex items-center justify-between text-xs">
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
              <button
                type="button"
                className="font-bold text-soft hover:text-metallic hover:underline"
                onClick={() => switchMode("signup")}
              >
                ویرایش ایمیل
              </button>
            </div>
          </div>
        )}

        {/* ------------------------------ forgot ------------------------------ */}
        {authMode === "forgot" && (
          <form onSubmit={doForgot} className="space-y-3">
            <Field icon={AtSign} label="ایمیل">
              <Input
                dir="ltr"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="h-11 rounded-xl border-line bg-chip text-left text-sm"
                required
              />
            </Field>
            <SubmitButton busy={busy === "forgot"} icon={Send} label="ارسال کد بازیابی" />
            <p className="text-center text-xs text-soft">
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
          <form onSubmit={doReset} className="space-y-3">
            <Field icon={ShieldCheck} label="کد بازیابی ۶ رقمی">
              <Input
                dir="ltr"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, ""))}
                placeholder="──────"
                className="h-11 rounded-xl border-line bg-chip text-center text-base font-extrabold tracking-[0.4em]"
                required
              />
            </Field>
            <Field icon={KeyRound} label="رمز جدید">
              <Input
                dir="ltr"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="حداقل ۶ کاراکتر"
                className="h-11 rounded-xl border-line bg-chip text-left text-sm"
                required
              />
            </Field>
            <Field icon={KeyRound} label="تکرار رمز جدید">
              <Input
                dir="ltr"
                type="password"
                autoComplete="new-password"
                value={newConfirm}
                onChange={(e) => setNewConfirm(e.target.value)}
                placeholder="••••••••"
                className="h-11 rounded-xl border-line bg-chip text-left text-sm"
                required
              />
            </Field>
            <SubmitButton busy={busy === "reset"} icon={KeyRound} label="ثبت رمز جدید" />
            <div className="flex items-center justify-between text-xs">
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
      </DialogContent>
    </Dialog>
  );
}
