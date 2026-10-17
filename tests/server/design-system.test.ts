import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { withoutComments } from "../support/source-scan";

/**
 * The screens are drawn with the shared pieces in src/components/ui and the class strings in src/lib/ui-classes.ts,
 * and with the colour tokens of globals.css. This reads the source of every page and component (comments ignored)
 * and fails when a screen goes round them: a colour of its own, a Tailwind palette colour, a copy of a primitive's
 * class string, or a raw form control. It is a safety net, not a proof: it reads text, it does not render.
 */

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SCANNED = ["src/app", "src/components"];
/** Where the primitives, and the class strings they are drawn with, live. */
const PRIMITIVES = "src/components/ui/";

function sourceFiles(): { file: string; code: string }[] {
  return SCANNED.flatMap((dir) =>
    readdirSync(path.join(ROOT, dir), { recursive: true, encoding: "utf8" })
      .map((relative) => `${dir}/${relative.split(path.sep).join("/")}`)
      .filter((file) => file.endsWith(".tsx"))
      .sort()
      .map((file) => ({ file, code: withoutComments(readFileSync(path.join(ROOT, file), "utf8")) })),
  );
}

const PALETTE =
  "black|white|gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";

/** A colour written out in a screen: a hex value, an rgb( or hsl( call, or a Tailwind palette class. */
const OWN_COLOUR = [
  { what: "a hex colour", pattern: /#[0-9a-fA-F]{3,8}\b/ },
  { what: "an rgb(), rgba(), hsl() or hsla() colour", pattern: /\b(?:rgba?|hsla?)\(/ },
  {
    what: "a Tailwind palette colour class",
    pattern: new RegExp(
      `\\b(?:bg|text|border|ring|fill|stroke|divide|outline|from|via|to|shadow|decoration|accent|caret)-(?:${PALETTE})(?:-\\d{2,3})?\\b`,
    ),
  },
];

/** What only the primitives (or ui-classes.ts) may write out: the class strings that make a button, a field, a pill. */
const PRIMITIVE_ONLY = [
  { what: "the primary button look", pattern: /bg-accent px-4 font-medium text-accent-ink/ },
  { what: "the field look", pattern: /border border-control bg-surface px-3/ },
  { what: "a full-screen layer (use Sheet)", pattern: /fixed inset-0/ },
  { what: "the danger notice look (use Notice)", pattern: /rounded-lg bg-danger-bg px-3 py-2/ },
  { what: "the pill look (use Pill)", pattern: /rounded-lg px-2\.5 py-0\.5 text-xs/ },
  { what: "the icon button look (use IconButton)", pattern: /grid min-h-11 min-w-11 place-items-center/ },
  { what: "the outline button look (use Button variant outline)", pattern: /border border-current/ },
];

const RAW_CONTROL = { what: "a raw form control (use Field with Input, Select or TextArea)", pattern: /<(?:input|select|textarea)\b/ };

/** Each way one file's code goes round the design system: a colour of its own, or something only a primitive writes. */
function problems(file: string, code: string): { colours: string[]; copies: string[] } {
  const colours: string[] = [];
  const copies: string[] = [];
  for (const { what, pattern } of OWN_COLOUR) {
    const match = pattern.exec(code);
    if (match) colours.push(`${file} has ${what}: ${match[0]}`);
  }
  if (!file.startsWith(PRIMITIVES)) {
    for (const { what, pattern } of [...PRIMITIVE_ONLY, RAW_CONTROL]) {
      const match = pattern.exec(code);
      if (match) copies.push(`${file} writes ${what} itself: ${match[0]}`);
    }
  }
  return { colours, copies };
}

describe("the screens and components", () => {
  const files = sourceFiles();

  it("are found by reading the folders", () => {
    const names = files.map((entry) => entry.file);
    expect(names).toEqual(
      expect.arrayContaining([
        "src/app/page.tsx",
        "src/app/signin/page.tsx",
        "src/components/PortionBoard.tsx",
        "src/components/ui/Button.tsx",
        "src/components/ui/Field.tsx",
      ]),
    );
  });

  it("use the colour tokens, never a colour of their own", () => {
    expect(files.flatMap(({ file, code }) => problems(file, code).colours)).toEqual([]);
  });

  it("leave the primitives' class strings and the raw form controls to src/components/ui", () => {
    expect(files.flatMap(({ file, code }) => problems(file, code).copies)).toEqual([]);
  });
});

describe("the check", () => {
  const check = (code: string, file = "src/components/X.tsx") => {
    const { colours, copies } = problems(file, withoutComments(code));
    return [...colours, ...copies];
  };

  it("accepts a screen made of tokens and primitives", () => {
    expect(check('<Card className="mt-4"><Pill tone="success">Paid</Pill><p className="text-muted">x</p></Card>')).toEqual([]);
  });

  it("refuses a hex colour, an rgb or hsl colour and a palette class", () => {
    expect(check('<p style={{ color: "#1f5f4a" }} />')).toHaveLength(1);
    expect(check('<p style={{ color: "rgb(0 0 0)" }} />')).toHaveLength(1);
    expect(check('<p style={{ color: "hsl(10 20% 30%)" }} />')).toHaveLength(1);
    for (const palette of ["bg-white", "text-red-600", "border-gray-200", "ring-slate-300", "fill-black", "stroke-blue-500"]) {
      expect(check(`<p className="${palette}" />`), palette).toHaveLength(1);
    }
  });

  it("does not take a token for a palette colour", () => {
    for (const token of ["bg-accent", "text-accent-ink", "bg-success-bg", "text-danger-ink", "border-control", "bg-line", "text-foreground", "border-current"]) {
      expect(check(`<p className="${token}" />`), token).toEqual([]);
    }
  });

  it("ignores a colour that only appears in a comment", () => {
    expect(check('// was #ffffff\n/* bg-white */\n<p className="text-muted" />')).toEqual([]);
  });

  it("refuses a copy of a primitive's class string outside src/components/ui", () => {
    for (const copy of [
      "min-h-11 rounded-xl bg-accent px-4 font-medium text-accent-ink",
      "mt-1 min-h-12 w-full rounded-xl border border-control bg-surface px-3 text-base",
      "fixed inset-0 z-40",
      "rounded-lg bg-danger-bg px-3 py-2 text-sm",
      "shrink-0 rounded-lg px-2.5 py-0.5 text-xs font-medium",
      "grid min-h-11 min-w-11 place-items-center rounded-lg text-xl",
      "rounded-lg border border-current px-3",
    ]) {
      expect(check(`<p className="${copy}" />`), copy).toHaveLength(1);
    }
  });

  it("lets the primitives write those strings themselves", () => {
    expect(check('<div className="fixed inset-0 z-40" /><input className="border border-control bg-surface px-3" />', "src/components/ui/Sheet.tsx")).toEqual([]);
  });

  it("refuses a raw input, select or textarea outside src/components/ui", () => {
    for (const tag of ["input", "select", "textarea"]) {
      expect(check(`<${tag} value="x" />`), tag).toHaveLength(1);
    }
    expect(check('<input type="checkbox" />', "src/components/ui/Field.tsx")).toEqual([]);
  });

  it("does not mistake an Input, Select or TextArea component for a raw control", () => {
    expect(check('<Field label="x"><Input /><Select /><TextArea /></Field>')).toEqual([]);
  });
});
