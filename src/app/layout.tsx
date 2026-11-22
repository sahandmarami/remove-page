import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

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
    icon: "/logo.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#0c0d16",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fa" dir="rtl" className="dark" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@100..900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen font-sans antialiased bg-background text-foreground flex flex-col">
        {children}
        <Toaster position="bottom-center" dir="rtl" expand={false} richColors closeButton />
      </body>
    </html>
  );
}
