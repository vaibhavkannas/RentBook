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

  it("offers the way back to this month, except on it", () => {
    expect(render("2026-09")).toContain(">Today</button>");
    expect(render("2026-10")).not.toContain(">Today</button>");
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
