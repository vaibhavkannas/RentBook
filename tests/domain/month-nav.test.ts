import { describe, expect, it } from "vitest";
import { monthHref, monthPickerCells, swipeDirection } from "@/lib/month-nav";

describe("monthPickerCells", () => {
  it("lists the twelve months of a year", () => {
    const cells = monthPickerCells(2026);
    expect(cells).toHaveLength(12);
    expect(cells[0]).toEqual({ key: "2026-01", label: "Jan" });
    expect(cells[9]).toEqual({ key: "2026-10", label: "Oct" });
    expect(cells[11]).toEqual({ key: "2026-12", label: "Dec" });
  });
});

describe("monthHref", () => {
  it("links the current month to the plain home page and others with a month", () => {
    expect(monthHref("2026-10", "2026-10")).toBe("/");
    expect(monthHref("2026-11", "2026-10")).toBe("/?month=2026-11");
  });
});

describe("swipeDirection", () => {
  it("swiping left goes to the next month and right to the previous", () => {
    expect(swipeDirection(-90, 5)).toBe("next");
    expect(swipeDirection(90, -5)).toBe("prev");
  });
  it("ignores short swipes", () => {
    expect(swipeDirection(-59, 0)).toBeNull();
    expect(swipeDirection(40, 0)).toBeNull();
  });
  it("ignores mostly vertical movement", () => {
    expect(swipeDirection(-80, 70)).toBeNull();
    expect(swipeDirection(70, -80)).toBeNull();
  });
});
