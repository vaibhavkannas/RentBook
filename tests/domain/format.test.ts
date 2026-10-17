import { describe, expect, it } from "vitest";
import {
  formatDay,
  formatMonthKey,
  formatMonthTitle,
  formatRupees,
  formatSavedAt,
  stripRupeeFormatting,
  wholeRupeesMessage,
} from "@/lib/format";

describe("format", () => {
  it("formats rupees with Indian digit grouping", () => {
    expect(formatRupees(5450)).toBe("₹ 5,450");
    expect(formatRupees(1234567)).toBe("₹ 12,34,567");
    expect(formatRupees(0)).toBe("₹ 0");
  });
  it("formats a month title", () => {
    expect(formatMonthTitle({ year: 2026, month: 10 })).toBe("October 2026");
  });
});

describe("formatMonthKey", () => {
  it("turns a month key into the long month title", () => {
    expect(formatMonthKey("2026-10")).toBe("October 2026");
    expect(formatMonthKey("2027-01")).toBe("January 2027");
  });
  it.each(["", "2026-13", "Oct-26", "46296", "2026-10-05"])(
    "returns %j unchanged when it is not a month key",
    (text) => {
      expect(formatMonthKey(text)).toBe(text);
    },
  );
});

describe("formatSavedAt", () => {
  it("shows India time", () => {
    expect(formatSavedAt("2026-10-05T04:30:00.000Z")).toMatch(/5 Oct.*10:00\s?am/i);
  });
  it("returns text that is not a date unchanged", () => {
    expect(formatSavedAt("not a date")).toBe("not a date");
  });
});

describe("formatDay", () => {
  it("shows a day as a short date with no leading zero", () => {
    expect(formatDay("2027-03-15")).toBe("15 Mar 2027");
    expect(formatDay("2026-10-05")).toBe("5 Oct 2026");
    expect(formatDay("2026-01-01")).toBe("1 Jan 2026");
    expect(formatDay("2026-12-31")).toBe("31 Dec 2026");
  });
  it("handles a leap day", () => {
    expect(formatDay("2028-02-29")).toBe("29 Feb 2028");
  });
  it.each(["", "  ", "2026-02-30", "2027-13-01", "2026-10", "15 Mar 2027", "46296", "2026-10-05T04:30:00Z", "soon"])(
    "returns %j unchanged when it is not a real YYYY-MM-DD day",
    (text) => {
      expect(formatDay(text)).toBe(text);
    },
  );
});

describe("wholeRupeesMessage", () => {
  it("says the range in whole rupees the way the rest of the app writes an amount, with the Indian grouping", () => {
    expect(wholeRupeesMessage("Advance", 0, 10_000_000)).toBe("Advance must be whole rupees, from ₹ 0 to ₹ 1,00,00,000.");
    expect(wholeRupeesMessage("Amount", 1, 10_000_000)).toBe("Amount must be whole rupees, from ₹ 1 to ₹ 1,00,00,000.");
  });

  it("never writes the largest amount the western way", () => {
    expect(wholeRupeesMessage("Refund", 0, 10_000_000)).not.toContain("10,000,000");
  });
});

describe("stripRupeeFormatting", () => {
  it("takes out commas, spaces of any kind and the rupee sign, and nothing else", () => {
    expect(stripRupeeFormatting("₹ 5,450")).toBe("5450");
    expect(stripRupeeFormatting(" 1,00,000 ")).toBe("100000");
    expect(stripRupeeFormatting("5\u00a0450\t")).toBe("5450");
    expect(stripRupeeFormatting("12.5k")).toBe("12.5k");
    expect(stripRupeeFormatting("-5")).toBe("-5");
  });

  it("leaves nothing for a blank or a lone sign, which is how a blank amount is told from text", () => {
    for (const text of ["", "   ", "₹", " , ", "₹ ,"]) expect(stripRupeeFormatting(text)).toBe("");
  });
});
