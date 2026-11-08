import { describe, expect, it } from "vitest";
import { hikeAlerts } from "@/lib/domain/alerts";
import { deriveMonthView, findPriorWithAnchor, nextPayment } from "@/lib/domain/month-view";
import { overdueList, overdueTotals } from "@/lib/domain/overdue";
import { suggestAmount } from "@/lib/domain/rent-rules";
import type { PortionConfig, PortionEntry, RentSnapshot, ScheduleRow, YearMonth } from "@/lib/domain/types";
import { type Entry, parsedRows, PORTIONS } from "../support/fixtures";

// The true rent of a cycle is the amount of its first payment. The suggested rent for a month is the true rent of the cycle the
// payment before it is in (with the hike when that payment ended the cycle), so a one-off amount in a cycle, an amount agreed for
// one month, never changes what is suggested next, and the first payment of a new cycle is the rent whatever it is.

const MONTHS = (start: YearMonth, length: number): YearMonth[] =>
  Array.from({ length }, (_, index) => {
    const at = start.year * 12 + start.month - 1 + index;
    return { year: Math.floor(at / 12), month: (at % 12) + 1 };
  });

/** p1's payments from `start`, one a month in order: [count, amount] each. Asha, unless a name is given. */
function p1Rows(start: YearMonth, payments: Array<[count: number, amount: number, tenant?: string]>): ScheduleRow[] {
  return parsedRows(
    ...payments.map(([count, amount, tenant], index): [number, number, Entry[]] => {
      const at = MONTHS(start, index + 1)[index];
      return [at.year, at.month, [[tenant ?? "Asha", count, amount]]];
    }),
  );
}

const portionsWith = (p1: Partial<PortionConfig>): PortionConfig[] => PORTIONS.map((p) => (p.id === "p1" ? { ...p, ...p1 } : p));
const snapshot = (rows: ScheduleRow[], portions = PORTIONS): RentSnapshot => ({ rows, portions, tenancies: [] });
const cardOf = (rows: ScheduleRow[], month: YearMonth, portions = PORTIONS) =>
  deriveMonthView(rows, portions, month).cards.find((card) => card.portionId === "p1")!;

const JUL26: YearMonth = { year: 2026, month: 7 };
const SEP26: YearMonth = { year: 2026, month: 9 };
const OCT26: YearMonth = { year: 2026, month: 10 };

describe("an amount agreed for one month does not change the next suggestion", () => {
  // Asha: July 5 450 (payment 1), August 5 450, September 5 000 (agreed), then October
  const rows = p1Rows(JUL26, [[1, 5450], [2, 5450], [3, 5000]]);

  it("still suggests the true rent after it, with no 'was' that is not the true rent", () => {
    expect(cardOf(rows, OCT26)).toMatchObject({
      status: "pending",
      next: { count: 4, suggestedAmount: 5450, previousAmount: 5450, startsNewCycle: false },
      rentReference: 5450,
    });
  });

  it("still tells the agreed month it was less than the true rent, as the card always did", () => {
    expect(cardOf(rows, SEP26)).toMatchObject({ status: "paid", rentReference: 5450, rentDifference: -450 });
  });

  it("shows no more or less than rent when the next month is paid at the true rent", () => {
    const paid = p1Rows(JUL26, [[1, 5450], [2, 5450], [3, 5000], [4, 5450]]);
    expect(cardOf(paid, OCT26)).toMatchObject({ status: "paid", rentReference: 5450, rentDifference: 0 });
  });

  it("is the owner's example the other way round: September 5 450 paid after an agreed 5 000 is not 'more'", () => {
    const paid = p1Rows(JUL26, [[1, 5450], [2, 5000], [3, 5450]]);
    expect(cardOf(paid, SEP26)).toMatchObject({ rentReference: 5450, rentDifference: 0 });
  });

  it("keeps the month's due and difference to the true rent, as the card's own line says", () => {
    const view = deriveMonthView(rows, PORTIONS, SEP26);
    // only p1 has entries: 5 000 received against the true rent of 5 450
    expect(view).toMatchObject({ received: 5000, due: 5450, difference: -450 });
  });

  it("owes the true rent for an unpaid month after it, in the overdue list and its totals", () => {
    const items = overdueList(snapshot(rows), "2026-10-17");
    const p1 = items.find((item) => item.portionId === "p1")!;
    expect(p1.months).toEqual([{ month: OCT26, owed: 5450, dueDate: "2026-10-01", daysOverdue: 16 }]);
    expect(overdueTotals([p1])).toEqual({ portions: 1, owed: 5450 });
  });
});

