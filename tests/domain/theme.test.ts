import { describe, expect, it } from "vitest";
import { adoptStoredTheme, applyThemeColor, chooseTheme, dataTheme, parseTheme, themeColorFor, themeCookie, type ThemeEnv } from "@/lib/theme";
import { BRAND } from "@/lib/brand";

/** A page, a cookie jar and a storage that can be taken away, as small fakes. */
function fakeEnv(options: { stored?: string; storageThrows?: boolean } = {}) {
  const attrs = new Map<string, string>();
  const written: string[] = [];
  const store = new Map<string, string>(options.stored === undefined ? [] : [["rentbook-theme", options.stored]]);
  const env: ThemeEnv = {
    setRoot: (value) => (value === undefined ? attrs.delete("data-theme") : attrs.set("data-theme", value)),
    writeCookie: (text) => void written.push(text),
    storage: options.storageThrows
      ? {
          getItem: () => {
            throw new Error("blocked");
          },
          setItem: () => {
            throw new Error("blocked");
          },
        }
      : { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => void store.set(key, value) },
  };
  return { env, attrs, written, store };
}

describe("parseTheme", () => {
  it("accepts the three choices and treats anything else as Auto", () => {
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("auto")).toBe("auto");
    expect(parseTheme(undefined)).toBe("auto");
    expect(parseTheme("<script>")).toBe("auto");
    expect(parseTheme(null)).toBe("auto");
  });
});

describe("dataTheme", () => {
  it("sets the attribute for a chosen scheme and leaves Auto without one", () => {
    expect(dataTheme("light")).toBe("light");
    expect(dataTheme("dark")).toBe("dark");
    expect(dataTheme("auto")).toBeUndefined();
  });
});

describe("themeCookie", () => {
  it("lasts a year, is sent only to this site, and is dropped for Auto", () => {
    expect(themeCookie("dark")).toBe("rentbook-theme=dark; Path=/; Max-Age=31536000; SameSite=Lax");
    expect(themeCookie("auto")).toBe("rentbook-theme=; Path=/; Max-Age=0; SameSite=Lax");
  });
});

describe("chooseTheme", () => {
  it("sets the attribute, the cookie and the storage", () => {
    const { env, attrs, written, store } = fakeEnv();
    chooseTheme(env, "dark");
    expect(attrs.get("data-theme")).toBe("dark");
    expect(written).toEqual([themeCookie("dark")]);
    expect(store.get("rentbook-theme")).toBe("dark");
  });

  it("removes the attribute for Auto", () => {
    const { env, attrs } = fakeEnv();
    chooseTheme(env, "light");
    chooseTheme(env, "auto");
    expect(attrs.has("data-theme")).toBe(false);
  });

  it("still applies the choice when the storage is blocked", () => {
    const { env, attrs, written } = fakeEnv({ storageThrows: true });
    expect(() => chooseTheme(env, "dark")).not.toThrow();
    expect(attrs.get("data-theme")).toBe("dark");
    expect(written).toHaveLength(1);
  });

  it("works with no storage at all", () => {
    const { env, attrs } = fakeEnv();
    chooseTheme({ ...env, storage: null }, "light");
    expect(attrs.get("data-theme")).toBe("light");
  });
});

describe("adoptStoredTheme", () => {
  it("applies the remembered choice when the server knew none, and says which", () => {
    const { env, attrs, written } = fakeEnv({ stored: "dark" });
    expect(adoptStoredTheme(env)).toBe("dark");
    expect(attrs.get("data-theme")).toBe("dark");
    expect(written).toEqual([themeCookie("dark")]);
  });

  it("does nothing when nothing is remembered, or the storage is blocked or holds rubbish", () => {
    for (const options of [{}, { storageThrows: true }, { stored: "purple" }]) {
      const { env, attrs, written } = fakeEnv(options);
      expect(adoptStoredTheme(env)).toBeNull();
      expect(attrs.size).toBe(0);
      expect(written).toEqual([]);
    }
  });
});

describe("the browser bar colour", () => {
  it("follows the phone in Auto, and the chosen Appearance in Light and Dark", () => {
    expect(themeColorFor("auto")).toEqual([
      { media: "(prefers-color-scheme: light)", color: BRAND.colors.accent },
      { media: "(prefers-color-scheme: dark)", color: BRAND.colors.backgroundDark },
    ]);
    expect(themeColorFor("light")).toBe(BRAND.colors.accent);
    expect(themeColorFor("dark")).toBe(BRAND.colors.backgroundDark);
  });

  it("is carried out on the page's own meta tags when the choice is made, and given back for Auto", () => {
    const metas = [
      { getAttribute: (n: string) => (n === "media" ? "(prefers-color-scheme: light)" : null), content: "#a", media: "(prefers-color-scheme: light)", dataset: {} as Record<string, string> },
      { getAttribute: (n: string) => (n === "media" ? "(prefers-color-scheme: dark)" : null), content: "#b", media: "(prefers-color-scheme: dark)", dataset: {} as Record<string, string> },
    ];
    applyThemeColor(metas, "dark");
    expect(metas.map((m) => [m.content, m.media])).toEqual([[BRAND.colors.backgroundDark, "all"], [BRAND.colors.backgroundDark, "all"]]);
    applyThemeColor(metas, "auto");
    expect(metas.map((m) => [m.content, m.media])).toEqual([
      [BRAND.colors.accent, "(prefers-color-scheme: light)"],
      [BRAND.colors.backgroundDark, "(prefers-color-scheme: dark)"],
    ]);
  });
});

describe("the cookie over https", () => {
  it("is Secure only when the page is served over https", () => {
    expect(themeCookie("dark", true)).toBe("rentbook-theme=dark; Path=/; Max-Age=31536000; SameSite=Lax; Secure");
    expect(themeCookie("auto", true)).toBe("rentbook-theme=; Path=/; Max-Age=0; SameSite=Lax; Secure");
    expect(themeCookie("dark", false)).toBe(themeCookie("dark"));
  });

  it("is written Secure by chooseTheme when the browser says it is on https", () => {
    const written: string[] = [];
    chooseTheme({ setRoot: () => {}, writeCookie: (t) => written.push(t), storage: null, secure: true }, "light");
    expect(written[0]).toMatch(/; Secure$/);
  });
});
