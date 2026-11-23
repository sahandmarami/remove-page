import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { SwRegister } from "@/components/sw-register";

/** static-export basePath (e.g. "/spriteforge" on GitHub Pages) — empty in dev */
const BP = process.env.NEXT_PUBLIC_BASE_PATH || "";

export const metadata: Metadata = {
  title: "Remove Page — حذف پس‌زمینه، استخراج فریم و ساخت تامنل",
  description:
    "حذف خودکار و دقیق پس‌زمینه تصاویر و گیف، برش هوشمند شیت، استخراج فریم از ویدیو، اسپرایت‌شیت و ساخت تامنل — همه‌چیز داخل مرورگر.",
  keywords: [
    "remove background",
    "background removal",
    "thumbnail maker",
    "sprite sheet",
    "chroma key",
    "gif frames",
    "حذف پس‌زمینه",
    "ساخت تامنل",
    "کروماکی",
  ],
  manifest: `${BP}/manifest.webmanifest`,
  applicationName: "Remove Page",
  icons: {
    icon: [
      { url: `${BP}/favicon.ico`, sizes: "48x48" },
      { url: `${BP}/favicon-32.png`, type: "image/png", sizes: "32x32" },
      { url: `${BP}/icon-192.png`, type: "image/png", sizes: "192x192" },
      { url: `${BP}/icon-512.png`, type: "image/png", sizes: "512x512" },
    ],
    shortcut: [`${BP}/favicon.ico`],
    apple: [{ url: `${BP}/apple-touch-icon.png`, sizes: "180x180" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Remove Page",
  },
  openGraph: {
    title: "Remove Page",
    description:
      "حذف پس‌زمینه، برش شیت، استخراج فریم ویدیو و گیف و ساخت تامنل — همه‌چیز داخل مرورگر",
    images: [{ url: `${BP}/og-image.png`, width: 1200, height: 630 }],
    locale: "fa_IR",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0c0d16" },
    { media: "(prefers-color-scheme: light)", color: "#f7f6fc" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <body className="min-h-screen font-sans antialiased bg-background text-foreground flex flex-col">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
          {children}
          <Toaster position="bottom-center" dir="rtl" expand={false} richColors closeButton />
          <SwRegister />
        </ThemeProvider>
      </body>
    </html>
  );
}
