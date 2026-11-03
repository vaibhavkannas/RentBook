import { describe, expect, it } from "vitest";
import { agreementAlerts, hikeAlerts } from "@/lib/domain/alerts";
import { overdueList } from "@/lib/domain/overdue";
import { OVERDUE_GRACE_DAYS, RENT_DUE_DAY } from "@/lib/domain/rent-due";
import type { YearCell } from "@/lib/domain/year-view";
import {
  AGREEMENT_HINT,
  agreementSentence,
  attentionItems,
  hikeSentence,
  earlierMonthsText,
  MOVED_OUT_HINT,
  nothingOverdueText,
  OVERDUE_MONTHS_SHOWN,
  OVERDUE_RULES,
  ordinalDay,
  overdueAge,
  overdueCountLine,
  overdueMonthLine,
  overdueMonthsShown,
  overdueSummary,
  showMovedOutHint,
  TENANTS_PROBLEM_NOTICE,
  YEAR_LEGEND,
  YEAR_TENANTS_PROBLEM_NOTICE,
  yearCellLabel,
  yearEmptyText,
  yearEmptyTitle,
} from "@/lib/report-copy";
import { baseRows, PORTIONS, tenancyRow } from "../support/fixtures";

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

describe("the Overdue screen's own words", () => {
  it("counts portions and says the month they are counted up to", () => {
    expect(overdueCountLine(4, { year: 2026, month: 10 })).toBe("4 portions · counted up to October 2026");
    expect(overdueCountLine(1, { year: 2026, month: 9 })).toBe("1 portion · counted up to September 2026");
  });

  it("says what an empty list means", () => {
    expect(nothingOverdueText({ year: 2026, month: 10 })).toBe("Every let portion has paid in full up to October 2026.");
  });

  it("warns that the Tenants tab cannot be read, and what is wrong with it", () => {
    expect(TENANTS_PROBLEM_NOTICE("The Tenants tab has no Phone header.")).toBe(
      "The Tenants tab can't be read, so tenants who moved out may show here. The Tenants tab has no Phone header.",
    );
  });

  it("says how many earlier months are left out of a list", () => {
    expect(earlierMonthsText(1)).toBe("and 1 earlier month");
    expect(earlierMonthsText(4)).toBe("and 4 earlier months");
  });
});

describe("overdueMonthsShown", () => {
  const months = (count: number) => Array.from({ length: count }, (_, index) => index + 1);

  it("lists up to 12 months newest first, and leaves nothing out", () => {
    expect(OVERDUE_MONTHS_SHOWN).toBe(12);
    expect(overdueMonthsShown(months(1))).toEqual({ shown: [1], earlier: 0 });
    expect(overdueMonthsShown(months(12))).toEqual({ shown: months(12).reverse(), earlier: 0 });
  });

  it("keeps the 12 newest of more, and counts the rest", () => {
    const result = overdueMonthsShown(months(16));
    expect(result.shown).toEqual([16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5]);
    expect(result.earlier).toBe(4);
    expect(overdueMonthsShown(months(13)).earlier).toBe(1);
  });

  it("does not change the list it is given", () => {
    const given = months(3);
    overdueMonthsShown(given);
    expect(given).toEqual([1, 2, 3]);
  });
});

describe("showMovedOutHint", () => {
  const OCT = { year: 2026, month: 10 };

  it("is for a portion whose oldest overdue month is more than 3 months before this month", () => {
    expect(showMovedOutHint({ year: 2026, month: 6 }, OCT)).toBe(true);
    expect(showMovedOutHint({ year: 2025, month: 12 }, OCT)).toBe(true);
  });

  it("is not for three months or fewer", () => {
    expect(showMovedOutHint({ year: 2026, month: 7 }, OCT)).toBe(false);
    expect(showMovedOutHint({ year: 2026, month: 8 }, OCT)).toBe(false);
    expect(showMovedOutHint(OCT, OCT)).toBe(false);
  });

  it("works across a year end", () => {
    expect(showMovedOutHint({ year: 2026, month: 10 }, { year: 2027, month: 1 })).toBe(false);
    expect(showMovedOutHint({ year: 2026, month: 9 }, { year: 2027, month: 1 })).toBe(true);
  });
});

