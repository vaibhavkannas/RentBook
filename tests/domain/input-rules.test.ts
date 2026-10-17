import { describe, expect, it } from "vitest";
import {
  cleanText,
  dayProblem,
  FIRST_YEAR,
  isDayInRange,
  LAST_YEAR,
  MAX_NAME_LENGTH,
  requireDay,
  textProblem,
} from "@/lib/domain/input-rules";
import { AppError } from "@/lib/errors";

function validationMessage(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("validation");
    return (error as AppError).message;
  }
  throw new Error("expected a validation error");
}

describe("isDayInRange", () => {
  it("accepts real days from the first day of 2000 to the last day of 2100", () => {
    expect(FIRST_YEAR).toBe(2000);
    expect(LAST_YEAR).toBe(2100);
    for (const day of ["2000-01-01", "2024-02-29", "2026-10-05", "2100-12-31"]) {
      expect(isDayInRange(day), day).toBe(true);
    }
  });

  it("refuses a year before 2000 or after 2100", () => {
    for (const day of ["1999-12-31", "1900-01-01", "0001-01-01", "2101-01-01", "9999-12-31"]) {
      expect(isDayInRange(day), day).toBe(false);
    }
  });

  it("refuses what is not a real day, even in range", () => {
    for (const day of ["2026-02-30", "2100-02-29", "2026-13-01", "26-10-05", "2026-1-5", "", " 2026-10-05", "x"]) {
      expect(isDayInRange(day), JSON.stringify(day)).toBe(false);
    }
  });
});

describe("dayProblem", () => {
  it("is null for a day in range", () => {
    expect(dayProblem("2026-10-05", "Move-in date")).toBeNull();
  });

  it("says what is wrong, in plain words, with the field's name", () => {
    expect(dayProblem("", "Move-in date")).toBe("Move-in date is required.");
    expect(dayProblem("05/10/2026", "Move-in date")).toBe("Move-in date isn't a real date.");
    expect(dayProblem("2026-02-30", "Date received")).toBe("Date received isn't a real date.");
    expect(dayProblem("1999-12-31", "Agreement end")).toBe("Agreement end must be a date from 2000 to 2100.");
    expect(dayProblem("2101-01-01", "Advance date")).toBe("Advance date must be a date from 2000 to 2100.");
  });
});

describe("requireDay", () => {
  it("returns normally for a day in range", () => {
    expect(() => requireDay("2026-10-05", "Move-out date")).not.toThrow();
  });

  it("throws a validation error with the same words as dayProblem", () => {
    expect(validationMessage(() => requireDay("2150-01-01", "Move-out date"))).toBe(
      "Move-out date must be a date from 2000 to 2100.",
    );
    expect(validationMessage(() => requireDay("", "Move-out date"))).toBe("Move-out date is required.");
  });
});

describe("textProblem", () => {
  const phone = { max: 30 };
  const notes = { max: 500, allowNewlines: true };
  const name = { max: MAX_NAME_LENGTH, required: true };

  it("is null for ordinary text, including other scripts and joiners used in Indian names", () => {
    expect(textProblem("98765 43210", "Phone", phone)).toBeNull();
    expect(textProblem("राजेश कुमार", "Phone", phone)).toBeNull();
    expect(textProblem("ക്ഷ‍ ‌", "Phone", phone)).toBeNull();
    expect(textProblem("Café ₹5,000 \u{1f3e0}", "Phone", phone)).toBeNull();
  });

  it("refuses control characters in a single line, and says so in plain words", () => {
    for (const text of ["a\nb", "a\r\nb", "a\tb", "a\u0000b", "a\u001bb", "a\u007fb", "a\u0085b", "a\u009fb", "a\u2028b", "a\u2029b"]) {
      expect(textProblem(text, "Phone", phone), JSON.stringify(text)).toBe(
        "Phone cannot have line breaks or other control characters.",
      );
    }
  });

  it("lets multi-line text have line breaks and tabs, and still refuses the other control characters", () => {
    expect(textProblem("one\ntwo\r\nthree\tfour", "Notes", notes)).toBeNull();
    for (const text of ["a\u0000b", "a\u0007b", "a\u000bb", "a\u000cb", "a\u001bb", "a\u007fb", "a\u0085b", "a\u2028b", "a\u2029b"]) {
      expect(textProblem(text, "Notes", notes), JSON.stringify(text)).toBe(
        "Notes cannot have control characters other than line breaks.",
      );
    }
  });

  it("limits the length, counting what is given as it is", () => {
    expect(textProblem("9".repeat(30), "Phone", phone)).toBeNull();
    expect(textProblem("9".repeat(31), "Phone", phone)).toBe("Phone can have at most 30 characters.");
  });

  it("with required, wants 1 to the maximum characters", () => {
    expect(textProblem("A", "Tenant name", name)).toBeNull();
    expect(textProblem("a".repeat(60), "Tenant name", name)).toBeNull();
    expect(textProblem("", "Tenant name", name)).toBe("Tenant name must be 1 to 60 characters.");
    expect(textProblem("a".repeat(61), "Tenant name", name)).toBe("Tenant name must be 1 to 60 characters.");
    expect(textProblem("", "Phone", phone)).toBeNull();
  });

  it("names a too-long text before it names a control character in it", () => {
    expect(textProblem("a\n".repeat(20), "Phone", phone)).toBe("Phone can have at most 30 characters.");
  });
});

describe("cleanText", () => {
  it("returns the text trimmed, and treats a missing value as empty", () => {
    expect(cleanText("  98765 43210\n", "Phone", { max: 30 })).toBe("98765 43210");
    expect(cleanText(undefined, "Phone", { max: 30 })).toBe("");
  });

  it("does not count spaces or a trailing line break against the limit or as a control character", () => {
    expect(cleanText(" ".repeat(40) + "98765\n", "Phone", { max: 30 })).toBe("98765");
  });

  it("keeps line breaks inside multi-line text", () => {
    expect(cleanText(" one\ntwo ", "Notes", { max: 500, allowNewlines: true })).toBe("one\ntwo");
  });

  it("throws a validation error from textProblem", () => {
    expect(validationMessage(() => cleanText("98765\n43210", "Phone", { max: 30 }))).toBe(
      "Phone cannot have line breaks or other control characters.",
    );
    expect(validationMessage(() => cleanText("   ", "Tenant name", { max: 60, required: true }))).toBe(
      "Tenant name must be 1 to 60 characters.",
    );
  });
});
