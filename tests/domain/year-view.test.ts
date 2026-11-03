import { describe, expect, it } from "vitest";
import { deriveMonthView } from "@/lib/domain/month-view";
import type { Tenancy } from "@/lib/domain/tenancy";
import type { PortionConfig, RentSnapshot, ScheduleRow } from "@/lib/domain/types";
import {
  deriveYearView,
  parseYear,
  yearBounds,
  type YearCell,
  type YearCellState,
  type YearView,
} from "@/lib/domain/year-view";
import { parseSchedule } from "@/lib/sheets/schedule";
import { baseRows, baseSchedule, parsedRows, PORTIONS, tenancyRow, TOTAL_HEADER } from "../support/fixtures";

const TODAY = "2026-10-17";

const snapshot = (
  rows: ScheduleRow[],
  tenancies: Tenancy[] = [],
  portions: PortionConfig[] = PORTIONS,
): RentSnapshot => ({ rows, portions, tenancies });

const portionsWith = (changes: Record<string, Partial<PortionConfig>>): PortionConfig[] =>
  PORTIONS.map((portion) => ({ ...portion, ...changes[portion.id] }));

const rowOf = (view: YearView, id: string) => view.rows.find((row) => row.portionId === id)!;
const states = (view: YearView, id: string): YearCellState[] => rowOf(view, id).cells.map((cell) => cell.state);
const cellOf = (view: YearView, id: string, month: number): YearCell => rowOf(view, id).cells[month - 1];

const NONE7: YearCellState[] = Array(7).fill("none");

describe("deriveYearView on the base Schedule (August and September 2026), today 17 October 2026", () => {
  const view = deriveYearView(snapshot(baseRows()), 2026, TODAY);

  it("has a row for each portion, in Settings order, of twelve cells January to December", () => {
    expect(view.year).toBe(2026);
    expect(view.rows.map((row) => row.portionId)).toEqual(["p1", "p2", "p3", "p4", "p5"]);
    expect(view.rows.map((row) => row.name)).toEqual(PORTIONS.map((portion) => portion.name));
    for (const row of view.rows) {
      expect(row.cells.map((cell) => cell.month)).toEqual(
        Array.from({ length: 12 }, (_, index) => ({ year: 2026, month: index + 1 })),
      );
    }
  });

  it("has no record from January to July, before the Schedule starts", () => {
    for (const id of ["p1", "p2", "p3", "p4", "p5"]) expect(states(view, id).slice(0, 7)).toEqual(NONE7);
  });

  it("shows August and September paid for p1 to p3, October unpaid, November and December not due yet", () => {
    for (const id of ["p1", "p2", "p3"]) {
      expect(states(view, id).slice(7)).toEqual(["paid", "paid", "unpaid", "upcoming", "upcoming"]);
    }
  });

  it("shows p5 vacant in August (before its first tenant) and paid in September", () => {
    expect(states(view, "p5").slice(7)).toEqual(["vacant", "paid", "unpaid", "upcoming", "upcoming"]);
  });

  it("shows p4, which never had a tenant, vacant from August on", () => {
    expect(states(view, "p4").slice(7)).toEqual(["vacant", "vacant", "vacant", "vacant", "vacant"]);
  });

  it("adds up what was entered and what was due: ₹ 59,400 of ₹ 92,285", () => {
    // August 27 150 + September 32 250 received; due those and October's 32 885 (5 450 + 13 335 + 9 000 + 5 100)
    expect(view.received).toBe(59400);
    expect(view.due).toBe(92285);
  });

  it("carries the money in each cell: the amount entered, the rent due, nothing for the rest", () => {
    expect(cellOf(view, "p2", 8)).toEqual({ month: { year: 2026, month: 8 }, state: "paid", received: 12700, due: 12700, shortBy: 0 });
    // October is unpaid for p2 at the hiked rent of a new cycle
    expect(cellOf(view, "p2", 10)).toEqual({ month: { year: 2026, month: 10 }, state: "unpaid", received: 0, due: 13335, shortBy: 0 });
    for (const [id, month] of [["p2", 11], ["p4", 9], ["p5", 8], ["p1", 3]] as const) {
      expect(cellOf(view, id, month)).toMatchObject({ received: 0, due: 0, shortBy: 0 });
    }
  });

  it("adds each row's cells, and the rows to the year", () => {
    expect(rowOf(view, "p1")).toMatchObject({ received: 10900, due: 10900 + 5450 });
    expect(rowOf(view, "p2")).toMatchObject({ received: 25400, due: 25400 + 13335 });
    expect(rowOf(view, "p3")).toMatchObject({ received: 18000, due: 18000 + 9000 });
    expect(rowOf(view, "p4")).toMatchObject({ received: 0, due: 0 });
    expect(rowOf(view, "p5")).toMatchObject({ received: 5100, due: 5100 + 5100 });
    for (const row of view.rows) {
      expect(row.received).toBe(row.cells.reduce((sum, cell) => sum + cell.received, 0));
      expect(row.due).toBe(row.cells.reduce((sum, cell) => sum + cell.due, 0));
    }
    expect(view.received).toBe(view.rows.reduce((sum, row) => sum + row.received, 0));
    expect(view.due).toBe(view.rows.reduce((sum, row) => sum + row.due, 0));
  });

  it("has data, and says when the Schedule starts", () => {
    expect(view.hasData).toBe(true);
    expect(view.firstMonth).toEqual({ year: 2026, month: 8 });
  });
});

