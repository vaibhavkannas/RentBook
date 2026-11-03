import { describe, expect, it } from "vitest";
import {
  AGREEMENT_NOTICE_DAYS,
  agreementAlerts,
  HIKE_NOTICE_MONTHS,
  hikeAlerts,
  hikeMonthFor,
} from "@/lib/domain/alerts";
import type { Tenancy } from "@/lib/domain/tenancy";
import type { PortionConfig, RentSnapshot, ScheduleRow, YearMonth } from "@/lib/domain/types";
import { todayIso } from "@/lib/domain/year-month";
import { baseRows, type Entry, parsedRows, PORTIONS, tenancyRow } from "../support/fixtures";

const TODAY = "2026-10-17";
const month = (year: number, m: number): YearMonth => ({ year, month: m });

const snapshot = (
  rows: ScheduleRow[],
  tenancies: Tenancy[] = [],
  portions: PortionConfig[] = PORTIONS,
): RentSnapshot => ({ rows, portions, tenancies });

const portionsWith = (changes: Record<string, Partial<PortionConfig>>): PortionConfig[] =>
  PORTIONS.map((portion) => ({ ...portion, ...changes[portion.id] }));

/** p1's entries in the given months (a [year, month, count, amount] each), and nobody else's. */
const p1Rows = (...entries: Array<[year: number, month: number, count: number, amount?: number]>) =>
  parsedRows(...entries.map(([year, m, count, amount = 5450]): [number, number, Entry[]] => [year, m, [["Asha", count, amount]]]));

describe("the notice periods", () => {
  it("are 60 days for an agreement and 2 months for a hike", () => {
    expect(AGREEMENT_NOTICE_DAYS).toBe(60);
    expect(HIKE_NOTICE_MONTHS).toBe(2);
  });
});

describe("hikeMonthFor", () => {
  it("is the month after the cycle's last payment, one payment a month", () => {
    // count 11 of 11 in September: the next payment (October) starts a new cycle
    expect(hikeMonthFor(month(2026, 9), 11, 11)).toEqual({ hikeMonth: month(2026, 10), paymentsLeft: 0 });
    // count 9 in September: October is 10, November is 11, December starts the new cycle
    expect(hikeMonthFor(month(2026, 9), 9, 11)).toEqual({ hikeMonth: month(2026, 12), paymentsLeft: 2 });
    expect(hikeMonthFor(month(2026, 9), 10, 11)).toEqual({ hikeMonth: month(2026, 11), paymentsLeft: 1 });
    expect(hikeMonthFor(month(2026, 9), 1, 11)).toEqual({ hikeMonth: month(2027, 8), paymentsLeft: 10 });
  });

  it("goes over a year end", () => {
    expect(hikeMonthFor(month(2026, 12), 11, 11)).toEqual({ hikeMonth: month(2027, 1), paymentsLeft: 0 });
    expect(hikeMonthFor(month(2026, 11), 8, 11)).toEqual({ hikeMonth: month(2027, 3), paymentsLeft: 3 });
  });

  it("starts the new cycle at once for a count at or past the cycle, as the card does", () => {
    expect(hikeMonthFor(month(2026, 9), 12, 11)).toEqual({ hikeMonth: month(2026, 10), paymentsLeft: 0 });
    expect(hikeMonthFor(month(2026, 9), 500, 11)).toEqual({ hikeMonth: month(2026, 10), paymentsLeft: 0 });
    expect(hikeMonthFor(month(2026, 9), 1, 1)).toEqual({ hikeMonth: month(2026, 10), paymentsLeft: 0 });
  });

  it("is null when the count never resets", () => {
    expect(hikeMonthFor(month(2026, 9), 5, null)).toBeNull();
  });

  it("counts the payments left the way the card counts, for a count that is not a whole number", () => {
    // 10.5 then 11.5: the second payment is at or past 11, so the one after it starts the cycle
    expect(hikeMonthFor(month(2026, 9), 10.5, 11)).toEqual({ hikeMonth: month(2026, 11), paymentsLeft: 1 });
    expect(hikeMonthFor(month(2026, 9), 8.2, 11)).toEqual({ hikeMonth: month(2027, 1), paymentsLeft: 3 });
    expect(hikeMonthFor(month(2026, 9), 0, 11)).toEqual({ hikeMonth: month(2027, 9), paymentsLeft: 11 });
    expect(hikeMonthFor(month(2026, 9), -2, 11)).toEqual({ hikeMonth: month(2027, 11), paymentsLeft: 13 });
  });

  it("is null for a count that is not a number", () => {
    expect(hikeMonthFor(month(2026, 9), Number.NaN, 11)).toBeNull();
    expect(hikeMonthFor(month(2026, 9), Number.POSITIVE_INFINITY, 11)).toBeNull();
  });
});

