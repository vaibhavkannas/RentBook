import { describe, expect, it } from "vitest";
import { detectMonthCodec, readMonth, writeMonth } from "@/lib/domain/month-codec";
import { serialFromYm } from "@/lib/domain/year-month";
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
  it("refuses a number that cannot be a plausible date", () => {
    expect(() => detectMonthCodec(5)).toThrow(/Month column format/);
  });
});

describe("detectMonthCodec: the other styles it can write", () => {
  it("keeps the separator the sheet uses", () => {
    expect(detectMonthCodec("Oct/26")).toEqual({
      kind: "text",
      style: { longName: false, separator: "/", fourDigitYear: false },
    });
    expect(detectMonthCodec("Oct '26")).toEqual({
      kind: "text",
      style: { longName: false, separator: " '", fourDigitYear: false },
    });
  });
  it("writes a prefix such as Sept in the short style, and remembers a trailing dot", () => {
    expect(detectMonthCodec("Sept-26")).toEqual({
      kind: "text",
      style: { longName: false, separator: "-", fourDigitYear: false },
    });
    expect(detectMonthCodec("Sept. 2026")).toEqual({
      kind: "text",
      style: { longName: false, separator: " ", fourDigitYear: true, dot: true },
    });
  });
  it("detects ISO year-month text", () => {
    expect(detectMonthCodec("2026-09")).toEqual({ kind: "iso" });
  });
});

describe("readMonth", () => {
  it("reads a date serial", () => {
    expect(readMonth(43831)).toEqual({ year: 2020, month: 1 });
    expect(readMonth(serialFromYm({ year: 2026, month: 10 }) + 0.5)).toEqual({ year: 2026, month: 10 });
  });

  it("accepts date serials from 2000-01 to 2100-12 only", () => {
    expect(readMonth(serialFromYm({ year: 2000, month: 1 }))).toEqual({ year: 2000, month: 1 });
    expect(readMonth(serialFromYm({ year: 2100, month: 12 }))).toEqual({ year: 2100, month: 12 });
    expect(readMonth(serialFromYm({ year: 1999, month: 12 }))).toBeNull();
    expect(readMonth(serialFromYm({ year: 2101, month: 1 }))).toBeNull();
    expect(readMonth(5)).toBeNull(); // 1900-01-04, not a month of a rent schedule
    expect(readMonth(0)).toBeNull();
    expect(readMonth(-3)).toBeNull();
    expect(readMonth(Number.NaN)).toBeNull();
    expect(readMonth(Number.POSITIVE_INFINITY)).toBeNull();
    expect(readMonth(1e15)).toBeNull();
  });

  it.each([
    ["Oct-26", 2026, 10],
    ["oct-26", 2026, 10],
    ["Oct 26", 2026, 10],
    ["Oct/26", 2026, 10],
    ["Oct '26", 2026, 10],
    ["Oct'26", 2026, 10],
    ["October 2026", 2026, 10],
    ["OCTOBER-2026", 2026, 10],
    ["Sep-26", 2026, 9],
    ["Sept-26", 2026, 9],
    ["sept. 26", 2026, 9],
    ["Sept. 2026", 2026, 9],
    ["Septem-26", 2026, 9],
    ["September 2026", 2026, 9],
    ["Marc-27", 2027, 3],
    ["May 2026", 2026, 5],
    ["Jan.-27", 2027, 1],
    ["  Dec 2099  ", 2099, 12],
    ["2026-09", 2026, 9],
    ["2100-12", 2100, 12],
  ])("reads the text %j", (text, year, month) => {
    expect(readMonth(text)).toEqual({ year, month });
  });

  it.each([
    "",
    "   ",
    "Total",
    "Grand total",
    "Ju-26", // two letters is not enough to tell June from July
    "Maybe 26",
    "Octo ber-26",
    "Oct-2",
    "Oct-202",
    "Oct-20266",
    "Oct26", // no separator
    "10/2026",
    "2026-13",
    "2026-00",
    "1999-12",
    "2101-01",
    "Oct 1999",
    "2026-09-01",
    "Foo-26",
  ])("does not read the text %j", (text) => {
    expect(readMonth(text)).toBeNull();
  });

  it("does not read anything that is not a number or text", () => {
    expect(readMonth(undefined)).toBeNull();
    expect(readMonth(null)).toBeNull();
    expect(readMonth(true)).toBeNull();
    expect(readMonth({})).toBeNull();
  });

  it("reads every cell on its own, whatever its neighbours look like", () => {
    expect(readMonth("Aug-26")).toEqual({ year: 2026, month: 8 });
    expect(readMonth(serialFromYm({ year: 2026, month: 9 }))).toEqual({ year: 2026, month: 9 });
  });
});

describe("writeMonth", () => {
  it("writes serial months", () => {
    const codec = detectMonthCodec(43831);
    expect(writeMonth(codec, { year: 2020, month: 1 })).toBe(43831);
  });
  it("writes text months in the detected style", () => {
    const codec = detectMonthCodec("Jan-20");
    expect(writeMonth(codec, { year: 2026, month: 10 })).toBe("Oct-26");
    const long = detectMonthCodec("October 2026");
    expect(writeMonth(long, { year: 2027, month: 1 })).toBe("January 2027");
    expect(writeMonth(detectMonthCodec("Sep/26"), { year: 2026, month: 10 })).toBe("Oct/26");
    expect(writeMonth(detectMonthCodec("Sep '26"), { year: 2026, month: 10 })).toBe("Oct '26");
    expect(writeMonth(detectMonthCodec("Sept. 2026"), { year: 2026, month: 10 })).toBe("Oct. 2026");
  });
  it("writes ISO months", () => {
    expect(writeMonth(detectMonthCodec("2026-09"), { year: 2026, month: 10 })).toBe("2026-10");
    expect(writeMonth({ kind: "iso" }, { year: 2027, month: 1 })).toBe("2027-01");
  });
  it("writes what it can read back", () => {
    for (const sample of ["Jan-20", "October 2026", "Sep/26", "Sep '26", "Sept. 2026", "2026-09", 43831]) {
      const codec = detectMonthCodec(sample);
      for (const ym of [{ year: 2026, month: 1 }, { year: 2026, month: 12 }, { year: 2031, month: 5 }]) {
        expect(readMonth(writeMonth(codec, ym))).toEqual(ym);
      }
    }
  });
});
