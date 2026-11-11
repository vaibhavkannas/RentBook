"use client";

import { useSyncExternalStore } from "react";
import { browserThemeEnv, chooseTheme, currentTheme, subscribeTheme, THEMES, type Theme } from "@/lib/theme";
import { cx } from "@/lib/ui-classes";

const LABELS: Record<Theme, string> = { auto: "Auto", light: "Light", dark: "Dark" };

/**
 * The Appearance control on More: Auto (the phone decides), Light or Dark. A choice is applied at once (data-theme on the root)
 * and remembered (a cookie the server reads for the next page, and localStorage). It shows what the page itself has on <html>,
 * so it also follows a choice adopted from the storage after the page loaded (see ThemeSync); `initial` is what the server
 * read from the cookie, so the right button is already pressed in the first paint. The colours change by CSS alone.
 */
export default function Appearance({ initial }: { initial: Theme }) {
  const theme = useSyncExternalStore(subscribeTheme, currentTheme, () => initial);
  return (
    <div role="group" aria-label="Appearance" className="grid grid-cols-3 gap-1 rounded-control bg-surface-2 p-1">
      {THEMES.map((name) => (
        <button
          key={name}
          type="button"
          aria-pressed={theme === name}
          onClick={() => chooseTheme(browserThemeEnv(), name)}
          className={cx(
            "press min-h-11 rounded-chip text-sm",
            theme === name ? "bg-surface font-semibold shadow-card" : "text-foreground",
          )}
        >
          {LABELS[name]}
        </button>
      ))}
    </div>
  );
}
