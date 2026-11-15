import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { withoutComments } from "../support/source-scan";

/**
 * One spacing scale. A margin, a padding, a gap or a stack space in a screen or a component takes one of these steps (Tailwind's
 * unit is 4 px): 0, px, 0.5 (2 px), 1 (4), 1.5 (6, inside a chip or beside an icon), 2 (8), 3 (12, between blocks), 4 (16, the
 * gutter and a card), 6 (24, a new section), 8 (32). Roles: page gutter 16; a header sits 16 above its first block; blocks 12
 * apart; a new section 24 down; card padding 16 (a dense list row 14 above and below); inside a card 8 between a title and its
 * content and 12 between rows; chips and action buttons 8 apart; a control 8 under its label. This reads the source and fails
 * on a step off the scale, so a later change cannot bring a random value back. It reads text, it does not render.
 */

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ALLOWED = new Set(["0", "px", "0.5", "1", "1.5", "2", "3", "4", "6", "8"]);

/** Documented exceptions: file (relative) and the class as written, with the reason. */
const EXCEPTIONS: Record<string, string> = {
  "src/components/PortionRow.tsx py-3.5": "a dense list row: 14 px above and below its line (card padding 16, row 12 plus the line)",
  "src/app/overdue/page.tsx px-3.5": "a month pill's side padding, optically matched to its 44 px height",
  "src/lib/ui-classes.ts px-2.5": "a status pill's side padding",
};

const SPACING = /(?<![\w-])-?(?:m|p)[trblxy]?-([0-9.]+|px)(?![\w.])|(?<![\w-])gap(?:-x|-y)?-([0-9.]+|px)(?![\w.])|(?<![\w-])space-[xy]-([0-9.]+|px)(?![\w.])/g;

function files(dir: string): string[] {
  return readdirSync(path.join(ROOT, dir), { recursive: true, encoding: "utf8" })
    .map((relative) => `${dir}/${relative.split(path.sep).join("/")}`)
    .filter((file) => /\.tsx?$/.test(file) && !file.endsWith(".test.ts"));
}

describe("the spacing scale", () => {
  const scanned = [...files("src/app"), ...files("src/components"), "src/lib/ui-classes.ts"];

  it("is used everywhere: no margin, padding, gap or stack space is off the scale, but the documented exceptions", () => {
    const off: string[] = [];
    for (const file of scanned) {
      const code = withoutComments(readFileSync(path.join(ROOT, file), "utf8"));
      for (const match of code.matchAll(SPACING)) {
        const step = match[1] ?? match[2] ?? match[3];
        if (ALLOWED.has(step)) continue;
        if (`${file} ${match[0].replace(/^-/, "")}` in EXCEPTIONS) continue;
        off.push(`${file}: ${match[0]}`);
      }
    }
    expect([...new Set(off)]).toEqual([]);
  });

  it("lists only exceptions that are still in the source, so the list cannot grow stale", () => {
    for (const key of Object.keys(EXCEPTIONS)) {
      const [file, cls] = [key.slice(0, key.lastIndexOf(" ")), key.slice(key.lastIndexOf(" ") + 1)];
      expect(readFileSync(path.join(ROOT, file), "utf8"), key).toContain(cls);
    }
  });

  it("does not catch what is not spacing: sizes and heights are their own thing (min-h-11, size-5, h-12)", () => {
    expect([..."min-h-11 size-5 h-12 w-21 text-2xl".matchAll(SPACING)]).toEqual([]);
  });
});
