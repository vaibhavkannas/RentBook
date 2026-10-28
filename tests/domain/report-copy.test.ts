import { describe, expect, it } from "vitest";
import { OVERDUE_GRACE_DAYS, RENT_DUE_DAY } from "@/lib/domain/rent-due";
import {
  MOVED_OUT_HINT,
  OVERDUE_RULES,
  ordinalDay,
  overdueAge,
  overdueMonthLine,
  overdueSummary,
} from "@/lib/report-copy";

describe("ordinalDay", () => {
  it("writes a day of the month with its ending", () => {
    const words = [1, 2, 3, 4, 5, 10, 11, 12, 13, 14, 20, 21, 22, 23, 24, 28, 30, 31].map(ordinalDay);
    expect(words).toEqual([
      "1st", "2nd", "3rd", "4th", "5th", "10th", "11th", "12th", "13th", "14th", "20th", "21st", "22nd", "23rd", "24th", "28th", "30th", "31st",
    ]);
  });
});

describe("overdueAge", () => {
  it("counts days, in the singular for one", () => {
    expect(overdueAge(1)).toBe("1 day overdue");
    expect(overdueAge(2)).toBe("2 days overdue");
    expect(overdueAge(5)).toBe("5 days overdue");
    expect(overdueAge(16)).toBe("16 days overdue");
    expect(overdueAge(59)).toBe("59 days overdue");
  });

  it("says about so many months from 60 days", () => {
    expect(overdueAge(60)).toBe("about 2 months overdue");
    expect(overdueAge(74)).toBe("about 2 months overdue");
    expect(overdueAge(75)).toBe("about 3 months overdue");
    expect(overdueAge(89)).toBe("about 3 months overdue");
    expect(overdueAge(180)).toBe("about 6 months overdue");
    expect(overdueAge(623)).toBe("about 21 months overdue");
  });

  it("reads 0 as days, not as nothing", () => {
    expect(overdueAge(0)).toBe("0 days overdue");
  });
});

describe("overdueMonthLine", () => {
  it("says an unpaid month is unpaid, and what is owed", () => {
    expect(overdueMonthLine({ kind: "unpaid", expected: 13335, paid: 0, owed: 13335 })).toBe("Unpaid: ₹ 13,335");
    expect(overdueMonthLine({ kind: "unpaid", expected: 5450, paid: 0, owed: 5450 })).toBe("Unpaid: ₹ 5,450");
  });

  it("says what a short month paid, of what, and what is short", () => {
    expect(overdueMonthLine({ kind: "short", expected: 13335, paid: 13300, owed: 35 })).toBe(
      "Paid ₹ 13,300 of ₹ 13,335: ₹ 35 short",
    );
    expect(overdueMonthLine({ kind: "short", expected: 5450, paid: 5000, owed: 450 })).toBe(
      "Paid ₹ 5,000 of ₹ 5,450: ₹ 450 short",
    );
  });

  it("groups the digits the Indian way", () => {
    expect(overdueMonthLine({ kind: "unpaid", expected: 105000, paid: 0, owed: 105000 })).toBe("Unpaid: ₹ 1,05,000");
  });
});

describe("overdueSummary", () => {
  const item = (unpaid: number, short: number, tenant = "Asha") => ({ tenant, unpaid, short });

  it("says the tenant and how many months are unpaid, in the singular and the plural", () => {
    expect(overdueSummary(item(1, 0, "Bala"))).toBe("Bala · 1 unpaid month");
    expect(overdueSummary(item(2, 0, "Bala"))).toBe("Bala · 2 unpaid months");
    expect(overdueSummary(item(21, 0))).toBe("Asha · 21 unpaid months");
  });

  it("adds how many months were paid short, when there are any", () => {
    expect(overdueSummary(item(1, 1))).toBe("Asha · 1 unpaid month · 1 paid short");
    expect(overdueSummary(item(2, 1))).toBe("Asha · 2 unpaid months · 1 paid short");
    expect(overdueSummary(item(1, 3))).toBe("Asha · 1 unpaid month · 3 paid short");
  });

  it("does not say 0 unpaid months when every month is a short one", () => {
    expect(overdueSummary(item(0, 1))).toBe("Asha · 1 month paid short");
    expect(overdueSummary(item(0, 2))).toBe("Asha · 2 months paid short");
  });

  it("does not start with a dot when the Schedule has no name for the tenant", () => {
    expect(overdueSummary(item(2, 0, ""))).toBe("No tenant name · 2 unpaid months");
    expect(overdueSummary(item(1, 1, "   "))).toBe("No tenant name · 1 unpaid month · 1 paid short");
  });
});

describe("OVERDUE_RULES", () => {
  it("states the four rules in plain words", () => {
    expect(OVERDUE_RULES).toEqual([
      "Rent for a month is due on the 1st and counts as overdue from the 6th.",
      "Amounts are what each month's card shows: the suggested rent for an unpaid month, or the part missing from a short one.",
      "Only the current tenant's months count. Vacant months and months paid ahead never do.",
      "A deposit is not rent and is never counted.",
    ]);
  });

  it("builds the first rule from the constants, which keep the overdue day inside the month", () => {
    expect(OVERDUE_RULES[0]).toContain(`due on the ${ordinalDay(RENT_DUE_DAY)}`);
    expect(OVERDUE_RULES[0]).toContain(`from the ${ordinalDay(RENT_DUE_DAY + OVERDUE_GRACE_DAYS)}`);
    // every month has a 28th, so the "6th" is a day of the same month in all of them
    expect(RENT_DUE_DAY + OVERDUE_GRACE_DAYS).toBeLessThanOrEqual(28);
  });
});

describe("MOVED_OUT_HINT", () => {
  it("points at the tenant page", () => {
    expect(MOVED_OUT_HINT).toBe("Moved out? Record the move-out on the tenant page and the months after it stop counting.");
  });
});
