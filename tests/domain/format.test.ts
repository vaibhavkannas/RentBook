import { describe, expect, it } from "vitest";
import { formatMonthKey, formatMonthTitle, formatRupees, formatSavedAt } from "@/lib/format";

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
