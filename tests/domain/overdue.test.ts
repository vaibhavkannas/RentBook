import { describe, expect, it, vi } from "vitest";
import { deriveMonthView } from "@/lib/domain/month-view";
import { overdueList, overdueTotals, type OverdueItem } from "@/lib/domain/overdue";
import type { Tenancy } from "@/lib/domain/tenancy";
import type { PortionConfig, RentSnapshot, ScheduleRow, YearMonth } from "@/lib/domain/types";
import { addMonths, compareYm } from "@/lib/domain/year-month";
import { parseSchedule } from "@/lib/sheets/schedule";
import { baseRows, baseSchedule, parsedRows, PORTIONS, tenancyRow, TOTAL_HEADER } from "../support/fixtures";

// Wrapped so the cost test can count the calls; it still does the real work.
vi.mock("@/lib/domain/month-view", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/domain/month-view")>();
  return { ...actual, deriveMonthView: vi.fn(actual.deriveMonthView) };
});

const SEP: YearMonth = { year: 2026, month: 9 };
const OCT: YearMonth = { year: 2026, month: 10 };
const TODAY = "2026-10-17";

const snapshot = (
  rows: ScheduleRow[],
  tenancies: Tenancy[] = [],
  portions: PortionConfig[] = PORTIONS,
): RentSnapshot => ({ rows, portions, tenancies });

const ids = (items: OverdueItem[]) => items.map((item) => item.portionId);
const itemFor = (items: OverdueItem[], id: string) => items.find((item) => item.portionId === id);

/** The portions with some changed, by id. */
const portionsWith = (changes: Record<string, Partial<PortionConfig>>): PortionConfig[] =>
  PORTIONS.map((portion) => ({ ...portion, ...changes[portion.id] }));

describe("overdueList on the base Schedule (August and September paid)", () => {
  it("lists the four let portions on 17 October, most owed first, and not the one never let", () => {
    const items = overdueList(snapshot(baseRows()), TODAY);
    expect(items.map((item) => [item.portionId, item.owed])).toEqual([
      ["p2", 13335], // a new cycle: the hiked rent
      ["p3", 9000],
      ["p1", 5450],
      ["p5", 5100],
    ]);
    expect(overdueTotals(items)).toEqual({ portions: 4, owed: 32885 });
    expect(itemFor(items, "p4")).toBeUndefined();
  });

  it("describes each item: the portion, the tenant, the month, its age", () => {
    const items = overdueList(snapshot(baseRows()), TODAY);
    expect(items[0]).toEqual({
      portionId: "p2",
      name: "First floor, double bedroom",
      tenant: "Bala",
      months: [
        { month: OCT, kind: "unpaid", expected: 13335, paid: 0, owed: 13335, dueDate: "2026-10-01", daysOverdue: 16 },
      ],
      owed: 13335,
      oldest: OCT,
      daysOverdue: 16,
      unpaid: 1,
      short: 0,
    });
  });

  it("lists nothing in the five days of grace, whatever is unpaid for the new month", () => {
    expect(overdueList(snapshot(baseRows()), "2026-10-05")).toEqual([]);
    expect(overdueList(snapshot(baseRows()), "2026-10-01")).toEqual([]);
  });

  it("lists October from the 6th", () => {
    const items = overdueList(snapshot(baseRows()), "2026-10-06");
    expect(ids(items)).toEqual(["p2", "p3", "p1", "p5"]);
    expect(items[0].daysOverdue).toBe(5);
  });

  it("lists the month before when it is still unpaid in the grace days of the next", () => {
    // 3 November: October (unpaid) is overdue, November is not due yet.
    const items = overdueList(snapshot(baseRows()), "2026-11-03");
    expect(items.map((item) => item.months.map((m) => m.month))).toEqual([[OCT], [OCT], [OCT], [OCT]]);
    expect(items[0].daysOverdue).toBe(33);
  });

  it("is empty for an empty Sheet, for no portions and for a Schedule with months but no entries", () => {
    expect(overdueList(snapshot([]), TODAY)).toEqual([]);
    expect(overdueList(snapshot(baseRows(), [], []), TODAY)).toEqual([]);
    expect(overdueList(snapshot(parsedRows([2026, 8], [2026, 9], [2026, 10])), TODAY)).toEqual([]);
  });

  it("is empty before the Schedule's first month", () => {
    expect(overdueList(snapshot(baseRows()), "2026-03-20")).toEqual([]);
  });
});

