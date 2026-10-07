import { describe, expect, it } from "vitest";
import { buildPaymentRequest, type PaymentRequestInput } from "@/lib/payment-request";

const base: PaymentRequestInput = {
  mode: "log",
  monthKey: "2026-10",
  portionId: "p1",
  amount: 5450,
  dateReceived: "2026-10-05",
  tenantName: "",
  confirmedReplace: false,
  seenEntry: undefined,
};

const SEEN = { tenant: "Asha", count: 4, amount: 5450 };

describe("buildPaymentRequest", () => {
  it("sends a plain log with no overwrite and no expected entry", () => {
    expect(buildPaymentRequest(base)).toEqual({
      ok: true,
      body: {
        month: "2026-10",
        portionId: "p1",
        amount: 5450,
        dateReceived: "2026-10-05",
        newTenantName: undefined,
        overwrite: undefined,
        expected: undefined,
      },
    });
  });

  it("makes an edit carry the entry the person saw", () => {
    const result = buildPaymentRequest({ ...base, mode: "edit", amount: 6000, seenEntry: SEEN });
    expect(result).toMatchObject({
      ok: true,
      body: { overwrite: true, expected: SEEN, amount: 6000, newTenantName: undefined },
    });
  });

  it("refuses to build an edit that has no entry to compare against", () => {
    const result = buildPaymentRequest({ ...base, mode: "edit", seenEntry: undefined });
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.message).toMatch(/no longer recorded/);
  });

  it("sends overwrite for a confirmed replace without an expected entry", () => {
    const result = buildPaymentRequest({ ...base, confirmedReplace: true });
    expect(result).toMatchObject({ ok: true, body: { overwrite: true, expected: undefined } });
  });

  it("sends the new tenant's name only in the new tenant sheet", () => {
    const result = buildPaymentRequest({ ...base, mode: "new-tenant", tenantName: "Farah" });
    expect(result).toMatchObject({ ok: true, body: { newTenantName: "Farah", expected: undefined } });
    const logging = buildPaymentRequest({ ...base, tenantName: "Farah" });
    expect(logging).toMatchObject({ ok: true, body: { newTenantName: undefined } });
  });

  describe("tenancy details for a new tenant", () => {
    const details = {
      phone: "98000 12345",
      moveIn: "2026-10-01",
      agreementEnd: "2027-09-30",
      advance: 12000,
      advanceDate: "2026-09-28",
      notes: "Cheque",
    };
    const newTenant: PaymentRequestInput = { ...base, mode: "new-tenant", tenantName: "Hari" };

    it("sends the tenancy details in the new tenant request", () => {
      const result = buildPaymentRequest({ ...newTenant, tenancy: details });
      expect(result).toMatchObject({ ok: true, body: { newTenantName: "Hari", tenancy: details } });
    });

    it("sends no tenancy when none was given", () => {
      const result = buildPaymentRequest(newTenant);
      expect(result.ok && result.body.tenancy).toBeUndefined();
    });

    it.each([
      ["every field is empty", { moveIn: "", phone: "", agreementEnd: "", advance: null, advanceDate: "", notes: "" }],
      ["every field is blank or spaces", { moveIn: "  ", phone: " ", notes: "\t" }],
      ["only an empty move-in is there", { moveIn: "" }],
      ["the advance is undefined and the text is empty", { moveIn: "", advance: undefined }],
    ])("leaves the tenancy out when %s", (_name, empty) => {
      const result = buildPaymentRequest({ ...newTenant, tenancy: empty });
      expect(result.ok).toBe(true);
      expect(result.ok && result.body.tenancy).toBeUndefined();
    });

    it.each([
      ["a move-in date", { moveIn: "2026-10-01" }],
      ["a phone", { moveIn: "", phone: "98000 12345" }],
      ["an agreement end", { moveIn: "", agreementEnd: "2027-09-30" }],
      ["an advance date", { moveIn: "", advanceDate: "2026-09-28" }],
      ["notes", { moveIn: "", notes: "Cheque" }],
      ["an advance of zero", { moveIn: "", advance: 0 }],
      ["an advance", { moveIn: "", advance: 12000 }],
    ])("sends the tenancy when only %s is filled", (_name, partial) => {
      const result = buildPaymentRequest({ ...newTenant, tenancy: partial });
      expect(result).toMatchObject({ ok: true, body: { tenancy: partial } });
    });

    it("ignores tenancy details outside the new tenant mode", () => {
      for (const mode of ["log", "edit"] as const) {
        const result = buildPaymentRequest({ ...base, mode, seenEntry: SEEN, tenancy: details });
        expect(result.ok && result.body.tenancy).toBeUndefined();
      }
    });
  });
});
