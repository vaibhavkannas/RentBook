/**
 * The Appearance choice under More: Auto (the phone decides), Light or Dark. The choice is kept in a cookie, which the root
 * layout reads on the server to put `data-theme` on <html> (so the first paint is already the right one, with no inline
 * script for the content security policy to block), and in localStorage, which covers a browser that dropped the cookie. Every
 * browser call is behind the small `ThemeEnv` so the rules can be tested; the page renders correctly with neither.
 */

import { BRAND } from "@/lib/brand";

export const THEMES = ["auto", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_COOKIE = "rentbook-theme";
const THEME_KEY = "rentbook-theme";
const YEAR_SECONDS = 365 * 24 * 60 * 60;

/** What the browser gives the rules: the attribute on <html>, the cookie jar and (when there is one) the storage. */
export type ThemeEnv = {
  setRoot: (value: "light" | "dark" | undefined) => void;
  writeCookie: (text: string) => void;
  storage: Pick<Storage, "getItem" | "setItem"> | null;
  /** The page is served over https: the cookie is then Secure. */
  secure?: boolean;
};

/** Anything that is not one of the three words is Auto. */
export function parseTheme(value: unknown): Theme {
  return value === "light" || value === "dark" ? value : "auto";
}

/** The `data-theme` a choice puts on <html>: none for Auto, so the phone's own scheme applies. */
export function dataTheme(theme: Theme): "light" | "dark" | undefined {
  return theme === "auto" ? undefined : theme;
}

/** The Set-Cookie text for a choice (document.cookie form). Auto removes the cookie. */
export function themeCookie(theme: Theme, secure = false): string {
  const text =
    theme === "auto"
      ? `${THEME_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`
      : `${THEME_COOKIE}=${theme}; Path=/; Max-Age=${YEAR_SECONDS}; SameSite=Lax`;
  return secure ? `${text}; Secure` : text;
}

const LIGHT_MEDIA = "(prefers-color-scheme: light)";
const DARK_MEDIA = "(prefers-color-scheme: dark)";

/** The browser bar's colour for a choice: the phone's scheme decides in Auto; Light and Dark are what was chosen. */
export function themeColorFor(theme: Theme): string | { media: string; color: string }[] {
  if (theme === "light") return BRAND.colors.accent;
  if (theme === "dark") return BRAND.colors.backgroundDark;
  return [
    { media: LIGHT_MEDIA, color: BRAND.colors.accent },
    { media: DARK_MEDIA, color: BRAND.colors.backgroundDark },
  ];
}

/** The part of a <meta name="theme-color"> that is changed (so it can be tested without a page). */
type ThemeMeta = { content: string; media: string; getAttribute(name: string): string | null; dataset: Record<string, string | undefined> };

/**
 * Colours the page's own theme-color tags for a choice made on the page (a reload has the server do it): Light or Dark makes
 * every tag that colour, for every scheme; Auto gives each tag back its own scheme's colour.
 */
export function applyThemeColor(metas: readonly ThemeMeta[], theme: Theme): void {
  for (const meta of metas) {
    meta.dataset.media ??= meta.getAttribute("media") ?? "";
    const chosen = themeColorFor(theme);
    if (typeof chosen === "string") {
      meta.content = chosen;
      meta.media = "all";
    } else {
      const own = meta.dataset.media === DARK_MEDIA ? chosen[1] : chosen[0];
      meta.content = own.color;
      meta.media = meta.dataset.media;
    }
  }
}

/** Apply a choice to the page and remember it. A blocked storage costs only the second copy. */
export function chooseTheme(env: ThemeEnv, theme: Theme): void {
  env.setRoot(dataTheme(theme));
  env.writeCookie(themeCookie(theme, env.secure));
  try {
    env.storage?.setItem(THEME_KEY, theme);
  } catch {
    // Private window or blocked site data: the cookie still remembers.
  }
}

/** For a page the server drew without a choice: apply what the storage remembers, if anything. Null when nothing was applied. */
export function adoptStoredTheme(env: ThemeEnv): Theme | null {
  let stored: string | null = null;
  try {
    stored = env.storage?.getItem(THEME_KEY) ?? null;
  } catch {
    return null;
  }
  const theme = parseTheme(stored);
  if (theme === "auto") return null;
  env.setRoot(dataTheme(theme));
  env.writeCookie(themeCookie(theme, env.secure));
  return theme;
}

/** Sent on the window when the page's theme was set, so a control that shows it can follow. */
const THEME_EVENT = "rentbook:theme";

export function subscribeTheme(onChange: () => void): () => void {
  window.addEventListener(THEME_EVENT, onChange);
  return () => window.removeEventListener(THEME_EVENT, onChange);
}

/** The choice on the page now: what <html> says (nothing is Auto). */
export function currentTheme(): Theme {
  return parseTheme(document.documentElement.getAttribute("data-theme"));
}

/** The real browser, behind the same small interface. The storage getter is guarded: the property itself can throw. */
export function browserThemeEnv(): ThemeEnv {
  let storage: Storage | null = null;
  try {
    storage = window.localStorage;
  } catch {
    storage = null;
  }
  return {
    setRoot: (value) => {
      if (value === undefined) document.documentElement.removeAttribute("data-theme");
      else document.documentElement.setAttribute("data-theme", value);
      applyThemeColor([...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')], parseTheme(value));
      window.dispatchEvent(new Event(THEME_EVENT));
    },
    writeCookie: (text) => {
      document.cookie = text;
    },
    storage,
    secure: window.location.protocol === "https:",
  };
}