describe("overdueList: what is owed is what the month card shows", () => {
  // Several tenants, short and hiked months, runs of unpaid months and a change of tenant: the owed amounts are compared
  // with the cards the month screen draws for each month, not with figures worked out again here.
  const rows = parsedRows(
    [2026, 1, [["Asha", 1, 5000], ["Bala", 7, 12000], ["Chitra", 3, 9000], null, ["Esha", 9, 11000]]],
    [2026, 2, [["Asha", 2, 5000], ["Bala", 8, 12000], ["Chitra", 4, 9000], null, ["Esha", 10, 11000]]],
    [2026, 3, [["Asha", 3, 4800], ["Bala", 9, 12000], ["Chitra", 5, 9000], null, ["Esha", 11, 11000]]],
    [2026, 4, [null, ["Bala", 10, 12000], ["Chitra", 6, 9000], null, ["Esha", 1, 11500]]],
    [2026, 5, [["Asha", 4, 5000], ["Bala", 11, 12000], null, null, ["Esha", 2, 11500]]],
    [2026, 6, [null, ["Bala", 1, 12600], ["Chitra", 7, 8500], null, null]],
    [2026, 7, [null, ["Bala", 2, 12000], ["Dev", 1, 9500], null, ["Esha", 3, 11500]]],
    [2026, 8, [null, ["Bala", 3, 12600], ["Dev", 2, 9000], null, null]],
    [2026, 9, [null, ["Bala", 4, 12600], null, null, ["Esha", 4, 11500]]],
  );
  const items = overdueList(snapshot(rows), TODAY);

  it("lists something of every kind, or the check below proves little", () => {
    const months = items.flatMap((item) => item.months);
    expect(months.some((m) => m.kind === "unpaid")).toBe(true);
    expect(months.some((m) => m.kind === "short")).toBe(true);
    expect(months.length).toBeGreaterThan(8);
  });

  it("owes, for every listed month, the card's reference (unpaid) or the card's shortfall (short)", () => {
    for (const item of items) {
      for (const m of item.months) {
        const card = deriveMonthView(rows, PORTIONS, m.month).cards.find((c) => c.portionId === item.portionId)!;
        if (m.kind === "unpaid") {
          expect(card.status).toBe("pending");
          expect(m.owed).toBe(card.rentReference);
          expect(m.paid).toBe(0);
        } else {
          expect(card.status).toBe("paid");
          expect(m.owed).toBe(-card.rentDifference!);
          expect(m.paid).toBe(card.entry!.amount);
          expect(m.expected).toBe(card.rentReference);
        }
      }
    }
  });

  it("lists every pending card and every short paid card of the current tenant's run, and nothing else", () => {
    for (const item of items) {
      const run = item.months;
      const start = { year: 2026, month: 1 };
      for (let month = start; compareYm(month, OCT) <= 0; month = addMonths(month, 1)) {
        const card = deriveMonthView(rows, PORTIONS, month).cards.find((c) => c.portionId === item.portionId)!;
        const listed = run.some((m) => compareYm(m.month, month) === 0);
        const inRun = item.portionId !== "p3" || compareYm(month, { year: 2026, month: 7 }) >= 0; // Dev's run starts in July
        const owes = card.status === "pending" || (card.status === "paid" && (card.rentDifference ?? 0) < 0);
        expect(listed).toBe(inRun && owes);
      }
    }
  });

  it("adds the months up, and counts the kinds", () => {
    for (const item of items) {
      expect(item.owed).toBe(item.months.reduce((sum, m) => sum + m.owed, 0));
      expect(item.unpaid).toBe(item.months.filter((m) => m.kind === "unpaid").length);
      expect(item.short).toBe(item.months.filter((m) => m.kind === "short").length);
      expect(item.unpaid + item.short).toBe(item.months.length);
      expect(item.oldest).toEqual(item.months[0].month);
      expect(item.daysOverdue).toBe(item.months[0].daysOverdue);
      // oldest first
      for (let i = 1; i < item.months.length; i++) {
        expect(compareYm(item.months[i - 1].month, item.months[i].month)).toBeLessThan(0);
      }
    }
  });
});