describe("hikeAlerts on the base Schedule, today 17 October 2026", () => {
  it("has one alert: p2, whose cycle ended in September, due with the next payment", () => {
    expect(hikeAlerts(snapshot(baseRows()), TODAY)).toEqual([
      {
        portionId: "p2",
        name: "First floor, double bedroom",
        tenant: "Bala",
        hikeMonth: month(2026, 10),
        paymentsLeft: 0,
        currentRent: 12700,
        newRent: 13335,
        hikePercent: 5,
        state: "due",
      },
    ]);
  });

  it("has none when nothing is near", () => {
    expect(hikeAlerts(snapshot([]), TODAY)).toEqual([]);
    expect(hikeAlerts(snapshot(baseRows(), [], []), TODAY)).toEqual([]);
    expect(hikeAlerts(snapshot(parsedRows([2026, 8], [2026, 9])), TODAY)).toEqual([]);
  });
});

describe("hikeAlerts: when the hike is near", () => {
  const alertFor = (rows: ScheduleRow[], today = TODAY, id = "p1") => hikeAlerts(snapshot(rows), today).find((a) => a.portionId === id);

  it("is soon for a September count of 9: the hike is with the payment for December", () => {
    const alert = alertFor(p1Rows([2026, 8, 8], [2026, 9, 9]));
    expect(alert).toMatchObject({
      hikeMonth: month(2026, 12),
      paymentsLeft: 2,
      currentRent: 5450,
      newRent: 5723,
      hikePercent: 5,
      state: "soon",
      tenant: "Asha",
    });
  });

  it("is soon for a count of 10 (November), due for 11 (October), and nothing for 8 (January)", () => {
    expect(alertFor(p1Rows([2026, 9, 10]))).toMatchObject({ hikeMonth: month(2026, 11), state: "soon", paymentsLeft: 1 });
    expect(alertFor(p1Rows([2026, 9, 11]))).toMatchObject({ hikeMonth: month(2026, 10), state: "due", paymentsLeft: 0 });
    expect(alertFor(p1Rows([2026, 9, 8]))).toBeUndefined();
    expect(alertFor(p1Rows([2026, 9, 9]))).toBeDefined();
  });

  it("is due when the month of the hike has come or gone, as when the owner is behind with the Schedule", () => {
    // count 11 in August and nothing since: the hike was with September's payment
    expect(alertFor(p1Rows([2026, 8, 11]))).toMatchObject({ hikeMonth: month(2026, 9), state: "due", paymentsLeft: 0 });
    // count 9 in June, nothing since: July, August are the 10th and 11th, September carries the hike
    expect(alertFor(p1Rows([2026, 6, 9]))).toMatchObject({ hikeMonth: month(2026, 9), state: "due", paymentsLeft: 2 });
  });

  it("is soon, not due, when the owner has paid ahead and the hike is with a later month", () => {
    // count 11 paid for November: December carries the hike, which is within two months of October
    expect(alertFor(p1Rows([2026, 11, 11]))).toMatchObject({ hikeMonth: month(2026, 12), state: "soon", paymentsLeft: 0 });
    // paid for December: January is beyond the two months
    expect(alertFor(p1Rows([2026, 12, 11]))).toBeUndefined();
  });

  it("starts looking two months ahead of the month today is in", () => {
    // hike with the payment for December: soon on 1 October, none on 30 September
    const rows = p1Rows([2026, 9, 9]);
    expect(alertFor(rows, "2026-10-01")).toMatchObject({ state: "soon" });
    expect(alertFor(rows, "2026-09-30")).toBeUndefined();
    expect(alertFor(rows, "2026-12-01")).toMatchObject({ state: "due" });
    expect(alertFor(rows, "2026-11-30")).toMatchObject({ state: "soon" });
  });

  it("moves on India midnight", () => {
    const rows = p1Rows([2026, 9, 9]);
    // 1 October in India begins at 18:30 UTC on 30 September
    expect(alertFor(rows, todayIso(new Date("2026-09-30T18:29:59Z")))).toBeUndefined();
    expect(alertFor(rows, todayIso(new Date("2026-09-30T18:30:00Z")))).toMatchObject({ state: "soon" });
  });

  it("goes over a year end", () => {
    // December count 11: the hike is with January's payment, soon in November and due in January
    expect(alertFor(p1Rows([2026, 12, 11]), "2026-11-20")).toMatchObject({ hikeMonth: month(2027, 1), state: "soon" });
    expect(alertFor(p1Rows([2026, 12, 11]), "2027-01-02")).toMatchObject({ hikeMonth: month(2027, 1), state: "due" });
  });

  it("uses the latest entry, whatever the order of the rows", () => {
    const rows = parsedRows(
      [2026, 9, [["Asha", 11, 5450]]],
      [2026, 7, [["Asha", 9, 5450]]],
      [2026, 8, [["Asha", 10, 5450]]],
    );
    expect(alertFor(rows)).toMatchObject({ hikeMonth: month(2026, 10), state: "due" });
  });

  it("works from the amount of the latest payment, with the portion's own percent", () => {
    const rows = p1Rows([2026, 9, 11, 10000]);
    expect(alertFor(rows)).toMatchObject({ currentRent: 10000, newRent: 10500 });
    const portions = portionsWith({ p1: { hikePercent: 2.5 } });
    const [alert] = hikeAlerts(snapshot(rows, [], portions), TODAY).filter((a) => a.portionId === "p1");
    expect(alert).toMatchObject({ newRent: 10250, hikePercent: 2.5 });
  });

  it("rounds the new rent as the card does, a half rupee up and in whole basis points", () => {
    // 20 500 at 0.1% is exactly 20 520.5: the card suggests 20 521
    const portions = portionsWith({ p1: { hikePercent: 0.1 } });
    const [alert] = hikeAlerts(snapshot(p1Rows([2026, 9, 11, 20500]), [], portions), TODAY);
    expect(alert.newRent).toBe(20521);
  });
});

