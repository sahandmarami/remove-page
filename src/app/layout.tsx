import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";

/** static-export basePath (e.g. "/spriteforge" on GitHub Pages) — empty in dev */
const BP = process.env.NEXT_PUBLIC_BASE_PATH || "";

export const metadata: Metadata = {
  title: "اسپرایت‌فورج | SpriteForge — برش‌زن هوشمند شیت و استخراج فریم",
  description:
    "استودیوی حرفه‌ای برش شیت تصاویر، حذف پس‌زمینه با موتور بینایی ماشین، استخراج فریم از ویدیو و گیف با کروماکی زنده، سازنده اسپرایت‌شیت و خروجی WebP شفاف.",
  keywords: [
    "sprite sheet",
    "background removal",
    "chroma key",
    "gif frames",
    "برش شیت",
    "حذف پس‌زمینه",
    "کروماکی",
  ],
  icons: {
    icon: `${BP}/logo.svg`,
  },
  applicationName: "SpriteForge",
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
        </ThemeProvider>
      </body>
    </html>
  );
}
