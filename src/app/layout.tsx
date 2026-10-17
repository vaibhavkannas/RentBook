import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { Suspense } from "react";
import BackRefresh from "@/components/BackRefresh";
import TabBar, { TabBarFallback } from "@/components/TabBar";
import { ToastProvider } from "@/components/ui/Toast";
import { BRAND } from "@/lib/brand";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "latin-ext"],
});

export const metadata: Metadata = {
  title: BRAND.name,
  description: BRAND.description,
  appleWebApp: { capable: true, title: BRAND.name, statusBarStyle: "default" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: BRAND.colors.accent,
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} h-full antialiased`}>
      <body className="min-h-full">
        <ToastProvider>{children}</ToastProvider>
        {/* A tap that goes back lands on a kept screen: this loads it again (it renders nothing). */}
        <BackRefresh />
        {/* The bar reads the month from the address, so it is drawn inside Suspense, with the month-less bar as its fallback. */}
        <Suspense fallback={<TabBarFallback />}>
          <TabBar />
        </Suspense>
      </body>
    </html>
  );
}
