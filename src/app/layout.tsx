import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import { cookies } from "next/headers";
import { Suspense } from "react";
import WriteNotices from "@/components/WriteNotices";
import BackRefresh from "@/components/BackRefresh";
import ThemeSync from "@/components/ThemeSync";
import TabBar, { TabBarFallback } from "@/components/TabBar";
import { ToastProvider } from "@/components/ui/Toast";
import { BRAND } from "@/lib/brand";
import { dataTheme, parseTheme, themeColorFor, THEME_COOKIE } from "@/lib/theme";
import "./globals.css";

// Inter for text, Space Grotesk for numbers and headings (the `font-display` class). Both are fetched when the app is built and
// served from the app's own address, so the page's content security policy needs no outside source for them.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "latin-ext"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin", "latin-ext"],
});

export const metadata: Metadata = {
  title: BRAND.name,
  description: BRAND.description,
  appleWebApp: { capable: true, title: BRAND.name, statusBarStyle: "default" },
  robots: { index: false, follow: false },
};

// Pinch zoom stays on: never set maximumScale or userScalable. viewportFit "cover" draws the page edge to edge, so the
// safe-area padding (pt-safe, px-safe, pb-safe, pb-tabbar in globals.css) keeps content clear of a notch and the home
// indicator. The browser bar takes the accent in light mode and the page's own colour in dark mode.
// The browser bar takes the accent in light mode and the page's own colour in dark mode: by the phone's scheme in Auto, and by the
// chosen Appearance (the cookie) in Light and Dark. Every page already asks for the request, so reading the cookie costs nothing.
export async function generateViewport(): Promise<Viewport> {
  return {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    colorScheme: "light dark",
    themeColor: themeColorFor(parseTheme((await cookies()).get(THEME_COOKIE)?.value)),
    interactiveWidget: "resizes-content",
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // The Appearance choice (More) is a cookie, so the first paint is already Light or Dark and nothing flashes. Every page asks
  // for the request already, so reading it here costs the app no static page.
  const theme = dataTheme(parseTheme((await cookies()).get(THEME_COOKIE)?.value));
  return (
    <html lang="en" data-theme={theme} className={`${inter.variable} ${spaceGrotesk.variable} h-full antialiased`}>
      <body className="min-h-full">
        <ToastProvider>
          {children}
          {/* What a save answered after its sheet was gone still has to tell the owner (it renders nothing otherwise). */}
          <WriteNotices />
        </ToastProvider>
        {/* A tap that goes back lands on a kept screen: this loads it again (it renders nothing). */}
        <BackRefresh />
        {/* A remembered Appearance choice the cookie lost is applied after the page loads (it renders nothing). */}
        <ThemeSync />
        {/* The bar reads the month from the address, so it is drawn inside Suspense, with the month-less bar as its fallback. */}
        <Suspense fallback={<TabBarFallback />}>
          <TabBar />
        </Suspense>
      </body>
    </html>
  );
}
