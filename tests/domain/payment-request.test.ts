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
});