describe("overdueList: short months", () => {
  it("lists a short month for what is missing, and the next month at the card's suggestion", () => {
    // Asha paid 5 000 against 5 450 in September; October is unpaid and its suggestion comes from September's 5 000.
    const rows = parsedRows([2026, 8, [["Asha", 2, 5450]]], [2026, 9, [["Asha", 3, 5000]]]);
    const [item, ...rest] = overdueList(snapshot(rows), TODAY);
    expect(rest).toEqual([]);
    expect(item.months).toEqual([
      { month: SEP, kind: "short", expected: 5450, paid: 5000, owed: 450, dueDate: "2026-09-01", daysOverdue: 46 },
      { month: OCT, kind: "unpaid", expected: 5000, paid: 0, owed: 5000, dueDate: "2026-10-01", daysOverdue: 16 },
    ]);
    expect(item).toMatchObject({ owed: 5450, oldest: SEP, daysOverdue: 46, unpaid: 1, short: 1 });
  });

  it("lists a short month that is the latest one, with nothing else", () => {
    const rows = parsedRows([2026, 8, [["Asha", 2, 5450]]], [2026, 9, [["Asha", 3, 5450]]], [2026, 10, [["Asha", 4, 5000]]]);
    const [item] = overdueList(snapshot(rows), TODAY);
    expect(item.months).toHaveLength(1);
    expect(item).toMatchObject({ owed: 450, unpaid: 0, short: 1, oldest: OCT });
  });

  it("does not list a month paid in full or with more than the rent", () => {
    const rows = parsedRows([2026, 8, [["Asha", 2, 5450]]], [2026, 9, [["Asha", 3, 6000]]], [2026, 10, [["Asha", 4, 6000]]]);
    expect(overdueList(snapshot(rows), TODAY)).toEqual([]);
  });

  it("measures a month against the payment before it, as its card does, so it follows an extra payment's higher rent", () => {
    // September paid 6 000 against 5 450. October's card suggests 6 000, so October paid at 5 450 is ₹ 550 less than rent on
    // the card, and the same ₹ 550 is listed: the list never disagrees with the card.
    const rows = parsedRows([2026, 8, [["Asha", 2, 5450]]], [2026, 9, [["Asha", 3, 6000]]], [2026, 10, [["Asha", 4, 5450]]]);
    const card = deriveMonthView(rows, PORTIONS, OCT).cards.find((c) => c.portionId === "p1")!;
    expect(card.rentDifference).toBe(-550);
    expect(overdueList(snapshot(rows), TODAY)[0]).toMatchObject({ owed: 550, short: 1, unpaid: 0 });
  });

  it("does not let an extra amount in one month pay for another", () => {
    // September 1 000 over, October unpaid: October is still owed in full.
    const rows = parsedRows([2026, 8, [["Asha", 2, 5450]]], [2026, 9, [["Asha", 3, 6450]]]);
    const [item] = overdueList(snapshot(rows), TODAY);
    expect(item.months).toEqual([expect.objectContaining({ month: OCT, kind: "unpaid", owed: 6450 })]);
    // an extra amount does not shorten a short month either
    const both = parsedRows([2026, 7, [["Asha", 1, 5450]]], [2026, 8, [["Asha", 2, 4450]]], [2026, 9, [["Asha", 3, 7450]]], [2026, 10, [["Asha", 4, 7450]]]);
    const [other] = overdueList(snapshot(both), TODAY);
    expect(other.months.map((m) => [m.month.month, m.kind, m.owed])).toEqual([[8, "short", 1000]]);
  });

  it("does not list a hiked month paid within the rounding allowance, and lists a shortfall beyond it", () => {
    const paid = (amount: number) => baseRows([2026, 10, [null, ["Bala", 1, amount]]]);
    expect(itemFor(overdueList(snapshot(paid(13340)), TODAY), "p2")).toBeUndefined();
    expect(itemFor(overdueList(snapshot(paid(13335)), TODAY), "p2")).toBeUndefined();
    expect(itemFor(overdueList(snapshot(paid(13325)), TODAY), "p2")).toBeUndefined();
    const short = itemFor(overdueList(snapshot(paid(13300)), TODAY), "p2")!;
    expect(short.months).toEqual([
      { month: OCT, kind: "short", expected: 13335, paid: 13300, owed: 35, dueDate: "2026-10-01", daysOverdue: 16 },
    ]);
    expect(short.owed).toBe(35);
  });

  it("does not list a new tenant's first payment, whatever it is", () => {
    const rows = baseRows([2026, 10, [["Dev", 1, 100]]]);
    expect(itemFor(overdueList(snapshot(rows), TODAY), "p1")).toBeUndefined();
  });
});

