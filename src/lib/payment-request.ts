import type { TenancyFields } from "@/lib/domain/tenancy";
import { RELOAD_STEP } from "@/lib/recovery-hint";
import type { PortionEntry } from "@/lib/domain/types";
import { stripRupeeFormatting } from "@/lib/format";

export type PaymentRequestInput = {
  mode: "log" | "edit" | "new-tenant";
  monthKey: string;
  portionId: string;
  /** The amount as typed. Blank and not-a-number are told apart, and each says so beside the amount field. */
  amountText: string;
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
  /** `field` is the sheet's own name for the field the message is about (`amount`, `tenantName`), when there is one. */
  | { ok: false; message: string; field?: string };

/** Shown when the amount field is blank. */
export const AMOUNT_BLANK_MESSAGE = "Enter the amount received.";

/** Shown when the amount typed is not a number at all (text such as "5k", or "Infinity"). */
export const AMOUNT_NOT_A_NUMBER_MESSAGE = "Enter the amount as a whole number.";

/** Shown when a new tenant is being added and the name field is blank. */
export const NEW_TENANT_NAME_BLANK_MESSAGE = "Enter the new tenant's name.";

/**
 * The amount typed into the sheet as a number. Commas, spaces and a rupee sign are ignored, like in the other
 * rupee fields. NaN, or Infinity, when it is not a number; a blank field is NaN too, not 0.
 */
export function amountFromText(text: string): number {
  const cleaned = stripRupeeFormatting(text);
  return cleaned === "" ? Number.NaN : Number(cleaned);
}

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
 * A blank new-tenant name, a blank amount and an amount that is not a number are refused here, before any request is
 * sent, each naming its field, in the order the fields are on the screen. Whether the amount is a whole number of rupees
 * in range is for the server to say.
 */
export function buildPaymentRequest(input: PaymentRequestInput): PaymentRequest {
  if (input.mode === "new-tenant" && input.tenantName.trim() === "") {
    return { ok: false, message: NEW_TENANT_NAME_BLANK_MESSAGE, field: "tenantName" };
  }
  if (stripRupeeFormatting(input.amountText) === "") return { ok: false, message: AMOUNT_BLANK_MESSAGE, field: "amount" };
  const amount = amountFromText(input.amountText);
  // JSON has no NaN or Infinity: they would reach the server as null and be refused with a message about the format.
  if (!Number.isFinite(amount)) return { ok: false, message: AMOUNT_NOT_A_NUMBER_MESSAGE, field: "amount" };
  const editing = input.mode === "edit";
  const replacing = editing || input.confirmedReplace;
  if (replacing && !input.seenEntry) {
    return {
      ok: false,
      message: `This payment is no longer recorded. Close this, then ${RELOAD_STEP}.`,
    };
  }
  return {
    ok: true,
    body: {
      month: input.monthKey,
      portionId: input.portionId,
      amount,
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

/** Shown when the server refused the retry itself: its token expired, or was not valid for this person. */
export const LOG_RETRY_UNUSABLE_MESSAGE =
  "This retry can no longer be used. The change itself is safe in your Schedule. Check the Activity screen, and add the Payments Log entry by hand if it is missing.";

/** The parts of the answer of POST /api/payments/log-retry that decide what to tell the person. */
export type LogRetryResponse = { ok: boolean; logWritten?: boolean; error?: { code: string; message?: string } };

/**
 * What to tell the person when retrying the Payments Log entry did not succeed. `body` is the answer of
 * POST /api/payments/log-retry, or null when none arrived (a timeout or a dropped connection): the retry may
 * then have gone through, so the person is sent to the Activity screen instead of being told it failed.
 * A "validation" answer means the token was refused (too old, or not theirs), and trying again cannot help.
 */
export function logRetryFailureMessage(body: LogRetryResponse | null): string {
  if (body === null) return LOG_RETRY_UNCONFIRMED_MESSAGE;
  return body.error?.code === "validation" ? LOG_RETRY_UNUSABLE_MESSAGE : LOG_RETRY_FAILED_MESSAGE;
}

/** The parts of POST /api/payments' answer that decide what the sheet does after a save. */
export type PaymentResponse = {
  ok: boolean;
  logWritten?: boolean;
  /** Present when the log entry did not save: the signed token to send back to retry it. */
  retryToken?: string;
  /** Absent unless the payment started a new tenant. */
  tenancyWritten?: boolean;
};

export type PaymentOutcome = {
  /** The token to retry the Payments Log entry with, when it did not save. Null when it saved. */
  retryToken: string | null;
  tenancyNotSaved: boolean;
  /** Nothing to tell the person: the sheet can close. */
  done: boolean;
};

/** What the sheet does after the server accepted the payment. */
export function paymentOutcome(body: PaymentResponse): PaymentOutcome {
  // No token with a failed log entry is not expected; the retry would then be refused with a plain message.
  const retryToken = body.logWritten === false ? (body.retryToken ?? "") : null;
  const tenancyNotSaved = body.tenancyWritten === false;
  return { retryToken, tenancyNotSaved, done: retryToken === null && !tenancyNotSaved };
}
