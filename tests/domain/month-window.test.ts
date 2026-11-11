import { describe, expect, it } from "vitest";
import type { MonthView, PortionConfig } from "@/lib/domain/types";
import { addMonths, parseYmKey, ymKey } from "@/lib/domain/year-month";
import { canSwitchHere, monthWindow, WINDOW_AFTER, WINDOW_BEFORE, windowViews } from "@/lib/month-window";
import { baseRows, PORTIONS } from "../support/fixtures";

const ym = (key: string) => parseYmKey(key)!;

describe("the window of months the month screen carries", () => {
  it("runs from 11 months before the current month to 2 after, oldest first", () => {
    const keys = monthWindow(ym("2026-10"), ym("2026-10"));
    expect(WINDOW_BEFORE).toBe(11);
    expect(WINDOW_AFTER).toBe(2);
    expect(keys).toHaveLength(14);
    expect(keys[0]).toBe("2025-11");
    expect(keys[13]).toBe("2026-12");
    expect(keys).toContain("2026-10");
  });

  it("crosses a year end both ways", () => {
    const keys = monthWindow(ym("2026-01"), ym("2026-01"));
    expect(keys[0]).toBe("2025-02");
    expect(keys.at(-1)).toBe("2026-03");
  });

  it("adds a requested month that lies outside it, in its place, so the page always has what the address asked for", () => {
    const early = monthWindow(ym("2026-10"), ym("2024-03"));
    expect(early[0]).toBe("2024-03");
    expect(early).toHaveLength(15);
    const late = monthWindow(ym("2026-10"), ym("2027-06"));
    expect(late.at(-1)).toBe("2027-06");
    expect(late).toHaveLength(15);
    expect([...late].sort()).toEqual(late);
  });

  it("does not repeat a requested month that is already inside", () => {
    expect(new Set(monthWindow(ym("2026-10"), ym("2026-03"))).size).toBe(14);
  });

  it("says a month can be switched to on the spot only when the page carries it", () => {
    const views = { "2026-09": {} as MonthView, "2026-10": {} as MonthView };
    expect(canSwitchHere(views, "2026-09")).toBe(true);
    expect(canSwitchHere(views, "2026-08")).toBe(false);
    expect(canSwitchHere(views, "nonsense")).toBe(false);
  });
});

describe("the views of the window", () => {
  const portions: PortionConfig[] = PORTIONS;

  it("derives one view per month of the window from the one snapshot, with no further read", () => {
    const keys = monthWindow(ym("2026-10"), ym("2026-10"));
    const views = windowViews({ rows: baseRows(), portions, tenancies: [] }, keys);
    expect(Object.keys(views)).toEqual(keys);
    for (const key of keys) expect(ymKey(views[key].month)).toBe(key);
  });

  it("uses the view it was handed for the requested month, so the page and the window agree", () => {
    const keys = monthWindow(ym("2026-10"), ym("2026-10"));
    const handed = { month: ym("2026-10"), cards: [], received: 1, due: 2, difference: 0, paidCount: 0 } satisfies MonthView;
    const views = windowViews({ rows: baseRows(), portions, tenancies: [] }, keys, handed);
    expect(views["2026-10"]).toBe(handed);
    expect(views["2026-09"]).not.toBe(handed);
  });

  it("is pure: the same snapshot gives the same views", () => {
    const keys = [ymKey(addMonths(ym("2026-10"), -1)), "2026-10"];
    const snap = { rows: baseRows(), portions, tenancies: [] };
    expect(windowViews(snap, keys)).toEqual(windowViews(snap, keys));
  });
});
