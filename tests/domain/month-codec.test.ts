import { describe, expect, it } from "vitest";
import { detectMonthCodec, readMonth, writeMonth } from "@/lib/domain/month-codec";
import { AppError } from "@/lib/errors";

describe("detectMonthCodec", () => {
  it("detects date cells as serial", () => {
    expect(detectMonthCodec(43831)).toEqual({ kind: "serial" });
  });
  it("detects short text with a dash", () => {
    expect(detectMonthCodec("Oct-26")).toEqual({
      kind: "text",
      style: { longName: false, separator: "-", fourDigitYear: false },
    });
  });
  it("detects long text with a space and four-digit year", () => {
    expect(detectMonthCodec("October 2026")).toEqual({
      kind: "text",
      style: { longName: true, separator: " ", fourDigitYear: true },
    });
  });
  it("refuses to guess unknown formats", () => {
    let thrown: unknown;
    try {
      detectMonthCodec("10/2026");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).code).toBe("sheet-structure");
    expect(() => detectMonthCodec(undefined)).toThrow(/Month column format/);
  });
});

describe("readMonth / writeMonth", () => {
  it("reads and writes serial months", () => {
    const codec = detectMonthCodec(43831);
    expect(readMonth(codec, 43831)).toEqual({ year: 2020, month: 1 });
    expect(writeMonth(codec, { year: 2020, month: 1 })).toBe(43831);
  });
  it("reads and writes text months in the detected style", () => {
    const codec = detectMonthCodec("Jan-20");
    expect(readMonth(codec, "Feb-20")).toEqual({ year: 2020, month: 2 });
    expect(writeMonth(codec, { year: 2026, month: 10 })).toBe("Oct-26");
    const long = detectMonthCodec("October 2026");
    expect(writeMonth(long, { year: 2027, month: 1 })).toBe("January 2027");
  });
  it("returns null for cells that are not months", () => {
    expect(readMonth({ kind: "serial" }, "Total")).toBeNull();
    expect(readMonth(detectMonthCodec("Jan-20"), 5)).toBeNull();
    expect(readMonth(detectMonthCodec("Jan-20"), "Total")).toBeNull();
  });
});
