import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MonthView, PortionCard } from "@/lib/domain/types";
import { smallTargets, unpressedTargets } from "../support/tap-targets";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

import MonthScreen from "@/components/MonthScreen";
import RefreshButton from "@/components/RefreshButton";
import UpdatedLabel from "@/components/UpdatedLabel";
import { createRefreshStore, refreshLook, updatedLabel } from "@/lib/refresh-status";
import { framedIconButtonClasses } from "@/lib/ui-classes";

const card = (name: string): PortionCard => ({
  portionId: "p1",
  name,
  cycleLength: 11,
  status: "pending",
  entry: null,
  next: { tenant: "Asha", count: 4, suggestedAmount: 5450, previousAmount: 5450, startsNewCycle: false },
  undoBlockedReason: null,
  tenancy: null,
  rentReference: 5450,
  rentDifference: null,
});
const view = (month: number, name: string): MonthView => ({
  month: { year: 2026, month },
  cards: [card(name)],
  received: 0,
  due: 5450,
  difference: 0,
  paidCount: 0,
});

const render = (monthKey: string, extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    createElement(MonthScreen, {
      monthKey,
      currentKey: "2026-10",
      today: "2026-10-17",
      renderedAt: Date.parse("2026-10-17T06:30:00Z"),
      views: { "2026-09": view(9, "Sept card"), "2026-10": view(10, "Oct card"), "2026-11": view(11, "Nov card") },
      attention: createElement("p", null, "ATTENTION"),
      problem: null,
      ...extra,
    }),
  );

describe("the month screen", () => {
  it("shows the month that was asked for, from the views the page carries", () => {
    expect(render("2026-09")).toContain("Sept card");
    expect(render("2026-09")).not.toContain("Oct card");
    expect(render("2026-11")).toContain("November 2026");
  });

  it("shows the Needs attention card on the current month only", () => {
    expect(render("2026-10")).toContain("ATTENTION");
    expect(render("2026-09")).not.toContain("ATTENTION");
  });

  it("offers the way back to this month, in the place of the refresh button, except on it", () => {
    expect(render("2026-09")).toContain(">This month</button>");
    expect(render("2026-09")).not.toContain('aria-label="Refresh"');
    expect(render("2026-10")).not.toContain(">This month</button>");
    expect(render("2026-10")).toContain('aria-label="Refresh"');
  });

  it("puts the arrows, the title and the refresh button on one line, the button last", () => {
    const html = render("2026-10");
    const line = html.match(/<div class="flex flex-wrap items-center justify-between[^"]*">([\s\S]*?)<\/div>\s*<p role="status"/)?.[1] ?? "";
    const at = (needle: string) => line.indexOf(needle);
    expect(at('aria-label="Previous month"')).toBeGreaterThan(-1);
    expect(at('aria-label="Previous month"')).toBeLessThan(at("October 2026"));
    expect(at("October 2026")).toBeLessThan(at('aria-label="Next month"'));
    expect(at('aria-label="Next month"')).toBeLessThan(at('aria-label="Refresh"'));
    // the refresh button is round and 44 px, with its words for a screen reader
    const button = html.match(/<button type="button" aria-busy="false" aria-label="Refresh" class="([^"]*)"/)![1].split(" ");
    expect(button).toEqual(expect.arrayContaining(["rounded-full", "min-h-11", "min-w-11", "press"]));
  });

  it("says how fresh the figures are, in the summary's meta line", () => {
    const summary = render("2026-10").match(/<section aria-label="Month summary"[\s\S]*?<\/section>/)![0];
    expect(summary).toMatch(/portions paid<span class="whitespace-nowrap"> · (<!-- -->)?Updated just now<\/span>/);
  });

  it("shows only the problem, with the arrows, when the Sheet could not be read", () => {
    const html = render("2026-10", { views: {}, problem: createElement("p", null, "THE PROBLEM") });
    expect(html).toContain("THE PROBLEM");
    expect(html).toContain('aria-label="Next month"');
    expect(html).not.toContain("Month summary");
  });

  it("gives the header's buttons 44 px and a press", () => {
    const nav = render("2026-09").match(/<nav[\s\S]*?<\/nav>/)![0];
    expect(smallTargets(nav)).toEqual([]);
    expect(unpressedTargets(nav)).toEqual([]);
  });
});

describe("the refresh button and the Updated words", () => {
  const html = (store = createRefreshStore()) => ({
    button: renderToStaticMarkup(createElement(RefreshButton, { store })),
    label: renderToStaticMarkup(createElement(UpdatedLabel, { store, renderedAt: 1_000_000 })),
    store,
  });

  it("show an idle button with the refresh icon and nothing said aloud, and the words 'Updated just now'", () => {
    const { button, label } = html();
    expect(button).toContain('aria-label="Refresh"');
    expect(button).toContain('aria-busy="false"');
    expect(button).not.toContain("refresh-turn");
    expect(button).toContain('<span role="status" class="sr-only"></span>');
    expect(label).toContain("Updated just now");
  });

  it("turn the icon once and say Updating while the page loads again, then show a green check", () => {
    // The server draws every button idle (the same first draw as the browser's); what each phase shows is decided here.
    expect(refreshLook("idle")).toEqual({ icon: "rotate", turning: false, frame: "round", announcement: "" });
    expect(refreshLook("updating")).toEqual({ icon: "rotate", turning: true, frame: "round", announcement: "Updating" });
    expect(refreshLook("done")).toEqual({ icon: "check", turning: false, frame: "round-done", announcement: "Updated" });
    expect(updatedLabel(0, 0, "updating")).toBe("Updating…");
    expect(framedIconButtonClasses(refreshLook("done").frame)).toContain("bg-success-bg text-success-ink");
  });

  it("keep the button the same 44 px square in every state, so nothing moves while it animates", () => {
    for (const phase of ["idle", "updating", "done"] as const) {
      const classes = framedIconButtonClasses(refreshLook(phase).frame);
      expect(classes).toContain("min-h-11 min-w-11");
      expect(classes).toContain("border");
    }
  });

  it("draw only the turn of the icon as motion: a transform, in globals.css, off for reduced motion", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync(new URL("../../src/app/globals.css", import.meta.url), "utf8");
    expect(css).toMatch(/@keyframes refresh-turn\s*\{\s*to\s*\{\s*transform:\s*rotate\(360deg\);\s*\}\s*\}/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.refresh-turn\s*\{\s*animation:\s*none/);
  });
});
