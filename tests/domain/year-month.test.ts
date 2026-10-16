import { describe, expect, it } from "vitest";
import {
  addMonths,
  compareYm,
  currentYm,
  isoDayFromSerial,
  isValidIsoDay,
  monthIndexFromName,
  monthName,
  parseYmKey,
  serialFromYm,
  todayIso,
  ymFromSerial,
  ymKey,
} from "@/lib/domain/year-month";

describe("ymKey / parseYmKey", () => {
  it("formats with zero padding", () => {
    expect(ymKey({ year: 2026, month: 3 })).toBe("2026-03");
  });
  it("parses a valid key", () => {
    expect(parseYmKey("2026-10")).toEqual({ year: 2026, month: 10 });
  });
  it("rejects bad keys", () => {
    expect(parseYmKey("2026-13")).toBeNull();
    expect(parseYmKey("2026-1")).toBeNull();
    expect(parseYmKey("Oct-26")).toBeNull();
  });
});

describe("compareYm / addMonths", () => {
  it("orders across years", () => {
    expect(compareYm({ year: 2025, month: 12 }, { year: 2026, month: 1 })).toBeLessThan(0);
    expect(compareYm({ year: 2026, month: 5 }, { year: 2026, month: 5 })).toBe(0);
  });
  it("rolls over year boundaries in both directions", () => {
    expect(addMonths({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(addMonths({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(addMonths({ year: 2026, month: 3 }, -15)).toEqual({ year: 2024, month: 12 });
  });
});

describe("sheets serials", () => {
  it("matches known serials", () => {
    expect(serialFromYm({ year: 1970, month: 1 })).toBe(25569);
    expect(serialFromYm({ year: 2020, month: 1 })).toBe(43831);
  });
  it("round-trips, including mid-month serials", () => {
    expect(ymFromSerial(43831)).toEqual({ year: 2020, month: 1 });
    expect(ymFromSerial(43831 + 20.5)).toEqual({ year: 2020, month: 1 });
    expect(ymFromSerial(serialFromYm({ year: 2026, month: 10 }))).toEqual({ year: 2026, month: 10 });
  });
});

describe("isoDayFromSerial", () => {
  it("turns known serials into the calendar day", () => {
    expect(isoDayFromSerial(25569)).toBe("1970-01-01");
    expect(isoDayFromSerial(43831)).toBe("2020-01-01");
    expect(isoDayFromSerial(46037)).toBe("2026-01-15");
    expect(isoDayFromSerial(46401)).toBe("2027-01-14");
    expect(isoDayFromSerial(0)).toBe("1899-12-30");
  });
  it("drops the time of day", () => {
    expect(isoDayFromSerial(46037.75)).toBe("2026-01-15");
    expect(isoDayFromSerial(46037.999)).toBe("2026-01-15");
  });
  it("round-trips the first day of a month", () => {
    expect(isoDayFromSerial(serialFromYm({ year: 2026, month: 10 }))).toBe("2026-10-01");
  });
  it("agrees with isValidIsoDay", () => {
    for (const serial of [1, 59, 60, 61, 20000, 46387, 80000]) {
      expect(isValidIsoDay(isoDayFromSerial(serial)!)).toBe(true);
    }
  });
  it("returns null for a number that is not a plausible date", () => {
    expect(isoDayFromSerial(Number.NaN)).toBeNull();
    expect(isoDayFromSerial(Number.POSITIVE_INFINITY)).toBeNull();
    expect(isoDayFromSerial(1e12)).toBeNull();
    expect(isoDayFromSerial(-1e9)).toBeNull();
  });
});

describe("time zone helpers", () => {
  it("uses Asia/Kolkata, not UTC", () => {
    const lateUtc = new Date("2026-09-30T20:00:00Z");
    expect(todayIso(lateUtc)).toBe("2026-10-01");
    expect(currentYm(lateUtc)).toEqual({ year: 2026, month: 10 });
  });
});

describe("isValidIsoDay", () => {
  it("accepts real dates only", () => {
    expect(isValidIsoDay("2026-10-05")).toBe(true);
    expect(isValidIsoDay("2026-02-30")).toBe(false);
    expect(isValidIsoDay("05-10-2026")).toBe(false);
  });
});

describe("month names", () => {
  it("formats and parses short and long names", () => {
    expect(monthName(1, false)).toBe("Jan");
    expect(monthName(9, true)).toBe("September");
    expect(monthIndexFromName("sep")).toBe(9);
    expect(monthIndexFromName("September")).toBe(9);
    // a prefix of at least three letters, with an optional trailing dot
    expect(monthIndexFromName("Sept")).toBe(9);
    expect(monthIndexFromName("sept.")).toBe(9);
    expect(monthIndexFromName("Marc")).toBe(3);
    expect(monthIndexFromName("Ju")).toBeNull();
    expect(monthIndexFromName("Septembers")).toBeNull();
    expect(monthIndexFromName("Sepx")).toBeNull();
  });
});