describe("hikeAlerts: when there is none", () => {
  const rows = p1Rows([2026, 9, 11]);

  it("has none when the count never resets", () => {
    expect(hikeAlerts(snapshot(rows, [], portionsWith({ p1: { cycleLength: null } })), TODAY)).toEqual([]);
  });

  it("has none when the hike is 0 %, or changes nothing", () => {
    expect(hikeAlerts(snapshot(rows, [], portionsWith({ p1: { hikePercent: 0 } })), TODAY)).toEqual([]);
    // a hike too small to change a whole rupee of rent
    expect(hikeAlerts(snapshot(p1Rows([2026, 9, 11, 100]), [], portionsWith({ p1: { hikePercent: 0.1 } })), TODAY)).toEqual([]);
    expect(hikeAlerts(snapshot(p1Rows([2026, 9, 11, 0])), TODAY)).toEqual([]);
  });

  it("has none for a portion that is vacant this month", () => {
    const left = [tenancyRow({ moveOut: "2026-10-01" })];
    expect(hikeAlerts(snapshot(rows, left), TODAY)).toEqual([]);
    // moved out on the 2nd: the portion is let this month, and the alert stays
    expect(hikeAlerts(snapshot(rows, [tenancyRow({ moveOut: "2026-10-02" })]), TODAY)).toHaveLength(1);
    // moved out on 30 September (after September's rent): vacant from October
    expect(hikeAlerts(snapshot(rows, [tenancyRow({ moveOut: "2026-09-30" })]), TODAY)).toEqual([]);
  });

  it("has none for a portion that is switched off", () => {
    expect(hikeAlerts(snapshot(baseRows(), [], portionsWith({ p2: { inactive: true } })), TODAY)).toEqual([]);
  });

  it("has none for a portion with no payment, or one that never had a tenant", () => {
    expect(hikeAlerts(snapshot(baseRows()), TODAY).some((a) => a.portionId === "p4")).toBe(false);
    expect(hikeAlerts(snapshot(parsedRows([2026, 9, []])), TODAY)).toEqual([]);
  });

  it("has none for a count that is not a number the card could count", () => {
    expect(hikeAlerts(snapshot(parsedRows([2026, 9, [["Asha", Number.NaN, 5450]]])), TODAY)).toEqual([]);
  });
});

