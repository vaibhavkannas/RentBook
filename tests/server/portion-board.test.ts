import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PortionCard } from "@/lib/domain/types";
import { smallTargets, unpressedTargets } from "../support/tap-targets";
import { withoutComments } from "../support/source-scan";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

import PortionBoard from "@/components/PortionBoard";

const card = (portionId: string, status: PortionCard["status"], overrides: Partial<PortionCard> = {}): PortionCard => ({
  portionId,
  name: `Portion ${portionId}`,
  cycleLength: 11,
  status,
  entry: status === "paid" ? { tenant: "Asha", count: 3, amount: 5450 } : null,
  next: status === "pending" ? { tenant: "Bala", count: 2, suggestedAmount: 6000, previousAmount: 6000, startsNewCycle: false } : null,
  undoBlockedReason: null,
  tenancy: null,
  rentReference: null,
  rentDifference: null,
  ...overrides,
});

const CARDS = [card("p1", "paid"), card("p2", "pending"), card("p3", "pending"), card("p4", "vacant", { vacancy: null }), card("p5", "needs-tenant")];
const board = (cards = CARDS) =>
  renderToStaticMarkup(createElement(PortionBoard, { monthKey: "2026-10", cards, defaultDate: "2026-10-05" }));

describe("the filter chips", () => {
  const out = board();
  const group = out.match(/<div role="group" aria-label="Filter portions"[\s\S]*?<\/div>/)![0];

  it("are a group of four buttons: All, Pending, Paid and Vacant, with their counts", () => {
    const chips = [...group.matchAll(/<button[^>]*aria-pressed="(true|false)"[^>]*>([\s\S]*?)<\/button>/g)].map((m) => ({
      pressed: m[1],
      text: m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
    }));
    expect(chips).toEqual([
      { pressed: "true", text: "All 5" },
      { pressed: "false", text: "Pending 2" },
      { pressed: "false", text: "Paid 1" },
      { pressed: "false", text: "Vacant 2" },
    ]);
  });

  it("keep a swipe on them for themselves, so scrolling the chips does not change the month", () => {
    expect(group).toContain("data-no-swipe");
  });

  it("show every portion at first", () => {
    expect(out.match(/aria-expanded=/g)).toHaveLength(5);
  });
});

describe("the portion rows", () => {
  const out = board();

  it("are closed to begin with, and each button says so (aria-expanded) and names the details it opens (aria-controls)", () => {
    const buttons = [...out.matchAll(/<button type="button" aria-expanded="(true|false)" aria-controls="([^"]+)"/g)];
    expect(buttons).toHaveLength(5);
    for (const [, expanded, controls] of buttons) {
      expect(expanded).toBe("false");
      expect(out).toContain(`id="${controls}" class="accordion" data-open="false"`);
    }
    expect(new Set(buttons.map((m) => m[2])).size).toBe(5);
  });

  it("put the button in a heading, so the portions can be found by their names", () => {
    expect(out.match(/<h2><button type="button" aria-expanded/g)).toHaveLength(5);
  });

  it("keep the details in the page while closed, for the height to animate, with their actions in them", () => {
    expect(out).toContain("Log payment");
    expect(out).toContain("Edit amount");
    expect(out).toContain("Add tenant");
  });

  it("give every button and link 44 px and a press", () => {
    expect(smallTargets(out)).toEqual([]);
    expect(unpressedTargets(out)).toEqual([]);
  });

  it("say the empty case in words when nothing matches a chip (the chips themselves are client state)", () => {
    expect(board([])).toContain("Nothing here for this filter.");
  });
});

describe("a tap on a row", () => {
  it("draws the rows that change and not the screen: rows are memoised and read the open row from a store", () => {
    const row = withoutComments(readFileSync(new URL("../../src/components/PortionRow.tsx", import.meta.url), "utf8"));
    expect(row).toMatch(/export default memo\(PortionRow\)/);
    expect(row).toMatch(/useSyncExternalStore\(\s*store\.subscribe/);
    const boardCode = withoutComments(readFileSync(new URL("../../src/components/PortionBoard.tsx", import.meta.url), "utf8"));
    expect(boardCode).not.toMatch(/useState<string \| null>/);
  });
});

describe("motion on the month screen", () => {
  const css = readFileSync(new URL("../../src/app/globals.css", import.meta.url), "utf8");

  it("asks for no motion from the accordion and the month slide where the device asks for less", () => {
    const reduced = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1]).join("\n");
    expect(reduced).toMatch(/\.accordion[\s\S]*transition:\s*none/);
    expect(reduced).toMatch(/\.month-in[\s\S]*animation:\s*none/);
    expect(reduced).toMatch(/transition:\s*none/);
  });

  it("opens a row by its height with a grid, not by measuring it", () => {
    expect(css).toMatch(/\.accordion\s*\{[^}]*grid-template-rows:\s*0fr/);
    expect(css).toMatch(/\.accordion\[data-open="true"\]\s*\{[^}]*grid-template-rows:\s*1fr/);
  });

  it("slides a month in with a transform and opacity only", () => {
    const frames = [...css.matchAll(/@keyframes month-in-(?:next|prev)\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1]);
    expect(frames).toHaveLength(2);
    for (const frame of frames) expect(frame.replace(/(opacity|transform)\s*:[^;]+;/g, "")).toMatch(/^\s*from\s*\{\s*\}\s*$/);
  });

  it("uses no transition in a component that is not for a transform or opacity, and every animation has a reduced-motion form", () => {
    const root = new URL("../../src/", import.meta.url).pathname;
    for (const file of readdirSync(root, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".tsx"))) {
      const code = withoutComments(readFileSync(path.join(root, file), "utf8"));
      for (const [name] of code.matchAll(/\btransition-(?!none)[a-z-]+/g)) {
        expect(["transition-opacity", "transition-transform"], `${file}: ${name}`).toContain(name);
      }
      for (const [name] of code.matchAll(/(?<![:\w-])animate-(?!none)[a-z]+/g)) {
        expect(code, `${file}: ${name} needs motion-safe: or motion-reduce:`).toMatch(/motion-(safe|reduce):/);
      }
    }
  });
});
