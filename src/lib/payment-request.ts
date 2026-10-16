import type { TenancyFields } from "@/lib/domain/tenancy";
import type { PortionEntry } from "@/lib/domain/types";

export type PaymentRequestInput = {
  mode: "log" | "edit" | "new-tenant";
  monthKey: string;
  portionId: string;
  amount: number;
  dateReceived: string;
  tenantName: string;
  /** The person confirmed "Replace amount" after a duplicate warning. */
  confirmedReplace: boolean;
  /**
   * The entry the person was shown, which the server checks the Sheet still holds before it changes it: the paid
   * card's entry as it was when the Edit sheet opened, or the entry a duplicate warning named (see
   * `existingEntryFrom`). Never read from a refreshed card.
   */
  seenEntry: PortionEntry | undefined;
  /**
   * Details of the new tenant. The new tenant sheet decides whether there are any (see
   * newTenantDetails in tenancy-input.ts); whatever it passes here is sent as it is. Only used in the new-tenant mode.
   */
  tenancy?: TenancyFields;
};

export type PaymentRequest =
  | {
      ok: true;
      body: {
        month: string;
        portionId: string;
        amount: number;
        dateReceived: string;
        newTenantName: string | undefined;
        overwrite: true | undefined;
        expected: PortionEntry | undefined;
        /** Only in the new-tenant mode, and only when the sheet passed tenancy details. */
        tenancy: TenancyFields | undefined;
      };
    }
  | { ok: false; message: string };

/**
 * The entry a duplicate warning names, from the `details` of the server's conflict answer. Null unless it names
 * the tenant, the count and the amount: a Replace that cannot be checked against all three is not offered.
 */
export function existingEntryFrom(details: Record<string, unknown> | undefined): PortionEntry | null {
  const tenant = details?.existingTenant;
  const count = details?.existingCount;
  const amount = details?.existingAmount;
  if (typeof tenant !== "string" || typeof count !== "number" || typeof amount !== "number") return null;
  if (!Number.isFinite(count) || !Number.isFinite(amount)) return null;
  return { tenant, count, amount };
}

/**
 * The body of POST /api/payments. An edit, and a Replace after a duplicate warning, always say which entry the
 * person was shown, so the server can refuse them if someone else has since changed or undone that payment.
 */
export function buildPaymentRequest(input: PaymentRequestInput): PaymentRequest {
  const editing = input.mode === "edit";
  const replacing = editing || input.confirmedReplace;
  if (replacing && !input.seenEntry) {
    return {
      ok: false,
      message: "This payment is no longer recorded. Close this and refresh the page.",
    };
  }
  return {
    ok: true,
    body: {
      month: input.monthKey,
      portionId: input.portionId,
      amount: input.amount,
      dateReceived: input.dateReceived,
      newTenantName: input.mode === "new-tenant" ? input.tenantName : undefined,
      overwrite: replacing ? true : undefined,
      expected: replacing ? input.seenEntry : undefined,
      tenancy: input.mode === "new-tenant" ? input.tenancy : undefined,
    },
  };
}

/** Shown when the payment saved but the tenancy details that came with a new tenant did not. */
export const TENANCY_NOT_SAVED_MESSAGE =
  "Payment saved, but the tenancy details weren't saved. Open the card's details page to check or add them.";

/** Shown when the retry got a real answer and the Payments Log entry still did not save. */
export const LOG_RETRY_FAILED_MESSAGE =
  "The log entry still didn't save. The payment itself is safe in your Schedule.";

/** Shown when the retry got no answer at all, so the entry may have been saved after all. */
export const LOG_RETRY_UNCONFIRMED_MESSAGE =
  "Couldn't confirm that the log entry saved. Check the Activity screen before trying again.";

/**
 * What to tell the person when retrying the Payments Log entry did not succeed. `body` is the answer of
 * POST /api/payments/log-retry, or null when none arrived (a timeout or a dropped connection): the retry may
 * then have gone through, so the person is sent to the Activity screen instead of being told it failed.
 */
export function logRetryFailureMessage(body: { ok: boolean; logWritten?: boolean } | null): string {
  return body === null ? LOG_RETRY_UNCONFIRMED_MESSAGE : LOG_RETRY_FAILED_MESSAGE;
}

/** The parts of POST /api/payments' answer that decide what the sheet does after a save. */
export type PaymentResponse = {
  ok: boolean;
  logWritten?: boolean;
  logRow?: unknown[];
  /** Absent unless the payment started a new tenant. */
  tenancyWritten?: boolean;
};

export type PaymentOutcome = {
  /** The Payments Log row to retry, when the log entry did not save. */
  pendingLogRow: unknown[] | null;
  tenancyNotSaved: boolean;
  /** Nothing to tell the person: the sheet can close. */
  done: boolean;
};

/** What the sheet does after the server accepted the payment. */
export function paymentOutcome(body: PaymentResponse): PaymentOutcome {
  const pendingLogRow = body.logWritten === false ? (body.logRow ?? []) : null;
  const tenancyNotSaved = body.tenancyWritten === false;
  return { pendingLogRow, tenancyNotSaved, done: pendingLogRow === null && !tenancyNotSaved };
}
