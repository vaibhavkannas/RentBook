import { describe, expect, it } from "vitest";
import {
  deriveMonthView,
  findPriorEntry,
  hasLaterEntry,
  LATER_ENTRY_REASON,
} from "@/lib/domain/month-view";
import { summarize, type Tenancy } from "@/lib/domain/tenancy";
import { parseSchedule } from "@/lib/sheets/schedule";
import { baseSchedule, monthCell, PORTIONS, scheduleRow, TOTAL_HEADER } from "../support/fixtures";

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

  it("totals the rent due and what is received", () => {
    expect(view.received).toBe(0);
    expect(view.paidCount).toBe(0);
    expect(view.due).toBe(5450 + 13335 + 9000 + 5100);
    expect(view.difference).toBe(0);
  });

  it("gives every pending card the suggested rent as its reference, and no difference", () => {
    expect(card(view, "p1")).toMatchObject({ rentReference: 5450, rentDifference: null });
    expect(card(view, "p2")).toMatchObject({ rentReference: 13335, rentDifference: null });
    expect(card(view, "p4")).toMatchObject({ rentReference: null, rentDifference: null });
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

  it("sums received and due from recorded amounts, with nothing extra or short", () => {
    expect(view.received).toBe(5450 + 12700 + 9000 + 5100);
    expect(view.due).toBe(view.received);
    expect(view.difference).toBe(0);
    expect(view.paidCount).toBe(4);
  });

  it("has a zero difference and a reference for a paid card that paid exactly the rent", () => {
    expect(card(view, "p1")).toMatchObject({ rentReference: 5450, rentDifference: 0 });
  });

  it("has no reference and no difference for a portion that started this month", () => {
    expect(card(view, "p5")).toMatchObject({ rentReference: null, rentDifference: null });
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

describe("card tenancy summary", () => {
  const OCT = { year: 2026, month: 10 };
  const SEP = { year: 2026, month: 9 };

  function tenancy(overrides: Partial<Tenancy> = {}): Tenancy {
    return {
      rowNumber: 2,
      id: "t-1",
      portionId: "p1",
      tenant: "Asha",
      phone: "98765 43210",
      moveIn: "2026-01-15",
      agreementEnd: "2027-01-14",
      advance: 20000,
      advanceDate: "2026-01-10",
      advanceStatus: "Held",
      refund: null,
      deductions: null,
      notes: "",
      moveOut: "",
      updatedBy: "owner@example.com",
      updatedAt: "2026-01-15T05:00:00.000Z",
      ...overrides,
    };
  }

  it("is the summary of the current tenancy when the names match", () => {
    const t = tenancy();
    expect(card(deriveMonthView(rows, PORTIONS, OCT, [t]), "p1").tenancy).toEqual(summarize(t));
  });

  it("matches the name ignoring case and surrounding spaces", () => {
    const t = tenancy({ tenant: "  ASHA " });
    expect(card(deriveMonthView(rows, PORTIONS, OCT, [t]), "p1").tenancy).toEqual(summarize(t));
  });

  it("uses the name on a paid card as well as on a pending one", () => {
    const t = tenancy();
    expect(card(deriveMonthView(rows, PORTIONS, SEP, [t]), "p1")).toMatchObject({ status: "paid", tenancy: summarize(t) });
    expect(card(deriveMonthView(rows, PORTIONS, OCT, [t]), "p1").status).toBe("pending");
  });

  it("is null when the tenancy is for a different tenant name", () => {
    const view = deriveMonthView(rows, PORTIONS, OCT, [tenancy({ tenant: "Bala" })]);
    expect(card(view, "p1").tenancy).toBeNull();
  });

  it("is null for a card with no tenant, even if the portion has a tenancy on file", () => {
    const view = deriveMonthView(rows, PORTIONS, OCT, [tenancy({ portionId: "p4", tenant: "Farah" })]);
    expect(card(view, "p4")).toMatchObject({ status: "needs-tenant", tenancy: null });
  });

  it("ignores a closed tenancy and another portion's tenancy", () => {
    const view = deriveMonthView(rows, PORTIONS, OCT, [
      tenancy({ moveOut: "2026-08-31" }),
      tenancy({ id: "t-2", portionId: "p2", tenant: "Asha" }),
    ]);
    expect(card(view, "p1").tenancy).toBeNull();
    expect(card(view, "p2").tenancy).toBeNull();
  });

  it("uses the last current row of the portion", () => {
    const older = tenancy({ id: "t-old", rowNumber: 2 });
    const newer = tenancy({ id: "t-new", rowNumber: 3, advance: 30000 });
    const view = deriveMonthView(rows, PORTIONS, OCT, [older, newer]);
    expect(card(view, "p1").tenancy).toEqual(summarize(newer));
  });

  it("gives every card a null tenancy when none is passed, and changes nothing else", () => {
    const without = deriveMonthView(rows, PORTIONS, OCT);
    const withEmpty = deriveMonthView(rows, PORTIONS, OCT, []);
    expect(without).toEqual(withEmpty);
    expect(without.cards.map((c) => c.tenancy)).toEqual([null, null, null, null, null]);
    const { cards, ...totals } = deriveMonthView(rows, PORTIONS, OCT, [tenancy()]);
    expect(totals).toEqual({
      month: OCT,
      received: 0,
      due: 5450 + 13335 + 9000 + 5100,
      difference: 0,
      paidCount: 0,
    });
    expect(cards[0]).toMatchObject({ status: "pending", next: { count: 4 } });
  });
});

describe("rent due against received (October after the base schedule)", () => {
  const OCT = { year: 2026, month: 10 };
  type Entry = [tenant: string, count: number, amount: number] | null;

  // After Sep-26 the suggested rent for October is p1 5450, p2 13335 (new cycle, hike), p3 9000,
  // p4 none (no tenant ever), p5 5100.
  const SUGGESTED_TOTAL = 5450 + 13335 + 9000 + 5100;

  /** October with the given entries for p1 to p5. */
  function october(entries: Entry[]) {
    const { rows } = parseSchedule(
      [...baseSchedule(), scheduleRow(monthCell("text", 2026, 10), entries, 6)],
      PORTIONS,
      TOTAL_HEADER,
    );
    return deriveMonthView(rows, PORTIONS, OCT);
  }

  it("shows extra when a tenant paid more than the suggested rent, and does not inflate the due total", () => {
    const view = october([["Asha", 4, 5480], null, null, null, null]);
    expect(card(view, "p1")).toMatchObject({
      status: "paid",
      rentReference: 5450,
      rentDifference: 30,
    });
    expect(view.received).toBe(5480);
    expect(view.due).toBe(SUGGESTED_TOTAL);
    expect(view.difference).toBe(30);
  });

  it("shows a shortfall when a tenant paid less", () => {
    const view = october([["Asha", 4, 5449], null, null, null, null]);
    expect(card(view, "p1")).toMatchObject({ rentReference: 5450, rentDifference: -1 });
    expect(view.received).toBe(5449);
    expect(view.due).toBe(SUGGESTED_TOTAL);
    expect(view.difference).toBe(-1);
  });

  it("shows nothing extra or short when the exact rent was paid", () => {
    const view = october([["Asha", 4, 5450], null, null, null, null]);
    expect(card(view, "p1")).toMatchObject({ rentReference: 5450, rentDifference: 0 });
    expect(view.due).toBe(SUGGESTED_TOTAL);
    expect(view.difference).toBe(0);
  });

  it("measures a payment on a new cycle against the rent with the hike", () => {
    const view = october([null, ["Bala", 1, 13365], null, null, null]);
    expect(card(view, "p2")).toMatchObject({ rentReference: 13335, rentDifference: 30 });
    expect(view.due).toBe(SUGGESTED_TOTAL);
    expect(view.difference).toBe(30);
  });

  it("has no reference for a portion with no earlier entry: due is the amount entered", () => {
    const view = october([null, null, null, ["Dev", 1, 7000], null]);
    expect(card(view, "p4")).toMatchObject({
      status: "paid",
      next: null,
      rentReference: null,
      rentDifference: null,
    });
    expect(view.received).toBe(7000);
    expect(view.due).toBe(5450 + 13335 + 9000 + 7000 + 5100);
    expect(view.difference).toBe(0);
  });

  it("has no reference for a new tenant's first payment on a portion that had another tenant", () => {
    const view = october([["Farah", 1, 7000], null, null, null, null]);
    expect(card(view, "p1")).toMatchObject({
      status: "paid",
      rentReference: null,
      rentDifference: null,
    });
    expect(view.due).toBe(7000 + 13335 + 9000 + 5100);
    expect(view.difference).toBe(0);
  });

  it("still has a reference when the same tenant is written with other capitals or spaces", () => {
    const view = october([[" ASHA ", 4, 5480], null, null, null, null]);
    expect(card(view, "p1")).toMatchObject({ rentReference: 5450, rentDifference: 30 });
  });

  it("adds up extra and short across paid cards, and counts pending cards at the suggested rent", () => {
    const view = october([["Asha", 4, 5480], ["Bala", 1, 13300], null, null, null]);
    expect(card(view, "p1").rentDifference).toBe(30);
    expect(card(view, "p2").rentDifference).toBe(-35);
    expect(card(view, "p3")).toMatchObject({ status: "pending", rentReference: 9000, rentDifference: null });
    expect(card(view, "p5")).toMatchObject({ status: "pending", rentReference: 5100, rentDifference: null });
    expect(view.received).toBe(5480 + 13300);
    // due uses the suggested rent for every portion that has one, paid or not
    expect(view.due).toBe(SUGGESTED_TOTAL);
    expect(view.difference).toBe(-5);
    expect(view.paidCount).toBe(2);
  });

  it("leaves pending portions out of the difference and counts a paid portion with no reference at its amount", () => {
    const view = october([["Asha", 4, 5480], null, null, ["Dev", 1, 7000], null]);
    expect(view.received).toBe(5480 + 7000);
    expect(view.due).toBe(5450 + 13335 + 9000 + 7000 + 5100);
    expect(view.difference).toBe(30);
  });

  it("keeps the statuses as they were", () => {
    const view = october([["Asha", 4, 5480], null, null, null, null]);
    expect(view.cards.map((c) => c.status)).toEqual([
      "paid",
      "pending",
      "pending",
      "needs-tenant",
      "pending",
    ]);
    expect(view.paidCount).toBe(1);
  });

  it("lets extra and short cancel in the total while each paid card still has its own difference", () => {
    const view = october([["Asha", 4, 5451], ["Bala", 1, 13349], null, null, null]);
    expect(card(view, "p1")).toMatchObject({ rentReference: 5450, rentDifference: 1 });
    expect(card(view, "p2")).toMatchObject({ rentReference: 13335, rentDifference: 14 });
    expect(view.difference).toBe(15);
  });

  describe("a rent rounded after the hike", () => {
    it("is the rent itself: rounding the hike down to the nearest 5 shows no short amount", () => {
      const view = october([null, ["Bala", 1, 13335 - 5], null, null, null]);
      expect(card(view, "p2")).toMatchObject({ rentReference: 13330, rentDifference: 0 });
      expect(view.received).toBe(13330);
      expect(view.due).toBe(5450 + 13330 + 9000 + 5100);
      expect(view.difference).toBe(0);
    });

    it("is the rent itself: rounding the hike up to the nearest 10 shows no extra amount", () => {
      const view = october([null, ["Bala", 1, 13340], null, null, null]);
      expect(card(view, "p2")).toMatchObject({ rentReference: 13340, rentDifference: 0 });
      expect(view.due).toBe(5450 + 13340 + 9000 + 5100);
      expect(view.difference).toBe(0);
    });

    it("still flags an amount further than the allowance from the hike", () => {
      const view = october([null, ["Bala", 1, 13346], null, null, null]);
      expect(card(view, "p2")).toMatchObject({ rentReference: 13335, rentDifference: 11 });
      const short = october([null, ["Bala", 1, 13324], null, null, null]);
      expect(card(short, "p2")).toMatchObject({ rentReference: 13335, rentDifference: -11 });
    });

    it("does not apply inside a cycle: a rent that is not a new hike is exact", () => {
      const view = october([["Asha", 4, 5445], null, null, null, null]);
      expect(card(view, "p1")).toMatchObject({ rentReference: 5450, rentDifference: -5 });
    });

    it("never changes the suggested amount of a card that has not paid", () => {
      const view = october([null, null, null, null, null]);
      expect(card(view, "p2")).toMatchObject({ rentReference: 13335, rentDifference: null });
      expect(view.due).toBe(SUGGESTED_TOTAL);
    });
  });

  it("makes received minus due equal the difference once every portion has paid", () => {
    const view = october([
      ["Asha", 4, 5500],
      ["Bala", 1, 13000],
      ["Chitra", 6, 9000],
      ["Dev", 1, 7000],
      ["Esha", 2, 5100],
    ]);
    expect(view.cards.every((c) => c.status === "paid")).toBe(true);
    expect(view.difference).toBe(50 - 335);
    expect(view.received - view.due).toBe(view.difference);
  });
});
