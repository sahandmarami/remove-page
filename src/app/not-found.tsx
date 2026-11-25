"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * 404 page — also handles the legacy GitHub-Pages paths:
 * after the custom domain went live the site moved from
 * sahandmarami.github.io/remove-page/…  →  removepage.kdns.fr/…
 * so old links (and cached service workers) get redirected to the root.
 */
export default function NotFound() {
  useEffect(() => {
    const path = window.location.pathname;
    const m = path.match(/^\/remove-page\/?(.*)$/);
    if (m) {
      const rest = m[1] || "";
      window.location.replace(
        "/" + rest + window.location.search + window.location.hash
      );
    }
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="select-none text-5xl font-extrabold tracking-tight">۴۰۴</p>
      <p className="text-sm font-bold text-soft">
        این صفحه پیدا نشد — احتمالاً از آدرس قدیمی سایت آمده‌ای
      </p>
      <Link
        href="/"
        className="metallic-gradient rounded-2xl px-6 py-3 text-sm font-extrabold text-white shadow-lg transition-all hover:brightness-110"
      >
        بازگشت به صفحه اصلی
      </Link>
    </main>
  );
}
