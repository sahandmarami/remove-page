"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

/** Light/Dark toggle — icon visibility is pure CSS (dark:block / dark:hidden), no hydration mismatch */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <Button
      type="button"
      variant="secondary"
      size="icon"
      aria-label="تغییر تم روشن/تاریک"
      title="تغییر تم"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      className="h-10 w-10 shrink-0 border border-line bg-chip text-soft backdrop-blur transition-colors hover:border-cyan-line hover:text-cyan-ink sm:h-9 sm:w-9"
    >
      <Sun className="hidden h-4 w-4 dark:block" />
      <Moon className="h-4 w-4 dark:hidden" />
    </Button>
  );
}
