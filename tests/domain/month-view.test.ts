import { describe, expect, it } from "vitest";
import {
  deriveMonthView,
  findPriorEntry,
  hasLaterEntry,
  LATER_ENTRY_REASON,
} from "@/lib/domain/month-view";
import { summarize, type Tenancy } from "@/lib/domain/tenancy";
import type { YearMonth } from "@/lib/domain/types";
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
    entries: new Map([["p1", e]]),
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

/**
 * PINNED before vacancy existed (wave 3, task 3-8): what the owner's month screens show when no tenancy in the Tenants tab
 * has a move-out date. The numbers are written out by hand from what the app computed before the vacancy rule was added;
 * they must never move. Two Schedules (the base one, and the base one with October and November entries), six months each
 * (August 2026 to January 2027), with no tenancies at all and with open tenancies (one of them for another name than the
 * Schedule's).
 */
describe("the owner's month views with no move-out in the Tenants tab (pinned)", () => {
  const openTenancy = (id: string, portionId: string, tenant: string, rowNumber: number): Tenancy => ({
    rowNumber,
    id,
    portionId,
    tenant,
    phone: "",
    moveIn: "2026-01-15",
    agreementEnd: "",
    advance: null,
    advanceDate: "",
    advanceStatus: null,
    refund: null,
    deductions: null,
    notes: "",
    moveOut: "",
    updatedBy: "owner@example.com",
    updatedAt: "2026-01-15T05:00:00.000Z",
  });
  // p3's open tenancy is for "Zed", not the Schedule's Chitra; p4 never had a tenant.
  const OPEN = [
    openTenancy("t-1", "p1", "Asha", 2),
    openTenancy("t-2", "p2", "Bala", 3),
    openTenancy("t-3", "p3", "Zed", 4),
    openTenancy("t-5", "p5", "Esha", 5),
  ];

  const LONGER = [
    ...baseSchedule(),
    scheduleRow(monthCell("text", 2026, 10), [["Asha", 4, 5450], null, null, null, ["Esha", 2, 5100]], 6),
    scheduleRow(monthCell("text", 2026, 11), [["Asha", 5, 5480], null, null, null, null], 7),
  ];

  type Pin = {
    statuses: string[];
    entries: Array<string | null>;
    /** tenant/count/suggestedAmount/previousAmount/startsNewCycle */
    next: Array<string | null>;
    reference: Array<number | null>;
    difference: Array<number | null>;
    undoBlocked: boolean[];
    /** received, due, difference, paidCount */
    totals: [number, number, number, number];
  };

  const NONE = [null, null, null, null, null];
  const ALL_PENDING = ["pending", "pending", "pending", "needs-tenant", "pending"];
  const NEXT_AFTER_SEP = [
    "Asha/4/5450/5450/false",
    "Bala/1/13335/12700/true",
    "Chitra/6/9000/9000/false",
    null,
    "Esha/2/5100/5100/false",
  ];
  const NO_UNDO = [false, false, false, false, false];

  const AUGUST: Pin = {
    statuses: ["paid", "paid", "paid", "needs-tenant", "needs-tenant"],
    entries: ["Asha/2/5450", "Bala/10/12700", "Chitra/4/9000", null, null],
    next: NONE,
    reference: NONE,
    difference: NONE,
    undoBlocked: [true, true, true, false, false],
    totals: [27150, 27150, 0, 3],
  };
  const SEPTEMBER: Pin = {
    statuses: ["paid", "paid", "paid", "needs-tenant", "paid"],
    entries: ["Asha/3/5450", "Bala/11/12700", "Chitra/5/9000", null, "Esha/1/5100"],
    next: ["Asha/3/5450/5450/false", "Bala/11/12700/12700/false", "Chitra/5/9000/9000/false", null, null],
    reference: [5450, 12700, 9000, null, null],
    difference: [0, 0, 0, null, null],
    undoBlocked: NO_UNDO,
    totals: [32250, 32250, 0, 4],
  };
  /** The base Schedule has nothing after September, so every later month looks the same. */
  const BASE_AFTER: Pin = {
    statuses: ALL_PENDING,
    entries: NONE,
    next: NEXT_AFTER_SEP,
    reference: [5450, 13335, 9000, null, 5100],
    difference: NONE,
    undoBlocked: NO_UNDO,
    totals: [0, 32885, 0, 0],
  };
  const LONGER_AFTER_NOV: Pin = {
    statuses: ALL_PENDING,
    entries: NONE,
    next: ["Asha/6/5480/5480/false", "Bala/1/13335/12700/true", "Chitra/6/9000/9000/false", null, "Esha/3/5100/5100/false"],
    reference: [5480, 13335, 9000, null, 5100],
    difference: NONE,
    undoBlocked: NO_UNDO,
    totals: [0, 32915, 0, 0],
  };

  const MONTHS: Array<[string, YearMonth]> = [
    ["August 2026", { year: 2026, month: 8 }],
    ["September 2026", { year: 2026, month: 9 }],
    ["October 2026", { year: 2026, month: 10 }],
    ["November 2026", { year: 2026, month: 11 }],
    ["December 2026", { year: 2026, month: 12 }],
    ["January 2027", { year: 2027, month: 1 }],
  ];

  const PINS: Record<"base" | "longer", Pin[]> = {
    base: [AUGUST, SEPTEMBER, BASE_AFTER, BASE_AFTER, BASE_AFTER, BASE_AFTER],
    longer: [
      AUGUST,
      { ...SEPTEMBER, undoBlocked: [true, false, false, false, true] },
      {
        statuses: ["paid", "pending", "pending", "needs-tenant", "paid"],
        entries: ["Asha/4/5450", null, null, null, "Esha/2/5100"],
        next: NEXT_AFTER_SEP,
        reference: [5450, 13335, 9000, null, 5100],
        difference: [0, null, null, null, 0],
        undoBlocked: [true, false, false, false, false],
        totals: [10550, 32885, 0, 2],
      },
      {
        statuses: ["paid", "pending", "pending", "needs-tenant", "pending"],
        entries: ["Asha/5/5480", null, null, null, null],
        next: ["Asha/5/5450/5450/false", "Bala/1/13335/12700/true", "Chitra/6/9000/9000/false", null, "Esha/3/5100/5100/false"],
        reference: [5450, 13335, 9000, null, 5100],
        difference: [30, null, null, null, null],
        undoBlocked: NO_UNDO,
        totals: [5480, 32885, 30, 1],
      },
      LONGER_AFTER_NOV,
      LONGER_AFTER_NOV,
    ],
  };

  /** What a month view shows about its cards and totals, for comparing with the written-out numbers. */
  function shown(view: ReturnType<typeof deriveMonthView>): Pin {
    return {
      statuses: view.cards.map((c) => c.status),
      entries: view.cards.map((c) => (c.entry ? `${c.entry.tenant}/${c.entry.count}/${c.entry.amount}` : null)),
      next: view.cards.map((c) =>
        c.next ? `${c.next.tenant}/${c.next.count}/${c.next.suggestedAmount}/${c.next.previousAmount}/${c.next.startsNewCycle}` : null,
      ),
      reference: view.cards.map((c) => c.rentReference),
      difference: view.cards.map((c) => c.rentDifference),
      undoBlocked: view.cards.map((c) => c.undoBlockedReason !== null),
      totals: [view.received, view.due, view.difference, view.paidCount],
    };
  }

  describe.each([
    ["base", baseSchedule()],
    ["longer", LONGER],
  ] as const)("the %s Schedule", (name, grid) => {
    const { rows } = parseSchedule(grid, PORTIONS, TOTAL_HEADER);

    it.each(MONTHS.map(([label, month], index) => [label, month, PINS[name][index]] as const))(
      "%s: the statuses, counts, suggested rent, due and received are as they were",
      (_label, month, pin) => {
        expect(shown(deriveMonthView(rows, PORTIONS, month))).toEqual(pin);
        expect(shown(deriveMonthView(rows, PORTIONS, month, []))).toEqual(pin);
        expect(shown(deriveMonthView(rows, PORTIONS, month, OPEN))).toEqual(pin);
      },
    );

    it.each(MONTHS)("%s: details show only for a tenant whose name the card shows", (_label, month) => {
      const ids = (tenancies: Tenancy[]) => deriveMonthView(rows, PORTIONS, month, tenancies).cards.map((c) => c.tenancy?.id ?? null);
      expect(ids([])).toEqual([null, null, null, null, null]);
      // p1, p2 and p5 match their Schedule tenants; p3's open tenancy is for Zed; p4 has no tenant at all
      const expected = ["t-1", "t-2", null, null, month.month === 8 && month.year === 2026 ? null : "t-5"];
      expect(ids(OPEN)).toEqual(expected);
    });
  });
});

