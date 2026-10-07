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
  /** The paid card's entry as it was when the Edit sheet opened. Never read from a refreshed card. */
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
 * The body of POST /api/payments. An edit always says which entry it was shown, so the server
 * can refuse it if someone else has since changed or undone that payment.
 */
export function buildPaymentRequest(input: PaymentRequestInput): PaymentRequest {
  const editing = input.mode === "edit";
  if (editing && !input.seenEntry) {
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
      overwrite: input.confirmedReplace || editing ? true : undefined,
      expected: editing ? input.seenEntry : undefined,
      tenancy: input.mode === "new-tenant" ? input.tenancy : undefined,
    },
  };
}

/** Shown when the payment saved but the tenancy details that came with a new tenant did not. */
export const TENANCY_NOT_SAVED_MESSAGE =
  "Payment saved, but the tenancy details weren't saved. Open Details on the card to check or add them.";

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