describe("deriveYearView agrees with the month screen", () => {
  it("shows, for every month that has fallen due, what the month view received and what it counted as due", () => {
    const rows = baseRows([2026, 10, [["Asha", 4, 5000], null, ["Chitra", 6, 9000]]]);
    const view = deriveYearView(snapshot(rows), 2026, TODAY);
    for (let month = 8; month <= 10; month++) {
      const monthView = deriveMonthView(rows, PORTIONS, { year: 2026, month });
      const cells = view.rows.map((row) => row.cells[month - 1]);
      expect(cells.reduce((sum, cell) => sum + cell.received, 0)).toBe(monthView.received);
      expect(cells.reduce((sum, cell) => sum + cell.due, 0)).toBe(monthView.due);
    }
  });

  it("states a month the way its card does", () => {
    const rows = baseRows([2026, 10, [["Asha", 4, 5000], null, ["Chitra", 6, 9500]]]);
    const view = deriveYearView(snapshot(rows), 2026, TODAY);
    const oct = deriveMonthView(rows, PORTIONS, { year: 2026, month: 10 });
    expect(oct.cards.find((card) => card.portionId === "p1")?.rentDifference).toBe(-450);
    expect(cellOf(view, "p1", 10).state).toBe("partial");
    // more than the rent is paid
    expect(oct.cards.find((card) => card.portionId === "p3")?.rentDifference).toBe(500);
    expect(cellOf(view, "p3", 10)).toMatchObject({ state: "paid", received: 9500, due: 9000 });
  });
});

