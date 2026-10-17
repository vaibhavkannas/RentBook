import { describe, expect, it } from "vitest";
import { latestEntryRow, firstVacantMonth, occupancyFor, vacancyOf } from "@/lib/domain/vacancy";
import type { Tenancy } from "@/lib/domain/tenancy";
import type { ScheduleRow, YearMonth } from "@/lib/domain/types";
import { parseSchedule } from "@/lib/sheets/schedule";
import { baseSchedule, monthCell, PORTIONS, scheduleRow, TOTAL_HEADER } from "../support/fixtures";

const OCT: YearMonth = { year: 2026, month: 10 };
const NOV: YearMonth = { year: 2026, month: 11 };
const DEC: YearMonth = { year: 2026, month: 12 };

type Entry = [tenant: string, count: number, amount: number] | null;

/** The base Schedule (August and September) plus October with the given entries for p1 to p5. */
function scheduleWith(...later: Array<[month: number, entries: Entry[]]>): ScheduleRow[] {
  const extra = later.map(([month, entries], index) =>
    scheduleRow(monthCell("text", 2026, month), entries, 6 + index),
  );
  return parseSchedule([...baseSchedule(), ...extra], PORTIONS, TOTAL_HEADER).rows;
}

/** Asha (p1) has paid October. */
const ASHA_PAID_OCT = scheduleWith([10, [["Asha", 4, 5450], null, null, null, null]]);

function tenancy(overrides: Partial<Tenancy> = {}): Tenancy {
  return {
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
    moveOut: "",
    updatedBy: "owner@example.com",
    updatedAt: "2026-01-15T05:00:00.000Z",
    ...overrides,
  };
}

const movedOut = (day: string, overrides: Partial<Tenancy> = {}) => tenancy({ moveOut: day, ...overrides });

describe("firstVacantMonth", () => {
  it("is the month of the move-out when it is on the 1st, and the month after otherwise", () => {
    expect(firstVacantMonth("2026-11-01")).toEqual(NOV);
    expect(firstVacantMonth("2026-11-02")).toEqual(DEC);
    expect(firstVacantMonth("2026-10-20")).toEqual(NOV);
    expect(firstVacantMonth("2026-10-31")).toEqual(NOV);
  });

  it("goes over a year end", () => {
    expect(firstVacantMonth("2026-12-31")).toEqual({ year: 2027, month: 1 });
    expect(firstVacantMonth("2027-01-01")).toEqual({ year: 2027, month: 1 });
  });
});

