import { describe, expect, it } from "vitest";
import {
  isHikeRounding,
  nextCount,
  roundedChoices,
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
  it("works in whole basis points, so a half rupee is never lost to floating point", () => {
    // 20500 at 0.1% is exactly 20520.5; in floating point it came out as 20520.4999...
    expect(suggestAmount(20500, 0.1, true)).toBe(20521);
    expect(suggestAmount(1250, 1.32, true)).toBe(1267);
    expect(suggestAmount(2500, 0.46, true)).toBe(2512);
  });
  it("takes a percent with more than two decimals to the nearest basis point", () => {
    expect(suggestAmount(10000, 5.555, true)).toBe(10556);
    expect(suggestAmount(10000, 5.554, true)).toBe(10555);
  });
  it("matches exact BigInt arithmetic, rounding half up, for many amounts and percents", () => {
    const exact = (amount: number, percent: number) => {
      const [whole, half] = [BigInt(10_000), BigInt(5_000)];
      const basisPoints = BigInt(Math.round(percent * 100));
      return Number((BigInt(amount) * (whole + basisPoints) + half) / whole);
    };
    let checked = 0;
    // every amount that is a multiple of 50 up to 60,000 (rents are round figures), at every hundredth of a percent up to 25
    for (let amount = 50; amount <= 60_000; amount += 50) {
      for (let hundredths = 0; hundredths <= 2_500; hundredths++) {
        const percent = hundredths / 100;
        const got = suggestAmount(amount, percent, true);
        if (got !== exact(amount, percent)) {
          throw new Error(`${amount} at ${percent}%: got ${got}, exact ${exact(amount, percent)}`);
        }
        checked++;
      }
    }
    // and a fixed pseudo-random set of any whole rupee amount, at percents with up to two decimals
    let seed = 12345;
    const next = () => (seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648;
    for (let i = 0; i < 100_000; i++) {
      const amount = 1 + Math.floor(next() * 10_000_000);
      const percent = Math.floor(next() * 10_001) / 100;
      expect(suggestAmount(amount, percent, true)).toBe(exact(amount, percent));
      checked++;
    }
    expect(checked).toBeGreaterThan(3_000_000);
  });
  it("always gives a whole rupee, and nothing below the previous rent for a hike of zero or more", () => {
    for (const [amount, percent] of [[5450.5, 5], [999, 0.01], [1, 100], [10_000_000, 100]]) {
      const result = suggestAmount(amount, percent, true);
      expect(Number.isInteger(result)).toBe(true);
      expect(result).toBeGreaterThanOrEqual(Math.floor(amount));
    }
    expect(suggestAmount(10_000_000, 100, true)).toBe(20_000_000);
  });
});

describe("isHikeRounding", () => {
  it("accepts an amount up to the allowance either side of the suggested hike", () => {
    expect(isHikeRounding(6316, 6316)).toBe(true);
    expect(isHikeRounding(6315, 6316)).toBe(true);
    expect(isHikeRounding(6320, 6316)).toBe(true);
    expect(isHikeRounding(6326, 6316)).toBe(true);
    expect(isHikeRounding(6306, 6316)).toBe(true);
  });
  it("rejects an amount beyond the allowance", () => {
    expect(isHikeRounding(6327, 6316)).toBe(false);
    expect(isHikeRounding(6305, 6316)).toBe(false);
    expect(isHikeRounding(5000, 6316)).toBe(false);
  });
});

describe("roundedChoices", () => {
  it("offers the nearest 5 and nearest 10, lowest first", () => {
    expect(roundedChoices(6316)).toEqual([6315, 6320]);
    expect(roundedChoices(13334)).toEqual([13330, 13335]);
  });
  it("rounds halves up", () => {
    expect(roundedChoices(13335)).toEqual([13340]);
    expect(roundedChoices(6312)).toEqual([6310]);
  });
  it("offers nothing when the suggestion is already a multiple of 10", () => {
    expect(roundedChoices(9450)).toEqual([]);
  });
  it("leaves out a choice equal to the suggestion and merges equal choices", () => {
    expect(roundedChoices(9455)).toEqual([9460]);
    expect(roundedChoices(9458)).toEqual([9460]);
  });
});

describe("sumAmounts", () => {
  it("treats missing amounts as zero", () => {
    expect(sumAmounts([5450, null, 9000, undefined])).toBe(14450);
    expect(sumAmounts([])).toBe(0);
  });
});
