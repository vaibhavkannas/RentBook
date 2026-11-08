import { describe, expect, it } from "vitest";
import {
  dueDate,
  daysOverdue,
  lastDueMonth,
  latestTenantStart,
  OVERDUE_GRACE_DAYS,
  RENT_DUE_DAY,
} from "@/lib/domain/rent-due";
import type { YearMonth } from "@/lib/domain/types";
import { todayIso } from "@/lib/domain/year-month";
import { baseRows, parsedRows } from "../support/fixtures";

const SEP: YearMonth = { year: 2026, month: 9 };
const OCT: YearMonth = { year: 2026, month: 10 };

describe("the constants", () => {
  it("fall due on a day every month has, and give a whole number of days of grace", () => {
    expect(Number.isInteger(RENT_DUE_DAY)).toBe(true);
    expect(RENT_DUE_DAY).toBeGreaterThanOrEqual(1);
    expect(RENT_DUE_DAY).toBeLessThanOrEqual(28);
    expect(Number.isInteger(OVERDUE_GRACE_DAYS)).toBe(true);
    expect(OVERDUE_GRACE_DAYS).toBeGreaterThanOrEqual(0);
  });

  it("are the owner's rule: due on the 1st, overdue from the 6th", () => {
    expect(RENT_DUE_DAY).toBe(1);
    expect(OVERDUE_GRACE_DAYS).toBe(5);
  });
});

describe("dueDate", () => {
  it("is the due day of the month, as a real day", () => {
    expect(dueDate({ year: 2026, month: 10 })).toBe("2026-10-01");
    expect(dueDate({ year: 2026, month: 2 })).toBe("2026-02-01");
    expect(dueDate({ year: 2028, month: 12 })).toBe("2028-12-01");
  });
});

describe("lastDueMonth", () => {
  it("is last month through the 5th and this month from the 6th", () => {
    expect(lastDueMonth("2026-10-01")).toEqual(SEP);
    expect(lastDueMonth("2026-10-05")).toEqual(SEP);
    expect(lastDueMonth("2026-10-06")).toEqual(OCT);
    expect(lastDueMonth("2026-10-17")).toEqual(OCT);
    expect(lastDueMonth("2026-10-31")).toEqual(OCT);
  });

  it("goes back over a year end, and over a leap February", () => {
    expect(lastDueMonth("2027-01-05")).toEqual({ year: 2026, month: 12 });
    expect(lastDueMonth("2027-01-06")).toEqual({ year: 2027, month: 1 });
    expect(lastDueMonth("2028-03-05")).toEqual({ year: 2028, month: 2 });
    expect(lastDueMonth("2028-02-29")).toEqual({ year: 2028, month: 2 });
    expect(lastDueMonth("2026-03-05")).toEqual({ year: 2026, month: 2 });
  });

  it("moves on India midnight, because it is fed the India day", () => {
    // 17 October in India starts at 18:30 UTC on the 16th.
    expect(todayIso(new Date("2026-10-16T18:30:00Z"))).toBe("2026-10-17");
    expect(todayIso(new Date("2026-10-16T18:29:59Z"))).toBe("2026-10-16");
    expect(lastDueMonth(todayIso(new Date("2026-10-16T18:30:00Z")))).toEqual(OCT);
    expect(lastDueMonth(todayIso(new Date("2026-10-16T18:29:59Z")))).toEqual(OCT);
    // The 6th of October starts at 18:30 UTC on the 5th: that second is the one that makes October overdue.
    expect(lastDueMonth(todayIso(new Date("2026-10-05T18:29:59Z")))).toEqual(SEP);
    expect(lastDueMonth(todayIso(new Date("2026-10-05T18:30:00Z")))).toEqual(OCT);
    // And the 1st of a month in India is still last month's overdue rent, not this month's.
    expect(lastDueMonth(todayIso(new Date("2026-10-31T18:30:00Z")))).toEqual(OCT);
    expect(lastDueMonth(todayIso(new Date("2026-11-05T18:29:59Z")))).toEqual(OCT);
    expect(lastDueMonth(todayIso(new Date("2026-11-05T18:30:00Z")))).toEqual({ year: 2026, month: 11 });
  });

  it("throws for a day that is not real", () => {
    expect(() => lastDueMonth("2026-02-30")).toThrow(RangeError);
    expect(() => lastDueMonth("")).toThrow(RangeError);
  });
});

