import { describe, expect, it } from "vitest";
import {
  nextCount,
  startsNewCycle,
  suggestAmount,
  sumAmounts,
} from "@/lib/domain/rent-rules";

describe("nextCount", () => {
  it("increments inside a cycle", () => {
    expect(nextCount(1, 11)).toBe(2);
    expect(nextCount(10, 11)).toBe(11);
  });
  it("wraps to 1 after the last payment of the cycle", () => {
    expect(nextCount(11, 11)).toBe(1);
  });
  it("wraps at a per-portion cycle length", () => {
    expect(nextCount(6, 6)).toBe(1);
    expect(nextCount(5, 6)).toBe(6);
  });
  it("never wraps when cycle length is null", () => {
    expect(nextCount(11, null)).toBe(12);
    expect(nextCount(40, null)).toBe(41);
  });
  it("treats a count above the cycle length as the end of a cycle", () => {
    expect(nextCount(12, 11)).toBe(1);
  });
});

describe("startsNewCycle", () => {
  it("is true only when the last payment completed the cycle", () => {
    expect(startsNewCycle(11, 11)).toBe(true);
    expect(startsNewCycle(10, 11)).toBe(false);
    expect(startsNewCycle(99, null)).toBe(false);
  });
});

describe("suggestAmount", () => {
  it("keeps the rent inside a cycle", () => {
    expect(suggestAmount(9000, 5, false)).toBe(9000);
  });
  it("adds the hike for a new cycle", () => {
    expect(suggestAmount(9000, 5, true)).toBe(9450);
  });
  it("rounds half up to a whole rupee", () => {
    expect(suggestAmount(5450, 5, true)).toBe(5723);
    expect(suggestAmount(12700, 5, true)).toBe(13335);
  });
  it("supports a per-portion hike percent, including zero", () => {
    expect(suggestAmount(10000, 10, true)).toBe(11000);
    expect(suggestAmount(10000, 0, true)).toBe(10000);
  });
});

describe("sumAmounts", () => {
  it("treats missing amounts as zero", () => {
    expect(sumAmounts([5450, null, 9000, undefined])).toBe(14450);
    expect(sumAmounts([])).toBe(0);
  });
});
