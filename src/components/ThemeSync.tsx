"use client";

import { useEffect } from "react";
import { adoptStoredTheme, browserThemeEnv } from "@/lib/theme";

/**
 * For a page the server drew with no Appearance choice: if the browser's storage remembers one (the cookie was dropped), apply
 * it once the page has loaded. It renders nothing. A page whose <html> already has a choice is left alone.
 */
export default function ThemeSync() {
  useEffect(() => {
    if (!document.documentElement.hasAttribute("data-theme")) adoptStoredTheme(browserThemeEnv());
  }, []);
  return null;
}