describe("occupancyFor", () => {
  it("is occupied when the portion has an entry for the month", () => {
    const left = [movedOut("2026-10-20")];
    expect(occupancyFor(ASHA_PAID_OCT, left, "p1", OCT)).toEqual({ state: "occupied" });
    // even when the tenant moved out before that month began
    expect(occupancyFor(ASHA_PAID_OCT, [movedOut("2026-09-10")], "p1", OCT)).toEqual({ state: "occupied" });
  });

  it("is never when the portion has no entry in any earlier month, whatever the Tenants tab says", () => {
    expect(occupancyFor(ASHA_PAID_OCT, [], "p4", OCT)).toEqual({ state: "never" });
    expect(occupancyFor(ASHA_PAID_OCT, [movedOut("2026-01-10", { portionId: "p4", tenant: "Dev" })], "p4", OCT)).toEqual({
      state: "never",
    });
    expect(occupancyFor(ASHA_PAID_OCT, [tenancy({ portionId: "p4", tenant: "Dev" })], "p4", OCT)).toEqual({ state: "never" });
    // p5 started in September: nothing before it
    expect(occupancyFor(ASHA_PAID_OCT, [], "p5", { year: 2026, month: 9 })).toEqual({ state: "occupied" });
    expect(occupancyFor(ASHA_PAID_OCT, [], "p5", { year: 2026, month: 8 })).toEqual({ state: "never" });
  });

  describe("a tenant who moves out on 20 October, with October paid", () => {
    const left = [movedOut("2026-10-20")];

    it("leaves October paid, and November and December vacant since the move-out", () => {
      expect(occupancyFor(ASHA_PAID_OCT, left, "p1", OCT)).toEqual({ state: "occupied" });
      expect(occupancyFor(ASHA_PAID_OCT, left, "p1", NOV)).toEqual({ state: "vacant", since: "2026-10-20", previousTenant: "Asha" });
      expect(occupancyFor(ASHA_PAID_OCT, left, "p1", DEC)).toEqual({ state: "vacant", since: "2026-10-20", previousTenant: "Asha" });
      expect(occupancyFor(ASHA_PAID_OCT, left, "p1", { year: 2027, month: 6 })).toMatchObject({ state: "vacant" });
    });

    it("leaves the other portions as they were", () => {
      expect(occupancyFor(ASHA_PAID_OCT, left, "p2", NOV)).toEqual({ state: "occupied" });
      expect(occupancyFor(ASHA_PAID_OCT, left, "p3", NOV)).toEqual({ state: "occupied" });
      expect(occupancyFor(ASHA_PAID_OCT, left, "p4", NOV)).toEqual({ state: "never" });
    });

    it("says the previous tenant as the Schedule writes the name", () => {
      const rows = scheduleWith([10, [["  ASHA ", 4, 5450], null, null, null, null]]);
      expect(occupancyFor(rows, left, "p1", NOV)).toMatchObject({ state: "vacant", previousTenant: "ASHA" });
    });
  });

  describe("the 1st of the month", () => {
    it("makes a month vacant when the tenant moved out on its 1st", () => {
      expect(occupancyFor(ASHA_PAID_OCT, [movedOut("2026-11-01")], "p1", NOV)).toEqual({
        state: "vacant",
        since: "2026-11-01",
        previousTenant: "Asha",
      });
    });

    it("leaves a month due when the tenant moved out after its 1st, and makes the next month vacant", () => {
      const left = [movedOut("2026-11-02")];
      expect(occupancyFor(ASHA_PAID_OCT, left, "p1", NOV)).toEqual({ state: "occupied" });
      expect(occupancyFor(ASHA_PAID_OCT, left, "p1", DEC)).toEqual({ state: "vacant", since: "2026-11-02", previousTenant: "Asha" });
    });

    it("makes the month the tenant left in vacant when they moved out before it began", () => {
      // moved out 30 September, October not paid: October is vacant
      const rows = scheduleWith();
      expect(occupancyFor(rows, [movedOut("2026-09-30")], "p1", OCT)).toMatchObject({ state: "vacant", since: "2026-09-30" });
    });
  });

  it("is occupied when rent was logged after the move-out", () => {
    // moved out in September, yet October was paid: the Sheet says the tenant stayed, so later months are due
    const left = [movedOut("2026-09-10")];
    expect(occupancyFor(ASHA_PAID_OCT, left, "p1", NOV)).toEqual({ state: "occupied" });
    expect(occupancyFor(ASHA_PAID_OCT, left, "p1", DEC)).toEqual({ state: "occupied" });
  });

  it("is occupied when a new tenant with the leaver's name has been paid since", () => {
    const rows = scheduleWith(
      [10, [["Asha", 4, 5450], null, null, null, null]],
      [11, [["Asha", 1, 6000], null, null, null, null]],
    );
    expect(occupancyFor(rows, [movedOut("2026-10-20")], "p1", DEC)).toEqual({ state: "occupied" });
  });

  it("is occupied when the portion has an open tenancy, whoever it is for", () => {
    const left = [movedOut("2026-10-20", { rowNumber: 2 }), tenancy({ rowNumber: 3, id: "t-2", tenant: "Hari" })];
    expect(occupancyFor(ASHA_PAID_OCT, left, "p1", NOV)).toEqual({ state: "occupied" });
    // an open tenancy of the same name too
    expect(
      occupancyFor(ASHA_PAID_OCT, [movedOut("2026-10-20", { rowNumber: 2 }), tenancy({ rowNumber: 3, id: "t-2" })], "p1", NOV),
    ).toEqual({ state: "occupied" });
  });

  it("is occupied when the only open tenancy belongs to another portion", () => {
    const left = [movedOut("2026-10-20"), tenancy({ rowNumber: 3, id: "t-2", portionId: "p2", tenant: "Bala" })];
    expect(occupancyFor(ASHA_PAID_OCT, left, "p1", NOV)).toMatchObject({ state: "vacant" });
  });

  it("ignores a move-out that is not a date", () => {
    for (const text of ["soon", "30 Sep", "2026-02-30", "next month"]) {
      expect(occupancyFor(ASHA_PAID_OCT, [movedOut(text)], "p1", NOV), text).toEqual({ state: "occupied" });
    }
  });

  it("is occupied when the Tenants tab has no move-out for the tenant on the card", () => {
    expect(occupancyFor(ASHA_PAID_OCT, [], "p1", NOV)).toEqual({ state: "occupied" });
    // a past tenancy of someone else does not make the portion vacant
    expect(occupancyFor(ASHA_PAID_OCT, [movedOut("2026-01-31", { tenant: "Bala" })], "p1", NOV)).toEqual({ state: "occupied" });
    // nor one of another portion with the same tenant name
    expect(occupancyFor(ASHA_PAID_OCT, [movedOut("2026-10-20", { portionId: "p2" })], "p1", NOV)).toEqual({ state: "occupied" });
  });

  it("matches the tenant name ignoring capitals and spaces around it", () => {
    expect(occupancyFor(ASHA_PAID_OCT, [movedOut("2026-10-20", { tenant: "  aSHa " })], "p1", NOV)).toMatchObject({ state: "vacant" });
  });

  it("uses the portion's most recent past tenancy of that name", () => {
    // an old tenancy of Asha that ended in March, and the latest one that ended on 20 October
    const left = [
      movedOut("2026-03-31", { rowNumber: 2, id: "t-old" }),
      movedOut("2026-10-20", { rowNumber: 3, id: "t-new" }),
    ];
    expect(occupancyFor(ASHA_PAID_OCT, left, "p1", NOV)).toEqual({ state: "vacant", since: "2026-10-20", previousTenant: "Asha" });
    // an old move-out alone says rent was logged after it
    expect(occupancyFor(ASHA_PAID_OCT, [left[0]], "p1", NOV)).toEqual({ state: "occupied" });
  });

  it("looks at the latest entry before the month, not at the month before", () => {
    // November has no entry and December is looked at: the latest earlier entry is October's
    const rows = scheduleWith([10, [["Asha", 4, 5450], null, null, null, null]], [11, [null, null, null, null, null]]);
    expect(occupancyFor(rows, [movedOut("2026-10-20")], "p1", DEC)).toMatchObject({ state: "vacant" });
  });

  it("looks only at entries before the month it is asked about", () => {
    // Asha paid October and November; she moved out in October: but November was paid, so every later month is due
    const rows = scheduleWith(
      [10, [["Asha", 4, 5450], null, null, null, null]],
      [11, [["Asha", 5, 5450], null, null, null, null]],
    );
    expect(occupancyFor(rows, [movedOut("2026-10-20")], "p1", DEC)).toEqual({ state: "occupied" });
  });
});

