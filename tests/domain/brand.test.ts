import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BRAND, getBrand } from "@/lib/brand";
import { withoutComments } from "../support/source-scan";

const SRC_DIR = fileURLToPath(new URL("../../src", import.meta.url));
const CSS = readFileSync(path.join(SRC_DIR, "app", "globals.css"), "utf8");

describe("BRAND", () => {
  it("has the name, wording and colours the app is built with", () => {
    expect(BRAND).toEqual({
      name: "RentBook",
      shortName: "RentBook",
      tagline: "Rent receipts, straight into your own Google Sheet.",
      description: "Record monthly rent receipts into your Google Sheet.",
      colors: {
        accent: "#1f5f4a",
        accentInk: "#ffffff",
        background: "#f6f5f1",
        accentDark: "#6fc2a0",
        backgroundDark: "#121311",
      },
    });
  });

  it("is what getBrand() returns", () => {
    expect(getBrand()).toBe(BRAND);
  });
});

/** The declarations of the `:root` block that is not inside a media query, and of the one inside the dark query. */
function rootBlocks(css: string): { light: string; dark: string } {
  const light = /(?:^|\n):root\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
  const dark = /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
  return { light, dark };
}

/** The value a custom property is given in a block of declarations. */
const valueOf = (block: string, property: string) =>
  new RegExp(`${property}:\\s*([^;]+);`).exec(block)?.[1].trim();

describe("globals.css", () => {
  const { light, dark } = rootBlocks(CSS);

  it("carries the brand colours in its light and dark tokens", () => {
    expect(valueOf(light, "--accent")).toBe(BRAND.colors.accent);
    expect(valueOf(light, "--accent-ink")).toBe(BRAND.colors.accentInk);
    expect(valueOf(light, "--background")).toBe(BRAND.colors.background);
    expect(valueOf(dark, "--accent")).toBe(BRAND.colors.accentDark);
    expect(valueOf(dark, "--background")).toBe(BRAND.colors.backgroundDark);
  });

  it("keeps every colour token it had", () => {
    const tokens: Record<string, [string, string]> = {
      "--foreground": ["#1b1b18", "#ecebe5"],
      "--surface": ["#ffffff", "#1b1c19"],
      "--muted": ["#6b6a63", "#a3a299"],
      "--line": ["#e4e2da", "#2e2f2a"],
      "--control": ["#8f8d84", "#6c6b63"],
      "--accent-ink": ["#ffffff", "#0d1f18"],
      "--success-bg": ["#e3f1e8", "#1e3a2a"],
      "--success-ink": ["#1d5a37", "#9fdcb8"],
      "--warn-bg": ["#fbefd5", "#40320f"],
      "--warn-ink": ["#7a4f0a", "#f0cf8a"],
      "--danger-bg": ["#fbe4e1", "#4a1f1a"],
      "--danger-ink": ["#8f2a1f", "#f4b3aa"],
    };
    for (const [name, [lightValue, darkValue]] of Object.entries(tokens)) {
      expect(valueOf(light, name), `${name} (light)`).toBe(lightValue);
      expect(valueOf(dark, name), `${name} (dark)`).toBe(darkValue);
    }
  });

  it("has an overlay colour for the backdrop of a sheet, darker in the dark theme", () => {
    expect(valueOf(light, "--overlay")).toBe("rgb(0 0 0 / 0.4)");
    expect(valueOf(dark, "--overlay")).toBe("rgb(0 0 0 / 0.6)");
  });

  it("has a focus colour that follows the accent", () => {
    expect(valueOf(light, "--focus")).toBe("var(--accent)");
  });

  it("makes the new tokens available as Tailwind theme values", () => {
    const theme = /@theme inline\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? "";
    expect(valueOf(theme, "--color-overlay")).toBe("var(--overlay)");
    expect(valueOf(theme, "--color-focus")).toBe("var(--focus)");
    expect(valueOf(theme, "--radius-card")).toBe("1rem");
    expect(valueOf(theme, "--radius-control")).toBe("0.75rem");
    expect(valueOf(theme, "--radius-chip")).toBe("0.5rem");
  });

  it("documents the type and spacing scale the shared pieces use", () => {
    expect(CSS).toMatch(/\/\*[\s\S]*text-2xl[\s\S]*text-lg[\s\S]*text-base[\s\S]*text-sm[\s\S]*text-xs[\s\S]*\*\//);
    expect(CSS).toMatch(/\/\*[\s\S]*16 px gutter[\s\S]*space-y-3[\s\S]*mt-3[\s\S]*mt-4[\s\S]*\*\//);
  });

  it("draws one focus ring, in the focus colour, on every control that can take keyboard focus", () => {
    const rule = /([^{}]*:focus-visible)\s*\{([^}]*)\}/.exec(CSS);
    expect(rule, "a :focus-visible rule").not.toBeNull();
    for (const selector of ["a", "button", "input", "select", "textarea", "summary", "[tabindex]"]) {
      expect(rule![1], selector).toContain(selector);
    }
    expect(valueOf(rule![2], "outline")).toBe("2px solid var(--focus)");
    expect(valueOf(rule![2], "outline-offset")).toBe("2px");
    expect(CSS.match(/:focus-visible/g)).toHaveLength(1);
  });

  it("has a press utility that shrinks a control a little while it is pressed, and does nothing for reduced motion", () => {
    const start = CSS.indexOf("@utility press");
    expect(start).toBeGreaterThan(-1);
    // The utility ends where the next top-level block begins; its own braces are balanced.
    let depth = 0;
    let end = start;
    for (let i = CSS.indexOf("{", start); i < CSS.length; i++) {
      if (CSS[i] === "{") depth++;
      if (CSS[i] === "}" && --depth === 0) {
        end = i + 1;
        break;
      }
    }
    const utility = CSS.slice(start, end);
    expect(utility).toMatch(/transition:\s*transform 120ms ease,\s*opacity 120ms ease;/);
    expect(utility).toMatch(/&:active:not\(:disabled\)\s*\{\s*transform:\s*scale\(0\.98\);?\s*\}/);
    const guard = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*)\}\s*\}\s*$/.exec(utility);
    expect(guard, "a reduced-motion guard").not.toBeNull();
    expect(guard![1]).toMatch(/transition:\s*none/);
    expect(guard![1]).toMatch(/transform:\s*none/);
  });
});