describe("the first payment of a new cycle is the rent, whatever it is", () => {
  /** p1 paid 5 450 for the 11 months of 2025; the first payment of the next cycle is December's. */
  const cycleOne = Array.from({ length: 11 }, (_, index): [number, number] => [index + 1, 5450]);
  const DEC25: YearMonth = { year: 2025, month: 12 };
  const JAN26: YearMonth = { year: 2026, month: 1 };

  it("offers the hike as the suggestion, worked from the true rent", () => {
    const rows = p1Rows({ year: 2025, month: 1 }, cycleOne);
    expect(cardOf(rows, DEC25)).toMatchObject({ next: { count: 1, previousAmount: 5450, suggestedAmount: 5723, startsNewCycle: true } });
  });

  it.each([5723, 5700, 5725, 5750, 5800, 6000, 5450, 5000])("shows no difference for a first payment of %i, and makes it the rent after it", (amount) => {
    const rows = p1Rows({ year: 2025, month: 1 }, [...cycleOne, [1, amount], [2, amount]]);
    expect(cardOf(rows, DEC25)).toMatchObject({ status: "paid", rentReference: amount, rentDifference: 0 });
    expect(cardOf(rows, JAN26)).toMatchObject({ status: "paid", rentReference: amount, rentDifference: 0 });
    const view = deriveMonthView(rows, PORTIONS, DEC25);
    expect(view.difference).toBe(0);
    // the next month's suggestion is the same rent
    const next = p1Rows({ year: 2025, month: 1 }, [...cycleOne, [1, amount]]);
    expect(cardOf(next, JAN26)).toMatchObject({ next: { count: 2, suggestedAmount: amount, previousAmount: amount, startsNewCycle: false } });
  });

  it.each([5700, 5800, 6000])("works the next cycle's hike from the first payment of %i, not from the hike before it", (first) => {
    // the whole second cycle at `first`, then the first payment of the third
    const second = Array.from({ length: 11 }, (_, index): [number, number] => [index + 1, first]);
    const rows = p1Rows({ year: 2025, month: 1 }, [...cycleOne, ...second]);
    const nov26: YearMonth = { year: 2026, month: 11 };
    expect(cardOf(rows, nov26)).toMatchObject({
      next: { count: 1, previousAmount: first, suggestedAmount: suggestAmount(first, 5, true), startsNewCycle: true },
    });
  });

  it("still gives a first payment of a new cycle no difference when the hike is 0%", () => {
    const rows = p1Rows({ year: 2025, month: 1 }, [...cycleOne, [1, 5600]]);
    expect(cardOf(rows, DEC25, portionsWith({ hikePercent: 0 }))).toMatchObject({ next: { suggestedAmount: 5450 }, rentReference: 5600, rentDifference: 0 });
  });

  it("does not make a payment mid-cycle the first of a cycle", () => {
    const rows = p1Rows({ year: 2025, month: 1 }, [...cycleOne.slice(0, 5), [6, 5600]]);
    expect(cardOf(rows, { year: 2025, month: 6 })).toMatchObject({ rentReference: 5450, rentDifference: 150 });
  });
});

describe("an agreed amount does not change the next hike alert's figures", () => {
  // Asha paid 5 450 for payments 1 to 8, then 4 000 for payment 9 (September 2026): the next cycle starts with December's payment
  const rows = p1Rows({ year: 2026, month: 1 }, [...Array.from({ length: 8 }, (_, index): [number, number] => [index + 1, 5450]), [9, 4000]]);

  it("shows the true rent and its hike as the current and the new rent", () => {
    const alerts = hikeAlerts(snapshot(rows), "2026-10-17").filter((alert) => alert.portionId === "p1");
    expect(alerts).toEqual([
      expect.objectContaining({ hikeMonth: { year: 2026, month: 12 }, paymentsLeft: 2, currentRent: 5450, newRent: 5723, hikePercent: 5, state: "soon" }),
    ]);
  });

  it("is the same with the agreed amount in any month of the cycle but the first", () => {
    for (const at of [1, 2, 4, 6, 7]) {
      const payments = Array.from({ length: 9 }, (_, index): [number, number] => [index + 1, index === at ? 4000 : 5450]);
      const [alert] = hikeAlerts(snapshot(p1Rows({ year: 2026, month: 1 }, payments)), "2026-10-17").filter((a) => a.portionId === "p1");
      expect(alert, `${at}`).toMatchObject({ currentRent: 5450, newRent: 5723 });
    }
  });

  it("takes the first payment of the cycle as the true rent, even when it is the odd one", () => {
    const first = p1Rows({ year: 2026, month: 1 }, [[1, 5000], ...Array.from({ length: 8 }, (_, index): [number, number] => [index + 2, 5450])]);
    const [alert] = hikeAlerts(snapshot(first), "2026-10-17").filter((a) => a.portionId === "p1");
    expect(alert).toMatchObject({ currentRent: 5000, newRent: suggestAmount(5000, 5, true) });
  });

  it("is due with the hike worked from the true rent when the cycle has just ended", () => {
    const ended = p1Rows({ year: 2025, month: 11 }, [...Array.from({ length: 10 }, (_, index): [number, number] => [index + 1, 5450]), [11, 5000]]);
    const [alert] = hikeAlerts(snapshot(ended), "2026-10-17").filter((a) => a.portionId === "p1");
    expect(alert).toMatchObject({ state: "due", currentRent: 5450, newRent: 5723 });
  });
});

