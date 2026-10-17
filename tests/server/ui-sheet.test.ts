import { readFileSync } from "node:fs";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PortionCard } from "@/lib/domain/types";
import { withoutComments } from "../support/source-scan";

// The bottom sheet and the three dialogs built on it, as the server renders them. What a key press means and how the
// page is locked are decided by helpers with their own tests (sheet-keys, page-lock); focus and scrolling in a real
// browser were checked by hand (see the task report).

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import MonthPicker from "@/components/MonthPicker";
import PaymentSheet from "@/components/PaymentSheet";
import UndoSheet from "@/components/UndoSheet";
import { Sheet } from "@/components/ui/Sheet";

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);
const source = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");


const card = (overrides: Partial<PortionCard> = {}): PortionCard => ({
  portionId: "p1",
  name: "Ground floor",
  cycleLength: 11,
  status: "paid",
  entry: { tenant: "Asha", count: 4, amount: 10000 },
  next: null,
  rentReference: 10000,
  rentDifference: null,
  undoBlockedReason: null,
  tenancy: null,
  ...overrides,
});

describe("Sheet", () => {
  const sheet = (props: Record<string, unknown> = {}) =>
    html(
      createElement(
        Sheet,
        { labelledBy: "t", onClose: () => {}, canClose: true, closeOnBackdrop: false, ...props } as ComponentProps<typeof Sheet>,
        createElement("h2", { id: "t" }, "Title"),
        createElement("p", null, "Body"),
      ),
    );

  it("is a backdrop that dims the page and holds the sheet at the bottom", () => {
    expect(sheet()).toMatch(/^<div class="fixed inset-0 z-40 flex items-end justify-center bg-overlay"/);
  });

  it("is a modal dialog named by its title, and described when it has a description", () => {
    const out = sheet({ describedBy: "d" });
    expect(out).toContain('role="dialog"');
    expect(out).toContain('aria-modal="true"');
    expect(out).toContain('aria-labelledby="t"');
    expect(out).toContain('aria-describedby="d"');
    expect(sheet()).not.toContain("aria-describedby");
  });

  it("is a panel that scrolls on its own, does not pass its scrolling on to the page, and clears the home indicator", () => {
    const panel = /<div role="dialog"[^>]*class="([^"]*)"/.exec(sheet())?.[1] ?? "";
    for (const wanted of [
      "max-h-dvh",
      "w-full",
      "max-w-md",
      "overflow-y-auto",
      "overscroll-contain",
      "rounded-t-2xl",
      "bg-surface",
      "p-5",
      "pb-safe",
    ]) {
      expect(panel.split(" ")).toContain(wanted);
    }
  });

  it("can take focus itself, but is not in the tab order", () => {
    expect(sheet()).toMatch(/<div role="dialog"[^>]*tabindex="-1"/);
  });

  it("has a grab bar on top, 4 by 36 px, hidden from screen readers", () => {
    expect(sheet()).toMatch(/<div aria-hidden="true" class="[^"]*\bh-1\b[^"]*\bw-9\b[^"]*\bbg-line\b[^"]*"><\/div>/);
  });

  it("shows what it is given", () => {
    const out = sheet();
    expect(out).toContain('<h2 id="t">Title</h2>');
    expect(out).toContain("<p>Body</p>");
  });
});