describe("overdueList: months paid ahead", () => {
  it("never lists a month paid ahead, and it does not make up an earlier month", () => {
    // November is paid ahead; October is unpaid and stays owed.
    const rows = baseRows([2026, 11, [["Asha", 4, 5450]]]);
    const items = overdueList(snapshot(rows), TODAY);
    const p1 = itemFor(items, "p1")!;
    expect(p1.months).toEqual([expect.objectContaining({ month: OCT, kind: "unpaid", owed: 5450 })]);
    expect(p1.owed).toBe(5450);
  });

  it("lists nothing for a portion paid ahead past the current month", () => {
    const rows = baseRows([2026, 10, [["Asha", 4, 5450]]], [2026, 11, [["Asha", 5, 5450]]]);
    expect(itemFor(overdueList(snapshot(rows), TODAY), "p1")).toBeUndefined();
  });

  it("starts after the current month for a tenant whose first payment is paid ahead", () => {
    // Dev's first entry is November: nothing of Dev's is due yet, and Asha's earlier months are history.
    const rows = baseRows([2026, 11, [["Dev", 1, 5500]]]);
    expect(itemFor(overdueList(snapshot(rows), TODAY), "p1")).toBeUndefined();
  });

  it("does not list a month that is only short when it is still before its overdue day", () => {
    // 3 October: September is the last month due. A short October is not looked at yet.
    const rows = baseRows([2026, 10, [["Asha", 4, 100]]]);
    expect(itemFor(overdueList(snapshot(rows), "2026-10-03"), "p1")).toBeUndefined();
    expect(itemFor(overdueList(snapshot(rows), "2026-10-06"), "p1")).toMatchObject({ owed: 5350, short: 1 });
  });
});