describe("the Year screen's empty words", () => {
  it("says which year has nothing recorded", () => {
    expect(yearEmptyTitle(2024)).toBe("Nothing recorded for 2024");
  });

  it("says where the Schedule starts, or that it has no months yet", () => {
    expect(yearEmptyText({ year: 2026, month: 8 })).toBe("Your Schedule starts in August 2026.");
    expect(yearEmptyText(null)).toBe("Your Schedule has no months yet.");
  });

  it("warns that months after a move-out can read as unpaid while the Tenants tab cannot be read", () => {
    expect(YEAR_TENANTS_PROBLEM_NOTICE("The Tenants tab has no Phone header.")).toBe(
      "The Tenants tab can't be read, so months after a move-out may show as unpaid. The Tenants tab has no Phone header.",
    );
  });
});

describe("yearCellLabel", () => {
  const cell = (overrides: Partial<YearCell>): YearCell => ({
    month: { year: 2026, month: 1 },
    state: "paid",
    received: 0,
    due: 0,
    shortBy: 0,
    ...overrides,
  });
  const portion = "First floor, single bedroom";

  it("says what a paid month received", () => {
    expect(yearCellLabel(cell({ state: "paid", received: 5450, due: 5450 }), portion)).toBe(
      "January 2026, First floor, single bedroom: paid ₹\u00a05,450",
    );
  });

  it("says what a part-paid month received, of what was due", () => {
    expect(
      yearCellLabel(cell({ month: { year: 2026, month: 10 }, state: "partial", received: 5000, due: 5450, shortBy: 450 }), portion),
    ).toBe("October 2026, First floor, single bedroom: part paid ₹\u00a05,000 of ₹\u00a05,450");
  });

  it("says what an unpaid month has due", () => {
    expect(yearCellLabel(cell({ month: { year: 2026, month: 10 }, state: "unpaid", due: 13335 }), "Second floor")).toBe(
      "October 2026, Second floor: unpaid, ₹\u00a013,335 due",
    );
  });

  it("says vacant, not due yet and no record in words", () => {
    expect(yearCellLabel(cell({ month: { year: 2026, month: 12 }, state: "vacant" }), portion)).toBe(
      "December 2026, First floor, single bedroom: vacant",
    );
    expect(yearCellLabel(cell({ month: { year: 2026, month: 11 }, state: "upcoming" }), portion)).toBe(
      "November 2026, First floor, single bedroom: not due yet",
    );
    expect(yearCellLabel(cell({ month: { year: 2025, month: 3 }, state: "none" }), portion)).toBe(
      "March 2025, First floor, single bedroom: no record",
    );
  });

  it("groups digits the Indian way", () => {
    expect(yearCellLabel(cell({ state: "paid", received: 125000 }), "P")).toBe("January 2026, P: paid ₹\u00a01,25,000");
  });
});

describe("YEAR_LEGEND", () => {
  it("lists a glyph and a word for every state a cell can show but none", () => {
    expect(YEAR_LEGEND.map((item) => `${item.glyph} ${item.label}`)).toEqual([
      "✓ Paid",
      "½ Part paid",
      "! Unpaid",
      "– Vacant",
      "· Not due yet",
    ]);
    expect(YEAR_LEGEND.map((item) => item.state)).toEqual(["paid", "partial", "unpaid", "vacant", "upcoming"]);
  });

  it("gives each glyph once, so a state is never told apart by colour alone", () => {
    expect(new Set(YEAR_LEGEND.map((item) => item.glyph)).size).toBe(YEAR_LEGEND.length);
  });
});

