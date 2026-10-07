import { describe, expect, it } from "vitest";
import {
  currentTenancy,
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

describe("newTenancyId", () => {
  const now = new Date("2026-10-07T10:00:00.000Z");

  it("is t- then the time in base 36 then four random base 36 characters", () => {
    const id = newTenancyId(now);
    expect(id).toMatch(/^t-[0-9a-z]+[0-9a-z]{4}$/);
    expect(id.startsWith(`t-${now.getTime().toString(36)}`)).toBe(true);
    expect(id).toHaveLength(2 + now.getTime().toString(36).length + 4);
  });

  it("is deterministic with an injected random source", () => {
    expect(newTenancyId(now, () => 0)).toBe(`t-${now.getTime().toString(36)}0000`);
    expect(newTenancyId(now, () => 0.999999)).toBe(`t-${now.getTime().toString(36)}zzzz`);
    expect(newTenancyId(now, () => 0.5)).toBe(newTenancyId(now, () => 0.5));
  });

  it("never lets a random value of 1 add a fifth character", () => {
    expect(newTenancyId(now, () => 1)).toBe(`t-${now.getTime().toString(36)}zzzz`);
  });

  it("differs when the time or the random source differs", () => {
    expect(newTenancyId(now, () => 0)).not.toBe(newTenancyId(new Date(now.getTime() + 1), () => 0));
    expect(newTenancyId(now, () => 0)).not.toBe(newTenancyId(now, () => 0.5));
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

  it("accepts the limits: advance 0 and the maximum, a 20 character phone, 500 characters of notes", () => {
    expect(validateTenancyFields({ moveIn: "2026-10-01", advance: 0 }).advance).toBe(0);
    expect(validateTenancyFields({ moveIn: "2026-10-01", advance: MAX_RUPEES }).advance).toBe(MAX_RUPEES);
    expect(validateTenancyFields({ moveIn: "2026-10-01", phone: "9".repeat(20) }).phone).toHaveLength(20);
    expect(validateTenancyFields({ moveIn: "2026-10-01", notes: "n".repeat(500) }).notes).toHaveLength(500);
  });

  it("accepts an agreement end on the move-in day and an explicit null advance", () => {
    const fields = validateTenancyFields({ moveIn: "2026-10-01", agreementEnd: "2026-10-01", advance: null });
    expect(fields.agreementEnd).toBe("2026-10-01");
    expect(fields.advance).toBeNull();
  });

  it("refuses a phone with a letter", () => {
    expect(validationMessage(() => validateTenancyFields({ moveIn: "2026-10-01", phone: "98765x" }))).toMatch(
      /Phone can only have/,
    );
  });

  it("refuses a phone of 21 characters", () => {
    expect(validationMessage(() => validateTenancyFields({ moveIn: "2026-10-01", phone: "9".repeat(21) }))).toMatch(
      /Phone can have at most 20 characters/,
    );
  });

  it("refuses a missing or unreal move-in date", () => {
    expect(validationMessage(() => validateTenancyFields({ moveIn: "" }))).toMatch(/Move-in date is required/);
    expect(validationMessage(() => validateTenancyFields({ moveIn: "   " }))).toMatch(/Move-in date is required/);
    expect(validationMessage(() => validateTenancyFields({ moveIn: "2026-02-30" }))).toMatch(
      /Move-in date must be a real date/,
    );
    expect(validationMessage(() => validateTenancyFields({ moveIn: "01/10/2026" }))).toMatch(
      /Move-in date must be a real date/,
    );
  });

  it("refuses an agreement end that is not a real day", () => {
    expect(
      validationMessage(() => validateTenancyFields({ moveIn: "2026-10-01", agreementEnd: "next year" })),
    ).toMatch(/Agreement end must be a real date/);
  });

  it("refuses an agreement end before the move-in date", () => {
    expect(
      validationMessage(() => validateTenancyFields({ moveIn: "2026-10-01", agreementEnd: "2026-09-30" })),
    ).toMatch(/Agreement end cannot be before the move-in date/);
  });

  it("refuses an advance date that is not a real day", () => {
    expect(
      validationMessage(() => validateTenancyFields({ moveIn: "2026-10-01", advanceDate: "2026-13-01" })),
    ).toMatch(/Advance date must be a real date/);
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
});