// ---- no hard-coded product name ----

/**
 * Where the product's name is written out in code: in a string, in template text or as text between tags.
 * Comments do not count.
 */
const writesTheName = (source: string) => withoutComments(source).includes(BRAND.name);

function sourceFiles(): string[] {
  return readdirSync(SRC_DIR, { recursive: true, encoding: "utf8" })
    .map((relative) => relative.split(path.sep).join("/"))
    .filter((relative) => /\.tsx?$/.test(relative))
    .sort();
}

describe("the product name in src", () => {
  it("is written only in src/lib/brand.ts: everything else reads BRAND", () => {
    const files = sourceFiles();
    expect(files).toContain("lib/brand.ts");
    const offenders = files
      .filter((file) => file !== "lib/brand.ts")
      .filter((file) => writesTheName(readFileSync(path.join(SRC_DIR, file), "utf8")));
    expect(offenders).toEqual([]);
  });

  describe("the check", () => {
    it("finds the name in a string, in template text and between tags", () => {
      expect(writesTheName(`const a = "RentBook";`)).toBe(true);
      expect(writesTheName("const a = 'Back to RentBook';")).toBe(true);
      expect(writesTheName("const a = `Welcome to RentBook, ${who}`;")).toBe(true);
      expect(writesTheName("const a = <h1>RentBook</h1>;")).toBe(true);
    });

    it("ignores a comment, and does not mistake a comment mark inside a string for one", () => {
      expect(writesTheName("// RentBook is private\nconst a = 1;")).toBe(false);
      expect(writesTheName("/* RentBook */ const a = 1;")).toBe(false);
      expect(writesTheName("const a = <p>{/* RentBook */}</p>;")).toBe(false);
      expect(writesTheName(`const url = "https://example.com/"; const b = "RentBook";`)).toBe(true);
    });

    it("is satisfied by reading the name from BRAND", () => {
      expect(writesTheName("const a = `Back to ${BRAND.name}`;")).toBe(false);
    });
  });
});