describe("where the cycle's first payment is", () => {
  it("is the earliest entry of the run when the Schedule starts in the middle of a cycle", () => {
    // starts at payment 5 (5 000); payment 7 is 5 300; June suggests 5 000
    const rows = p1Rows({ year: 2026, month: 3 }, [[5, 5000], [6, 5000], [7, 5300]]);
    expect(cardOf(rows, { year: 2026, month: 6 })).toMatchObject({ next: { count: 8, suggestedAmount: 5000, previousAmount: 5000 } });
    expect(cardOf(rows, { year: 2026, month: 5 })).toMatchObject({ rentReference: 5000, rentDifference: 300 });
  });

  it("is the same as the last payment when a mid-cycle start never differs", () => {
    const rows = p1Rows({ year: 2026, month: 3 }, [[5, 5000], [6, 5000]]);
    expect(cardOf(rows, { year: 2026, month: 5 })).toMatchObject({ next: { suggestedAmount: 5000 } });
  });

  it("works the hike from the earliest entry when a mid-cycle start reaches the end of its cycle", () => {
    const rows = p1Rows({ year: 2026, month: 1 }, [[9, 5000], [10, 5200], [11, 5000]]);
    expect(cardOf(rows, { year: 2026, month: 4 })).toMatchObject({
      next: { count: 1, previousAmount: 5000, suggestedAmount: suggestAmount(5000, 5, true), startsNewCycle: true },
    });
  });

  it("is the new tenant's first payment after a change of tenant, never the tenant before", () => {
    const rows = p1Rows({ year: 2026, month: 1 }, [[1, 5450], [2, 5450], [3, 5450], [1, 6000, "Dev"], [2, 5900, "Dev"]]);
    expect(cardOf(rows, { year: 2026, month: 6 })).toMatchObject({ next: { tenant: "Dev", count: 3, suggestedAmount: 6000, previousAmount: 6000 } });
    // Dev's first payment has no rent to measure against, and the second is measured against it
    expect(cardOf(rows, { year: 2026, month: 4 })).toMatchObject({ rentReference: null, rentDifference: null });
    expect(cardOf(rows, { year: 2026, month: 5 })).toMatchObject({ rentReference: 6000, rentDifference: -100 });
  });

  it("is the new tenant's earliest entry when their first entry is not payment 1", () => {
    const rows = p1Rows({ year: 2026, month: 1 }, [[1, 5450], [2, 5450], [4, 6000, "Dev"], [5, 6200, "Dev"]]);
    expect(cardOf(rows, { year: 2026, month: 5 })).toMatchObject({ next: { tenant: "Dev", count: 6, suggestedAmount: 6000 } });
  });

  it("reads the same tenant in another case, or with spaces, as one run", () => {
    const rows = p1Rows({ year: 2026, month: 1 }, [[1, 5450, "Asha"], [2, 5000, "ASHA"], [3, 5000, " asha "]]);
    expect(cardOf(rows, { year: 2026, month: 4 })).toMatchObject({ next: { suggestedAmount: 5450 } });
  });

  it("does not let a blank tenant cell carry the run past it", () => {
    // the blank name is a name of its own, as on the card: its run starts at February
    const rows = p1Rows({ year: 2026, month: 1 }, [[1, 5450], [2, 5600, ""], [3, 5000, ""]]);
    expect(cardOf(rows, { year: 2026, month: 4 })).toMatchObject({ next: { tenant: "", suggestedAmount: 5600 } });
  });

  it("is not moved by months with no entry in the middle of a cycle", () => {
    const rows = parsedRows(
      [2026, 1, [["Asha", 1, 5450]]],
      [2026, 2],
      [2026, 3, [["Asha", 2, 5000]]],
      [2026, 4],
      [2026, 5, [["Asha", 3, 5000]]],
    );
    expect(cardOf(rows, { year: 2026, month: 6 })).toMatchObject({ next: { count: 4, suggestedAmount: 5450 } });
    // a month with no entry at all is the card's pending month, at the true rent
    expect(cardOf(rows, { year: 2026, month: 4 })).toMatchObject({ status: "pending", next: { suggestedAmount: 5450, count: 3 } });
  });

  it("reads a month typed twice as its lower row", () => {
    const rows = parsedRows(
      [2026, 6, [["Asha", 1, 4000]]],
      [2026, 6, [["Asha", 1, 5450]]],
      [2026, 7, [["Asha", 2, 5000]]],
    );
    expect(cardOf(rows, { year: 2026, month: 8 })).toMatchObject({ next: { count: 3, suggestedAmount: 5450 } });
  });

  it("does not depend on the order of the rows in the Sheet", () => {
    const sorted = p1Rows({ year: 2026, month: 1 }, [[1, 5450], [2, 5000], [3, 5000]]);
    const jumbled = parsedRows(
      [2026, 3, [["Asha", 3, 5000]]],
      [2026, 1, [["Asha", 1, 5450]]],
      [2026, 2, [["Asha", 2, 5000]]],
    );
    expect(cardOf(jumbled, { year: 2026, month: 4 })).toEqual(cardOf(sorted, { year: 2026, month: 4 }));
    expect(cardOf(jumbled, { year: 2026, month: 4 }).next?.suggestedAmount).toBe(5450);
  });

  it("stops at the end of an earlier cycle, so a count typed to restart a cycle does not reach back past it", () => {
    // payments 1 to 11 at 5 000, then the count is typed to restart at 2: December 6 000, January 6 000, February 6 100
    const full = Array.from({ length: 11 }, (_, index): [number, number] => [index + 1, 5000]);
    const rows = p1Rows({ year: 2025, month: 1 }, [...full, [2, 6000], [3, 6000], [4, 6100]]);
    expect(cardOf(rows, { year: 2026, month: 3 })).toMatchObject({ next: { count: 5, suggestedAmount: 6000 } });
  });

  it("stops at payment 1 when the cycle length was longer later than the cycles before it", () => {
    // payments 1 to 11 at 5 000 when the cycle was 11, then December starts a cycle at 5 300; the cycle is now 12 payments, so
    // 11 is no longer the end of a cycle, and only the count of 1 tells where the cycle began
    const first = Array.from({ length: 11 }, (_, index): [number, number] => [index + 1, 5000]);
    const rows = p1Rows({ year: 2025, month: 1 }, [...first, [1, 5300], [2, 5300], [3, 5400]]);
    expect(cardOf(rows, { year: 2026, month: 3 }, portionsWith({ cycleLength: 12 }))).toMatchObject({
      next: { count: 4, suggestedAmount: 5300, previousAmount: 5300 },
    });
  });

  it("counts a count that is not a whole number as the card does", () => {
    // cycle of 3: 1.5, 2.5 and 3.5 are one run that has reached the end of its cycle (3.5 is at or past 3)
    const rows = p1Rows({ year: 2026, month: 1 }, [[1.5, 5000], [2.5, 5100], [3.5, 5200]]);
    const three = portionsWith({ cycleLength: 3, hikePercent: 10 });
    expect(cardOf(rows, { year: 2026, month: 4 }, three)).toMatchObject({
      next: { count: 1, startsNewCycle: true, previousAmount: 5000, suggestedAmount: 5500 },
    });
    // and a count of 1.5 after a first payment of 1 stays in that cycle
    const mid = p1Rows({ year: 2026, month: 1 }, [[1, 5500], [1.5, 5600]]);
    expect(cardOf(mid, { year: 2026, month: 3 }, three)).toMatchObject({ next: { count: 2.5, startsNewCycle: false, suggestedAmount: 5500 } });
  });

  it("is the payment before when the cycle is one payment long", () => {
    const rows = p1Rows({ year: 2026, month: 1 }, [[1, 5000], [1, 5500]]);
    expect(cardOf(rows, { year: 2026, month: 3 }, portionsWith({ cycleLength: 1, hikePercent: 10 }))).toMatchObject({
      next: { startsNewCycle: true, previousAmount: 5500, suggestedAmount: 6050 },
    });
  });
});

