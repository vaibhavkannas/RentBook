import { describe, expect, it } from "vitest";
import { cardDifferenceText, describeDifference, progressPercent } from "@/lib/rent-difference";

describe("describeDifference", () => {
  it("says how much more than the rent was paid, in plain words", () => {
    expect(describeDifference(30)).toEqual({ tone: "more", text: "₹ 30 more than rent" });
  });

  it("says how much less than the rent was paid, with no minus sign", () => {
    expect(describeDifference(-1)).toEqual({ tone: "less", text: "₹ 1 less than rent" });
  });

  it("has nothing to say when the rent was paid exactly", () => {
    expect(describeDifference(0)).toBeNull();
    expect(describeDifference(-0)).toBeNull();
  });

  it("uses the same wording for one rupee and for many: there is no singular or plural to get wrong", () => {
    expect(describeDifference(1)?.text).toBe("₹ 1 more than rent");
    expect(describeDifference(2)?.text).toBe("₹ 2 more than rent");
    expect(describeDifference(-2)?.text).toBe("₹ 2 less than rent");
  });

  it("groups digits the Indian way, like every other amount on the page", () => {
    expect(describeDifference(123456)?.text).toBe("₹ 1,23,456 more than rent");
    expect(describeDifference(-100000)?.text).toBe("₹ 1,00,000 less than rent");
  });

  it("rounds to a whole rupee and says nothing when that rounds to zero", () => {
    expect(describeDifference(0.4)).toBeNull();
    expect(describeDifference(-0.4)).toBeNull();
    expect(describeDifference(30.4)?.text).toBe("₹ 30 more than rent");
    expect(describeDifference(-29.6)?.text).toBe("₹ 30 less than rent");
  });

  it("has nothing to say about a number that is not finite", () => {
    expect(describeDifference(Number.NaN)).toBeNull();
    expect(describeDifference(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("is role-neutral: it never says who paid or who is owed", () => {
    for (const value of [30, -30]) {
      expect(describeDifference(value)?.text).not.toMatch(/tenant|owner|owe|you|your/i);
    }
  });
});

describe("describeDifference while some portions have not paid yet", () => {
  it('adds "so far", because the total can still change', () => {
    expect(describeDifference(64, true)).toEqual({ tone: "more", text: "₹ 64 more than rent so far" });
    expect(describeDifference(-3, true)).toEqual({ tone: "less", text: "₹ 3 less than rent so far" });
  });

  it("is the plain wording when everything has been paid", () => {
    expect(describeDifference(64, false)).toEqual(describeDifference(64));
    expect(describeDifference(64, false)?.text).toBe("₹ 64 more than rent");
    expect(describeDifference(-3, false)?.text).toBe("₹ 3 less than rent");
  });

  it("still has nothing to say about a zero difference", () => {
    expect(describeDifference(0, true)).toBeNull();
    expect(describeDifference(0.4, true)).toBeNull();
  });
});

describe("cardDifferenceText", () => {
  it("adds the reference rent in brackets", () => {
    expect(cardDifferenceText(30, 6330)).toBe("₹ 30 more than rent (₹ 6,330)");
    expect(cardDifferenceText(-1, 10836)).toBe("₹ 1 less than rent (₹ 10,836)");
  });

  it("shows nothing when the rent was paid exactly", () => {
    expect(cardDifferenceText(0, 6300)).toBeNull();
  });

  it("shows nothing when there is no difference to show (no earlier entry to compare with)", () => {
    expect(cardDifferenceText(null, null)).toBeNull();
    expect(cardDifferenceText(null, 6300)).toBeNull();
  });

  it("leaves out the brackets rather than guess when the reference is missing", () => {
    expect(cardDifferenceText(30, null)).toBe("₹ 30 more than rent");
  });
});

describe("progressPercent", () => {
  it("is the share of the rent due that has been received, rounded", () => {
    expect(progressPercent(0, 1000)).toBe(0);
    expect(progressPercent(500, 1000)).toBe(50);
    expect(progressPercent(1, 3)).toBe(33);
    expect(progressPercent(2, 3)).toBe(67);
  });

  it("stops at 100 when more than the rent due has been received", () => {
    expect(progressPercent(1000, 1000)).toBe(100);
    expect(progressPercent(1030, 1000)).toBe(100);
    expect(progressPercent(5000, 1000)).toBe(100);
  });

  it("is 0 when nothing is due, and never negative", () => {
    expect(progressPercent(0, 0)).toBe(0);
    expect(progressPercent(500, 0)).toBe(0);
    expect(progressPercent(-5, 1000)).toBe(0);
  });
});