describe("overdueList: only the current tenant's run counts", () => {
  it("does not list an earlier tenant's gap", () => {
    // Asha: January, March (February missing). Dev from April. September paid, October unpaid.
    const rows = parsedRows(
      [2026, 1, [["Asha", 1, 5000]]],
      [2026, 3, [["Asha", 2, 5000]]],
      [2026, 4, [["Dev", 1, 5500]]],
      [2026, 5, [["Dev", 2, 5500]]],
      [2026, 6, [["Dev", 3, 5500]]],
      [2026, 7, [["Dev", 4, 5500]]],
      [2026, 8, [["Dev", 5, 5500]]],
      [2026, 9, [["Dev", 6, 5500]]],
    );
    const [item, ...rest] = overdueList(snapshot(rows), TODAY);
    expect(rest).toEqual([]);
    expect(item.tenant).toBe("Dev");
    expect(item.months).toEqual([expect.objectContaining({ month: OCT, owed: 5500 })]);
  });

  it("drops a tenant who left owing once the next tenant's first payment is logged", () => {
    // Asha paid until June and left; nothing logged for July to September. Dev pays in September.
    const rows = parsedRows(
      [2026, 5, [["Asha", 4, 5000]]],
      [2026, 6, [["Asha", 5, 5000]]],
      [2026, 9, [["Dev", 1, 5500]]],
    );
    const [item] = overdueList(snapshot(rows), TODAY);
    expect(item.tenant).toBe("Dev");
    expect(item.months.map((m) => m.month)).toEqual([OCT]);
    // Before Dev's payment is logged, Asha's months are still counted.
    const before = overdueList(snapshot(parsedRows([2026, 5, [["Asha", 4, 5000]]], [2026, 6, [["Asha", 5, 5000]]])), TODAY);
    expect(before[0].months.map((m) => m.month.month)).toEqual([7, 8, 9, 10]);
  });

  it("starts a mid-year tenant at their first month", () => {
    const rows = parsedRows(
      [2026, 3, [["Asha", 1, 5000]]],
      [2026, 4, [["Asha", 2, 5000]]],
      [2026, 5, [["Asha", 3, 5000]]],
      [2026, 6, [["Asha", 4, 5000]]],
    );
    const [item] = overdueList(snapshot(rows), TODAY);
    expect(item.months.map((m) => m.month.month)).toEqual([7, 8, 9, 10]);
    expect(item.oldest).toEqual({ year: 2026, month: 7 });
  });

  it("lists a blank month inside a tenant's run as unpaid", () => {
    const rows = parsedRows(
      [2026, 5, [["Asha", 1, 5000]]],
      [2026, 6, [["Asha", 2, 5000]]],
      [2026, 7],
      [2026, 8, [["Asha", 3, 5000]]],
      [2026, 9, [["Asha", 4, 5000]]],
      [2026, 10, [["Asha", 5, 5000]]],
    );
    // July has no entry: the card says unpaid, and its suggestion comes from June's 5 000.
    const [item] = overdueList(snapshot(rows), TODAY);
    expect(item.months).toEqual([expect.objectContaining({ month: { year: 2026, month: 7 }, kind: "unpaid", owed: 5000 })]);
  });

  it("reads a tenant's name in another case as the same tenant", () => {
    const rows = parsedRows([2026, 7, [["Asha", 1, 5000]]], [2026, 8, [[" ASHA ", 2, 5000]]], [2026, 9, [["asha", 3, 5000]]]);
    const [item] = overdueList(snapshot(rows), TODAY);
    expect(item.months.map((m) => m.month.month)).toEqual([10]);
    expect(item.tenant).toBe("asha");
  });

  it("lists a last entry from January 2025 as 21 unpaid months from February 2025, with no move-out", () => {
    const rows = parsedRows([2025, 1, [["Asha", 1, 5000]]]);
    const [item] = overdueList(snapshot(rows), TODAY);
    expect(item.months).toHaveLength(21);
    expect(item.oldest).toEqual({ year: 2025, month: 2 });
    expect(item.months[0].month).toEqual({ year: 2025, month: 2 });
    expect(item.months[20].month).toEqual(OCT);
    expect(item).toMatchObject({ owed: 105000, unpaid: 21, short: 0, daysOverdue: 623 });
  });

  it("is not changed by the order of the rows or a month typed twice", () => {
    const sorted = parsedRows([2026, 8, [["Asha", 2, 5450]]], [2026, 9, [["Asha", 3, 5450]]]);
    const jumbled = parsedRows([2026, 9, [["Asha", 3, 5450]]], [2026, 8, [["Asha", 2, 5450]]]);
    expect(overdueList(snapshot(jumbled), TODAY)).toEqual(overdueList(snapshot(sorted), TODAY));
    // September typed twice: the lower row is the one that counts (here the same figures)
    const twice = parsedRows([2026, 8, [["Asha", 2, 5450]]], [2026, 9, [["Asha", 3, 5450]]], [2026, 9, [["Asha", 3, 5450]]]);
    expect(overdueList(snapshot(twice), TODAY)).toEqual(overdueList(snapshot(sorted), TODAY));
  });

  it("goes by the lower row when a month is typed twice with different amounts", () => {
    const rows = parsedRows(
      [2026, 8, [["Asha", 2, 5450]]],
      [2026, 9, [["Asha", 3, 5450]]],
      [2026, 9, [["Asha", 3, 5000]]],
    );
    const [item] = overdueList(snapshot(rows), TODAY);
    expect(item.months.map((m) => [m.month.month, m.kind, m.owed])).toEqual([[9, "short", 450], [10, "unpaid", 5000]]);
  });
});

