import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { APP_TIME_ZONE } from "@/lib/domain/year-month";
import {
  formatDay,
  formatMonthKey,
  formatMonthTitle,
  formatRupees,
  formatSavedAt,
  formatTime,
  indiaDayKey,
  stripRupeeFormatting,
  wholeRupeesMessage,
} from "@/lib/format";
import { withoutComments } from "../support/source-scan";

describe("format", () => {
  it("formats rupees with Indian digit grouping", () => {
    expect(formatRupees(5450)).toBe("₹ 5,450");
    expect(formatRupees(1234567)).toBe("₹ 12,34,567");
    expect(formatRupees(0)).toBe("₹ 0");
  });
  it("formats a month title", () => {
    expect(formatMonthTitle({ year: 2026, month: 10 })).toBe("October 2026");
  });
});

describe("formatMonthKey", () => {
  it("turns a month key into the long month title", () => {
    expect(formatMonthKey("2026-10")).toBe("October 2026");
    expect(formatMonthKey("2027-01")).toBe("January 2027");
  });
  it.each(["", "2026-13", "Oct-26", "46296", "2026-10-05"])(
    "returns %j unchanged when it is not a month key",
    (text) => {
      expect(formatMonthKey(text)).toBe(text);
    },
  );
});

describe("formatSavedAt", () => {
  it("shows India time", () => {
    expect(formatSavedAt("2026-10-05T04:30:00.000Z")).toMatch(/5 Oct.*10:00\s?am/i);
  });
  it("returns text that is not a date unchanged", () => {
    expect(formatSavedAt("not a date")).toBe("not a date");
  });
});

describe("formatDay", () => {
  it("shows a day as a short date with no leading zero", () => {
    expect(formatDay("2027-03-15")).toBe("15 Mar 2027");
    expect(formatDay("2026-10-05")).toBe("5 Oct 2026");
    expect(formatDay("2026-01-01")).toBe("1 Jan 2026");
    expect(formatDay("2026-12-31")).toBe("31 Dec 2026");
  });
  it("handles a leap day", () => {
    expect(formatDay("2028-02-29")).toBe("29 Feb 2028");
  });
  it.each(["", "  ", "2026-02-30", "2027-13-01", "2026-10", "15 Mar 2027", "46296", "2026-10-05T04:30:00Z", "soon"])(
    "returns %j unchanged when it is not a real YYYY-MM-DD day",
    (text) => {
      expect(formatDay(text)).toBe(text);
    },
  );
});

describe("wholeRupeesMessage", () => {
  it("says the range in whole rupees the way the rest of the app writes an amount, with the Indian grouping", () => {
    expect(wholeRupeesMessage("Advance", 0, 10_000_000)).toBe("Advance must be whole rupees, from ₹ 0 to ₹ 1,00,00,000.");
    expect(wholeRupeesMessage("Amount", 1, 10_000_000)).toBe("Amount must be whole rupees, from ₹ 1 to ₹ 1,00,00,000.");
  });

  it("never writes the largest amount the western way", () => {
    expect(wholeRupeesMessage("Refund", 0, 10_000_000)).not.toContain("10,000,000");
  });
});

describe("stripRupeeFormatting", () => {
  it("takes out commas, spaces of any kind and the rupee sign, and nothing else", () => {
    expect(stripRupeeFormatting("₹ 5,450")).toBe("5450");
    expect(stripRupeeFormatting(" 1,00,000 ")).toBe("100000");
    expect(stripRupeeFormatting("5\u00a0450\t")).toBe("5450");
    expect(stripRupeeFormatting("12.5k")).toBe("12.5k");
    expect(stripRupeeFormatting("-5")).toBe("-5");
  });

  it("leaves nothing for a blank or a lone sign, which is how a blank amount is told from text", () => {
    for (const text of ["", "   ", "₹", " , ", "₹ ,"]) expect(stripRupeeFormatting(text)).toBe("");
  });
});

