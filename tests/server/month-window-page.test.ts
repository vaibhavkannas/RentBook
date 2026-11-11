import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MonthView } from "@/lib/domain/types";
import { withSnapshotCache, type SheetsContext } from "@/lib/sheets/service";
import { FakeGateway } from "../support/fake-gateway";
import { baseSchedule, TOTAL_HEADER } from "../support/fixtures";

// The home page carries the months around the one asked for, so the screen can switch on the spot. They all come from the one
// snapshot the page reads: the Sheet is read once per page view, however many months go to the screen.

const seen = vi.hoisted(() => ({ props: null as null | Record<string, unknown>, ctx: null as unknown }));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => undefined }) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
vi.mock("@/lib/server/auth-guard", () => ({ getViewer: async () => ({ email: "member@example.com", isOwner: false }) }));
vi.mock("@/lib/server/context", () => ({ getSheetsContext: () => seen.ctx }));
vi.mock("@/components/MonthScreen", () => ({
  default: (props: Record<string, unknown>) => {
    seen.props = props;
    return null;
  },
}));

import Home from "@/app/(month)/page";

let fake: FakeGateway;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-17T06:30:00Z") });
  fake = new FakeGateway({ Schedule: baseSchedule() });
  seen.ctx = withSnapshotCache({ gateway: fake, scheduleTab: "Schedule", totalHeader: TOTAL_HEADER } as SheetsContext);
  seen.props = null;
});
afterEach(() => vi.useRealTimers());

async function render(month?: string) {
  const page = (await Home({ searchParams: Promise.resolve(month ? { month } : {}) })) as ReactElement;
  renderToStaticMarkup(createElement(() => page));
  return seen.props!;
}

// The snapshot is one getManyValues call; the one-time tab check before the first read is not a read of the figures.
const reads = () => fake.calls.filter((call) => call === "getManyValues");

describe("the home page's window of months", () => {
  it("carries a year back to a quarter ahead of the current month, whichever month is asked for", async () => {
    const props = await render();
    const keys = Object.keys(props.views as Record<string, MonthView>);
    expect(keys[0]).toBe("2025-11");
    expect(keys.at(-1)).toBe("2026-12");
    expect(keys).toHaveLength(14);
    expect(props.monthKey).toBe("2026-10");
    expect(props.currentKey).toBe("2026-10");
  });

  it("adds a requested month outside the window, so the page always has the month the address asked for", async () => {
    const props = await render("2024-03");
    const keys = Object.keys(props.views as Record<string, MonthView>);
    expect(keys[0]).toBe("2024-03");
    expect(keys).toHaveLength(15);
    expect(props.monthKey).toBe("2024-03");
  });

  it("reads the Sheet once for the whole window", async () => {
    await render();
    expect(reads()).toHaveLength(1);
    fake.calls.length = 0;
    // The snapshot is cached for a moment, so a second page view inside it reads nothing either.
    await render("2026-03");
    expect(reads()).toHaveLength(0);
  });

  it("reads the Sheet once for a month far outside the window, too", async () => {
    await render("2020-01");
    expect(reads()).toHaveLength(1);
  });

  it("derives each month's view for that month", async () => {
    const props = await render();
    const views = props.views as Record<string, MonthView>;
    for (const [key, view] of Object.entries(views)) expect(`${view.month.year}-${String(view.month.month).padStart(2, "0")}`).toBe(key);
  });
});