describe("overdueList: vacant portions", () => {
  const leftOn = (day: string) => [tenancyRow({ moveOut: day })];

  it("does not list a month from the 1st of the move-out's month, when the tenant moved out that day", () => {
    const items = overdueList(snapshot(baseRows(), leftOn("2026-10-01")), TODAY);
    expect(itemFor(items, "p1")).toBeUndefined();
    expect(ids(items)).toEqual(["p2", "p3", "p5"]);
  });

  it("lists October when the tenant moved out on the 2nd, as the month is still due", () => {
    const items = overdueList(snapshot(baseRows(), leftOn("2026-10-02")), TODAY);
    expect(itemFor(items, "p1")).toMatchObject({ owed: 5450, months: [expect.objectContaining({ month: OCT })] });
  });

  it("does not list the months of a vacancy, and lists a month before it that was not paid", () => {
    // Asha moved out on 30 September, after September's rent was logged: October and November are vacant.
    const items = overdueList(snapshot(baseRows(), leftOn("2026-09-30")), "2026-11-17");
    expect(itemFor(items, "p1")).toBeUndefined();
    expect(itemFor(items, "p2")!.months.map((m) => m.month.month)).toEqual([10, 11]);
    // Asha owes July and moved out on 31 August: July is listed, September and October are vacant.
    const rows = parsedRows([2026, 6, [["Asha", 1, 5000]]], [2026, 8, [["Asha", 2, 5000]]]);
    const [item] = overdueList(snapshot(rows, leftOn("2026-08-31")), TODAY);
    expect(item.months.map((m) => [m.month.month, m.kind])).toEqual([[7, "unpaid"]]);
  });

  it("does not take a move-out for a vacancy when rent was logged after it", () => {
    // Asha moved out on 31 August but September's rent was logged: the Sheet says she stayed, so October is due.
    const items = overdueList(snapshot(baseRows(), leftOn("2026-08-31")), TODAY);
    expect(itemFor(items, "p1")).toMatchObject({ owed: 5450 });
  });

  it("skips the vacant gap inside a run and counts the months after it", () => {
    // Asha: January to March, moved out on 1 April, back on the Schedule in September (no new details on file).
    const rows = parsedRows(
      [2026, 1, [["Asha", 1, 5000]]],
      [2026, 2, [["Asha", 2, 5000]]],
      [2026, 3, [["Asha", 3, 5000]]],
      [2026, 9, [["Asha", 4, 5000]]],
    );
    const [item] = overdueList(snapshot(rows, leftOn("2026-04-01")), TODAY);
    // April to August are vacant (skipped); October is due again because rent was logged after the move-out
    expect(item.months.map((m) => m.month.month)).toEqual([10]);
  });

  it("ignores a move-out that is not a real day, and lists the months", () => {
    const items = overdueList(snapshot(baseRows(), leftOn("soon")), TODAY);
    expect(itemFor(items, "p1")).toBeDefined();
  });

  it("does not list a portion that never had a tenant", () => {
    expect(itemFor(overdueList(snapshot(baseRows()), TODAY), "p4")).toBeUndefined();
    expect(itemFor(overdueList(snapshot(baseRows(), [tenancyRow({ portionId: "p4", tenant: "Dev" })]), TODAY), "p4")).toBeUndefined();
  });

  it("still lists a tenant whose details are on file with no move-out", () => {
    const items = overdueList(snapshot(baseRows(), [tenancyRow()]), TODAY);
    expect(ids(items)).toEqual(["p2", "p3", "p1", "p5"]);
  });
});

