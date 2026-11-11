import { describe, expect, it } from "vitest";
import { ringFigures, RING_RADIUS } from "@/lib/ring";

describe("the progress ring", () => {
  const circumference = 2 * Math.PI * RING_RADIUS;

  it("is empty at 0, full at 100 and half at 50", () => {
    expect(ringFigures(0)).toMatchObject({ percent: 0, offset: circumference });
    expect(ringFigures(100)).toMatchObject({ percent: 100, offset: 0 });
    expect(ringFigures(50).offset).toBeCloseTo(circumference / 2, 5);
  });

  it("never goes outside 0 to 100, and rounds to a whole percent", () => {
    expect(ringFigures(-5).percent).toBe(0);
    expect(ringFigures(250).percent).toBe(100);
    expect(ringFigures(61.6).percent).toBe(62);
    expect(ringFigures(Number.NaN).percent).toBe(0);
  });

  it("says its figure in words for a screen reader", () => {
    expect(ringFigures(62).label).toBe("62% collected");
  });
});