describe("deriveYearView: short and ahead", () => {
  it("shows a short month as partial, with what is short", () => {
    const view = deriveYearView(snapshot(baseRows([2026, 10, [["Asha", 4, 5000]]])), 2026, TODAY);
    expect(cellOf(view, "p1", 10)).toEqual({ month: { year: 2026, month: 10 }, state: "partial", received: 5000, due: 5450, shortBy: 450 });
    expect(rowOf(view, "p1")).toMatchObject({ received: 15900, due: 16350 });
  });

  it("shows a hiked month paid within the rounding allowance as paid, and beyond it as partial", () => {
    const hike = (amount: number) =>
      deriveYearView(snapshot(baseRows([2026, 10, [null, ["Bala", 1, amount]]])), 2026, TODAY);
    expect(cellOf(hike(13340), "p2", 10)).toMatchObject({ state: "paid", received: 13340, due: 13340, shortBy: 0 });
    expect(cellOf(hike(13300), "p2", 10)).toMatchObject({ state: "partial", received: 13300, due: 13335, shortBy: 35 });
  });

  it("shows a new tenant's first payment as paid, with the amount as the rent due", () => {
    const view = deriveYearView(snapshot(baseRows([2026, 10, [["Dev", 1, 100]]])), 2026, TODAY);
    expect(cellOf(view, "p1", 10)).toMatchObject({ state: "paid", received: 100, due: 100, shortBy: 0 });
  });

  it("counts a month paid ahead in both what was received and what is due", () => {
    const rows = baseRows([2026, 12, [["Asha", 4, 5450]]]);
    const view = deriveYearView(snapshot(rows), 2026, TODAY);
    expect(states(view, "p1").slice(7)).toEqual(["paid", "paid", "unpaid", "upcoming", "paid"]);
    expect(cellOf(view, "p1", 12)).toMatchObject({ received: 5450, due: 5450 });
    expect(view.received).toBe(59400 + 5450);
    expect(view.due).toBe(92285 + 5450);
  });

  it("shows a short month that is paid ahead as partial", () => {
    const view = deriveYearView(snapshot(baseRows([2026, 12, [["Asha", 4, 5000]]])), 2026, TODAY);
    expect(cellOf(view, "p1", 12)).toMatchObject({ state: "partial", shortBy: 450 });
  });

  it("does not count a month that is not due yet", () => {
    const view = deriveYearView(snapshot(baseRows()), 2026, TODAY);
    expect(cellOf(view, "p1", 11)).toMatchObject({ state: "upcoming", received: 0, due: 0 });
  });
});

describe("deriveYearView: today", () => {
  it("calls the new month not due yet through the fifth, and unpaid from the sixth", () => {
    const rows = baseRows();
    expect(cellOf(deriveYearView(snapshot(rows), 2026, "2026-10-05"), "p1", 10).state).toBe("upcoming");
    expect(cellOf(deriveYearView(snapshot(rows), 2026, "2026-10-06"), "p1", 10).state).toBe("unpaid");
    expect(cellOf(deriveYearView(snapshot(rows), 2026, "2026-10-01"), "p1", 9).state).toBe("paid");
  });

  it("shows January 2027 unpaid and the rest of 2027 not due yet on 10 January 2027", () => {
    const view = deriveYearView(snapshot(baseRows()), 2027, "2027-01-10");
    for (const id of ["p1", "p2", "p3", "p5"]) {
      expect(states(view, id)).toEqual(["unpaid", ...Array(11).fill("upcoming")]);
    }
    // p2 starts a new cycle: January is due at the hiked rent
    expect(cellOf(view, "p2", 1)).toMatchObject({ due: 13335 });
    expect(states(view, "p4")).toEqual(Array(12).fill("vacant"));
    // the months of the year before that are unpaid too: nobody has paid since September
    const before = deriveYearView(snapshot(baseRows()), 2026, "2027-01-10");
    expect(states(before, "p1").slice(7)).toEqual(["paid", "paid", "unpaid", "unpaid", "unpaid"]);
  });

  it("has no unpaid or part-paid month on a day before the Schedule starts", () => {
    const view = deriveYearView(snapshot(baseRows()), 2026, "2026-03-20");
    for (const row of view.rows) expect(row.cells.every((cell) => ["none", "vacant", "upcoming", "paid"].includes(cell.state))).toBe(true);
    expect(cellOf(view, "p1", 8).state).toBe("paid");
  });
});