describe("daysOverdue", () => {
  it("runs from the due date to today", () => {
    expect(daysOverdue(OCT, "2026-10-17")).toBe(16);
    expect(daysOverdue(OCT, "2026-10-06")).toBe(5);
    expect(daysOverdue(SEP, "2026-10-17")).toBe(46);
    expect(daysOverdue({ year: 2025, month: 2 }, "2026-10-17")).toBe(623);
  });

  it("is 0 on the due date and before it: nothing is overdue before it is due", () => {
    expect(daysOverdue(OCT, "2026-10-01")).toBe(0);
    expect(daysOverdue(OCT, "2026-09-20")).toBe(0);
    expect(daysOverdue({ year: 2026, month: 11 }, "2026-10-17")).toBe(0);
  });

  it("counts the leap day", () => {
    expect(daysOverdue({ year: 2028, month: 2 }, "2028-03-01")).toBe(29);
    expect(daysOverdue({ year: 2026, month: 2 }, "2026-03-01")).toBe(28);
  });
});

describe("latestTenantStart", () => {
  it("is the tenant of the latest entry and the first month of their run", () => {
    const rows = baseRows();
    expect(latestTenantStart(rows, "p1")).toEqual({ tenant: "Asha", start: { year: 2026, month: 8 } });
    expect(latestTenantStart(rows, "p2")).toEqual({ tenant: "Bala", start: { year: 2026, month: 8 } });
    expect(latestTenantStart(rows, "p3")).toEqual({ tenant: "Chitra", start: { year: 2026, month: 8 } });
    // Esha's first entry is September
    expect(latestTenantStart(rows, "p5")).toEqual({ tenant: "Esha", start: { year: 2026, month: 9 } });
  });

  it("is null for a portion with no entry, an unknown portion and an empty Sheet", () => {
    expect(latestTenantStart(baseRows(), "p4")).toBeNull();
    expect(latestTenantStart(baseRows(), "nope")).toBeNull();
    expect(latestTenantStart([], "p1")).toBeNull();
    expect(latestTenantStart(parsedRows([2026, 8], [2026, 9]), "p1")).toBeNull();
  });

  it("is the one month of a tenant who has one entry", () => {
    expect(latestTenantStart(parsedRows([2026, 10, [["Asha", 1, 5000]]]), "p1")).toEqual({
      tenant: "Asha",
      start: OCT,
    });
  });

  it("starts at the new tenant's first month when the tenant changed", () => {
    const rows = baseRows([2026, 10, [["Dev", 1, 5500]]]);
    expect(latestTenantStart(rows, "p1")).toEqual({ tenant: "Dev", start: OCT });
    // the same name again later: the earlier months are another run
    const back = baseRows([2026, 10, [["Dev", 1, 5500]]], [2026, 11, [["Asha", 1, 5450]]]);
    expect(latestTenantStart(back, "p1")).toEqual({ tenant: "Asha", start: { year: 2026, month: 11 } });
  });

  it("reads the same name in another case, or with spaces around it, as one tenant", () => {
    const rows = baseRows([2026, 10, [["  ASHA ", 4, 5450]]]);
    // the tenant is spelled as the latest entry spells it
    expect(latestTenantStart(rows, "p1")).toEqual({ tenant: "ASHA", start: { year: 2026, month: 8 } });
    const lower = baseRows([2026, 10, [["asha", 4, 5450]]]);
    expect(latestTenantStart(lower, "p1")).toEqual({ tenant: "asha", start: { year: 2026, month: 8 } });
  });

  it("keeps a run going over months with no entry", () => {
    const rows = parsedRows(
      [2026, 3, [["Asha", 1, 5000]]],
      [2026, 4],
      [2026, 5],
      [2026, 6, [["Asha", 2, 5000]]],
      [2026, 7],
    );
    expect(latestTenantStart(rows, "p1")).toEqual({ tenant: "Asha", start: { year: 2026, month: 3 } });
  });

  it("keeps a run going over months that are missing from the Schedule altogether", () => {
    const rows = parsedRows([2025, 1, [["Asha", 1, 5000]]], [2026, 10, [["Asha", 2, 5000]]]);
    expect(latestTenantStart(rows, "p1")).toEqual({ tenant: "Asha", start: { year: 2025, month: 1 } });
  });

  it("ends a run at an entry by another tenant, even when the first tenant is back after it", () => {
    const rows = parsedRows(
      [2026, 1, [["Asha", 1, 5000]]],
      [2026, 2, [["Asha", 2, 5000]]],
      [2026, 3, [["Bala", 1, 5000]]],
      [2026, 4, [["Asha", 1, 5000]]],
      [2026, 5, [["Asha", 2, 5000]]],
    );
    expect(latestTenantStart(rows, "p1")).toEqual({ tenant: "Asha", start: { year: 2026, month: 4 } });
  });

  it("is not moved by another portion's tenants", () => {
    const rows = parsedRows(
      [2026, 1, [["Asha", 1, 5000], ["Bala", 1, 9000]]],
      [2026, 2, [["Asha", 2, 5000], ["Dev", 1, 9000]]],
    );
    expect(latestTenantStart(rows, "p1")).toEqual({ tenant: "Asha", start: { year: 2026, month: 1 } });
    expect(latestTenantStart(rows, "p2")).toEqual({ tenant: "Dev", start: { year: 2026, month: 2 } });
  });

  it("takes the lower row when a month is typed twice", () => {
    // October twice: the lower row names Dev, so Dev is the tenant of October and Asha's run ended in September.
    const devLower = parsedRows(
      [2026, 9, [["Asha", 3, 5450]]],
      [2026, 10, [["Asha", 4, 5450]]],
      [2026, 10, [["Dev", 1, 5500]]],
    );
    expect(latestTenantStart(devLower, "p1")).toEqual({ tenant: "Dev", start: OCT });
    // the other way round: the lower row names Asha, so she is the tenant of October and her run goes on
    const ashaLower = parsedRows(
      [2026, 9, [["Asha", 3, 5450]]],
      [2026, 10, [["Dev", 1, 5500]]],
      [2026, 10, [["Asha", 4, 5450]]],
    );
    expect(latestTenantStart(ashaLower, "p1")).toEqual({ tenant: "Asha", start: SEP });
  });

  it("ignores a repeated month whose lower row is blank for the portion", () => {
    const rows = parsedRows(
      [2026, 9, [["Asha", 3, 5450]]],
      [2026, 10, [["Asha", 4, 5450]]],
      [2026, 10, [null, ["Bala", 1, 9000]]],
    );
    expect(latestTenantStart(rows, "p1")).toEqual({ tenant: "Asha", start: SEP });
    expect(latestTenantStart(rows, "p2")).toEqual({ tenant: "Bala", start: OCT });
  });

  it("does not depend on the order of the rows in the Sheet", () => {
    const rows = parsedRows(
      [2026, 10, [["Asha", 4, 5450]]],
      [2026, 8, [["Asha", 2, 5450]]],
      [2026, 9, [["Asha", 3, 5450]]],
    );
    expect(latestTenantStart(rows, "p1")).toEqual({ tenant: "Asha", start: { year: 2026, month: 8 } });
  });

  it("reads a blank tenant cell as a name of its own, as the card does, so it ends the run", () => {
    const rows = parsedRows(
      [2026, 8, [["Asha", 1, 5450]]],
      [2026, 9, [["", 2, 5450]]],
      [2026, 10, [["Asha", 3, 5450]]],
    );
    expect(latestTenantStart(rows, "p1")).toEqual({ tenant: "Asha", start: OCT });
    expect(latestTenantStart(parsedRows([2026, 8, [["Asha", 1, 5450]]], [2026, 9, [["", 2, 5450]]]), "p1")).toEqual({
      tenant: "",
      start: SEP,
    });
  });

  it("works across a year end", () => {
    const rows = parsedRows([2025, 11, [["Asha", 1, 5000]]], [2025, 12, [["Asha", 2, 5000]]], [2026, 1, [["Asha", 3, 5000]]]);
    expect(latestTenantStart(rows, "p1")).toEqual({ tenant: "Asha", start: { year: 2025, month: 11 } });
  });
});