describe("agreementSentence", () => {
  const sentence = (state: "ended" | "today" | "soon", days: number, agreementEnd = "2026-10-05") =>
    agreementSentence({ state, days, agreementEnd });

  it("says how long ago an agreement ended, and on what day", () => {
    expect(sentence("ended", -12, "2026-10-05")).toBe("Agreement ended 12 days ago, on 5 Oct 2026.");
    expect(sentence("ended", -1, "2026-10-16")).toBe("Agreement ended 1 day ago, on 16 Oct 2026.");
    expect(sentence("ended", -990, "2024-01-31")).toBe("Agreement ended 990 days ago, on 31 Jan 2024.");
  });

  it("says an agreement ends today", () => {
    expect(sentence("today", 0, "2026-10-17")).toBe("Agreement ends today.");
  });

  it("says in how many days an agreement ends, and on what day", () => {
    expect(sentence("soon", 45, "2026-12-01")).toBe("Agreement ends in 45 days, on 1 Dec 2026.");
    expect(sentence("soon", 1, "2026-10-18")).toBe("Agreement ends in 1 day, on 18 Oct 2026.");
    expect(sentence("soon", 60, "2026-12-16")).toBe("Agreement ends in 60 days, on 16 Dec 2026.");
  });

  it("carries the hint for an ended agreement", () => {
    expect(AGREEMENT_HINT).toBe("Renewed? Change the agreement end in Details.");
  });
});

describe("hikeSentence", () => {
  const hike = (overrides: Partial<Parameters<typeof hikeSentence>[0]> = {}) => ({
    hikePercent: 5,
    hikeMonth: { year: 2026, month: 10 },
    paymentsLeft: 0,
    currentRent: 12700,
    newRent: 13335,
    ...overrides,
  });

  it("says the rent goes up with the next payment, and from what to what", () => {
    expect(hikeSentence(hike())).toBe("Rent goes up 5% with the next payment (October 2026): ₹\u00a012,700 to ₹\u00a013,335.");
  });

  it("says the rent goes up from a later payment, after how many more", () => {
    expect(hikeSentence(hike({ hikeMonth: { year: 2026, month: 12 }, paymentsLeft: 2, currentRent: 5450, newRent: 5723 }))).toBe(
      "Rent goes up 5% from the payment for December 2026, after 2 more payments: ₹\u00a05,450 to ₹\u00a05,723.",
    );
    expect(hikeSentence(hike({ hikeMonth: { year: 2026, month: 11 }, paymentsLeft: 1 }))).toBe(
      "Rent goes up 5% from the payment for November 2026, after 1 more payment: ₹\u00a012,700 to ₹\u00a013,335.",
    );
  });

  it("goes by the payments left, not the state: no 'after 0 more payments', and no 'next payment' for a later one", () => {
    // paid ahead: the next payment carries the hike although it is for a month to come
    expect(hikeSentence(hike({ hikeMonth: { year: 2026, month: 12 }, paymentsLeft: 0 }))).toBe(
      "Rent goes up 5% with the next payment (December 2026): ₹\u00a012,700 to ₹\u00a013,335.",
    );
    // behind with the Schedule: the month of the hike has gone by but payments come first
    expect(hikeSentence(hike({ hikeMonth: { year: 2026, month: 9 }, paymentsLeft: 2 }))).toBe(
      "Rent goes up 5% from the payment for September 2026, after 2 more payments: ₹\u00a012,700 to ₹\u00a013,335.",
    );
  });

  it("writes a percent with a fraction as it is", () => {
    expect(hikeSentence(hike({ hikePercent: 2.5 }))).toContain("Rent goes up 2.5% with");
    expect(hikeSentence(hike({ hikePercent: 0.1 }))).toContain("Rent goes up 0.1% with");
  });
});