describe("overdueList: switched-off portions", () => {
  it("has no item for a switched-off portion with no entries", () => {
    const items = overdueList(snapshot(baseRows(), [], portionsWith({ p4: { inactive: true } })), TODAY);
    expect(ids(items)).toEqual(["p2", "p3", "p1", "p5"]);
  });

  it("still lists rent owed by a switched-off portion whose tenant has not moved out", () => {
    const items = overdueList(snapshot(baseRows(), [], portionsWith({ p3: { inactive: true } })), TODAY);
    expect(itemFor(items, "p3")).toMatchObject({ owed: 9000 });
  });

  it("does not list a switched-off portion from the month it is vacant", () => {
    const moved = [tenancyRow({ portionId: "p3", tenant: "Chitra", moveOut: "2026-10-01" })];
    const items = overdueList(snapshot(baseRows(), moved, portionsWith({ p3: { inactive: true } })), TODAY);
    expect(itemFor(items, "p3")).toBeUndefined();
  });

  it("still counts a month paid short by a switched-off portion, which has its card in that month", () => {
    const rows = baseRows([2026, 10, [null, null, ["Chitra", 6, 8000]]]);
    const items = overdueList(snapshot(rows, [tenancyRow({ portionId: "p3", tenant: "Chitra", moveOut: "2026-11-30" })], portionsWith({ p3: { inactive: true } })), TODAY);
    expect(itemFor(items, "p3")).toMatchObject({ owed: 1000, short: 1, unpaid: 0 });
  });
});

describe("overdueList: odd rows", () => {
  it("does not list a portion whose rent is nothing", () => {
    // A rent of 0 (a hand-typed row) owes nothing.
    const rows = parsedRows([2026, 9, [["Asha", 1, 0]]]);
    expect(overdueList(snapshot(rows), TODAY)).toEqual([]);
  });

  it("works in whole rupees when an amount has paise", () => {
    const rows = parsedRows([2026, 8, [["Asha", 1, 5450.4]]], [2026, 9, [["Asha", 2, 5000]]]);
    const [item] = overdueList(snapshot(rows), TODAY);
    // September is short by 450.4, which the card shows as ₹ 450; October is owed at September's 5 000
    expect(item.months.map((m) => [m.month.month, m.owed])).toEqual([[9, 450], [10, 5000]]);
    const decimal = parsedRows([2026, 9, [["Asha", 1, 5450.5]]]);
    expect(overdueList(snapshot(decimal), TODAY)[0].owed).toBe(5451);
  });

  it("lists a month short by more than half a rupee as ₹ 1, and not one short by less, as the card's line does", () => {
    const short = parsedRows([2026, 8, [["Asha", 2, 5450]]], [2026, 9, [["Asha", 3, 5449.4]]], [2026, 10, [["Asha", 4, 5449.4]]]);
    expect(overdueList(snapshot(short), TODAY)[0].months.map((m) => [m.month.month, m.owed])).toEqual([[9, 1]]);
    const nearly = parsedRows([2026, 8, [["Asha", 2, 5450]]], [2026, 9, [["Asha", 3, 5449.7]]], [2026, 10, [["Asha", 4, 5449.7]]]);
    expect(overdueList(snapshot(nearly), TODAY)).toEqual([]);
  });

  it("keeps a blank tenant name as it is", () => {
    const rows = parsedRows([2026, 8, [["", 1, 5000]]]);
    const [item] = overdueList(snapshot(rows), TODAY);
    expect(item.tenant).toBe("");
    expect(item.months.map((m) => m.month.month)).toEqual([9, 10]);
  });

  it("lists a portion whose id is not a plain name", () => {
    const portions = PORTIONS.map((p) => (p.id === "p1" ? { ...p, id: "__proto__" } : p));
    const rows = parseSchedule(baseSchedule(), portions, TOTAL_HEADER).rows;
    const items = overdueList(snapshot(rows, [], portions), TODAY);
    expect(items.map((item) => [item.portionId, item.owed])).toEqual([
      ["p2", 13335],
      ["p3", 9000],
      ["__proto__", 5450],
      ["p5", 5100],
    ]);
  });
});