describe("vacant cards", () => {
  const NOV = { year: 2026, month: 11 };
  const DEC = { year: 2026, month: 12 };
  const OCT = { year: 2026, month: 10 };

  const ASHA_LEFT: Tenancy = {
    rowNumber: 2,
    id: "t-1",
    portionId: "p1",
    tenant: "Asha",
    phone: "",
    moveIn: "2026-01-15",
    agreementEnd: "",
    advance: null,
    advanceDate: "",
    advanceStatus: null,
    refund: null,
    deductions: null,
    notes: "",
    moveOut: "2026-10-20",
    updatedBy: "owner@example.com",
    updatedAt: "2026-01-15T05:00:00.000Z",
  };

  /** The base Schedule with Asha (p1) and Esha (p5) paid in October. */
  const { rows: withOctober } = parseSchedule(
    [
      ...baseSchedule(),
      scheduleRow(monthCell("text", 2026, 10), [["Asha", 4, 5450], null, null, null, ["Esha", 2, 5100]], 6),
    ],
    PORTIONS,
    TOTAL_HEADER,
  );

  it("keeps October paid and makes November and December vacant, since the move-out", () => {
    const october = card(deriveMonthView(withOctober, PORTIONS, OCT, [ASHA_LEFT]), "p1");
    expect(october).toMatchObject({ status: "paid", entry: { tenant: "Asha", count: 4, amount: 5450 }, vacancy: null });
    for (const month of [NOV, DEC]) {
      expect(card(deriveMonthView(withOctober, PORTIONS, month, [ASHA_LEFT]), "p1")).toEqual({
        portionId: "p1",
        name: "First floor, single bedroom",
        cycleLength: 11,
        status: "vacant",
        entry: null,
        next: null,
        rentReference: null,
        rentDifference: null,
        undoBlockedReason: null,
        tenancy: null,
        vacancy: { since: "2026-10-20", previousTenant: "Asha" },
      });
    }
  });

  it("adds nothing to what is due, and does not count as paid", () => {
    const view = deriveMonthView(withOctober, PORTIONS, NOV, [ASHA_LEFT]);
    // Bala is on a new cycle (13335), Chitra 9000, Esha 5100; Asha is vacant and p4 never had a tenant
    expect(view.due).toBe(13335 + 9000 + 5100);
    expect(view.received).toBe(0);
    expect(view.difference).toBe(0);
    expect(view.paidCount).toBe(0);
    expect(view.cards.map((c) => c.status)).toEqual(["vacant", "pending", "pending", "needs-tenant", "pending"]);
  });

  it("leaves every other card as it was, with a null vacancy", () => {
    const before = deriveMonthView(withOctober, PORTIONS, NOV);
    const after = deriveMonthView(withOctober, PORTIONS, NOV, [ASHA_LEFT]);
    for (const id of ["p2", "p3", "p4", "p5"]) {
      expect(card(after, id)).toEqual({ ...card(before, id), vacancy: null });
    }
  });

  it("gives a card that is not vacant a null vacancy, even without any tenancies", () => {
    const view = deriveMonthView(withOctober, PORTIONS, NOV);
    expect(view.cards.map((c) => c.vacancy)).toEqual([null, null, null, null, null]);
  });

  it("makes November due when the tenant moved out after its 1st, and December vacant", () => {
    const left = { ...ASHA_LEFT, moveOut: "2026-11-02" };
    expect(card(deriveMonthView(withOctober, PORTIONS, NOV, [left]), "p1")).toMatchObject({ status: "pending", vacancy: null });
    expect(card(deriveMonthView(withOctober, PORTIONS, DEC, [left]), "p1")).toMatchObject({
      status: "vacant",
      vacancy: { since: "2026-11-02", previousTenant: "Asha" },
    });
  });

  it("makes November vacant when the tenant moved out on its 1st", () => {
    const left = { ...ASHA_LEFT, moveOut: "2026-11-01" };
    expect(card(deriveMonthView(withOctober, PORTIONS, NOV, [left]), "p1")).toMatchObject({ status: "vacant" });
  });

  it("is not vacant while the portion has an open tenancy, and shows nobody else's details", () => {
    const open: Tenancy = { ...ASHA_LEFT, rowNumber: 3, id: "t-2", tenant: "Hari", moveOut: "" };
    // with an open tenancy the portion is not vacant: Asha's card is pending, and her details are not Hari's
    expect(card(deriveMonthView(withOctober, PORTIONS, NOV, [ASHA_LEFT, open]), "p1")).toMatchObject({ status: "pending", tenancy: null });
  });

  it("has no undo reason for a vacant month, even when a later month has an entry", () => {
    const { rows } = parseSchedule(
      [
        ...baseSchedule(),
        scheduleRow(monthCell("text", 2026, 10), [["Asha", 4, 5450], null, null, null, null], 6),
        scheduleRow(monthCell("text", 2026, 11), [null, null, null, null, null], 7),
        scheduleRow(monthCell("text", 2026, 12), [["Hari", 1, 6000], null, null, null, null], 8),
      ],
      PORTIONS,
      TOTAL_HEADER,
    );
    expect(card(deriveMonthView(rows, PORTIONS, NOV, [ASHA_LEFT]), "p1")).toMatchObject({ status: "vacant", undoBlockedReason: null });
    // and December, where Hari moved in, is paid
    expect(card(deriveMonthView(rows, PORTIONS, DEC, [ASHA_LEFT]), "p1")).toMatchObject({ status: "paid", entry: { tenant: "Hari", count: 1 } });
    // January: the new tenant is not the one who left, so the portion is let again
    expect(card(deriveMonthView(rows, PORTIONS, { year: 2027, month: 1 }, [ASHA_LEFT]), "p1")).toMatchObject({
      status: "pending",
      next: { tenant: "Hari", count: 2 },
    });
  });
});

