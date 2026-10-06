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
    },
  };
}
