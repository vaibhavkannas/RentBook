import { describe, expect, it } from "vitest";
import {
  buildPaymentRequest,
  existingEntryFrom,
  LOG_RETRY_FAILED_MESSAGE,
  LOG_RETRY_UNCONFIRMED_MESSAGE,
  LOG_RETRY_UNUSABLE_MESSAGE,
  logRetryFailureMessage,
  paymentOutcome,
  TENANCY_NOT_SAVED_MESSAGE,
  type PaymentRequestInput,
} from "@/lib/payment-request";

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

describe("existingEntryFrom", () => {
  it("reads tenant, count and amount from the details of a duplicate warning", () => {
    expect(
      existingEntryFrom({ existingAmount: 5450, existingTenant: "Asha", existingCount: 4 }),
    ).toEqual(SEEN);
  });

  it("allows a tenant name that is empty, as a payment recorded without one can be", () => {
    expect(existingEntryFrom({ existingAmount: 5450, existingTenant: "", existingCount: 1 })).toEqual({
      tenant: "",
      count: 1,
      amount: 5450,
    });
  });

  it("gives nothing when any of the three is missing or of the wrong kind, so no Replace is offered", () => {
    for (const details of [
      undefined,
      {},
      { existingAmount: 5450, existingTenant: "Asha" },
      { existingTenant: "Asha", existingCount: 4 },
      { existingAmount: 5450, existingCount: 4 },
      { existingAmount: "5450", existingTenant: "Asha", existingCount: 4 },
      { existingAmount: 5450, existingTenant: "Asha", existingCount: "4" },
      { existingAmount: 5450, existingTenant: 7, existingCount: 4 },
      { existingAmount: Number.NaN, existingTenant: "Asha", existingCount: 4 },
    ]) {
      expect(existingEntryFrom(details)).toBeNull();
    }
  });
});

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

  it("makes a confirmed replace carry the entry the duplicate warning named", () => {
    const result = buildPaymentRequest({ ...base, amount: 6000, confirmedReplace: true, seenEntry: SEEN });
    expect(result).toMatchObject({ ok: true, body: { overwrite: true, expected: SEEN, amount: 6000 } });
  });

  it("does the same for a replace in the new tenant sheet", () => {
    const result = buildPaymentRequest({
      ...base,
      mode: "new-tenant",
      tenantName: "Farah",
      confirmedReplace: true,
      seenEntry: SEEN,
    });
    expect(result).toMatchObject({
      ok: true,
      body: { overwrite: true, expected: SEEN, newTenantName: "Farah" },
    });
  });

  it("refuses to build a replace that has no entry to compare against", () => {
    for (const mode of ["log", "new-tenant"] as const) {
      const result = buildPaymentRequest({ ...base, mode, confirmedReplace: true, seenEntry: undefined });
      expect(result.ok).toBe(false);
      expect(result.ok ? "" : result.message).toMatch(/no longer recorded/);
    }
  });

  it("sends no expected entry unless the person replaced or edited, even when an entry is given", () => {
    const result = buildPaymentRequest({ ...base, seenEntry: SEEN });
    expect(result).toMatchObject({ ok: true, body: { overwrite: undefined, expected: undefined } });
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

    it("sends exactly the tenancy it is given: the sheet decides whether there is one", () => {
      // buildPaymentRequest never second-guesses the object, even a mostly empty one.
      for (const given of [
        { moveIn: "2026-10-05" },
        { moveIn: "" },
        { moveIn: "2026-10-05", phone: "", advance: null },
        { moveIn: "", advance: 0 },
      ]) {
        const result = buildPaymentRequest({ ...newTenant, tenancy: given });
        expect(result).toMatchObject({ ok: true, body: { tenancy: given } });
        expect(result.ok && result.body.tenancy).toBe(given);
      }
    });

    it("sends the tenancy next to the new tenant's name and the payment", () => {
      const result = buildPaymentRequest({ ...newTenant, tenancy: { moveIn: "2026-10-01", advance: 5000 } });
      expect(result).toEqual({
        ok: true,
        body: {
          month: "2026-10",
          portionId: "p1",
          amount: 5450,
          dateReceived: "2026-10-05",
          newTenantName: "Hari",
          overwrite: undefined,
          expected: undefined,
          tenancy: { moveIn: "2026-10-01", advance: 5000 },
        },
      });
    });

    it("ignores tenancy details outside the new tenant mode", () => {
      for (const mode of ["log", "edit"] as const) {
        const result = buildPaymentRequest({ ...base, mode, seenEntry: SEEN, tenancy: details });
        expect(result.ok && result.body.tenancy).toBeUndefined();
      }
    });
  });
});

