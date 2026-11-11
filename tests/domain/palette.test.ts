import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The colour tokens of globals.css, light and dark. Text must keep a contrast of at least 4.5:1 with what it sits on, and a
// control's border (the one thing that says where a field is) at least 3:1, in both schemes.

const css = readFileSync(new URL("../../src/app/globals.css", import.meta.url), "utf8");

/** The `--name: #hex` declarations of the first block that follows `opening`. */
function tokens(opening: RegExp): Record<string, string> {
  const start = css.search(opening);
  expect(start).toBeGreaterThanOrEqual(0);
  const block = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  return Object.fromEntries([...block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\b/g)].map((m) => [m[1], m[2]]));
}

const light = tokens(/^:root\s*\{/m);
const dark = tokens(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{/);

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Text colour on the background it is drawn on. */
const TEXT_ON: [string, string][] = [
  ["foreground", "background"],
  ["foreground", "surface"],
  ["foreground", "accent-soft"],
  ["foreground", "line"],
  ["muted", "background"],
  ["muted", "surface"],
  ["muted", "surface-2"],
  ["muted", "accent-soft"],
  ["accent", "background"],
  ["accent", "surface"],
  ["accent", "accent-soft"],
  ["accent-ink", "accent"],
  ["success-ink", "success-bg"],
  ["success-ink", "surface"],
  ["warn-ink", "warn-bg"],
  ["warn-ink", "surface"],
  ["danger-ink", "danger-bg"],
  ["danger-ink", "surface"],
  ["off-ink", "off-bg"],
  ["background", "foreground"],
];

describe.each([
  ["light", light],
  ["dark", dark],
] as const)("the %s palette", (_name, palette) => {
  it.each(TEXT_ON)("%s text on %s is at least 4.5:1", (text, ground) => {
    expect(palette[text], `--${text} is defined`).toBeDefined();
    expect(palette[ground], `--${ground} is defined`).toBeDefined();
    expect(contrast(palette[text], palette[ground])).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps a control's border at least 3:1 against the surface", () => {
    expect(contrast(palette.control, palette.surface)).toBeGreaterThanOrEqual(3);
  });
});

describe("the dark palette", () => {
  it("redefines every token the light one has that is a colour", () => {
    for (const name of Object.keys(light)) {
      if (name === "focus") continue;
      expect(dark[name], `--${name}`).toBeDefined();
    }
  });
});
