import { describe, expect, it } from "vitest";
import {
  buildMoveOutRequest,
  buildTenancyRequest,
  emptyMoveOutForm,
  emptyTenancyForm,
  hasTenancyDetails,
  newTenantDetails,
  parseRupees,
  tenancyFormText,
} from "@/lib/tenancy-input";

describe("parseRupees", () => {
  it.each([
    ["", null],
    ["   ", null],
    ["0", 0],
    ["20000", 20000],
    ["20,000", 20000],
    ["1,00,000", 100000],
    ["  ₹ 5,450 ", 5450],
    ["10000000", 10_000_000],
  ])("reads %j as %j", (text, value) => {
    expect(parseRupees(text, "Advance")).toEqual({ ok: true, value });
  });

  it.each(["1.5", "-5", "abc", "12a", "1e3", "5 000 x", "10000001", "99999999999999999999999"])(
    "refuses %j with a message that names the field",
    (text) => {
      const result = parseRupees(text, "Refund");
      expect(result.ok).toBe(false);
      expect(result.ok ? "" : result.message).toBe("Refund must be a whole number of rupees from 0 to 10,000,000.");
    },
  );
});

describe("hasTenancyDetails", () => {
  const TODAY = "2026-10-05";

  it("is false for an untouched section", () => {
    expect(hasTenancyDetails({ moveIn: TODAY }, TODAY)).toBe(false);
    expect(
      hasTenancyDetails(
        { moveIn: TODAY, phone: "", agreementEnd: "", advance: null, advanceDate: "", notes: "" },
        TODAY,
      ),
    ).toBe(false);
  });

  it("does not count spaces, or a move-in written with spaces around the default", () => {
    expect(hasTenancyDetails({ moveIn: ` ${TODAY} `, phone: "  ", notes: "\t" }, TODAY)).toBe(false);
  });

  it.each([
    ["an advance", { advance: 12000 }],
    ["an advance of zero", { advance: 0 }],
    ["an advance date", { advanceDate: "2026-09-28" }],
    ["an agreement end", { agreementEnd: "2027-09-30" }],
    ["a phone", { phone: "98000 12345" }],
    ["notes", { notes: "Cheque" }],
    ["a move-in that is not the default", { moveIn: "2026-10-01" }],
    ["a cleared move-in", { moveIn: "" }],
  ])("is true when there is %s", (_name, partial) => {
    expect(hasTenancyDetails({ moveIn: TODAY, ...partial }, TODAY)).toBe(true);
  });

  it("returns a plain boolean, and an advance that is not a finite number does not count", () => {
    expect(hasTenancyDetails({ moveIn: TODAY, advance: 5 }, TODAY)).toBe(true);
    expect(hasTenancyDetails({ moveIn: TODAY, advance: Number.NaN }, TODAY)).toBe(false);
    expect(hasTenancyDetails({ moveIn: TODAY, advance: Number.POSITIVE_INFINITY }, TODAY)).toBe(false);
    expect(hasTenancyDetails({ moveIn: TODAY, advance: undefined }, TODAY)).toBe(false);
  });
});