describe("deriveMonthView with a portion that is switched off", () => {
  const entry = (tenant: string, count: number, amount: number) => ({ tenant, count, amount });
  const rowOf = (month: number, rowNumber: number, p1: ReturnType<typeof entry> | null, p2: ReturnType<typeof entry> | null) => ({
    rowNumber,
    month: { year: 2026, month },
    entries: new Map([["p1", p1], ["p2", p2]]),
  });
  // Dev paid in August and September; October has no entry for p2.
  const history = [
    rowOf(8, 3, entry("Asha", 1, 5000), entry("Dev", 1, 7000)),
    rowOf(9, 4, entry("Asha", 2, 5000), entry("Dev", 2, 7000)),
    rowOf(10, 5, entry("Asha", 3, 5000), null),
  ];
  const portions = [{ ...PORTIONS[0] }, { ...PORTIONS[1], inactive: true }];
  const left = (moveOut: string): Tenancy => ({
    rowNumber: 2,
    id: "t-dev",
    portionId: "p2",
    tenant: "Dev",
    phone: "",
    moveIn: "2026-01-01",
    agreementEnd: "",
    advance: null,
    advanceDate: "",
    advanceStatus: null,
    refund: null,
    deductions: null,
    notes: "",
    moveOut,
    updatedBy: "owner@example.com",
    updatedAt: "2026-09-30T05:00:00.000Z",
  });

  it("has no card for it from the month it is vacant, so nothing is due for it", () => {
    const tenancies = [left("2026-09-30")];
    const view = deriveMonthView(history, portions, { year: 2026, month: 10 }, tenancies);
    expect(view.cards.map((c) => c.portionId)).toEqual(["p1"]);
    expect(view.due).toBe(5000);
    expect(view.received).toBe(5000);
    expect(deriveMonthView(history, portions, { year: 2026, month: 11 }, tenancies).cards.map((c) => c.portionId)).toEqual(["p1"]);
  });

  it("keeps a card for it in a month where its tenant is still there and nothing is logged, so a slip never hides rent", () => {
    // no move-out on file: the Schedule's last tenant is still the tenant in October, November and every month after
    for (const month of [10, 11, 12]) {
      const view = deriveMonthView(history, portions, { year: 2026, month });
      expect(view.cards.map((c) => c.portionId)).toEqual(["p1", "p2"]);
      expect(card(view, "p2")).toMatchObject({ status: "pending", inactive: true, next: { tenant: "Dev", count: 3, suggestedAmount: 7000 }, rentReference: 7000 });
    }
    const october = deriveMonthView(history, portions, { year: 2026, month: 10 });
    expect(october.due).toBe(5000 + 7000);
    expect(october.received).toBe(5000);
    expect(october.paidCount).toBe(1);
  });

  it("keeps a card for the months before the move-out that have no entry, and the one the tenant left in", () => {
    // moved out on 20 October: October is still due (the tenant lived there after the 1st), November is vacant
    const tenancies = [left("2026-10-20")];
    expect(deriveMonthView(history, portions, { year: 2026, month: 10 }, tenancies).cards.map((c) => c.portionId)).toEqual(["p1", "p2"]);
    expect(deriveMonthView(history, portions, { year: 2026, month: 11 }, tenancies).cards.map((c) => c.portionId)).toEqual(["p1"]);
    // moved out on the 1st: October is already vacant
    expect(deriveMonthView(history, portions, { year: 2026, month: 10 }, [left("2026-10-01")]).cards.map((c) => c.portionId)).toEqual(["p1"]);
  });

  it("has no card for a switched-off portion that never had a tenant", () => {
    const never = [{ ...PORTIONS[0] }, { ...PORTIONS[3], inactive: true }];
    const sheet = [{ rowNumber: 3, month: { year: 2026, month: 10 }, entries: new Map([["p1", entry("Asha", 1, 5000)], ["p4", null]]) }];
    const view = deriveMonthView(sheet, never, { year: 2026, month: 10 });
    expect(view.cards.map((c) => c.portionId)).toEqual(["p1"]);
  });

  it("has a paid card for it, marked switched off, in a month where it has an entry", () => {
    const view = deriveMonthView(history, portions, { year: 2026, month: 9 });
    expect(view.cards.map((c) => c.portionId)).toEqual(["p1", "p2"]);
    expect(card(view, "p2")).toMatchObject({
      status: "paid",
      inactive: true,
      entry: { tenant: "Dev", count: 2, amount: 7000 },
      rentReference: 7000,
      rentDifference: 0,
      vacancy: null,
    });
    expect(card(view, "p1")).not.toHaveProperty("inactive");
    expect(view.received).toBe(12000);
    expect(view.due).toBe(12000);
    expect(view.paidCount).toBe(2);
  });

  it("blocks the undo of an entry that a later month follows, as for any portion", () => {
    const view = deriveMonthView(history, portions, { year: 2026, month: 8 });
    expect(card(view, "p2").undoBlockedReason).toBe(LATER_ENTRY_REASON);
  });

  it("gives every card of a Sheet with nothing switched off exactly the cards it gave before (no inactive key)", () => {
    const view = deriveMonthView(rows, PORTIONS, { year: 2026, month: 10 });
    expect(view.cards.every((c) => !("inactive" in c))).toBe(true);
    expect(view.cards).toHaveLength(5);
  });
});
