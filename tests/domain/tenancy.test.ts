import { describe, expect, it } from "vitest";
import {
  ADVANCE_STATUSES,
  currentTenancy,
  isAdvanceStatus,
  MAX_RUPEES,
  newTenancyId,
  pastTenancies,
  sameTenantName,
  summarize,
  validateTenancyFields,
  validateTenantName,
  type Tenancy,
} from "@/lib/domain/tenancy";
import { AppError } from "@/lib/errors";

function tenancy(overrides: Partial<Tenancy> = {}): Tenancy {
  return {
    rowNumber: 2,
    id: "t-1",
    portionId: "p1",
    tenant: "Asha",
    phone: "98765 43210",
    moveIn: "2026-01-15",
    agreementEnd: "2027-01-14",
    advance: 20000,
    advanceDate: "2026-01-10",
    advanceStatus: "Held",
    refund: null,
    deductions: null,
    notes: "",
    moveOut: "",
    updatedBy: "owner@example.com",
    updatedAt: "2026-01-15T05:00:00.000Z",
    ...overrides,
  };
}

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

describe("sameTenantName", () => {
  it("ignores case and surrounding spaces", () => {
    expect(sameTenantName("Asha", "  asha ")).toBe(true);
    expect(sameTenantName("ASHA K", "asha k")).toBe(true);
  });

  it("tells different names apart", () => {
    expect(sameTenantName("Asha", "Asha K")).toBe(false);
    expect(sameTenantName("Asha", "Bala")).toBe(false);
  });
});

describe("currentTenancy", () => {
  it("is the last row of the portion with no move-out", () => {
    const all = [
      tenancy({ rowNumber: 2, id: "a", moveOut: "2026-06-30" }),
      tenancy({ rowNumber: 3, id: "b" }),
      tenancy({ rowNumber: 4, id: "c" }),
    ];
    expect(currentTenancy(all, "p1")?.id).toBe("c");
  });

  it("ignores other portions and closed rows", () => {
    const all = [
      tenancy({ rowNumber: 2, id: "a" }),
      tenancy({ rowNumber: 3, id: "b", portionId: "p2" }),
      tenancy({ rowNumber: 4, id: "c", moveOut: "2026-06-30" }),
    ];
    expect(currentTenancy(all, "p1")?.id).toBe("a");
    expect(currentTenancy(all, "p2")?.id).toBe("b");
  });

  it("is null when the portion has none", () => {
    expect(currentTenancy([], "p1")).toBeNull();
    expect(currentTenancy([tenancy({ moveOut: "2026-06-30" })], "p1")).toBeNull();
    expect(currentTenancy([tenancy({ portionId: "p2" })], "p1")).toBeNull();
  });
});

