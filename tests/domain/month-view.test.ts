import { describe, expect, it } from "vitest";
import {
  deriveMonthView,
  findPriorEntry,
  hasLaterEntry,
  LATER_ENTRY_REASON,
} from "@/lib/domain/month-view";
import { parseSchedule } from "@/lib/sheets/schedule";
import { baseSchedule, PORTIONS, TOTAL_HEADER } from "../support/fixtures";

const { rows } = parseSchedule(baseSchedule(), PORTIONS, TOTAL_HEADER);
const card = (view: ReturnType<typeof deriveMonthView>, id: string) =>
  view.cards.find((c) => c.portionId === id)!;

describe("deriveMonthView for a month with no entries yet (Oct-26)", () => {
  const view = deriveMonthView(rows, PORTIONS, { year: 2026, month: 10 });

  it("continues the count inside a cycle with the same rent", () => {
    expect(card(view, "p1")).toMatchObject({
      status: "pending",
      next: { tenant: "Asha", count: 4, suggestedAmount: 5450, startsNewCycle: false },
    });
  });

  it("starts a new cycle with the hike suggestion after payment 11", () => {
    expect(card(view, "p2")).toMatchObject({
      status: "pending",
      next: { count: 1, previousAmount: 12700, suggestedAmount: 13335, startsNewCycle: true },
    });
  });

  it("asks for a tenant when the portion never had one", () => {
    expect(card(view, "p4")).toMatchObject({ status: "needs-tenant", next: null });
  });

  it("totals what is expected and what is received", () => {
    expect(view.received).toBe(0);
    expect(view.paidCount).toBe(0);
    expect(view.expected).toBe(5450 + 13335 + 9000 + 5100);
  });
});

describe("deriveMonthView for a month that is already recorded (Sep-26)", () => {
  const view = deriveMonthView(rows, PORTIONS, { year: 2026, month: 9 });

  it("marks recorded portions paid and derives the count from earlier months", () => {
    expect(card(view, "p1")).toMatchObject({
      status: "paid",
      entry: { tenant: "Asha", count: 3, amount: 5450 },
      next: { count: 3 },
    });
  });

  it("shows a portion that started this month as paid with no earlier history", () => {
    expect(card(view, "p5")).toMatchObject({ status: "paid", next: null });
  });

  it("sums received and expected from recorded amounts", () => {
    expect(view.received).toBe(5450 + 12700 + 9000 + 5100);
    expect(view.expected).toBe(view.received);
    expect(view.paidCount).toBe(4);
  });
});

describe("per-portion cycle settings", () => {
  it("never resets when cycleLength is null", () => {
    const portions = PORTIONS.map((p) => ({ ...p, cycleLength: null }));
    const view = deriveMonthView(rows, portions, { year: 2026, month: 10 });
    expect(card(view, "p2").next).toMatchObject({
      count: 12,
      suggestedAmount: 12700,
      startsNewCycle: false,
    });
  });
});

describe("findPriorEntry", () => {
  it("ignores the selected month and later months", () => {
    expect(findPriorEntry(rows, "p1", { year: 2026, month: 9 })?.count).toBe(2);
    expect(findPriorEntry(rows, "p1", { year: 2026, month: 8 })).toBeNull();
  });
});

describe("undoBlockedReason", () => {
  const portions = PORTIONS.slice(0, 1);
  const entry = { tenant: "Asha", count: 1, amount: 5000 };
  const rowFor = (month: number, e: typeof entry | null, rowNumber: number) => ({
    rowNumber,
    month: { year: 2026, month },
    entries: { p1: e },
  });

  it("is null when the paid month is the portion's latest entry", () => {
    const rows = [rowFor(9, entry, 4), rowFor(10, entry, 5)];
    const view = deriveMonthView(rows, portions, { year: 2026, month: 10 });
    expect(view.cards[0].status).toBe("paid");
    expect(view.cards[0].undoBlockedReason).toBeNull();
  });

  it("explains why when a later month has an entry", () => {
    const rows = [rowFor(9, entry, 4), rowFor(10, entry, 5)];
    const view = deriveMonthView(rows, portions, { year: 2026, month: 9 });
    expect(view.cards[0].undoBlockedReason).toBe(LATER_ENTRY_REASON);
  });

  it("is null for a card that is not paid, even when a later month has an entry", () => {
    const rows = [rowFor(8, entry, 3), rowFor(9, null, 4), rowFor(10, entry, 5)];
    const view = deriveMonthView(rows, portions, { year: 2026, month: 9 });
    expect(view.cards[0].status).toBe("pending");
    expect(view.cards[0].undoBlockedReason).toBeNull();
  });

  it("hasLaterEntry ignores earlier months and empty later rows", () => {
    const rows = [rowFor(8, entry, 3), rowFor(9, entry, 4), rowFor(10, null, 5)];
    expect(hasLaterEntry(rows, "p1", { year: 2026, month: 9 })).toBe(false);
    expect(hasLaterEntry(rows, "p1", { year: 2026, month: 8 })).toBe(true);
  });
});