describe("overdueList: order", () => {
  it("puts the one owed most first", () => {
    expect(overdueList(snapshot(baseRows()), TODAY).map((item) => item.owed)).toEqual([13335, 9000, 5450, 5100]);
  });

  it("puts the older month first when the amounts are equal, and keeps the Settings order after that", () => {
    const rows = parsedRows(
      [2026, 8, [null, ["Bala", 1, 7000], ["Chitra", 1, 5000], null, ["Esha", 1, 7000]]],
      [2026, 9, [["Asha", 1, 10000], ["Bala", 2, 7000], null, null, ["Esha", 2, 7000]]],
    );
    // p3 owes September and October at 5 000 each (since September); p1 owes October at 10 000: equal, and p3 is older although
    // p1 comes first in Settings. p2 and p5 owe 7 000 since October.
    const items = overdueList(snapshot(rows), TODAY);
    expect(items.map((item) => [item.portionId, item.owed, item.oldest.month])).toEqual([
      ["p3", 10000, 9],
      ["p1", 10000, 10],
      ["p2", 7000, 10],
      ["p5", 7000, 10],
    ]);
  });

  it("puts equal amounts of the same age in Settings order, whatever that order is", () => {
    const rows = parsedRows([2026, 9, [null, ["Bala", 1, 7000], null, null, ["Esha", 1, 7000]]]);
    expect(ids(overdueList(snapshot(rows), TODAY))).toEqual(["p2", "p5"]);
    const reversed = [...PORTIONS].reverse();
    expect(ids(overdueList(snapshot(rows, [], reversed), TODAY))).toEqual(["p5", "p2"]);
  });

  it("puts the larger owed first even when it is newer", () => {
    const rows = parsedRows(
      [2026, 8, [["Asha", 1, 1000], null, ["Chitra", 1, 30000]]],
      [2026, 9, [null, null, ["Chitra", 2, 30000]]],
    );
    // p1 owes September and October (2 000, from September); p3 owes October (30 000)
    expect(ids(overdueList(snapshot(rows), TODAY))).toEqual(["p3", "p1"]);
  });
});

describe("overdueList: cost", () => {
  it("makes one month view per month, from the earliest run start to the last due month, for all portions", () => {
    vi.mocked(deriveMonthView).mockClear();
    const rows = parsedRows([2025, 1, [["Asha", 1, 5000]]], [2025, 6, [null, ["Bala", 1, 7000]]]);
    overdueList(snapshot(rows), TODAY);
    // January 2025 to October 2026 is 22 months
    expect(vi.mocked(deriveMonthView)).toHaveBeenCalledTimes(22);
  });

  it("makes none when nothing can be listed", () => {
    vi.mocked(deriveMonthView).mockClear();
    overdueList(snapshot([]), TODAY);
    overdueList(snapshot(baseRows()), "2026-03-20");
    expect(vi.mocked(deriveMonthView)).not.toHaveBeenCalled();
  });
});

describe("overdueTotals", () => {
  it("counts the portions and adds what they owe", () => {
    const items = overdueList(snapshot(baseRows()), TODAY);
    expect(overdueTotals(items)).toEqual({ portions: 4, owed: 32885 });
    expect(overdueTotals(items.slice(0, 1))).toEqual({ portions: 1, owed: 13335 });
  });

  it("is zero for no items", () => {
    expect(overdueTotals([])).toEqual({ portions: 0, owed: 0 });
  });
});
