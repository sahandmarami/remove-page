"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, LogIn, LogOut, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
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
        className={`${shell} gap-1.5 px-2.5 text-[11px] font-extrabold sm:px-3 sm:text-xs`}
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
      <DropdownMenuContent align="end" className="panel-glass border-line rounded-2xl">
        <DropdownMenuLabel className="text-xs font-bold text-soft">
          حساب کاربری
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-line" />
        <DropdownMenuLabel className="pb-2">
          <span dir="ltr" className="block max-w-[14rem] truncate text-left text-xs font-extrabold">
            {user.email}
          </span>
          <span className="text-[10px] font-bold text-neon">
            {user.email_confirmed_at ? "ایمیل تایید شده" : "ایمیل تایید نشده"}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-line" />
        <DropdownMenuItem
          disabled={busy}
          onClick={handleSignOut}
          className="gap-2 rounded-xl text-xs font-bold text-destructive focus:text-destructive"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <LogOut className="h-4 w-4" />
          )}
          خروج از حساب
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
