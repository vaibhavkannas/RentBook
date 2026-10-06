import { describe, expect, it } from "vitest";
import { formatMonthTitle, formatRupees } from "@/lib/format";

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