describe("vacancyOf", () => {
  it("is the latest vacancy of the portion: since the move-out and who moved out", () => {
    expect(vacancyOf(ASHA_PAID_OCT, [movedOut("2026-10-20")], "p1")).toEqual({ since: "2026-10-20", previousTenant: "Asha" });
  });

  it("is the vacancy whatever the month is, even one that is still paid", () => {
    // the move-out is on 20 December, so November is not vacant, but the tenant page says since when
    const rows = scheduleWith([10, [["Asha", 4, 5450], null, null, null, null]], [11, [["Asha", 5, 5450], null, null, null, null]]);
    expect(vacancyOf(rows, [movedOut("2026-12-20")], "p1")).toEqual({ since: "2026-12-20", previousTenant: "Asha" });
  });

  it("is null for a portion that never had a tenant, for an open tenancy, and for rent logged after the move-out", () => {
    expect(vacancyOf(ASHA_PAID_OCT, [], "p4")).toBeNull();
    expect(vacancyOf(ASHA_PAID_OCT, [], "p1")).toBeNull();
    expect(vacancyOf(ASHA_PAID_OCT, [movedOut("2026-10-20", { rowNumber: 2 }), tenancy({ rowNumber: 3, id: "t-2", tenant: "Hari" })], "p1")).toBeNull();
    expect(vacancyOf(ASHA_PAID_OCT, [movedOut("2026-09-10")], "p1")).toBeNull();
  });

  it("ignores a move-out that is not a date", () => {
    expect(vacancyOf(ASHA_PAID_OCT, [movedOut("soon")], "p1")).toBeNull();
  });

  it("takes the move-out of the tenant the Schedule names, not another tenant's", () => {
    expect(vacancyOf(ASHA_PAID_OCT, [movedOut("2026-10-20", { tenant: "Bala" })], "p1")).toBeNull();
  });
});

describe("latestEntryRow", () => {
  it("gives the month and the entry of the latest row with one, a month's lower row losing", () => {
    expect(latestEntryRow(ASHA_PAID_OCT, "p1")).toEqual({ month: OCT, entry: { tenant: "Asha", count: 4, amount: 5450 } });
    expect(latestEntryRow(ASHA_PAID_OCT, "p1", OCT)?.month).toEqual({ year: 2026, month: 9 });
    expect(latestEntryRow(ASHA_PAID_OCT, "p4")).toBeNull();
  });
});