describe("deriveYearView: a year with nothing in it", () => {
  it("has no data in 2025, and says the Schedule starts in August 2026", () => {
    const view = deriveYearView(snapshot(baseRows()), 2025, TODAY);
    expect(view.hasData).toBe(false);
    expect(view.firstMonth).toEqual({ year: 2026, month: 8 });
    expect(view.rows).toHaveLength(5);
    for (const row of view.rows) {
      expect(row.cells).toHaveLength(12);
      expect(row.cells.every((cell) => cell.state === "none" && cell.received === 0 && cell.due === 0)).toBe(true);
      expect(row).toMatchObject({ received: 0, due: 0 });
    }
    expect(view).toMatchObject({ received: 0, due: 0 });
  });

  it("has no data for a Schedule with no month rows, and no first month", () => {
    const view = deriveYearView(snapshot([]), 2026, TODAY);
    expect(view.hasData).toBe(false);
    expect(view.firstMonth).toBeNull();
    expect(view.rows).toHaveLength(5);
    expect(view.rows.every((row) => row.cells.every((cell) => cell.state === "none"))).toBe(true);
    expect(view).toMatchObject({ received: 0, due: 0 });
  });

  it("has data for a year after the Schedule: its months are not due yet", () => {
    const view = deriveYearView(snapshot(baseRows()), 2028, TODAY);
    expect(view.hasData).toBe(true);
    expect(states(view, "p1")).toEqual(Array(12).fill("upcoming"));
  });

  it("has no data when there are no portions", () => {
    const view = deriveYearView(snapshot(baseRows(), [], []), 2026, TODAY);
    expect(view).toMatchObject({ rows: [], received: 0, due: 0, hasData: false });
    expect(view.firstMonth).toEqual({ year: 2026, month: 8 });
  });

  it("has data for a Schedule whose months have no entries at all, every cell vacant from the first month", () => {
    const view = deriveYearView(snapshot(parsedRows([2026, 3], [2026, 4])), 2026, TODAY);
    expect(view.hasData).toBe(true);
    expect(states(view, "p1")).toEqual(["none", "none", "vacant", "vacant", "vacant", "vacant", "vacant", "vacant", "vacant", "vacant", "vacant", "vacant"]);
    expect(view).toMatchObject({ received: 0, due: 0 });
  });
});

describe("deriveYearView: a Schedule that starts mid-year", () => {
  const rows = parsedRows(
    [2026, 3, [["Asha", 1, 5000], ["Bala", 1, 12000]]],
    [2026, 4, [["Asha", 2, 5000], ["Bala", 2, 12000]]],
    [2026, 5, [["Asha", 3, 5000], null, ["Chitra", 1, 9000]]],
  );
  const view = deriveYearView(snapshot(rows), 2026, TODAY);

  it("has no record before March", () => {
    expect(states(view, "p1").slice(0, 2)).toEqual(["none", "none"]);
    expect(states(view, "p4").slice(0, 2)).toEqual(["none", "none"]);
    expect(view.firstMonth).toEqual({ year: 2026, month: 3 });
  });

  it("is vacant from March for a portion with no tenant yet, and unpaid for the months since the last payment", () => {
    expect(states(view, "p3").slice(2, 5)).toEqual(["vacant", "vacant", "paid"]);
    expect(states(view, "p1").slice(2)).toEqual(["paid", "paid", "paid", "unpaid", "unpaid", "unpaid", "unpaid", "unpaid", "upcoming", "upcoming"]);
    // Bala paid March and April only; May has no entry for p2
    expect(states(view, "p2").slice(2, 6)).toEqual(["paid", "paid", "unpaid", "unpaid"]);
  });

  it("has data, even though January and February have none", () => {
    expect(view.hasData).toBe(true);
    expect(view.received).toBe(5000 * 3 + 12000 * 2 + 9000);
  });
});