describe("hikeAlerts: order", () => {
  it("lists the earliest hike first, then Settings order", () => {
    const rows = parsedRows(
      [2026, 9, [["Asha", 10, 5450], ["Bala", 11, 12700], ["Chitra", 11, 9000], null, ["Esha", 11, 5100]]],
    );
    const alerts = hikeAlerts(snapshot(rows), TODAY);
    // p1 is the 10th payment (November); p2, p3 and p5 are due in October
    expect(alerts.map((a) => [a.portionId, a.hikeMonth.month, a.state])).toEqual([
      ["p2", 10, "due"],
      ["p3", 10, "due"],
      ["p5", 10, "due"],
      ["p1", 11, "soon"],
    ]);
    const reversed = hikeAlerts(snapshot(rows, [], [...PORTIONS].reverse()), TODAY);
    expect(reversed.map((a) => a.portionId)).toEqual(["p5", "p3", "p2", "p1"]);
  });

  it("puts a hike that was due in an earlier month before one due this month", () => {
    const rows = parsedRows(
      [2026, 8, [null, null, ["Chitra", 11, 9000]]],
      [2026, 9, [["Asha", 3, 5450], ["Bala", 11, 12700]]],
    );
    expect(hikeAlerts(snapshot(rows), TODAY).map((a) => [a.portionId, a.hikeMonth.month])).toEqual([["p3", 9], ["p2", 10]]);
  });
});