describe("attentionItems", () => {
  const TODAY = "2026-10-17";
  const none = { overdue: [], agreements: [], hikes: [], monthKey: "2026-10" };
  const ended = { state: "ended" } as const;
  const today = { state: "today" } as const;
  const soon = { state: "soon" } as const;

  it("is empty when nothing is due", () => {
    expect(attentionItems(none)).toEqual([]);
    expect(attentionItems({ ...none, monthKey: null })).toEqual([]);
  });

  it("lists, from real data, overdue rent, an ended agreement, one ending soon and a hike, in that order", () => {
    const rows = baseRows();
    const tenancies = [
      tenancyRow({ id: "t-1", portionId: "p1", tenant: "Asha", agreementEnd: "2026-10-05" }),
      tenancyRow({ id: "t-3", portionId: "p3", tenant: "Chitra", agreementEnd: "2026-12-01" }),
    ];
    const snapshot = { rows, portions: PORTIONS, tenancies };
    const items = attentionItems({
      overdue: overdueList(snapshot, TODAY),
      agreements: agreementAlerts(snapshot, TODAY),
      hikes: hikeAlerts(snapshot, TODAY),
      monthKey: "2026-10",
    });
    expect(items).toEqual([
      { href: "/overdue?month=2026-10", text: "Rent overdue: 4 portions, ₹\u00a032,885", tone: "danger" },
      { href: "/alerts?month=2026-10", text: "1 agreement ended", tone: "danger" },
      { href: "/alerts?month=2026-10", text: "1 agreement ends within 60 days", tone: "warn" },
      { href: "/alerts?month=2026-10#hikes", text: "Rent goes up soon for 1 portion", tone: "neutral" },
    ]);
  });

  it("says portion, agreement and portions, agreements in the singular and the plural", () => {
    expect(attentionItems({ ...none, overdue: [{ owed: 5450 }] })).toEqual([
      { href: "/overdue?month=2026-10", text: "Rent overdue: 1 portion, ₹\u00a05,450", tone: "danger" },
    ]);
    expect(attentionItems({ ...none, overdue: [{ owed: 105000 }, { owed: 450 }] })[0].text).toBe(
      "Rent overdue: 2 portions, ₹\u00a01,05,450",
    );
    expect(attentionItems({ ...none, agreements: [ended, ended] }).map((item) => item.text)).toEqual(["2 agreements ended"]);
    expect(attentionItems({ ...none, agreements: [soon, soon, soon] }).map((item) => item.text)).toEqual([
      "3 agreements end within 60 days",
    ]);
    expect(attentionItems({ ...none, hikes: [{}, {}] }).map((item) => item.text)).toEqual(["Rent goes up soon for 2 portions"]);
  });

  it("counts an agreement that ends today with those ending within 60 days", () => {
    expect(attentionItems({ ...none, agreements: [today] })).toEqual([
      { href: "/alerts?month=2026-10", text: "1 agreement ends within 60 days", tone: "warn" },
    ]);
    expect(attentionItems({ ...none, agreements: [ended, today, soon] }).map((item) => item.text)).toEqual([
      "1 agreement ended",
      "2 agreements end within 60 days",
    ]);
  });

  it("gives each row the tone of its kind", () => {
    expect(attentionItems({ ...none, hikes: [{}] }).map((item) => item.tone)).toEqual(["neutral"]);
    expect(attentionItems({ ...none, agreements: [soon] }).map((item) => item.tone)).toEqual(["warn"]);
    expect(attentionItems({ ...none, agreements: [ended] }).map((item) => item.tone)).toEqual(["danger"]);
  });

  it("builds the links from the month key, and from none when there is no month", () => {
    const all = { overdue: [{ owed: 1 }], agreements: [ended, soon], hikes: [{}] };
    expect(attentionItems({ ...all, monthKey: "2027-01" }).map((item) => item.href)).toEqual([
      "/overdue?month=2027-01",
      "/alerts?month=2027-01",
      "/alerts?month=2027-01",
      "/alerts?month=2027-01#hikes",
    ]);
    for (const monthKey of [null, "", "2026-13", "October"]) {
      expect(attentionItems({ ...all, monthKey }).map((item) => item.href)).toEqual(["/overdue", "/alerts", "/alerts", "/alerts#hikes"]);
    }
  });
});