describe("paymentOutcome", () => {
  it("closes the sheet when the payment, the log and the tenancy all saved", () => {
    expect(paymentOutcome({ ok: true, logWritten: true, tenancyWritten: true })).toEqual({
      retryToken: null,
      tenancyNotSaved: false,
      done: true,
    });
  });

  it("closes the sheet for a payment that had no tenancy part (tenancyWritten is absent)", () => {
    expect(paymentOutcome({ ok: true })).toEqual({ retryToken: null, tenancyNotSaved: false, done: true });
    expect(paymentOutcome({ ok: true, logWritten: true })).toMatchObject({ done: true });
  });

  it("keeps the retry token for a retry when the log entry did not save", () => {
    expect(paymentOutcome({ ok: true, logWritten: false, retryToken: "tok.en" })).toEqual({
      retryToken: "tok.en",
      tenancyNotSaved: false,
      done: false,
    });
    // No token came back: the sheet still warns, and the retry will be refused with a plain message.
    expect(paymentOutcome({ ok: true, logWritten: false })).toEqual({
      retryToken: "",
      tenancyNotSaved: false,
      done: false,
    });
  });

  it("warns, and does not close, when the tenancy details did not save", () => {
    expect(paymentOutcome({ ok: true, logWritten: true, tenancyWritten: false })).toEqual({
      retryToken: null,
      tenancyNotSaved: true,
      done: false,
    });
  });

  it("reports both problems together", () => {
    expect(paymentOutcome({ ok: true, logWritten: false, retryToken: "x.y", tenancyWritten: false })).toEqual({
      retryToken: "x.y",
      tenancyNotSaved: true,
      done: false,
    });
  });

  it("has neutral wording for the tenancy warning", () => {
    expect(TENANCY_NOT_SAVED_MESSAGE).toBe(
      "Payment saved, but the tenancy details weren't saved. Open the card's details page to check or add them.",
    );
  });
});

describe("logRetryFailureMessage", () => {
  it("says it could not confirm when the retry got no answer at all (a timeout or a dropped connection)", () => {
    expect(logRetryFailureMessage(null)).toBe(LOG_RETRY_UNCONFIRMED_MESSAGE);
    expect(LOG_RETRY_UNCONFIRMED_MESSAGE).toBe(
      "Couldn't confirm that the log entry saved. Check the Activity screen before trying again.",
    );
  });

  it("says the retry can no longer be used when the server refused the token", () => {
    const refused = { ok: false, error: { code: "validation", message: "This retry has expired." } };
    expect(logRetryFailureMessage(refused)).toBe(LOG_RETRY_UNUSABLE_MESSAGE);
    expect(LOG_RETRY_UNUSABLE_MESSAGE).toBe(
      "This retry can no longer be used. The change itself is safe in your Schedule. Check the Activity screen, and add the Payments Log entry by hand if it is missing.",
    );
  });

  it("keeps the plain failure wording for a real answer that says the entry did not save", () => {
    expect(logRetryFailureMessage({ ok: true, logWritten: false })).toBe(LOG_RETRY_FAILED_MESSAGE);
    expect(logRetryFailureMessage({ ok: false })).toBe(LOG_RETRY_FAILED_MESSAGE);
    expect(LOG_RETRY_FAILED_MESSAGE).toBe(
      "The log entry still didn't save. The payment itself is safe in your Schedule.",
    );
  });
});
