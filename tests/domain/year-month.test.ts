import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  compareYm,
  currentYm,
  daysBetween,
  firstDayOf,
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

describe("daysBetween", () => {
  it("counts whole days from the first day to the second", () => {
    expect(daysBetween("2026-10-01", "2026-10-01")).toBe(0);
    expect(daysBetween("2026-10-01", "2026-10-02")).toBe(1);
    expect(daysBetween("2026-10-01", "2026-10-17")).toBe(16);
    expect(daysBetween("2026-10-17", "2026-12-16")).toBe(60);
  });

  it("is negative when the second day is earlier", () => {
    expect(daysBetween("2026-10-17", "2026-10-05")).toBe(-12);
    expect(daysBetween("2027-01-01", "2026-12-31")).toBe(-1);
  });

  it("counts the leap day of 2028 and not one in 2026 or 2100", () => {
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2);
    expect(daysBetween("2028-02-29", "2028-03-01")).toBe(1);
    expect(daysBetween("2026-02-28", "2026-03-01")).toBe(1);
    expect(daysBetween("2100-02-28", "2100-03-01")).toBe(1);
    expect(daysBetween("2028-01-01", "2029-01-01")).toBe(366);
    expect(daysBetween("2026-01-01", "2027-01-01")).toBe(365);
  });

  it("crosses month and year ends", () => {
    expect(daysBetween("2026-01-31", "2026-02-01")).toBe(1);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
    expect(daysBetween("2026-11-30", "2026-12-01")).toBe(1);
    expect(daysBetween("2026-04-30", "2026-05-31")).toBe(31);
  });

  it("is not moved by the time zone or by daylight saving of the machine it runs on", () => {
    // Whole days through UTC, so a 23- or 25-hour day somewhere is still one day.
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2);
    expect(daysBetween("2026-11-01", "2026-11-03")).toBe(2);
  });

  it("agrees with addDays", () => {
    for (const [from, n] of [["2026-10-17", 60], ["2028-02-29", 366], ["2026-01-31", -31], ["2026-12-31", 1]] as const) {
      expect(daysBetween(from, addDays(from, n))).toBe(n);
    }
  });

  it("throws on a value that is not a real day, in either place, without quoting it", () => {
    for (const bad of ["2026-02-30", "2026-13-01", "2026-00-10", "26-10-17", "2026-10-1", "", " 2026-10-17", "2026-10-17T00:00:00Z", "soon", "0050-01-01"]) {
      expect(() => daysBetween(bad, "2026-10-17")).toThrow(RangeError);
      expect(() => daysBetween("2026-10-17", bad)).toThrow(RangeError);
    }
    expect(() => daysBetween("2027-02-30", "2026-10-17")).toThrow(/real day/);
    expect(() => daysBetween("2027-02-30", "2026-10-17")).not.toThrow(/2027/);
  });
});

describe("addDays", () => {
  it("moves a day forward and back, over month, year and leap-day ends", () => {
    expect(addDays("2026-10-17", 0)).toBe("2026-10-17");
    expect(addDays("2026-10-01", 5)).toBe("2026-10-06");
    expect(addDays("2026-10-30", 2)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2028-02-29", 1)).toBe("2028-03-01");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-10-17", 60)).toBe("2026-12-16");
    expect(addDays("2026-10-17", -365)).toBe("2025-10-17");
  });

  it("throws on a day that is not real, a step that is not a whole number, and a result that is not a four-digit year", () => {
    expect(() => addDays("2026-02-30", 1)).toThrow(RangeError);
    expect(() => addDays("", 1)).toThrow(RangeError);
    expect(() => addDays("2026-10-17", 1.5)).toThrow(RangeError);
    expect(() => addDays("2026-10-17", Number.NaN)).toThrow(RangeError);
    expect(() => addDays("9999-12-31", 1)).toThrow(RangeError);
    expect(() => addDays("0100-01-01", -1)).toThrow(RangeError);
  });

  it("gives a day isValidIsoDay accepts", () => {
    for (const n of [-800, -31, -1, 0, 1, 28, 59, 400]) {
      expect(isValidIsoDay(addDays("2026-10-17", n))).toBe(true);
    }
  });
});

describe("firstDayOf", () => {
  it("is the 1st of the month, zero padded", () => {
    expect(firstDayOf({ year: 2026, month: 3 })).toBe("2026-03-01");
    expect(firstDayOf({ year: 2026, month: 12 })).toBe("2026-12-01");
    expect(firstDayOf({ year: 2028, month: 2 })).toBe("2028-02-01");
  });

  it("is a real day, and the day before it is the last of the month before", () => {
    expect(isValidIsoDay(firstDayOf({ year: 2026, month: 10 }))).toBe(true);
    expect(addDays(firstDayOf({ year: 2028, month: 3 }), -1)).toBe("2028-02-29");
    expect(addDays(firstDayOf({ year: 2027, month: 1 }), -1)).toBe("2026-12-31");
  });
});
