"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, LogIn, LogOut, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/components/auth/auth-context";

/** header account widget: compact login button when signed out, avatar menu when in.
 *  heights match ThemeToggle (h-10 mobile / h-9 desktop) so the header stays aligned */
export function AccountButton() {
  const { user, initializing, openAuth, signOut } = useAuth();
  const [busy, setBusy] = useState(false);

  const shell =
    "h-10 shrink-0 rounded-xl border border-line bg-chip text-soft backdrop-blur transition-colors hover:border-cyan-line hover:text-cyan-ink sm:h-9";

  if (initializing) {
    return (
      <Button
        variant="secondary"
        size="icon"
        disabled
        aria-label="در حال بررسی نشستی"
        className={`${shell} w-10 sm:w-9`}
      >
        <UserRound className="h-4 w-4 opacity-50" />
      </Button>
    );
  }

  if (!user || !user.email) {
    return (
      <Button
        type="button"
        variant="secondary"
        onClick={() => openAuth("login")}
        className="btn-shine h-10 shrink-0 rounded-xl metallic-gradient px-3 text-xs font-extrabold text-white shadow-md transition-all hover:brightness-110 active:scale-95 sm:h-9"
      >
        <LogIn className="h-4 w-4" />
        <span>ورود</span>
        <span className="hidden sm:inline">/ ثبت‌نام</span>
      </Button>
    );
  }

  const letter = user.email.charAt(0).toUpperCase();

  async function handleSignOut() {
    setBusy(true);
    try {
      await signOut();
      toast.success("از حساب خارج شدی");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          aria-label="حساب کاربری"
          className={`${shell} gap-2 px-1.5 sm:px-2`}
        >
          <span className="metallic-gradient flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-extrabold text-white shadow-sm">
            {letter}
          </span>
          <span
            dir="ltr"
            className="hidden max-w-[8rem] truncate text-left text-[11px] font-bold sm:block"
          >
            {user.email}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={10}
        collisionPadding={12}
        className="panel-solid border-line min-w-[13.5rem] overflow-hidden rounded-2xl p-0 shadow-2xl"
      >
        {/* gradient header — same language as the auth modal hero band */}
        <div className="metallic-gradient relative flex items-center gap-3 overflow-hidden px-4 py-3">
          <span className="pointer-events-none absolute -left-8 -top-10 h-24 w-24 rounded-full bg-white/15 blur-xl" />
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/15 text-sm font-extrabold text-white ring-1 ring-white/40">
            {letter}
          </span>
          <span className="min-w-0">
            <span
              dir="ltr"
              className="block max-w-[12rem] truncate text-left text-xs font-extrabold text-white"
            >
              {user.email}
            </span>
            <span className="mt-1 flex items-center gap-1.5 text-[10px] font-bold text-white/90">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  user.email_confirmed_at ? "bg-neon" : "bg-amber-300"
                }`}
              />
              {user.email_confirmed_at ? "ایمیل تایید شده" : "ایمیل تایید نشده"}
            </span>
          </span>
        </div>

        <div className="p-1.5">
          <DropdownMenuItem
            disabled={busy}
            onClick={handleSignOut}
            className="gap-2 rounded-xl text-xs font-bold text-destructive focus:bg-destructive/15 focus:text-destructive"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <LogOut className="h-4 w-4" />
            )}
            خروج از حساب
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