describe("indiaDayKey", () => {
  it("is the day the time falls on in India, which starts at 18:30 UTC the evening before", () => {
    expect(indiaDayKey("2026-10-15T19:00:00Z")).toBe("2026-10-16");
    expect(indiaDayKey("2026-10-15T18:29:59Z")).toBe("2026-10-15");
    expect(indiaDayKey("2026-10-15T18:30:00Z")).toBe("2026-10-16");
    expect(indiaDayKey("2026-10-16T18:29:59.999Z")).toBe("2026-10-16");
  });

  it("reads the time the app writes, with milliseconds", () => {
    expect(indiaDayKey("2026-10-05T04:30:00.000Z")).toBe("2026-10-05");
  });

  it("crosses the end of a month, a year and a leap February", () => {
    expect(indiaDayKey("2026-10-31T19:00:00Z")).toBe("2026-11-01");
    expect(indiaDayKey("2026-12-31T19:00:00Z")).toBe("2027-01-01");
    expect(indiaDayKey("2028-02-28T18:30:00Z")).toBe("2028-02-29");
    expect(indiaDayKey("2028-02-29T18:30:00Z")).toBe("2028-03-01");
  });

  it("reads a time written with an offset", () => {
    expect(indiaDayKey("2026-10-16T00:15:00+05:30")).toBe("2026-10-16");
    expect(indiaDayKey("2026-10-15T20:00:00-05:00")).toBe("2026-10-16");
    expect(indiaDayKey("2026-10-16T01:00:00+0530")).toBe("2026-10-16");
    expect(indiaDayKey("2026-10-16T01:00:00+09:00")).toBe("2026-10-15");
  });

  it("is null for a time it cannot read, and never guesses from the server's own time zone", () => {
    for (const text of [
      "",
      "   ",
      "not a date",
      "46300.4166",
      "5 Oct",
      "10/5/2026",
      "2026",
      "2026-10-05",
      "2026-10-05T10:00:00",
      "2026-10-05 10:00:00Z",
      "2026-02-30T10:00:00Z",
      "2026-13-01T10:00:00Z",
      "2026-10-05T25:00:00Z",
      "2026-10-05T10:61:00Z",
    ]) {
      expect(indiaDayKey(text), text).toBeNull();
    }
  });
});

describe("formatTime", () => {
  it("shows India time as hour:minute am or pm", () => {
    expect(formatTime("2026-10-05T04:30:00.000Z")).toBe("10:00 am");
    expect(formatTime("2026-10-05T13:35:00Z")).toBe("7:05 pm");
    expect(formatTime("2026-10-05T00:00:00Z")).toBe("5:30 am");
  });

  it("says 12 for midnight and for noon, and zero-pads the minutes", () => {
    expect(formatTime("2026-10-05T18:30:00Z")).toBe("12:00 am");
    expect(formatTime("2026-10-05T18:39:00Z")).toBe("12:09 am");
    expect(formatTime("2026-10-05T06:30:00Z")).toBe("12:00 pm");
    expect(formatTime("2026-10-05T07:29:00Z")).toBe("12:59 pm");
    expect(formatTime("2026-10-05T18:29:00Z")).toBe("11:59 pm");
  });

  it("separates the time and am or pm with an ordinary space, whatever the runtime's locale data says", () => {
    expect(formatTime("2026-10-05T04:30:00Z")).toMatch(/^\d{1,2}:\d{2} [ap]m$/);
  });

  it("is null for a time it cannot read", () => {
    for (const text of ["", "later", "46300.41", "2026-10-05", "2026-10-05T10:00:00"]) expect(formatTime(text)).toBeNull();
  });
});

describe("the display time zone", () => {
  it("is India, and is written once in the source: the day, the time and the saved-at text all use the one constant", () => {
    expect(APP_TIME_ZONE).toBe("Asia/Kolkata");
    const root = fileURLToPath(new URL("../../", import.meta.url));
    const writing = ["src/lib", "src/app", "src/components"]
      .flatMap((dir) =>
        readdirSync(path.join(root, dir), { recursive: true, encoding: "utf8" })
          .filter((file) => /\.tsx?$/.test(file))
          .map((file) => `${dir}/${file.split(path.sep).join("/")}`),
      )
      .filter((file) => withoutComments(readFileSync(path.join(root, file), "utf8")).includes("Asia/Kolkata"));
    expect(writing).toEqual(["src/lib/domain/year-month.ts"]);
  });
});