describe("the Sheet source", () => {
  it("leaves what a key means, and the page lock, to the helpers (tested in tests/domain)", () => {
    const code = withoutComments(source("src/components/ui/Sheet.tsx"));
    expect(code).toMatch(/import \{ sheetKeyAction \} from "@\/lib\/sheet-keys"/);
    expect(code).toMatch(/import \{ sheetLock \} from "@\/lib\/page-lock"/);
    expect(code).toMatch(/sheetKeyAction\(/);
    expect(code).toMatch(/sheetLock\.acquire\(\)/);
    expect(code).toMatch(/sheetLock\.release\(\)/);
    expect(code).not.toContain("classList");
    expect(code).not.toContain('"Escape"');
  });
});

describe("globals.css for sheets", () => {
  const css = source("src/app/globals.css");

  it("stops the page behind an open sheet from scrolling", () => {
    expect(css).toMatch(/html\.sheet-open,\s*html\.sheet-open body\s*\{\s*overflow:\s*hidden;?\s*\}/);
  });

  it("has a bottom padding that clears the home indicator but is never less than 1.25rem", () => {
    expect(css).toMatch(/@utility pb-safe\s*\{\s*padding-bottom:\s*max\(1\.25rem,\s*env\(safe-area-inset-bottom\)\);?\s*\}/);
  });
});

describe("the dialogs", () => {
  it.each(["PaymentSheet", "UndoSheet", "MonthPicker"])("%s is built on Sheet and draws no backdrop of its own", (name) => {
    const code = withoutComments(source(`src/components/${name}.tsx`));
    expect(code).toMatch(/import \{ Sheet \} from "@\/components\/ui\/Sheet"/);
    expect(code).toMatch(/<Sheet\b/);
    expect(code).not.toContain("fixed inset-0");
    expect(code).not.toContain("bg-black");
    expect(code).not.toMatch(/role="dialog"/);
  });

  it("do not scan for buttons or listen for Escape and Tab themselves any more", () => {
    for (const name of ["PaymentSheet", "UndoSheet", "MonthPicker"]) {
      const code = withoutComments(source(`src/components/${name}.tsx`));
      expect(code, name).not.toContain('"Escape"');
      expect(code, name).not.toContain("trapTabIndex");
      expect(code, name).not.toContain("addEventListener");
    }
  });

  it("only the month picker closes from the backdrop", () => {
    expect(withoutComments(source("src/components/MonthPicker.tsx"))).toMatch(/closeOnBackdrop/);
    for (const name of ["PaymentSheet", "UndoSheet"]) {
      expect(withoutComments(source(`src/components/${name}.tsx`)), name).toMatch(/closeOnBackdrop=\{false\}/);
    }
  });
});

describe("PaymentSheet on Sheet", () => {
  const props = {
    monthKey: "2026-10",
    monthLabel: "October 2026",
    cards: [card({ status: "pending", entry: null, next: { tenant: "Asha", count: 4, suggestedAmount: 10000, previousAmount: 10000, startsNewCycle: false } })],
    initialPortionId: "p1",
    defaultDate: "2026-10-05",
    onClose: () => {},
  };

  it("is a modal dialog named by its title, with the grab bar", () => {
    const out = html(createElement(PaymentSheet, { ...props, mode: "log" }));
    expect(out).toContain('role="dialog"');
    expect(out).toContain('aria-modal="true"');
    expect(out).toContain('aria-labelledby="sheet-title"');
    expect(out).toContain('<h2 id="sheet-title"');
    expect(out).toContain("overscroll-contain");
    expect(out).toContain("pb-safe");
    expect(out).toContain("bg-overlay");
  });

  it("labels its fields, takes focus in the amount field, and saves with a 48 px button", () => {
    const out = html(createElement(PaymentSheet, { ...props, mode: "log" }));
    expect(out).toMatch(/<label for="[^"]+" class="block text-sm"><span class="text-muted">Amount received \(₹\)<\/span><input [^>]*autofocus=""/i);
    expect(out).toMatch(/<button type="submit"[^>]*class="[^"]*\bmin-h-12\b[^"]*"[^>]*>Save to sheet<\/button>/);
  });

  it("keeps the Close button at least 44 px square", () => {
    const out = html(createElement(PaymentSheet, { ...props, mode: "log" }));
    expect(out).toMatch(/<button [^>]*aria-label="Close"[^>]*class="[^"]*\bmin-h-11\b[^"]*\bmin-w-11\b/);
  });
});

describe("UndoSheet on Sheet", () => {
  const out = html(
    createElement(UndoSheet, { monthKey: "2026-10", monthLabel: "October 2026", card: card(), onClose: () => {}, onDone: () => {} }),
  );

  it("is a modal dialog named by its title and described by what the undo will do", () => {
    expect(out).toContain('role="dialog"');
    expect(out).toContain('aria-labelledby="undo-title"');
    expect(out).toContain('aria-describedby="undo-description"');
    expect(out).toContain('<h2 id="undo-title"');
    expect(out).toMatch(/<p id="undo-description"[^>]*>/);
  });

  it("offers Undo payment as the danger button and Keep as the quiet one", () => {
    expect(out).toMatch(/<button type="button"[^>]*class="[^"]*\bmin-h-12\b[^"]*\bbg-danger-bg\b[^"]*"[^>]*>Undo payment<\/button>/);
    expect(out).toMatch(/<button type="button"[^>]*class="[^"]*\bmin-h-11\b[^"]*\btext-muted\b[^"]*"[^>]*>Keep<\/button>/);
  });
});

describe("MonthPicker on Sheet", () => {
  const out = html(createElement(MonthPicker, { shownKey: "2026-10", currentKey: "2026-10", onPick: () => {}, onClose: () => {} }));

  it("is a modal dialog named Choose month, with a title for screen readers", () => {
    expect(out).toContain('role="dialog"');
    const labelledBy = /role="dialog"[^>]*aria-labelledby="([^"]+)"/.exec(out)?.[1];
    expect(labelledBy).toBeTruthy();
    expect(out).toContain(`<h2 id="${labelledBy}" class="sr-only">Choose month</h2>`);
  });

  it("dims the page with the overlay token", () => {
    expect(out).toContain("bg-overlay");
    expect(out).not.toContain("bg-black");
  });

  it("still has the year arrows, twelve months and a Close button", () => {
    expect(out).toContain('aria-label="Previous year"');
    expect(out).toContain('aria-label="Next year"');
    expect(out.match(/aria-pressed=/g)).toHaveLength(12);
    expect(out).toMatch(/>Close<\/button>/);
  });
});
