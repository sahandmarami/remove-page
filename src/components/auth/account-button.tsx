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

/** header account widget: login button when signed out, user menu when in */
export function AccountButton() {
  const { user, initializing, openAuth, signOut } = useAuth();
  const [busy, setBusy] = useState(false);

  if (initializing) {
    return (
      <Button
        variant="secondary"
        size="icon"
        disabled
        aria-label="در حال بررسی نشستی"
        className="h-10 w-10 shrink-0 rounded-xl border border-line bg-chip text-soft sm:h-9 sm:w-9"
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
        className="h-10 shrink-0 gap-1.5 rounded-xl border border-line bg-chip px-3 text-xs font-bold text-soft backdrop-blur transition-colors hover:border-cyan-line hover:text-cyan-ink sm:h-9 sm:text-sm"
      >
        <LogIn className="h-4 w-4" />
        ورود / ثبت‌نام
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
          className="h-10 shrink-0 gap-2 rounded-xl border border-line bg-chip px-2 backdrop-blur transition-colors hover:border-cyan-line sm:h-9 sm:px-2.5"
        >
          <span className="metallic-gradient flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-extrabold text-white shadow-sm">
            {letter}
          </span>
          <span dir="ltr" className="hidden max-w-[9rem] truncate text-xs font-bold text-soft sm:block">
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