describe("a portion whose count never resets keeps following the last payment", () => {
  // there is no hike cycle, so no first payment after a hike to trust: a permanent change could never become the suggestion
  const never = portionsWith({ cycleLength: null });

  it("suggests the last payment's amount, and compares each month with the one before it, as it always did", () => {
    const rows = p1Rows({ year: 2026, month: 1 }, [[1, 5000], [2, 5000], [3, 5000], [4, 5500]]);
    expect(cardOf(rows, { year: 2026, month: 5 }, never)).toMatchObject({
      status: "pending",
      next: { count: 5, suggestedAmount: 5500, previousAmount: 5500, startsNewCycle: false },
    });
    expect(cardOf(rows, { year: 2026, month: 4 }, never)).toMatchObject({ rentReference: 5000, rentDifference: 500 });
  });

  it("owes the last payment's amount for an unpaid month", () => {
    const rows = p1Rows({ year: 2026, month: 1 }, [[1, 5000], [2, 5500]]);
    const [item] = overdueList(snapshot(rows, never), "2026-04-17");
    expect(item.months.map((m) => [m.month.month, m.owed])).toEqual([[3, 5500], [4, 5500]]);
  });

  it("has no hike alert", () => {
    const rows = p1Rows({ year: 2026, month: 1 }, [[1, 5000], [2, 5500]]);
    expect(hikeAlerts(snapshot(rows, never), "2026-04-17").filter((alert) => alert.portionId === "p1")).toEqual([]);
  });
});