describe("deriveYearView: vacancy", () => {
  it("shows the months after a move-out on the 1st as vacant, from that month", () => {
    const view = deriveYearView(snapshot(baseRows(), [tenancyRow({ moveOut: "2026-10-01" })]), 2026, TODAY);
    expect(states(view, "p1").slice(7)).toEqual(["paid", "paid", "vacant", "vacant", "vacant"]);
    expect(view.due).toBe(92285 - 5450);
  });

  it("shows October as still due for a move-out on the 2nd, and November on as vacant", () => {
    const view = deriveYearView(snapshot(baseRows(), [tenancyRow({ moveOut: "2026-10-02" })]), 2026, TODAY);
    expect(states(view, "p1").slice(7)).toEqual(["paid", "paid", "unpaid", "vacant", "vacant"]);
  });

  it("shows a vacant gap in the middle of a year", () => {
    const rows = parsedRows(
      [2026, 1, [["Asha", 1, 5000]]],
      [2026, 2, [["Asha", 2, 5000]]],
      [2026, 3, [["Asha", 3, 5000]]],
      [2026, 9, [["Dev", 1, 6000]]],
    );
    const view = deriveYearView(snapshot(rows, [tenancyRow({ moveOut: "2026-03-31" })]), 2026, TODAY);
    expect(states(view, "p1")).toEqual([
      "paid", "paid", "paid", "vacant", "vacant", "vacant", "vacant", "vacant", "paid", "unpaid", "upcoming", "upcoming",
    ]);
  });
});

describe("deriveYearView: switched-off portions", () => {
  it("has no row for a switched-off portion with no card in the year", () => {
    const view = deriveYearView(snapshot(baseRows(), [], portionsWith({ p4: { inactive: true } })), 2026, TODAY);
    expect(view.rows.map((row) => row.portionId)).toEqual(["p1", "p2", "p3", "p5"]);
  });

  it("has a row for a switched-off portion that has entries in the year, with no record where it has no card", () => {
    // p3 moved out on 30 September: its cards are August and September, then none
    const moved = [tenancyRow({ portionId: "p3", tenant: "Chitra", moveOut: "2026-09-30" })];
    const view = deriveYearView(snapshot(baseRows(), moved, portionsWith({ p3: { inactive: true } })), 2026, TODAY);
    expect(view.rows.map((row) => row.portionId)).toEqual(["p1", "p2", "p3", "p4", "p5"]);
    expect(states(view, "p3").slice(7)).toEqual(["paid", "paid", "none", "none", "none"]);
    expect(rowOf(view, "p3")).toMatchObject({ received: 18000, due: 18000 });
  });

  it("keeps a switched-off portion's card in the months it is still let", () => {
    const view = deriveYearView(snapshot(baseRows(), [], portionsWith({ p3: { inactive: true } })), 2026, TODAY);
    expect(states(view, "p3").slice(7)).toEqual(["paid", "paid", "unpaid", "upcoming", "upcoming"]);
  });

  it("has no row for the portion in a year before its entries", () => {
    const moved = [tenancyRow({ portionId: "p3", tenant: "Chitra", moveOut: "2026-09-30" })];
    const view = deriveYearView(snapshot(baseRows(), moved, portionsWith({ p3: { inactive: true } })), 2025, TODAY);
    expect(view.rows.map((row) => row.portionId)).toEqual(["p1", "p2", "p4", "p5"]);
  });
});