describe("agreementAlerts", () => {
  const withEnd = (agreementEnd: string, overrides: Partial<Tenancy> = {}) => [tenancyRow({ agreementEnd, ...overrides })];
  const alerts = (tenancies: Tenancy[], today = TODAY, rows = baseRows()) => agreementAlerts(snapshot(rows, tenancies), today);

  it("is soon for an end 45 days away", () => {
    expect(alerts(withEnd("2026-12-01"))).toEqual([
      {
        portionId: "p1",
        name: "First floor, single bedroom",
        tenant: "Asha",
        agreementEnd: "2026-12-01",
        days: 45,
        state: "soon",
      },
    ]);
  });

  it("is soon up to 60 days, and nothing from 61", () => {
    expect(alerts(withEnd("2026-12-16"))).toEqual([expect.objectContaining({ days: 60, state: "soon" })]);
    expect(alerts(withEnd("2026-12-17"))).toEqual([]);
    expect(alerts(withEnd("2027-06-30"))).toEqual([]);
  });

  it("is soon for the next day, today for today and ended for yesterday", () => {
    expect(alerts(withEnd("2026-10-18"))).toEqual([expect.objectContaining({ days: 1, state: "soon" })]);
    expect(alerts(withEnd("2026-10-17"))).toEqual([expect.objectContaining({ days: 0, state: "today" })]);
    expect(alerts(withEnd("2026-10-16"))).toEqual([expect.objectContaining({ days: -1, state: "ended" })]);
  });

  it("is ended, with the days since, for an end that has gone by, and stays so", () => {
    expect(alerts(withEnd("2026-10-05"))).toEqual([expect.objectContaining({ days: -12, state: "ended" })]);
    expect(alerts(withEnd("2024-01-31"))).toEqual([expect.objectContaining({ days: -990, state: "ended" })]);
  });

  it("moves 'today' to 'ended' on India midnight", () => {
    const end = withEnd("2026-10-17");
    expect(alerts(end, todayIso(new Date("2026-10-16T18:29:59Z")))[0]).toMatchObject({ days: 1, state: "soon" });
    expect(alerts(end, todayIso(new Date("2026-10-16T18:30:00Z")))[0]).toMatchObject({ days: 0, state: "today" });
    expect(alerts(end, todayIso(new Date("2026-10-17T18:29:59Z")))[0]).toMatchObject({ days: 0, state: "today" });
    expect(alerts(end, todayIso(new Date("2026-10-17T18:30:00Z")))[0]).toMatchObject({ days: -1, state: "ended" });
  });

  it("counts the leap day", () => {
    expect(alerts(withEnd("2028-02-29"), "2028-02-01", parsedRows([2028, 1, [["Asha", 1, 5000]]]))).toEqual([
      expect.objectContaining({ days: 28, state: "soon" }),
    ]);
    expect(alerts(withEnd("2028-03-01"), "2028-02-28")[0].days).toBe(2);
  });

  it("reads the tenant's name in another case, or with spaces around it, as the Schedule's tenant", () => {
    expect(alerts(withEnd("2026-12-01", { tenant: "ASHA " }))).toHaveLength(1);
    expect(alerts(withEnd("2026-12-01", { tenant: "asha" }))[0].tenant).toBe("asha");
  });

  it("has no alert for an open tenancy of another name than the Schedule's latest tenant", () => {
    expect(alerts(withEnd("2026-12-01", { tenant: "Dev" }))).toEqual([]);
    // the Schedule's tenant changed to Dev: the old details of Asha are not the current tenant's
    const rows = baseRows([2026, 10, [["Dev", 1, 5500]]]);
    expect(alerts(withEnd("2026-12-01"), TODAY, rows)).toEqual([]);
    expect(alerts(withEnd("2026-12-01", { tenant: "Dev" }), TODAY, rows)).toHaveLength(1);
  });

  it("has no alert for a tenancy that has a move-out, even one still to come", () => {
    expect(alerts(withEnd("2026-12-01", { moveOut: "2026-11-30" }))).toEqual([]);
    expect(alerts(withEnd("2026-10-05", { moveOut: "2026-10-06" }))).toEqual([]);
    expect(alerts(withEnd("2026-12-01", { moveOut: "soon" }))).toEqual([]);
  });

  it("has no alert for an agreement end that is blank, spaces, text or not a real day", () => {
    for (const end of ["", "   ", "March next year", "2027-02-30", "2026-13-01", "26-12-01", "2026-12-1", "0000-00-00"]) {
      expect(alerts(withEnd(end)), end).toEqual([]);
    }
  });

  it("trims the agreement end", () => {
    expect(alerts(withEnd(" 2026-12-01 "))).toEqual([expect.objectContaining({ agreementEnd: "2026-12-01", days: 45 })]);
  });

  it("has no alert for a portion with no tenant on the Schedule, or with no details on file", () => {
    expect(alerts(withEnd("2026-12-01", { portionId: "p4", tenant: "Dev" }))).toEqual([]);
    expect(alerts([])).toEqual([]);
    expect(alerts(withEnd("2026-12-01", { portionId: "nope" }))).toEqual([]);
    expect(alerts(withEnd("2026-12-01"), TODAY, [])).toEqual([]);
  });

  it("looks at the portion's current tenancy only: the last open row", () => {
    // an older open row for the same portion is not the current one
    const rows = [
      tenancyRow({ rowNumber: 2, id: "t-1", agreementEnd: "2026-10-05" }),
      tenancyRow({ rowNumber: 3, id: "t-2", agreementEnd: "2026-12-01" }),
    ];
    expect(alerts(rows)).toEqual([expect.objectContaining({ agreementEnd: "2026-12-01" })]);
    // a closed row after an open one does not hide it
    const closedAfter = [tenancyRow({ rowNumber: 2, agreementEnd: "2026-12-01" }), tenancyRow({ rowNumber: 3, id: "t-2", moveOut: "2026-01-01", agreementEnd: "2026-10-05" })];
    expect(alerts(closedAfter)).toEqual([expect.objectContaining({ agreementEnd: "2026-12-01" })]);
  });

  it("still alerts for a switched-off portion that is let", () => {
    const tenancies = [tenancyRow({ portionId: "p3", tenant: "Chitra", agreementEnd: "2026-12-01", id: "t-3" })];
    const found = agreementAlerts(snapshot(baseRows(), tenancies, portionsWith({ p3: { inactive: true } })), TODAY);
    expect(found).toEqual([expect.objectContaining({ portionId: "p3" })]);
  });

  it("lists ended first, the longest past first, then the soonest, then Settings order", () => {
    const tenancies = [
      tenancyRow({ id: "t-1", portionId: "p1", tenant: "Asha", agreementEnd: "2026-10-05" }), // ended 12 days
      tenancyRow({ id: "t-2", portionId: "p2", tenant: "Bala", agreementEnd: "2026-10-27" }), // 10 days
      tenancyRow({ id: "t-3", portionId: "p3", tenant: "Chitra", agreementEnd: "2026-09-07" }), // ended 40 days
      tenancyRow({ id: "t-5", portionId: "p5", tenant: "Esha", agreementEnd: "2026-10-17" }), // today
    ];
    expect(alerts(tenancies).map((a) => [a.portionId, a.days, a.state])).toEqual([
      ["p3", -40, "ended"],
      ["p1", -12, "ended"],
      ["p5", 0, "today"],
      ["p2", 10, "soon"],
    ]);
  });

  it("keeps Settings order for equal days", () => {
    const tenancies = [
      tenancyRow({ id: "t-3", portionId: "p3", tenant: "Chitra", agreementEnd: "2026-11-01" }),
      tenancyRow({ id: "t-1", portionId: "p1", tenant: "Asha", agreementEnd: "2026-11-01" }),
    ];
    expect(alerts(tenancies).map((a) => a.portionId)).toEqual(["p1", "p3"]);
  });
});