describe("newTenantDetails", () => {
  const TODAY = "2026-10-05";
  const untouched = { moveIn: TODAY, advance: "", advanceDate: "", agreementEnd: "", phone: "" };

  it("sends nothing for an untouched section", () => {
    expect(newTenantDetails(untouched, TODAY)).toEqual({ ok: true, tenancy: undefined });
  });

  it("sends nothing when the only text is spaces", () => {
    expect(newTenantDetails({ ...untouched, advance: "  ", phone: " " }, TODAY)).toEqual({
      ok: true,
      tenancy: undefined,
    });
  });

  it.each([
    ["an advance", { advance: "12,000" }],
    ["an advance date", { advanceDate: "2026-09-28" }],
    ["an agreement end", { agreementEnd: "2027-09-30" }],
    ["a phone", { phone: "98000 12345" }],
  ])("sends the details, with the default move-in, when only %s is filled", (_name, partial) => {
    const result = newTenantDetails({ ...untouched, ...partial }, TODAY);
    expect(result.ok && result.tenancy).toMatchObject({ moveIn: TODAY });
    expect(result.ok && result.tenancy).toBeDefined();
  });

  it("sends every field the person filled in, cleaned", () => {
    const result = newTenantDetails(
      {
        moveIn: " 2026-10-01 ",
        advance: "₹ 12,000",
        advanceDate: "2026-09-28",
        agreementEnd: "2027-09-30",
        phone: " 98000 12345 ",
      },
      TODAY,
    );
    expect(result).toEqual({
      ok: true,
      tenancy: {
        moveIn: "2026-10-01",
        advance: 12000,
        advanceDate: "2026-09-28",
        agreementEnd: "2027-09-30",
        phone: "98000 12345",
      },
    });
  });

  it("sends the details when only the move-in date was changed", () => {
    expect(newTenantDetails({ ...untouched, moveIn: "2026-10-01" }, TODAY)).toEqual({
      ok: true,
      tenancy: { moveIn: "2026-10-01", advance: null, advanceDate: "", agreementEnd: "", phone: "" },
    });
  });

  it("keeps an advance of zero", () => {
    const result = newTenantDetails({ ...untouched, advance: "0" }, TODAY);
    expect(result.ok && result.tenancy?.advance).toBe(0);
  });

  it("refuses an advance that is not a whole number of rupees, even when nothing else is filled", () => {
    for (const advance of ["abc", "1.5", "-1", "10000001"]) {
      const result = newTenantDetails({ ...untouched, advance }, TODAY);
      expect(result.ok).toBe(false);
      expect(result.ok ? "" : result.message).toMatch(/^Advance must be a whole number of rupees/);
    }
  });

  it("refuses details that have no move-in date", () => {
    for (const form of [{ ...untouched, moveIn: "" }, { ...untouched, moveIn: "  ", phone: "98000 12345" }]) {
      const result = newTenantDetails(form, TODAY);
      expect(result.ok).toBe(false);
      expect(result.ok ? "" : result.message).toMatch(/move-in date/i);
    }
  });
});

describe("emptyTenancyForm and tenancyFormText", () => {
  it("starts an empty form on the given move-in day", () => {
    expect(emptyTenancyForm("2026-10-05")).toEqual({
      phone: "",
      moveIn: "2026-10-05",
      agreementEnd: "",
      advance: "",
      advanceDate: "",
      notes: "",
    });
  });

  it("fills the form from a tenancy, with the advance as text", () => {
    expect(
      tenancyFormText({
        phone: "98765 43210",
        moveIn: "2026-01-15",
        agreementEnd: "2027-01-14",
        advance: 20000,
        advanceDate: "2026-01-10",
        notes: "Paid by cheque",
      }),
    ).toEqual({
      phone: "98765 43210",
      moveIn: "2026-01-15",
      agreementEnd: "2027-01-14",
      advance: "20000",
      advanceDate: "2026-01-10",
      notes: "Paid by cheque",
    });
  });

  it("shows no advance as an empty field and an advance of zero as 0", () => {
    const base = { phone: "", moveIn: "2026-01-15", agreementEnd: "", advanceDate: "", notes: "" };
    expect(tenancyFormText({ ...base, advance: null }).advance).toBe("");
    expect(tenancyFormText({ ...base, advance: 0 }).advance).toBe("0");
  });
});

describe("buildTenancyRequest", () => {
  const form = {
    phone: " 98765 43210 ",
    moveIn: "2026-01-15",
    agreementEnd: "2027-01-14",
    advance: "20,000",
    advanceDate: "2026-01-10",
    notes: "  Paid by cheque ",
  };
  const fields = {
    phone: "98765 43210",
    moveIn: "2026-01-15",
    agreementEnd: "2027-01-14",
    advance: 20000,
    advanceDate: "2026-01-10",
    notes: "Paid by cheque",
  };

  it("builds a create request with the tenant name the page showed", () => {
    expect(buildTenancyRequest({ mode: "create", portionId: "p1", tenant: "Asha" }, form)).toEqual({
      ok: true,
      body: { portionId: "p1", tenant: "Asha", fields },
    });
  });

  it("builds an edit request with the id and the updated-at the page was rendered with", () => {
    expect(
      buildTenancyRequest(
        { mode: "edit", portionId: "p1", tenant: "Asha", id: "t-1", expectedUpdatedAt: "2026-01-15T05:00:00.000Z" },
        form,
      ),
    ).toEqual({
      ok: true,
      body: {
        portionId: "p1",
        tenant: "Asha",
        id: "t-1",
        expectedUpdatedAt: "2026-01-15T05:00:00.000Z",
        fields,
      },
    });
  });

  it("sends an empty updated-at as it is: a hand-typed row can have none", () => {
    const result = buildTenancyRequest(
      { mode: "edit", portionId: "p1", tenant: "Asha", id: "t-1", expectedUpdatedAt: "" },
      form,
    );
    expect(result.ok && "expectedUpdatedAt" in result.body && result.body.expectedUpdatedAt).toBe("");
  });

  it("sends no advance as null", () => {
    const result = buildTenancyRequest({ mode: "create", portionId: "p1", tenant: "Asha" }, { ...form, advance: " " });
    expect(result.ok && result.body.fields.advance).toBeNull();
  });

  it("refuses an advance that is not a whole number of rupees", () => {
    const result = buildTenancyRequest({ mode: "create", portionId: "p1", tenant: "Asha" }, { ...form, advance: "2.5k" });
    expect(result).toEqual({
      ok: false,
      message: "Advance must be a whole number of rupees from 0 to 10,000,000.",
    });
  });

  it("refuses a form with no move-in date", () => {
    const result = buildTenancyRequest({ mode: "create", portionId: "p1", tenant: "Asha" }, { ...form, moveIn: " " });
    expect(result).toEqual({ ok: false, message: "Move-in date is required." });
  });
});

