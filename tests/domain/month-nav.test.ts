import { describe, expect, it } from "vitest";
import {
  monthHref,
  monthPickerCells,
  sheetKey,
  shouldCloseOnBackdrop,
  shouldStartSwipe,
  swipeDirection,
  trapTabIndex,
} from "@/lib/month-nav";

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
  it("counts a drag of exactly 60 px", () => {
    expect(swipeDirection(-60, 0)).toBe("next");
    expect(swipeDirection(60, 0)).toBe("prev");
    expect(swipeDirection(-59.9, 0)).toBeNull();
  });
  it("counts a drag at exactly the 1.5 ratio and ignores one just under it", () => {
    expect(swipeDirection(-90, 60)).toBe("next");
    expect(swipeDirection(90, -60)).toBe("prev");
    expect(swipeDirection(-90, 61)).toBeNull();
    expect(swipeDirection(90, -61)).toBeNull();
  });
  it("honours a custom minimum distance", () => {
    expect(swipeDirection(-30, 0, 30)).toBe("next");
    expect(swipeDirection(-29, 0, 30)).toBeNull();
  });
});

describe("shouldStartSwipe", () => {
  it("starts with one finger and no dialog open", () => {
    expect(shouldStartSwipe(1, false)).toBe(true);
  });
  it("never starts while a dialog is open, wherever the finger lands", () => {
    expect(shouldStartSwipe(1, true)).toBe(false);
  });
  it("ignores a pinch or any multi-finger touch", () => {
    expect(shouldStartSwipe(2, false)).toBe(false);
    expect(shouldStartSwipe(3, false)).toBe(false);
  });
  it("ignores a touch event with no touches", () => {
    expect(shouldStartSwipe(0, false)).toBe(false);
  });
});

describe("trapTabIndex", () => {
  it("lets Tab move normally between controls", () => {
    expect(trapTabIndex(5, 0, false)).toBeNull();
    expect(trapTabIndex(5, 2, false)).toBeNull();
    expect(trapTabIndex(5, 3, true)).toBeNull();
  });
  it("wraps Tab from the last control to the first", () => {
    expect(trapTabIndex(5, 4, false)).toBe(0);
  });
  it("wraps Shift+Tab from the first control to the last", () => {
    expect(trapTabIndex(5, 0, true)).toBe(4);
  });
  it("pulls focus in when it is on the dialog itself or outside it", () => {
    expect(trapTabIndex(5, -1, false)).toBe(0);
    expect(trapTabIndex(5, -1, true)).toBe(4);
  });
  it("does nothing when there is nothing to focus", () => {
    expect(trapTabIndex(0, -1, false)).toBeNull();
  });
});

describe("sheetKey", () => {
  it("changes with the month so a sheet cannot survive a month change", () => {
    expect(sheetKey("2026-10", "log", "p1")).not.toBe(sheetKey("2026-11", "log", "p1"));
  });
  it("changes with the mode and the portion", () => {
    expect(sheetKey("2026-10", "log", "p1")).not.toBe(sheetKey("2026-10", "edit", "p1"));
    expect(sheetKey("2026-10", "log", "p1")).not.toBe(sheetKey("2026-10", "log", "p2"));
    expect(sheetKey("2026-10", "new-tenant", null)).not.toBe(sheetKey("2026-10", "new-tenant", "p1"));
  });
  it("is stable for the same inputs", () => {
    expect(sheetKey("2026-10", "log", "p1")).toBe(sheetKey("2026-10", "log", "p1"));
  });
});

describe("shouldCloseOnBackdrop", () => {
  it("closes when the press went down and up on the backdrop itself", () => {
    expect(
      shouldCloseOnBackdrop({ downOnBackdrop: true, upOnBackdrop: true, clickOnBackdrop: true }),
    ).toBe(true);
  });
  it("does not close for a drag that started inside the panel and ended on the backdrop", () => {
    expect(
      shouldCloseOnBackdrop({ downOnBackdrop: false, upOnBackdrop: true, clickOnBackdrop: true }),
    ).toBe(false);
  });
  it("does not close for a drag that started on the backdrop and ended inside the panel", () => {
    expect(
      shouldCloseOnBackdrop({ downOnBackdrop: true, upOnBackdrop: false, clickOnBackdrop: true }),
    ).toBe(false);
  });
  it("does not close for a click that landed on something inside the panel", () => {
    expect(
      shouldCloseOnBackdrop({ downOnBackdrop: true, upOnBackdrop: true, clickOnBackdrop: false }),
    ).toBe(false);
  });
});
