import { describe, expect, it } from "vitest";
import { hasTenancyDetails, newTenantDetails, parseRupees } from "@/lib/tenancy-input";

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