describe("deriveYearView: odd rows", () => {
  it("is not changed by the order of the rows", () => {
    const sorted = parsedRows(
      [2026, 8, [["Asha", 2, 5450]]],
      [2026, 9, [["Asha", 3, 5450]]],
      [2026, 10, [["Asha", 4, 5450]]],
    );
    const jumbled = parsedRows(
      [2026, 10, [["Asha", 4, 5450]]],
      [2026, 8, [["Asha", 2, 5450]]],
      [2026, 9, [["Asha", 3, 5450]]],
    );
    expect(deriveYearView(snapshot(jumbled), 2026, TODAY)).toEqual(deriveYearView(snapshot(sorted), 2026, TODAY));
  });

  it("reads a month typed twice as the lower row", () => {
    const rows = parsedRows([2026, 8, [["Asha", 2, 5450]]], [2026, 9, [["Asha", 3, 5450]]], [2026, 9, [["Asha", 3, 5000]]]);
    const view = deriveYearView(snapshot(rows), 2026, TODAY);
    expect(cellOf(view, "p1", 9)).toMatchObject({ state: "partial", received: 5000, shortBy: 450 });
  });

  it("shows a blank month between two paid months as unpaid", () => {
    const rows = parsedRows([2026, 7, [["Asha", 1, 5000]]], [2026, 8], [2026, 9, [["Asha", 2, 5000]]]);
    const view = deriveYearView(snapshot(rows), 2026, TODAY);
    expect(states(view, "p1").slice(6, 9)).toEqual(["paid", "unpaid", "paid"]);
  });

  it("shows an entry with a rent of nothing as paid, for nothing", () => {
    const rows = parsedRows([2026, 9, [["Asha", 1, 0]]]);
    const view = deriveYearView(snapshot(rows), 2026, TODAY);
    expect(cellOf(view, "p1", 9)).toMatchObject({ state: "paid", received: 0, due: 0 });
    expect(cellOf(view, "p1", 10)).toMatchObject({ state: "unpaid", due: 0 });
  });

  it("shows a portion whose id is not a plain name", () => {
    const portions = portionsWith({ p1: { id: "__proto__" } });
    const rows = parseSchedule(baseSchedule(), portions, TOTAL_HEADER).rows;
    const view = deriveYearView(snapshot(rows, [], portions), 2026, TODAY);
    expect(view.rows.map((row) => row.portionId)).toEqual(["__proto__", "p2", "p3", "p4", "p5"]);
    expect(states(view, "__proto__").slice(7)).toEqual(["paid", "paid", "unpaid", "upcoming", "upcoming"]);
  });
});

describe("yearBounds", () => {
  it("is the Schedule's first year to the later of its last year and this year", () => {
    expect(yearBounds(baseRows(), TODAY)).toEqual({ first: 2026, last: 2026 });
    expect(yearBounds(baseRows(), "2027-01-10")).toEqual({ first: 2026, last: 2027 });
    expect(yearBounds(parsedRows([2024, 3, [["Asha", 1, 5000]]], [2026, 5]), TODAY)).toEqual({ first: 2024, last: 2026 });
  });

  it("reaches the Schedule's last year when it is after this year", () => {
    expect(yearBounds(parsedRows([2026, 8], [2028, 2]), TODAY)).toEqual({ first: 2026, last: 2028 });
  });

  it("is this year alone when there are no rows", () => {
    expect(yearBounds([], TODAY)).toEqual({ first: 2026, last: 2026 });
    expect(yearBounds([], "2027-01-01")).toEqual({ first: 2027, last: 2027 });
  });

  it("does not depend on the order of the rows", () => {
    expect(yearBounds(parsedRows([2028, 2], [2024, 6], [2026, 8]), TODAY)).toEqual({ first: 2024, last: 2028 });
  });

  it("takes the year of the India day it is given", () => {
    expect(yearBounds(baseRows(), "2026-12-31")).toEqual({ first: 2026, last: 2026 });
    expect(yearBounds(baseRows(), "2027-01-01")).toEqual({ first: 2026, last: 2027 });
  });
});

describe("parseYear", () => {
  it("accepts a whole year from 2000 to 2100", () => {
    expect(parseYear("2026")).toBe(2026);
    expect(parseYear("2000")).toBe(2000);
    expect(parseYear("2100")).toBe(2100);
  });

  it("reads the first of several values, as the month parameter does", () => {
    expect(parseYear(["2027", "2026"])).toBe(2027);
    expect(parseYear(["abc", "2026"])).toBeNull();
    expect(parseYear([])).toBeNull();
  });

  it("is null for anything else", () => {
    for (const bad of ["1999", "2101", "26", "02026", "20260", "2026.0", "2026.5", " 2026", "2026 ", "+2026", "-2026", "2026e0", "0x7EA", "abc", "", "2026-10", "٢٠٢٦"]) {
      expect(parseYear(bad), bad).toBeNull();
    }
    expect(parseYear(undefined)).toBeNull();
    expect(parseYear(null)).toBeNull();
  });
});