describe("emptyMoveOutForm", () => {
  it("starts on the given day, with the outcome the tenancy has and its notes", () => {
    expect(emptyMoveOutForm("2026-10-05", { advanceStatus: "Adjusted", notes: "Cheque" })).toEqual({
      moveOut: "2026-10-05",
      advanceStatus: "Adjusted",
      refund: "",
      deductions: "",
      notes: "Cheque",
    });
  });
  it("starts the outcome as Held when none is known", () => {
    expect(emptyMoveOutForm("2026-10-05", { advanceStatus: null, notes: "" }).advanceStatus).toBe("Held");
  });
});

describe("buildMoveOutRequest", () => {
  const target = { id: "t-1", expectedUpdatedAt: "2026-01-15T05:00:00.000Z", hasAdvance: true, initialNotes: "Cheque" };
  const form = { moveOut: "2026-09-30", advanceStatus: "Refunded" as const, refund: "15,000", deductions: "5000", notes: "Cheque" };

  it("sends the id, the updated-at the page had, the date, the outcome, the refund and the deductions", () => {
    expect(buildMoveOutRequest(target, form)).toEqual({
      ok: true,
      body: {
        id: "t-1",
        expectedUpdatedAt: "2026-01-15T05:00:00.000Z",
        moveOut: "2026-09-30",
        advanceStatus: "Refunded",
        refund: 15000,
        deductions: 5000,
      },
    });
  });

  it("sends the notes only when the person changed them", () => {
    const unchanged = buildMoveOutRequest(target, { ...form, notes: " Cheque " });
    expect(unchanged.ok && "notes" in unchanged.body).toBe(false);
    const changed = buildMoveOutRequest(target, { ...form, notes: " Left the keys " });
    expect(changed.ok && changed.body.notes).toBe("Left the keys");
    const cleared = buildMoveOutRequest(target, { ...form, notes: "" });
    expect(cleared.ok && cleared.body.notes).toBe("");
  });

  it("leaves out an empty refund and empty deductions", () => {
    const result = buildMoveOutRequest(target, { ...form, refund: "", deductions: " " });
    expect(result.ok && "refund" in result.body).toBe(false);
    expect(result.ok && "deductions" in result.body).toBe(false);
  });

  it("keeps a refund or deductions of zero", () => {
    const result = buildMoveOutRequest(target, { ...form, refund: "0", deductions: "0" });
    expect(result.ok && result.body.refund).toBe(0);
    expect(result.ok && result.body.deductions).toBe(0);
  });

  it("sends no outcome for a tenancy without an advance", () => {
    const result = buildMoveOutRequest({ ...target, hasAdvance: false }, form);
    expect(result.ok && "advanceStatus" in result.body).toBe(false);
  });

  it("sends an empty updated-at as it is", () => {
    const result = buildMoveOutRequest({ ...target, expectedUpdatedAt: "" }, form);
    expect(result.ok && result.body.expectedUpdatedAt).toBe("");
  });

  it("refuses a missing move-out date", () => {
    expect(buildMoveOutRequest(target, { ...form, moveOut: "" })).toEqual({
      ok: false,
      message: "Move-out date is required.",
    });
  });

  it("names the field when the refund or the deductions are wrong", () => {
    expect(buildMoveOutRequest(target, { ...form, refund: "ten" })).toEqual({
      ok: false,
      message: "Refund must be a whole number of rupees from 0 to 10,000,000.",
    });
    expect(buildMoveOutRequest(target, { ...form, deductions: "-5" })).toEqual({
      ok: false,
      message: "Deductions must be a whole number of rupees from 0 to 10,000,000.",
    });
  });
});