describe("pastTenancies", () => {
  it("lists closed rows of the portion, newest move-out first, ties by higher row first", () => {
    const all = [
      tenancy({ rowNumber: 2, id: "old", moveOut: "2025-03-31" }),
      tenancy({ rowNumber: 3, id: "tie-low", moveOut: "2026-06-30" }),
      tenancy({ rowNumber: 4, id: "tie-high", moveOut: "2026-06-30" }),
      tenancy({ rowNumber: 5, id: "other", portionId: "p2", moveOut: "2026-07-01" }),
      tenancy({ rowNumber: 6, id: "current" }),
    ];
    expect(pastTenancies(all, "p1").map((t) => t.id)).toEqual(["tie-high", "tie-low", "old"]);
  });

  it("does not reorder the input list", () => {
    const all = [
      tenancy({ rowNumber: 2, id: "a", moveOut: "2025-03-31" }),
      tenancy({ rowNumber: 3, id: "b", moveOut: "2026-06-30" }),
    ];
    pastTenancies(all, "p1");
    expect(all.map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("is empty when nobody has moved out", () => {
    expect(pastTenancies([tenancy()], "p1")).toEqual([]);
  });
});

describe("summarize", () => {
  it("keeps only what a portion card needs", () => {
    expect(summarize(tenancy())).toEqual({
      id: "t-1",
      phone: "98765 43210",
      moveIn: "2026-01-15",
      agreementEnd: "2027-01-14",
      advance: 20000,
      advanceStatus: "Held",
      updatedAt: "2026-01-15T05:00:00.000Z",
    });
  });
});

describe("advance statuses", () => {
  it("are Held, Refunded and Adjusted, and nothing else is one", () => {
    expect([...ADVANCE_STATUSES]).toEqual(["Held", "Refunded", "Adjusted"]);
    for (const status of ADVANCE_STATUSES) expect(isAdvanceStatus(status)).toBe(true);
    for (const other of ["held", "Held ", "", "Returned", null, undefined, 1]) {
      expect(isAdvanceStatus(other)).toBe(false);
    }
  });
});

describe("newTenancyId", () => {
  it("is t- then a random UUID", () => {
    expect(newTenancyId()).toMatch(/^t-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("is different every time, even for ids made in the same millisecond", () => {
    const ids = new Set(Array.from({ length: 2_000 }, () => newTenancyId()));
    expect(ids.size).toBe(2_000);
  });
});

describe("validateTenancyFields", () => {
  it("trims text and returns every field", () => {
    expect(
      validateTenancyFields({
        phone: "  +91 (98765) 43-210 ",
        moveIn: " 2026-10-01 ",
        agreementEnd: " 2027-08-31 ",
        advance: 20000,
        advanceDate: " 2026-09-25 ",
        notes: "  Deposit paid by cheque  ",
      }),
    ).toEqual({
      phone: "+91 (98765) 43-210",
      moveIn: "2026-10-01",
      agreementEnd: "2027-08-31",
      advance: 20000,
      advanceDate: "2026-09-25",
      notes: "Deposit paid by cheque",
    });
  });

  it("fills the optional fields with blanks and a null advance", () => {
    expect(validateTenancyFields({ moveIn: "2026-10-01" })).toEqual({
      phone: "",
      moveIn: "2026-10-01",
      agreementEnd: "",
      advance: null,
      advanceDate: "",
      notes: "",
    });
  });

  it("accepts the limits: advance 0 and the maximum, a 30 character phone, 500 characters of notes", () => {
    expect(validateTenancyFields({ moveIn: "2026-10-01", advance: 0 }).advance).toBe(0);
    expect(validateTenancyFields({ moveIn: "2026-10-01", advance: MAX_RUPEES }).advance).toBe(MAX_RUPEES);
    expect(validateTenancyFields({ moveIn: "2026-10-01", phone: "9".repeat(30) }).phone).toHaveLength(30);
    expect(validateTenancyFields({ moveIn: "2026-10-01", notes: "n".repeat(500) }).notes).toHaveLength(500);
  });

  it("accepts an agreement end on the move-in day and an explicit null advance", () => {
    const fields = validateTenancyFields({ moveIn: "2026-10-01", agreementEnd: "2026-10-01", advance: null });
    expect(fields.agreementEnd).toBe("2026-10-01");
    expect(fields.advance).toBeNull();
  });

  it.each(["98765\n43210", "98765\r\n43210", "98765\t43210", "98765\u000043210", "98765\u007f"])(
    "refuses a phone with a control character: %j",
    (phone) => {
      expect(validationMessage(() => validateTenancyFields({ moveIn: "2026-10-01", phone }))).toMatch(
        /Phone cannot have line breaks or other control characters/,
      );
    },
  );

  it("does not count spaces around the phone, or a trailing line break, against it", () => {
    expect(validateTenancyFields({ moveIn: "2026-10-01", phone: "  98765 43210\n" }).phone).toBe("98765 43210");
    expect(validateTenancyFields({ moveIn: "2026-10-01", phone: " ".repeat(40) + "98765" }).phone).toBe("98765");
  });

  it("refuses a missing or unreal move-in date", () => {
    expect(validationMessage(() => validateTenancyFields({ moveIn: "" }))).toMatch(/Move-in date is required/);
    expect(validationMessage(() => validateTenancyFields({ moveIn: "   " }))).toMatch(/Move-in date is required/);
    expect(validationMessage(() => validateTenancyFields({ moveIn: "2026-02-30" }))).toMatch(
      /Move-in date isn't a real date/,
    );
    expect(validationMessage(() => validateTenancyFields({ moveIn: "01/10/2026" }))).toMatch(
      /Move-in date isn't a real date/,
    );
  });

  it("refuses an agreement end that is not a real day", () => {
    expect(
      validationMessage(() => validateTenancyFields({ moveIn: "2026-10-01", agreementEnd: "next year" })),
    ).toMatch(/Agreement end isn't a real date/);
  });

  it("refuses an agreement end before the move-in date", () => {
    expect(
      validationMessage(() => validateTenancyFields({ moveIn: "2026-10-01", agreementEnd: "2026-09-30" })),
    ).toMatch(/Agreement end cannot be before the move-in date/);
  });

  it("refuses an advance date that is not a real day", () => {
    expect(
      validationMessage(() => validateTenancyFields({ moveIn: "2026-10-01", advanceDate: "2026-13-01" })),
    ).toMatch(/Advance date isn't a real date/);
  });

  it("refuses an advance that is not a whole number from 0 to the maximum", () => {
    for (const advance of [1.5, -1, MAX_RUPEES + 1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        validationMessage(() => validateTenancyFields({ moveIn: "2026-10-01", advance })),
        String(advance),
      ).toMatch(/Advance must be a whole number of rupees from 0 to 10,000,000/);
    }
    expect(MAX_RUPEES + 1).toBe(10_000_001);
  });

  it("refuses notes of 501 characters", () => {
    expect(
      validationMessage(() => validateTenancyFields({ moveIn: "2026-10-01", notes: "n".repeat(501) })),
    ).toMatch(/Notes can have at most 500 characters/);
  });

  it("keeps line breaks and tabs in notes, and refuses the other control characters", () => {
    expect(validateTenancyFields({ moveIn: "2026-10-01", notes: "Paid by cheque.\r\nCall in May\tplease.\n" }).notes).toBe(
      "Paid by cheque.\r\nCall in May\tplease.",
    );
    for (const notes of ["a\u0000b", "a\u0007b", "a\u001bb", "a\u007fb", "a\u0085b", "a\u2028b"]) {
      expect(
        validationMessage(() => validateTenancyFields({ moveIn: "2026-10-01", notes })),
        JSON.stringify(notes),
      ).toBe("Notes cannot have control characters other than line breaks.");
    }
  });

  it("takes tenancy dates from 2000-01-01 to 2100-12-31", () => {
    expect(
      validateTenancyFields({ moveIn: "2000-01-01", agreementEnd: "2100-12-31", advanceDate: "2000-01-01" }),
    ).toMatchObject({ moveIn: "2000-01-01", agreementEnd: "2100-12-31", advanceDate: "2000-01-01" });
  });

  it("refuses a move-in date, agreement end or advance date outside 2000 to 2100", () => {
    expect(validationMessage(() => validateTenancyFields({ moveIn: "1999-12-31" }))).toBe(
      "Move-in date must be a date from 2000 to 2100.",
    );
    expect(validationMessage(() => validateTenancyFields({ moveIn: "2101-01-01" }))).toBe(
      "Move-in date must be a date from 2000 to 2100.",
    );
    expect(
      validationMessage(() => validateTenancyFields({ moveIn: "2026-10-01", agreementEnd: "2101-01-01" })),
    ).toBe("Agreement end must be a date from 2000 to 2100.");
    expect(
      validationMessage(() => validateTenancyFields({ moveIn: "2026-10-01", advanceDate: "1999-12-31" })),
    ).toBe("Advance date must be a date from 2000 to 2100.");
  });
});

describe("validateTenantName", () => {
  it("trims the name", () => {
    expect(validateTenantName("  Asha K  ")).toBe("Asha K");
  });

  it("accepts 1 and 60 characters", () => {
    expect(validateTenantName("A")).toBe("A");
    expect(validateTenantName("a".repeat(60))).toHaveLength(60);
  });

  it("refuses an empty name and a 61 character name", () => {
    expect(validationMessage(() => validateTenantName(""))).toMatch(/Tenant name must be 1 to 60 characters/);
    expect(validationMessage(() => validateTenantName("   "))).toMatch(/Tenant name must be 1 to 60 characters/);
    expect(validationMessage(() => validateTenantName("a".repeat(61)))).toMatch(
      /Tenant name must be 1 to 60 characters/,
    );
  });

  it("refuses a name with a line break or another control character", () => {
    for (const name of ["Asha\nK", "Asha\tK", "Asha\u0000K", "Asha\u001bK", "Asha\u007f", "Asha\u0085K", "Asha\u2029K"]) {
      expect(validationMessage(() => validateTenantName(name)), JSON.stringify(name)).toBe(
        "Tenant name cannot have line breaks or other control characters.",
      );
    }
  });

  it("does not count a line break around the name against it", () => {
    expect(validateTenantName("\nAsha K\n")).toBe("Asha K");
  });

  it("keeps names in other scripts", () => {
    expect(validateTenantName("राजेश कुमार")).toBe("राजेश कुमार");
  });
});
