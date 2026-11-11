/**
 * The Appearance choice under More: Auto (the phone decides), Light or Dark. The choice is kept in a cookie, which the root
 * layout reads on the server to put `data-theme` on <html> (so the first paint is already the right one, with no inline
 * script for the content security policy to block), and in localStorage, which covers a browser that dropped the cookie. Every
 * browser call is behind the small `ThemeEnv` so the rules can be tested; the page renders correctly with neither.
 */

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
export function themeCookie(theme: Theme): string {
  return theme === "auto"
    ? `${THEME_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`
    : `${THEME_COOKIE}=${theme}; Path=/; Max-Age=${YEAR_SECONDS}; SameSite=Lax`;
}

/** Apply a choice to the page and remember it. A blocked storage costs only the second copy. */
export function chooseTheme(env: ThemeEnv, theme: Theme): void {
  env.setRoot(dataTheme(theme));
  env.writeCookie(themeCookie(theme));
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
  env.writeCookie(themeCookie(theme));
  return theme;
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
    },
    writeCookie: (text) => {
      document.cookie = text;
    },
    storage,
  };
}