describe("findPriorWithAnchor", () => {
  const entry = (count: number, amount: number, tenant = "Asha"): PortionEntry => ({ tenant, count, amount });
  const rows = p1Rows({ year: 2026, month: 1 }, [[1, 5450], [2, 5000], [3, 5200]]);

  it("gives the latest entry before a month, with the entry that is its cycle's first", () => {
    expect(findPriorWithAnchor(rows, PORTIONS[0], { year: 2026, month: 4 })).toEqual({
      month: { year: 2026, month: 3 },
      entry: entry(3, 5200),
      anchor: entry(1, 5450),
    });
    expect(findPriorWithAnchor(rows, PORTIONS[0], { year: 2026, month: 3 })).toEqual({
      month: { year: 2026, month: 2 },
      entry: entry(2, 5000),
      anchor: entry(1, 5450),
    });
  });

  it("gives the latest entry of all when no month is given", () => {
    expect(findPriorWithAnchor(rows, PORTIONS[0])?.entry).toEqual(entry(3, 5200));
  });

  it("is the entry itself when it is a cycle's first, or when the count never resets", () => {
    expect(findPriorWithAnchor(rows, PORTIONS[0], { year: 2026, month: 2 })).toMatchObject({ entry: entry(1, 5450), anchor: entry(1, 5450) });
    expect(findPriorWithAnchor(rows, portionsWith({ cycleLength: null })[0], { year: 2026, month: 4 })).toMatchObject({
      entry: entry(3, 5200),
      anchor: entry(3, 5200),
    });
  });

  it("is null when there is no entry before the month, or none at all", () => {
    expect(findPriorWithAnchor(rows, PORTIONS[0], { year: 2026, month: 1 })).toBeNull();
    expect(findPriorWithAnchor(rows, PORTIONS[3])).toBeNull();
    expect(findPriorWithAnchor([], PORTIONS[0])).toBeNull();
  });
});

describe("nextPayment", () => {
  const prior: PortionEntry = { tenant: "Asha", count: 11, amount: 5000 };

  it("works from the amount of the entry it is given, as it always did, when no base is given", () => {
    expect(nextPayment(prior, PORTIONS[0])).toEqual({ tenant: "Asha", count: 1, previousAmount: 5000, startsNewCycle: true, suggestedAmount: 5250 });
  });

  it("works from a base amount when one is given: the true rent", () => {
    expect(nextPayment(prior, PORTIONS[0], 5450)).toEqual({ tenant: "Asha", count: 1, previousAmount: 5450, startsNewCycle: true, suggestedAmount: 5723 });
    expect(nextPayment({ ...prior, count: 4 }, PORTIONS[0], 5450)).toMatchObject({ count: 5, previousAmount: 5450, startsNewCycle: false, suggestedAmount: 5450 });
  });
});
