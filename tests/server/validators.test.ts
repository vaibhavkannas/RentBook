import { describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import * as inputRules from "@/lib/domain/input-rules";
import * as validators from "@/lib/server/validators";
import { isoDay, safeText } from "@/lib/server/validators";

/** The first problem a schema finds with `value`, or null when it is fine. */
function problem(schema: ZodType, value: unknown): string | null {
  const result = schema.safeParse(value);
  return result.success ? null : result.error.issues[0].message;
}

describe("safeText", () => {
  it("trims, and returns the trimmed text", () => {
    expect(safeText(30).parse("  98765 43210 \n")).toBe("98765 43210");
    expect(safeText(30).parse("   ")).toBe("");
  });

  it("accepts text in any script", () => {
    expect(safeText(60).parse("राजेश कुमार")).toBe("राजेश कुमार");
    expect(safeText(60).parse("Zoë O’Neil \u{1f3e0}")).toBe("Zoë O’Neil \u{1f3e0}");
  });

  it("refuses control characters in a single line", () => {
    for (const text of ["a\nb", "a\r\nb", "a\tb", "a\u0000b", "a\u001bb", "a\u007fb", "a\u0085b", "a\u2028b"]) {
      expect(problem(safeText(30, { label: "Phone" }), text), JSON.stringify(text)).toBe(
        "Phone cannot have line breaks or other control characters.",
      );
    }
  });

  it("refuses a character the trimming leaves inside, but not a line break the trimming takes off", () => {
    expect(safeText(30).parse("98765\n")).toBe("98765");
    expect(safeText(30).parse("\n98765")).toBe("98765");
    expect(problem(safeText(30), "98765\u0000")).not.toBeNull();
  });

  it("with allowNewlines lets line breaks and tabs through and still refuses the other control characters", () => {
    const notes = safeText(500, { allowNewlines: true, label: "Notes" });
    expect(notes.parse("  Paid by cheque.\r\nCall in May\tplease.\n")).toBe("Paid by cheque.\r\nCall in May\tplease.");
    for (const text of ["a\u0000b", "a\u0007b", "a\u001bb", "a\u007fb", "a\u0085b", "a\u2029b"]) {
      expect(problem(notes, text), JSON.stringify(text)).toBe(
        "Notes cannot have control characters other than line breaks.",
      );
    }
  });

  it("limits the length of the trimmed text", () => {
    const phone = safeText(30, { label: "Phone" });
    expect(phone.parse(`  ${"9".repeat(30)}  `)).toHaveLength(30);
    expect(problem(phone, "9".repeat(31))).toBe("Phone can have at most 30 characters.");
  });

  it("with required, wants 1 to the maximum characters once trimmed", () => {
    const name = safeText(60, { label: "Tenant name", required: true });
    expect(name.parse(" Asha ")).toBe("Asha");
    expect(problem(name, "   ")).toBe("Tenant name must be 1 to 60 characters.");
    expect(problem(name, "a".repeat(61))).toBe("Tenant name must be 1 to 60 characters.");
    expect(safeText(60).parse("")).toBe("");
  });

  it("refuses what is not text", () => {
    expect(problem(safeText(30), 5)).not.toBeNull();
    expect(problem(safeText(30), null)).not.toBeNull();
    expect(safeText(30).optional().parse(undefined)).toBeUndefined();
  });
});

describe("isoDay", () => {
  const moveIn = isoDay("Move-in date");

  it("accepts real days from 2000 to 2100 and returns them as given", () => {
    for (const day of ["2000-01-01", "2026-10-05", "2100-12-31"]) {
      expect(moveIn.parse(day)).toBe(day);
    }
  });

  it("refuses a year outside 2000 to 2100 and a day that is not real", () => {
    expect(problem(moveIn, "1999-12-31")).toBe("Move-in date must be a date from 2000 to 2100.");
    expect(problem(moveIn, "2101-01-01")).toBe("Move-in date must be a date from 2000 to 2100.");
    expect(problem(moveIn, "2026-02-30")).toBe("Move-in date isn't a real date.");
    expect(problem(moveIn, "next year")).toBe("Move-in date isn't a real date.");
  });

  it("refuses a blank day, and says it is required", () => {
    expect(problem(moveIn, "")).toBe("Move-in date is required.");
    expect(problem(moveIn, "   ")).toBe("Move-in date is required.");
  });

  it("with allowBlank lets a blank through and still judges anything else", () => {
    const end = isoDay("Agreement end", { allowBlank: true });
    expect(end.parse("")).toBe("");
    expect(end.parse("  ")).toBe("  ");
    expect(problem(end, "1999-01-01")).toBe("Agreement end must be a date from 2000 to 2100.");
  });

  it("judges the day without its surrounding spaces, but does not change it", () => {
    expect(moveIn.parse(" 2026-10-05 ")).toBe(" 2026-10-05 ");
  });

  it("limits the length of the text it is given", () => {
    expect(problem(moveIn, "2".repeat(201))).not.toBeNull();
    expect(problem(moveIn, 20261005)).not.toBeNull();
  });
});

describe("what validators re-export", () => {
  it("is the date range the client can use too", () => {
    expect(validators.isDayInRange).toBe(inputRules.isDayInRange);
    expect(validators.FIRST_YEAR).toBe(2000);
    expect(validators.LAST_YEAR).toBe(2100);
  });
});
